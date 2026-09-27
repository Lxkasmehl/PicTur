"""
API of the database-backed research groups: /api/v2/orgs/<slug>/...

Regions, turtles, sightings, carapace submissions (staff + community) with matching and review.
The main group keeps using the classic routes; nothing here touches Sheets or backend/data/.
Authorization: orgs.tenancy.org_route (live roles from the auth backend).
"""

import os
import shutil
import threading
import uuid

from flask import g, jsonify, request, send_file
from sqlalchemy.orm import selectinload
from werkzeug.utils import secure_filename

from config import MAX_FILE_SIZE, UPLOAD_FOLDER, allowed_file
from orgs import db as org_db
from orgs import matching, media, service, storage
from orgs.db import Session
from orgs.models import Image, Region, Sighting, Submission, Turtle
from orgs.service import ServiceError
from orgs.tenancy import is_staff, org_get, org_query, org_route
from routes.images import _thumbnail_jpeg_bytes
from upload_rate_limit import upload_rate_limit_ok, upload_rate_limit_response
from upload_validation import UploadImageError, ingest_saved_upload, upload_error_response

PREFIX = '/api/v2/orgs/<slug>'


def _json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _error(message, status=400):
    return jsonify({'error': message}), status


def _save_submission_image(org_id):
    """Validate the multipart 'file' and store it in a new submission folder.
    Returns (absolute path, None) or (None, error response)."""
    file = request.files.get('file')
    if file is None or not file.filename:
        return None, _error('No file provided')
    if not allowed_file(file.filename):
        return None, (jsonify({
            'error': 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP, HEIC.',
            'code': 'invalid_extension',
        }), 400)
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return None, (jsonify({'error': 'File too large (max 8MB after optimization).', 'code': 'file_too_large'}), 400)
    temp_path = os.path.join(UPLOAD_FOLDER, f'org_{uuid.uuid4().hex}_{secure_filename(file.filename)}')
    file.save(temp_path)
    try:
        temp_path = ingest_saved_upload(temp_path, context='api/v2/submissions', filename=file.filename)
    except UploadImageError as err:
        storage.remove_quietly(temp_path)
        return None, upload_error_response(err)
    dest_dir = storage.new_submission_dir(org_id)
    dest = os.path.join(dest_dir, 'photo' + (os.path.splitext(temp_path)[1].lower() or '.jpg'))
    shutil.move(temp_path, dest)
    return dest, None


def _match_in_background(org_id, submission_id):
    def run():
        try:
            sub = Session.get(Submission, submission_id)
            if sub is None or sub.org_id != org_id:
                return
            try:
                service.run_matching(org_id, sub)
            except Exception as exc:  # keep the submission reviewable without candidates
                print(f'[orgs] matching failed for submission {submission_id}: {exc}', flush=True)
            Session.commit()
        finally:
            Session.remove()

    threading.Thread(target=run, daemon=True, name=f'org-match-{submission_id}').start()


def _serve_file(full_path):
    if not full_path or not os.path.isfile(full_path):
        return _error('Image not found', 404)
    max_dim = request.args.get('max_dim', type=int)
    if max_dim and 32 <= max_dim <= 4096:
        buf = _thumbnail_jpeg_bytes(full_path, max_dim)
        if buf is not None:
            return send_file(buf, mimetype='image/jpeg', max_age=3600)
    return send_file(full_path, max_age=3600)


