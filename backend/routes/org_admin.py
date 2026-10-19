"""
Research-group lifecycle for super admins: how much data a group holds, and deleting it.

Deleting removes the group in the auth service first (members and invitations go with it, and the
group becomes unreachable), then purges its database rows, files and in-memory caches here. A
group that still holds turtles, records, review-queue packets or photos can only be deleted when
the request repeats the group's full name in addition to its URL name.
"""

import json
import os
import shutil
import urllib.error
import urllib.request

from flask import jsonify, request

import tenant
from auth import require_admin_only
from config import AUTH_URL
from services import manager_service

PHOTO_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.tif', '.tiff', '.bmp'}


def _record_counts(org_id):
    """Non-empty data rows (header row excluded) per book of the group database."""
    from orgs.db import Session
    from orgs.models import BOOKS, SheetRow

    counts = {book: 0 for book in BOOKS}
    try:
        rows = Session.query(SheetRow.book, SheetRow.cells).filter(
            SheetRow.org_id == int(org_id), SheetRow.row_index > 0).all()
        for book, cells in rows:
            if any(str(c).strip() for c in (cells or [])):
                counts[book] = counts.get(book, 0) + 1
    finally:
        Session.rollback()
    return counts


def _file_counts(org_id):
    """(review-queue packets, photo files) on disk."""
    data = tenant.data_dir(org_id)
    queue_dir = os.path.join(data, 'Review_Queue')
    queue = 0
    if os.path.isdir(queue_dir):
        queue = sum(1 for e in os.scandir(queue_dir) if e.is_dir())
    photos = 0
    for _root, _dirs, files in os.walk(data):
        photos += sum(1 for f in files if os.path.splitext(f)[1].lower() in PHOTO_EXTENSIONS)
    return queue, photos


def group_usage(org_id):
    records = _record_counts(org_id)
    queue, photos = _file_counts(org_id)
    usage = {
        'turtle_records': records.get('research', 0),
        'community_records': records.get('community', 0),
        'review_queue': queue,
        'photos': photos,
    }
    usage['has_data'] = any(usage.values())
    return usage


def _delete_in_auth_service(org_id, slug):
    """DELETE {AUTH_URL}/orgs/<id> with the caller's token. Returns (ok, status, error)."""
    if not AUTH_URL:
        return False, 503, 'AUTH_URL is not configured'
    req = urllib.request.Request(
        f'{AUTH_URL.rstrip("/")}/orgs/{int(org_id)}',
        method='DELETE',
        data=json.dumps({'confirm': slug}).encode(),
        headers={
            'Authorization': request.headers.get('Authorization', ''),
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True, 200, None
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read().decode()).get('error')
        except (ValueError, AttributeError):
            message = None
        return False, e.code, message or f'Auth service refused (HTTP {e.code})'
    except (urllib.error.URLError, OSError, TimeoutError):
        return False, 503, 'Auth service is not reachable; nothing was deleted'


def purge_group_data(org_id):
    """Database rows, files and caches of a group that no longer exists in the auth service."""
    from orgs.db import Session
    from orgs.models import SheetRow, SheetTab
    from orgs import sheets_store

    org_id = int(org_id)
    manager_service.forget_tenant(org_id)
    try:
        Session.query(SheetRow).filter(SheetRow.org_id == org_id).delete(synchronize_session=False)
        Session.query(SheetTab).filter(SheetTab.org_id == org_id).delete(synchronize_session=False)
        Session.commit()
    except Exception:
        Session.rollback()
        raise
    sheets_store.forget_org(org_id)
    shutil.rmtree(os.path.join(tenant.org_data_root(), str(org_id)), ignore_errors=True)


def _require_super_admin_group():
    t = tenant.current()
    if t is None:
        return None, (jsonify({'success': False, 'error': 'The main research group cannot be deleted'}), 400)
    if not t.super_admin:
        return None, (jsonify({'success': False, 'error': 'Super admin access required'}), 403)
    return t, None


def register_org_admin_routes(app):
    @app.route('/api/org/usage', methods=['GET'])
    @require_admin_only
    def org_usage():
        """What the active research group holds (shown before deleting it)."""
        t, error = _require_super_admin_group()
        if error:
            return error
        return jsonify({'success': True, 'org': {'id': t.id, 'slug': t.slug, 'name': t.name},
                        'usage': group_usage(t.id)})

    @app.route('/api/org', methods=['DELETE'])
    @require_admin_only
    def delete_org():
        """Delete the active research group with all its data. Body: {confirm_slug, confirm_name}."""
        t, error = _require_super_admin_group()
        if error:
            return error
        body = request.get_json(silent=True) or {}
        if str(body.get('confirm_slug') or '').strip().lower() != t.slug.lower():
            return jsonify({'success': False, 'error': 'Type the URL name of the group to confirm'}), 400
        usage = group_usage(t.id)
        if usage['has_data'] and str(body.get('confirm_name') or '').strip() != t.name.strip():
            return jsonify({
                'success': False,
                'error': 'This group still holds data. Type its full name to delete it anyway.',
                'usage': usage,
            }), 409

        ok, status, message = _delete_in_auth_service(t.id, t.slug)
        if not ok:
            return jsonify({'success': False, 'error': message}), status
        try:
            purge_group_data(t.id)
        except Exception as exc:
            # The group is gone from the auth service already, so its data is unreachable;
            # leftovers only take disk space.
            print(f'org-admin: group {t.slug} deleted, but purging its data failed: {exc}')
            return jsonify({'success': True, 'purged': False, 'usage': usage})
        return jsonify({'success': True, 'purged': True, 'usage': usage})
