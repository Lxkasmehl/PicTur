"""
Domain logic of the database-backed research groups (used by routes/orgs_api.py).
"""

import re
import secrets
import time
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from orgs import matching, media, storage
from orgs.db import Session
from orgs.models import (
    TURTLE_SEXES,
    TURTLE_STATUSES,
    Image,
    Region,
    Sighting,
    Submission,
    Turtle,
    utcnow,
)


class ServiceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------- parsing ----------

def parse_datetime(value):
    """ISO date or datetime -> aware datetime (UTC if no offset). None/'' -> None."""
    if value in (None, ''):
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
        except ValueError:
            raise ServiceError(f'Invalid date: {value}')
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_float(value, name, lo=None, hi=None):
    if value in (None, ''):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ServiceError(f'{name} must be a number')
    if (lo is not None and f < lo) or (hi is not None and f > hi):
        raise ServiceError(f'{name} is out of range')
    return f


def clean_text(value, name, max_len):
    if value is None:
        return None
    s = str(value).strip()
    if len(s) > max_len:
        raise ServiceError(f'{name} is too long (max {max_len} characters)')
    return s or None


def require_region(org_id, region_id):
    """Validate that region_id (may be None) belongs to the group."""
    if region_id in (None, ''):
        return None
    try:
        rid = int(region_id)
    except (TypeError, ValueError):
        raise ServiceError('Invalid region')
    exists = Session.query(Region.id).filter(Region.org_id == org_id, Region.id == rid).first()
    if not exists:
        raise ServiceError('Region not found', 404)
    return rid


# ---------- IDs ----------

def new_primary_id():
    """Same scheme as the main group's Primary ID: 'T' + ms timestamp + 9 random digits."""
    return f'T{int(time.time() * 1000)}{secrets.randbelow(1_000_000_000):09d}'


_BIO_RE = re.compile(r'^([FMU])(\d+)$')


def next_bio_id(org_id, sex):
    """Sex letter + running number per group and letter (F1, F2, M1, ...)."""
    letter = sex if sex in TURTLE_SEXES else 'U'
    rows = Session.query(Turtle.bio_id).filter(
        Turtle.org_id == org_id, Turtle.bio_id.like(f'{letter}%')
    ).all()
    highest = 0
    for (bio,) in rows:
        m = _BIO_RE.match(bio or '')
        if m:
            highest = max(highest, int(m.group(2)))
    return f'{letter}{highest + 1}'


# ---------- serialization ----------

def region_dict(r):
    return {'id': r.id, 'parent_id': r.parent_id, 'name': r.name}


def image_dict(slug, img):
    return {
        'id': img.id,
        'url': media.image_url(slug, img.org_id, img.id),
        'is_reference': bool(img.is_reference),
        'sighting_id': img.sighting_id,
        'created_at': _iso(img.created_at),
    }


def sighting_dict(s):
    return {
        'id': s.id,
        'observed_at': _iso(s.observed_at),
        'region_id': s.region_id,
        'lat': s.lat,
        'lon': s.lon,
        'observer_name': s.observer_name,
        'measurements': s.measurements or {},
        'notes': s.notes,
        'created_at': _iso(s.created_at),
    }


def reference_image(turtle):
    return next((i for i in turtle.images if i.is_reference), None)


def turtle_summary(slug, t, sighting_count=None, last_seen=None):
    ref = reference_image(t)
    return {
        'id': t.id,
        'primary_id': t.primary_id,
        'bio_id': t.bio_id,
        'name': t.name,
        'sex': t.sex,
        'species': t.species,
        'region_id': t.region_id,
        'status': t.status,
        'reference_image_url': media.image_url(slug, t.org_id, ref.id) if ref else None,
        'sighting_count': sighting_count if sighting_count is not None else len(t.sightings),
        'last_seen': _iso(last_seen) if last_seen is not None else _iso(_last_seen(t)),
    }


def turtle_detail(slug, t):
    return {
        **turtle_summary(slug, t),
        'notes': t.notes,
        'extra': t.extra or {},
        'created_at': _iso(t.created_at),
        'updated_at': _iso(t.updated_at),
        'sightings': [sighting_dict(s) for s in t.sightings],
        'images': [image_dict(slug, i) for i in t.images],
    }


