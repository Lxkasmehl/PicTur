"""
Request context for the research-group API: which group, which user, which role.

This is the ONLY place where research-group authorization happens. Roles come live from the auth
backend (/auth/validate memberships), never from the JWT 'role' claim — that claim only describes
the main group.
"""

import json
import threading
import time
import urllib.error
import urllib.request
from functools import wraps

from flask import g, jsonify, request

import auth as auth_module
from config import AUTH_URL
from orgs import db as org_db

ROLE_RANK = {'community': 1, 'staff': 2, 'admin': 3}

_public_cache = {'at': 0.0, 'orgs': []}
_public_lock = threading.Lock()
PUBLIC_CACHE_SECONDS = 30


def _fetch_public_orgs():
    """Groups accepting community uploads (cached briefly; used for anonymous requests)."""
    with _public_lock:
        if time.time() - _public_cache['at'] < PUBLIC_CACHE_SECONDS:
            return _public_cache['orgs']
    orgs = []
    if AUTH_URL:
        try:
            with urllib.request.urlopen(f'{AUTH_URL}/orgs/public', timeout=5) as resp:
                orgs = json.loads(resp.read().decode() or '{}').get('orgs', [])
        except (urllib.error.URLError, OSError, ValueError, TimeoutError):
            orgs = []
    with _public_lock:
        _public_cache['at'] = time.time()
        _public_cache['orgs'] = orgs
    return orgs


def _resolve_context(slug):
    """Returns (org, role, user, error_response). org/user are plain dicts."""
    auth_header = request.headers.get('Authorization')
    if auth_header:
        ok, error, body = auth_module.validate_with_auth_service(auth_header, org_slug=slug)
        if ok and body:
            user = body.get('user') or {}
            org = body.get('org')
            if not org:
                return None, None, None, (jsonify({'error': 'Research group not found'}), 404)
            if body.get('is_super_admin'):
                role = 'admin'
            else:
                membership = next(
                    (m for m in body.get('memberships') or [] if m.get('org_id') == org.get('id')),
                    None,
                )
                role = membership.get('role') if membership else 'community'
            return org, role, {'id': user.get('id'), 'email': user.get('email')}, None
        # Invalid/revoked token: continue anonymously (public endpoints), the role check below
        # rejects anything that needs membership.
        auth_error = error
    else:
        auth_error = None
    org = next((o for o in _fetch_public_orgs() if o.get('slug') == slug), None)
    if not org:
        status = 401 if auth_error else 404
        return None, None, None, (jsonify({'error': auth_error or 'Research group not found'}), status)
    org = {**org, 'accepts_community': True}
    return org, 'community', None, None


def org_route(min_role='staff', *, allow_anonymous=False):
    """
    Decorator for /api/v2/orgs/<slug>/... routes.

    min_role: 'staff' | 'admin' | 'community' (community = any visitor of a group that accepts
    community uploads). Sets g.org, g.org_role, g.user. Only database-backed groups are served.
    """

    def decorator(f):
        @wraps(f)
        def wrapper(slug, *args, **kwargs):
            if request.method == 'OPTIONS':
                return jsonify({}), 200
            if not org_db.is_configured():
                return jsonify({'error': 'Research-group database is not configured'}), 503
            org, role, user, err = _resolve_context(slug)
            if err:
                return err
            if org.get('kind') != 'db':
                return jsonify({'error': 'This research group uses the classic workflow'}), 400
            if user is None and not allow_anonymous:
                return jsonify({'error': 'Authentication required'}), 401
            if ROLE_RANK.get(role, 0) < ROLE_RANK[min_role]:
                return jsonify({'error': 'You do not have access to this research group'}), 403
            if min_role == 'community' and role == 'community' and not org.get('accepts_community'):
                return jsonify({'error': 'This research group does not accept community uploads'}), 403
            g.org = {'id': int(org['id']), 'slug': org['slug'], 'name': org.get('name')}
            g.org_role = role
            g.user = user
            try:
                return f(slug, *args, **kwargs)
            finally:
                org_db.Session.remove()

        return wrapper

    return decorator


def is_staff():
    return ROLE_RANK.get(getattr(g, 'org_role', None), 0) >= ROLE_RANK['staff']


def org_query(model):
    """Query scoped to the current request's research group."""
    return org_db.Session.query(model).filter(model.org_id == g.org['id'])


def org_get(model, obj_id):
    """Fetch one row of the current group by id, or None (other groups' rows are invisible)."""
    try:
        obj_id = int(obj_id)
    except (TypeError, ValueError):
        return None
    return org_query(model).filter(model.id == obj_id).first()
