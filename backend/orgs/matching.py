"""
Carapace matching for the database-backed research groups.

Uses the shared SuperPoint/LightGlue engine, but every group has its own reference cache
(TurtleDeepMatcher.org_caches) so candidates can never come from another group or the main group.
"""

import logging
import threading

from orgs import storage
from orgs.db import Session
from orgs.models import Image, Region, Turtle

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 5
_load_lock = threading.Lock()


def _brain():
    from turtles.image_processing import brain

    return brain


def region_descendants(org_id, region_id):
    """region_id plus all regions below it (same group only)."""
    rows = Session.query(Region.id, Region.parent_id).filter(Region.org_id == org_id).all()
    children = {}
    for rid, parent in rows:
        children.setdefault(parent, []).append(rid)
    if region_id not in {rid for rid, _ in rows}:
        return set()
    out, stack = set(), [region_id]
    while stack:
        rid = stack.pop()
        if rid in out:
            continue
        out.add(rid)
        stack.extend(children.get(rid, []))
    return out


def ensure_loaded(org_id):
    """Load the group's references into the matcher cache once (lazily, on first use)."""
    brain = _brain()
    if brain.has_org_cache(org_id):
        return
    with _load_lock:
        if brain.has_org_cache(org_id):
            return
        rows = (
            Session.query(Image.feature_path, Image.turtle_id, Turtle.region_id)
            .join(Turtle, Turtle.id == Image.turtle_id)
            .filter(Image.org_id == org_id, Image.is_reference.is_(True))
            .all()
        )
        entries = [
            (storage.abs_path(org_id, fp), turtle_id, region_id)
            for fp, turtle_id, region_id in rows
            if fp
        ]
        brain.load_org_cache(org_id, entries)


def extract_features(image_full_path):
    """Compute and store SuperPoint features next to the image. Returns the .pt path or None."""
    pt_path = storage.feature_path_for(image_full_path)
    return pt_path if _brain().process_and_save(image_full_path, pt_path) else None


def find_candidates(org_id, image_full_path, region_id=None, limit=MAX_CANDIDATES):
    """
    Best matching turtles of this group for a query photo.

    With region_id, candidates from that region (and its sub-regions) come first; if fewer than
    `limit` are found there, the search widens to the rest of the group (in_region=False).
    Returns [{'turtle_id', 'score', 'confidence', 'in_region'}].
    """
    ensure_loaded(org_id)
    brain = _brain()
    query_feats = brain.extract_query_features(image_full_path)
    if query_feats is None:
        raise ValueError('Could not read the uploaded image')

    results = []
    seen = set()
    if region_id is not None:
        scoped = brain.match_against_org_cache(org_id, query_feats, region_descendants(org_id, region_id))
        for r in scoped[:limit]:
            results.append({**_candidate(r), 'in_region': True})
            seen.add(r['site_id'])
    if len(results) < limit:
        for r in brain.match_against_org_cache(org_id, query_feats):
            if r['site_id'] in seen:
                continue
            results.append({**_candidate(r), 'in_region': region_id is None})
            seen.add(r['site_id'])
            if len(results) >= limit:
                break
    return results


def _candidate(r):
    return {'turtle_id': r['site_id'], 'score': int(r['score']), 'confidence': float(r['confidence'])}


def cache_reference(org_id, image, region_id):
    """Put a (new) reference image of a turtle into the group's cache."""
    brain = _brain()
    if not brain.has_org_cache(org_id):
        return  # loaded lazily with this reference included on next use
    if image.feature_path:
        brain.add_to_org_cache(org_id, storage.abs_path(org_id, image.feature_path), image.turtle_id, region_id)


def uncache_turtle(org_id, turtle_id):
    _brain().remove_from_org_cache(org_id, turtle_id)


def update_cached_region(org_id, turtle_id, region_id):
    _brain().update_org_cache_location(org_id, turtle_id, region_id)