def submission_dict(slug, s, turtles_by_id=None):
    candidates = []
    for c in s.candidates or []:
        t = (turtles_by_id or {}).get(c.get('turtle_id'))
        if turtles_by_id is not None and t is None:
            continue  # turtle deleted since matching
        entry = dict(c)
        if t is not None:
            entry['turtle'] = turtle_summary(slug, t)
        candidates.append(entry)
    return {
        'id': s.id,
        'status': s.status,
        'match_state': s.match_state,
        'image_url': media.submission_url(slug, s.org_id, s.id),
        'uploader_email': s.uploader_email,
        'uploader_is_staff': bool(s.uploader_is_staff),
        'observed_at': _iso(s.observed_at),
        'region_id': s.region_id,
        'lat': s.lat,
        'lon': s.lon,
        'notes': s.notes,
        'candidates': candidates,
        'resolved_turtle_id': s.resolved_turtle_id,
        'resolved_at': _iso(s.resolved_at),
        'created_at': _iso(s.created_at),
    }


def _last_seen(t):
    dates = [s.observed_at or s.created_at for s in t.sightings]
    return max(dates) if dates else None


def _iso(dt):
    if dt is None:
        return None
    if isinstance(dt, str):  # aggregate results on SQLite come back as text
        dt = parse_datetime(dt)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# ---------- turtles ----------

TURTLE_EDITABLE = ('name', 'sex', 'species', 'region_id', 'status', 'notes', 'extra')


def apply_turtle_fields(org_id, turtle, data):
    if 'name' in data:
        turtle.name = clean_text(data['name'], 'Name', 120)
    if 'sex' in data:
        sex = (data['sex'] or 'U').upper()
        if sex not in TURTLE_SEXES:
            raise ServiceError('Sex must be F, M or U')
        turtle.sex = sex
    if 'species' in data:
        turtle.species = clean_text(data['species'], 'Species', 120)
    if 'region_id' in data:
        turtle.region_id = require_region(org_id, data['region_id'])
    if 'status' in data:
        if data['status'] not in TURTLE_STATUSES:
            raise ServiceError(f'Status must be one of: {", ".join(TURTLE_STATUSES)}')
        turtle.status = data['status']
    if 'notes' in data:
        turtle.notes = clean_text(data['notes'], 'Notes', 5000)
    if 'extra' in data:
        if not isinstance(data['extra'], dict):
            raise ServiceError('extra must be an object')
        turtle.extra = data['extra']


def apply_sighting_fields(org_id, sighting, data):
    if 'observed_at' in data:
        sighting.observed_at = parse_datetime(data['observed_at'])
    if 'region_id' in data:
        sighting.region_id = require_region(org_id, data['region_id'])
    if 'lat' in data:
        sighting.lat = parse_float(data['lat'], 'Latitude', -90, 90)
    if 'lon' in data:
        sighting.lon = parse_float(data['lon'], 'Longitude', -180, 180)
    if 'observer_name' in data:
        sighting.observer_name = clean_text(data['observer_name'], 'Observer', 200)
    if 'notes' in data:
        sighting.notes = clean_text(data['notes'], 'Notes', 5000)
    if 'measurements' in data:
        m = data['measurements'] or {}
        if not isinstance(m, dict):
            raise ServiceError('measurements must be an object')
        sighting.measurements = {str(k)[:60]: v for k, v in m.items() if v not in (None, '')}


def set_reference(org_id, turtle, image):
    """Make `image` the turtle's matching reference (features computed if missing)."""
    if image.turtle_id != turtle.id:
        raise ServiceError('Image does not belong to this turtle')
    if not image.feature_path:
        pt = matching.extract_features(storage.abs_path(org_id, image.path))
        if not pt:
            raise ServiceError('Could not compute features for this image', 500)
        image.feature_path = storage.rel_path(org_id, pt)
    for other in turtle.images:
        if other.is_reference and other.id != image.id:
            other.is_reference = False
    Session.flush()
    image.is_reference = True
    Session.flush()


# ---------- submissions ----------