def register_org_routes(app):
    """Register /api/v2/orgs/<slug>/... routes and initialize the database (if configured)."""
    try:
        org_db.init_engine()
    except Exception as exc:
        # Never take the main group down because the research-group database is unavailable.
        print(f'[orgs] database initialization failed: {exc}', flush=True)

    # ---------------- regions ----------------

    @app.route(f'{PREFIX}/regions', methods=['GET', 'OPTIONS'])
    @org_route('community', allow_anonymous=True)
    def org_regions_list(slug):
        rows = org_query(Region).order_by(Region.name).all()
        return jsonify({'org': g.org, 'role': g.org_role, 'regions': [service.region_dict(r) for r in rows]})

    @app.route(f'{PREFIX}/regions', methods=['POST'])
    @org_route('admin')
    def org_regions_create(slug):
        data = _json_body()
        try:
            name = service.clean_text(data.get('name'), 'Name', 120)
            if not name:
                raise ServiceError('Name is required')
            parent_id = service.require_region(g.org['id'], data.get('parent_id'))
        except ServiceError as e:
            return _error(e.message, e.status)
        same_parent = Region.parent_id.is_(None) if parent_id is None else Region.parent_id == parent_id
        dup = org_query(Region).filter(same_parent, Region.name == name).first()
        if dup:
            return _error('A region with this name already exists here', 409)
        region = Region(org_id=g.org['id'], parent_id=parent_id, name=name)
        Session.add(region)
        Session.commit()
        return jsonify({'region': service.region_dict(region)}), 201

    @app.route(f'{PREFIX}/regions/<int:region_id>', methods=['PATCH', 'OPTIONS'])
    @org_route('admin')
    def org_regions_update(slug, region_id):
        region = org_get(Region, region_id)
        if region is None:
            return _error('Region not found', 404)
        try:
            name = service.clean_text(_json_body().get('name'), 'Name', 120)
        except ServiceError as e:
            return _error(e.message, e.status)
        if not name:
            return _error('Name is required')
        region.name = name
        Session.commit()
        return jsonify({'region': service.region_dict(region)})

    @app.route(f'{PREFIX}/regions/<int:region_id>', methods=['DELETE'])
    @org_route('admin')
    def org_regions_delete(slug, region_id):
        region = org_get(Region, region_id)
        if region is None:
            return _error('Region not found', 404)
        in_use = (
            org_query(Region).filter(Region.parent_id == region.id).first()
            or org_query(Turtle).filter(Turtle.region_id == region.id).first()
            or org_query(Sighting).filter(Sighting.region_id == region.id).first()
        )
        if in_use:
            return _error('Region is still used by sub-regions, turtles or sightings', 409)
        Session.delete(region)
        Session.commit()
        return jsonify({'success': True})

    # ---------------- turtles ----------------

    @app.route(f'{PREFIX}/turtles', methods=['GET', 'OPTIONS'])
    @org_route('staff')
    def org_turtles_list(slug):
        q = org_query(Turtle).options(selectinload(Turtle.images))
        search = (request.args.get('q') or '').strip()
        if search:
            like = f'%{search}%'
            q = q.filter(Turtle.bio_id.ilike(like) | Turtle.name.ilike(like) | Turtle.primary_id.ilike(like))
        region_id = request.args.get('region_id', type=int)
        if region_id:
            q = q.filter(Turtle.region_id.in_(matching.region_descendants(g.org['id'], region_id) or {-1}))
        status = request.args.get('status')
        if status:
            q = q.filter(Turtle.status == status)
        stats = service.sighting_stats(g.org['id'])
        turtles = q.order_by(Turtle.created_at.desc()).all()
        out = []
        for t in turtles:
            count, last = stats.get(t.id, (0, None))
            out.append(service.turtle_summary(slug, t, sighting_count=count, last_seen=last))
        return jsonify({'turtles': out})

    @app.route(f'{PREFIX}/turtles/<int:turtle_id>', methods=['GET', 'OPTIONS'])
    @org_route('staff')
    def org_turtles_get(slug, turtle_id):
        turtle = org_get(Turtle, turtle_id)
        if turtle is None:
            return _error('Turtle not found', 404)
        return jsonify({'turtle': service.turtle_detail(slug, turtle)})

    @app.route(f'{PREFIX}/turtles/<int:turtle_id>', methods=['PATCH'])
    @org_route('staff')
    def org_turtles_update(slug, turtle_id):
        turtle = org_get(Turtle, turtle_id)
        if turtle is None:
            return _error('Turtle not found', 404)
        data = {k: v for k, v in _json_body().items() if k in service.TURTLE_EDITABLE}
        try:
            service.apply_turtle_fields(g.org['id'], turtle, data)
        except ServiceError as e:
            Session.rollback()
            return _error(e.message, e.status)
        Session.commit()
        if 'region_id' in data:
            matching.update_cached_region(g.org['id'], turtle.id, turtle.region_id)
        return jsonify({'turtle': service.turtle_detail(slug, turtle)})

    @app.route(f'{PREFIX}/turtles/<int:turtle_id>', methods=['DELETE'])
    @org_route('admin')
    def org_turtles_delete(slug, turtle_id):
        turtle = org_get(Turtle, turtle_id)
        if turtle is None:
            return _error('Turtle not found', 404)
        folder = storage.turtle_dir(g.org['id'], turtle.id)
        org_query(Submission).filter(Submission.resolved_turtle_id == turtle.id).update(
            {Submission.resolved_turtle_id: None}, synchronize_session=False
        )
        Session.delete(turtle)
        Session.commit()
        matching.uncache_turtle(g.org['id'], turtle_id)
        storage.remove_tree_quietly(folder)
        return jsonify({'success': True})

    @app.route(f'{PREFIX}/turtles/<int:turtle_id>/reference', methods=['POST', 'OPTIONS'])
    @org_route('staff')
    def org_turtles_set_reference(slug, turtle_id):
        turtle = org_get(Turtle, turtle_id)
        image = org_get(Image, _json_body().get('image_id'))
        if turtle is None or image is None:
            return _error('Turtle or image not found', 404)
        try:
            service.set_reference(g.org['id'], turtle, image)
        except ServiceError as e:
            Session.rollback()
            return _error(e.message, e.status)
        Session.commit()
        matching.cache_reference(g.org['id'], image, turtle.region_id)
        return jsonify({'turtle': service.turtle_detail(slug, turtle)})

    @app.route(f'{PREFIX}/turtles/<int:turtle_id>/images/<int:image_id>', methods=['DELETE', 'OPTIONS'])
    @org_route('staff')
    def org_turtles_delete_image(slug, turtle_id, image_id):
        image = org_get(Image, image_id)
        if image is None or image.turtle_id != turtle_id:
            return _error('Image not found', 404)
        if image.is_reference:
            return _error('Choose another reference photo before deleting this one', 409)
        files = [storage.abs_path(g.org['id'], image.path)]
        if image.feature_path:
            files.append(storage.abs_path(g.org['id'], image.feature_path))
        Session.delete(image)
        Session.commit()
        storage.remove_quietly(*files)
        return jsonify({'success': True})

    # ---------------- sightings ----------------

    @app.route(f'{PREFIX}/sightings/<int:sighting_id>', methods=['PATCH', 'OPTIONS'])
    @org_route('staff')
    def org_sightings_update(slug, sighting_id):
        sighting = org_get(Sighting, sighting_id)
        if sighting is None:
            return _error('Sighting not found', 404)
        try:
            service.apply_sighting_fields(g.org['id'], sighting, _json_body())
        except ServiceError as e:
            Session.rollback()
            return _error(e.message, e.status)
        Session.commit()
        return jsonify({'sighting': service.sighting_dict(sighting)})

    @app.route(f'{PREFIX}/sightings/<int:sighting_id>', methods=['DELETE'])
    @org_route('staff')
    def org_sightings_delete(slug, sighting_id):
        sighting = org_get(Sighting, sighting_id)
        if sighting is None:
            return _error('Sighting not found', 404)
        if org_query(Sighting).filter(Sighting.turtle_id == sighting.turtle_id).count() <= 1:
            return _error('A turtle needs at least one sighting', 409)
        Session.delete(sighting)
        Session.commit()
        return jsonify({'success': True})

    # ---------------- submissions ----------------

    @app.route(f'{PREFIX}/submissions', methods=['POST', 'OPTIONS'])
    @org_route('community', allow_anonymous=True)
    def org_submissions_create(slug):
        staff = is_staff()
        if not upload_rate_limit_ok(request, 'staff' if staff else 'community'):
            return upload_rate_limit_response()
        org_id = g.org['id']
        try:
            region_id = service.require_region(org_id, request.form.get('region_id'))
            lat = service.parse_float(request.form.get('lat'), 'Latitude', -90, 90)
            lon = service.parse_float(request.form.get('lon'), 'Longitude', -180, 180)
            observed_at = service.parse_datetime(request.form.get('observed_at'))
            notes = service.clean_text(request.form.get('notes'), 'Notes', 5000)
        except ServiceError as e:
            return _error(e.message, e.status)
        image_full, err = _save_submission_image(org_id)
        if err:
            return err
        sub = Submission(
            org_id=org_id,
            uploader_user_id=(g.user or {}).get('id'),
            uploader_email=(g.user or {}).get('email'),
            uploader_is_staff=staff,
            image_path=storage.rel_path(org_id, image_full),
            observed_at=observed_at,
            region_id=region_id,
            lat=lat,
            lon=lon,
            notes=notes,
            status='pending',
            match_state='pending',
            candidates=[],
        )
        Session.add(sub)
        Session.commit()
        if not staff:
            _match_in_background(org_id, sub.id)
            return jsonify({'submission': {'id': sub.id, 'status': sub.status}}), 201
        try:
            service.run_matching(org_id, sub)
        except Exception as exc:
            print(f'[orgs] matching failed for submission {sub.id}: {exc}', flush=True)
        Session.commit()
        subs = [sub]
        return jsonify({'submission': service.submission_dict(slug, sub, service.candidate_turtles(org_id, subs))}), 201

    @app.route(f'{PREFIX}/submissions', methods=['GET'])
    @org_route('staff')
    def org_submissions_list(slug):
        status = request.args.get('status', 'pending')
        q = org_query(Submission)
        if status != 'all':
            q = q.filter(Submission.status == status)
        subs = q.order_by(Submission.created_at.desc()).limit(500).all()
        turtles = service.candidate_turtles(g.org['id'], subs)
        return jsonify({'submissions': [service.submission_dict(slug, s, turtles) for s in subs]})

    @app.route(f'{PREFIX}/submissions/mine', methods=['GET', 'OPTIONS'])
    @org_route('community')
    def org_submissions_mine(slug):
        subs = (
            org_query(Submission)
            .filter(Submission.uploader_user_id == g.user['id'])
            .order_by(Submission.created_at.desc())
            .limit(200)
            .all()
        )
        # Uploaders see their photo and review status, not the candidate turtles.
        return jsonify({'submissions': [
            {k: v for k, v in service.submission_dict(slug, s, {}).items()
             if k not in ('candidates', 'uploader_email')}
            for s in subs
        ]})

    @app.route(f'{PREFIX}/submissions/<int:submission_id>', methods=['GET', 'OPTIONS'])
    @org_route('staff')
    def org_submissions_get(slug, submission_id):
        sub = org_get(Submission, submission_id)
        if sub is None:
            return _error('Submission not found', 404)
        return jsonify({'submission': service.submission_dict(slug, sub, service.candidate_turtles(g.org['id'], [sub]))})

    @app.route(f'{PREFIX}/submissions/<int:submission_id>/rematch', methods=['POST', 'OPTIONS'])
    @org_route('staff')
    def org_submissions_rematch(slug, submission_id):
        sub = org_get(Submission, submission_id)
        if sub is None:
            return _error('Submission not found', 404)
        data = _json_body()
        try:
            if 'region_id' in data:
                sub.region_id = service.require_region(g.org['id'], data.get('region_id'))
            service.run_matching(g.org['id'], sub)
        except ServiceError as e:
            Session.rollback()
            return _error(e.message, e.status)
        except Exception as exc:
            Session.commit()
            return _error(f'Matching failed: {exc}', 500)
        Session.commit()
        return jsonify({'submission': service.submission_dict(slug, sub, service.candidate_turtles(g.org['id'], [sub]))})

    @app.route(f'{PREFIX}/submissions/<int:submission_id>/approve', methods=['POST', 'OPTIONS'])
    @org_route('staff')
    def org_submissions_approve(slug, submission_id):
        sub = org_get(Submission, submission_id)
        if sub is None:
            return _error('Submission not found', 404)
        try:
            turtle = service.approve_submission(g.org['id'], sub, _json_body(), (g.user or {}).get('id'))
        except ServiceError as e:
            return _error(e.message, e.status)
        return jsonify({'turtle': service.turtle_detail(slug, turtle)})

    @app.route(f'{PREFIX}/submissions/<int:submission_id>/reject', methods=['POST', 'OPTIONS'])
    @org_route('staff')
    def org_submissions_reject(slug, submission_id):
        sub = org_get(Submission, submission_id)
        if sub is None:
            return _error('Submission not found', 404)
        if sub.status != 'pending':
            return _error('This submission has already been resolved', 409)
        sub.status = 'rejected'
        sub.resolved_by = (g.user or {}).get('id')
        sub.resolved_at = service.utcnow()
        Session.commit()
        return jsonify({'success': True})

    # ---------------- media (signed URLs, no Authorization header) ----------------

    @app.route('/api/v2/orgs/<slug>/media/<kind>/<int:obj_id>', methods=['GET'])
    def org_media(slug, kind, obj_id):
        if not org_db.is_configured():
            return _error('Research-group database is not configured', 503)
        if kind not in ('image', 'submission'):
            return _error('Not found', 404)
        model = Image if kind == 'image' else Submission
        try:
            row = Session.get(model, obj_id)
            if row is None or not media.verify(request.args.get('t'), row.org_id, kind, obj_id):
                return _error('Not found', 404)
            rel = row.path if kind == 'image' else row.image_path
            return _serve_file(storage.abs_path(row.org_id, rel))
        finally:
            Session.remove()