def run_matching(org_id, submission):
    """Compute features + candidates for a submission (updates the row, does not commit)."""
    full = storage.abs_path(org_id, submission.image_path)
    try:
        if not submission.feature_path:
            pt = matching.extract_features(full)
            if pt:
                submission.feature_path = storage.rel_path(org_id, pt)
        submission.candidates = matching.find_candidates(org_id, full, submission.region_id)
        submission.match_state = 'done'
    except Exception:
        submission.candidates = []
        submission.match_state = 'failed'
        raise


def candidate_turtles(org_id, submissions):
    ids = {c.get('turtle_id') for s in submissions for c in (s.candidates or [])}
    ids.discard(None)
    if not ids:
        return {}
    rows = Session.query(Turtle).filter(Turtle.org_id == org_id, Turtle.id.in_(ids)).all()
    return {t.id: t for t in rows}


def approve_submission(org_id, submission, data, user_id):
    """
    Resolve a pending submission: attach it to an existing turtle (data['turtle_id']) or create a
    new one (data['new_turtle']). Always records a sighting with the photo. The photo becomes the
    reference for new turtles, or when data['set_reference'] is true.
    Returns the turtle. Commits.
    """
    if submission.status != 'pending':
        raise ServiceError('This submission has already been resolved', 409)
    src_full = storage.abs_path(org_id, submission.image_path)
    created_files = []
    try:
        if data.get('turtle_id') is not None:
            turtle = (
                Session.query(Turtle)
                .filter(Turtle.org_id == org_id, Turtle.id == int(data['turtle_id']))
                .first()
            )
            if turtle is None:
                raise ServiceError('Turtle not found', 404)
            is_new = False
        else:
            fields = data.get('new_turtle') or {}
            turtle = Turtle(
                org_id=org_id,
                primary_id=new_primary_id(),
                sex='U',
                status='active',
                extra={},
                created_by=user_id,
                region_id=submission.region_id,
            )
            apply_turtle_fields(org_id, turtle, fields)
            turtle.bio_id = next_bio_id(org_id, turtle.sex)
            Session.add(turtle)
            Session.flush()
            is_new = True

        sighting = Sighting(
            org_id=org_id,
            turtle_id=turtle.id,
            observed_at=submission.observed_at or submission.created_at,
            region_id=submission.region_id,
            lat=submission.lat,
            lon=submission.lon,
            observer_user_id=submission.uploader_user_id,
            observer_name=submission.uploader_email,
            notes=submission.notes,
            measurements={},
        )
        apply_sighting_fields(org_id, sighting, data.get('sighting') or {})
        Session.add(sighting)
        Session.flush()

        dest_full = storage.move_into_turtle_dir(org_id, turtle.id, src_full)
        created_files += [dest_full, storage.feature_path_for(dest_full)]
        image = Image(
            org_id=org_id,
            turtle_id=turtle.id,
            sighting_id=sighting.id,
            kind='carapace',
            path=storage.rel_path(org_id, dest_full),
            feature_path=(
                storage.rel_path(org_id, storage.feature_path_for(dest_full))
                if submission.feature_path
                else None
            ),
            is_reference=False,
        )
        Session.add(image)
        Session.flush()
        Session.refresh(turtle)
        if is_new or data.get('set_reference'):
            set_reference(org_id, turtle, image)
            if image.feature_path:
                created_files.append(storage.abs_path(org_id, image.feature_path))

        submission.status = 'approved'
        submission.resolved_turtle_id = turtle.id
        submission.resolved_by = user_id
        submission.resolved_at = utcnow()
        Session.commit()
    except IntegrityError:
        Session.rollback()
        storage.remove_quietly(*created_files)
        raise ServiceError('Conflicting change, please try again', 409)
    except Exception:
        Session.rollback()
        storage.remove_quietly(*created_files)
        raise

    if image.is_reference:
        matching.cache_reference(org_id, image, turtle.region_id)
    return turtle


def sighting_stats(org_id):
    """{turtle_id: (count, last_seen)} for list views."""
    rows = (
        Session.query(
            Sighting.turtle_id,
            func.count(Sighting.id),
            func.max(func.coalesce(Sighting.observed_at, Sighting.created_at)),
        )
        .filter(Sighting.org_id == org_id)
        .group_by(Sighting.turtle_id)
        .all()
    )
    return {tid: (cnt, last) for tid, cnt, last in rows}
