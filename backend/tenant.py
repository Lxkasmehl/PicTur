"""
Research-group (tenant) context of the current request.

The main group (PicTur Research, Google Sheets) is the default: no context is set and every code
path behaves exactly as before. For a database-backed research group the frontend sends
``X-Org-Slug`` (or ``?org=`` on <img>/download URLs); ``resolve_request_tenant`` then activates that
group, and the per-group services in ``services.manager_service`` (TurtleManager, Sheets, locations
catalog) and the role checks in ``auth`` follow it.

The context lives in a ContextVar. Background threads must be started through ``spawn`` so they
keep their group (a plain Thread would silently fall back to the main group).
"""

import contextvars
import json
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from flask import jsonify, request

MAIN_SLUG = 'main'
_DEFAULT_ORG_DATA_ROOT = Path(__file__).resolve().parent / 'org_data'


def org_data_root():
    """Root of all research-group files (a sibling of backend/data, never inside it)."""
    return os.path.abspath(os.environ.get('ORG_DATA_DIR') or str(_DEFAULT_ORG_DATA_ROOT))


def data_dir(org_id):
    """A research group's equivalent of backend/data/ (turtle folders, Review_Queue, catalog)."""
    return os.path.join(org_data_root(), str(int(org_id)), 'data')


_public_cache = {'at': 0.0, 'orgs': []}
_public_lock = threading.Lock()
PUBLIC_CACHE_SECONDS = 30


def _fetch_public_orgs():
    """Groups accepting community uploads (cached briefly; used for anonymous requests)."""
    from config import AUTH_URL

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


@dataclass(frozen=True)
class Tenant:
    id: int
    slug: str
    name: str
    #: role of the requesting user in this group: 'community' | 'staff' | 'admin'
    role: str
    #: True when the Authorization header was already validated (and not revoked) for this request
    token_validated: bool = False


_current = contextvars.ContextVar('pictur_tenant', default=None)


def current():
    """The active research group, or None for the main group."""
    return _current.get()


def activate(tenant):
    return _current.set(tenant)


def deactivate(token):
    _current.reset(token)


def spawn(target, *args, name=None, daemon=True, **kwargs):
    """Start a thread that keeps the caller's research-group context."""
    ctx = contextvars.copy_context()
    thread = threading.Thread(
        target=ctx.run, args=(target, *args), kwargs=kwargs, name=name, daemon=daemon
    )
    thread.start()
    return thread


def effective_user(user_data):
    """JWT payload with 'role' replaced by the role in the active research group.
    The JWT 'role' claim only describes the main group; unchanged when no group is active."""
    t = current()
    if t is None or not isinstance(user_data, dict):
        return user_data
    return {**user_data, 'role': t.role}


def upload_photo_type():
    """Photo type of admin uploads: plastron in the main group, carapace in research groups."""
    return 'plastron' if current() is None else 'carapace'


def request_org_slug():
    slug = (request.headers.get('X-Org-Slug') or request.args.get('org') or '').strip().lower()
    return None if not slug or slug == MAIN_SLUG else slug


def resolve_request_tenant():
    """
    Flask before_request hook. Returns an error response to abort, or None.
    Sets the context for database-backed groups; leaves it empty for the main group.
    """
    if request.method == 'OPTIONS':
        return None
    slug = request_org_slug()
    if slug is None:
        return None

    import auth as auth_module
    from orgs import db as org_db

    org = None
    role = 'community'
    validated = False
    # Backup download links carry no Authorization header; their signed token names the group.
    # No role is granted from it — the archive route authorizes the token itself.
    dl_org = auth_module.download_token_org(request.args.get('dl') or '') if request.args.get('dl') else None
    if dl_org and dl_org.get('slug') == slug:
        if not org_db.ensure_engine():
            return jsonify({'error': 'Research-group database is not available'}), 503
        from flask import g

        g._tenant_token = activate(Tenant(id=int(dl_org['id']), slug=dl_org['slug'],
                                          name=dl_org.get('name') or slug, role='community',
                                          token_validated=False))
        return None
    auth_header = request.headers.get('Authorization')
    if auth_header:
        ok, _error, body = auth_module.validate_with_auth_service(auth_header, org_slug=slug)
        if ok and body:
            org = body.get('org')
            validated = True
            if org is None:
                return jsonify({'error': 'Research group not found'}), 404
            if body.get('is_super_admin'):
                role = 'admin'
            else:
                membership = next(
                    (m for m in body.get('memberships') or [] if m.get('org_id') == org.get('id')),
                    None,
                )
                if membership:
                    role = membership.get('role') or 'community'
    if org is None:
        # Anonymous (or invalid token): only groups open to community uploads are reachable.
        org = next((o for o in _fetch_public_orgs() if o.get('slug') == slug), None)
        if org is None:
            return jsonify({'error': 'Research group not found'}), 404
        org = {**org, 'accepts_community': True}

    if org.get('kind') != 'db':
        return None  # the Sheets-backed main group under another slug: classic behaviour
    if role == 'community' and not org.get('accepts_community', True):
        return jsonify({'error': 'This research group does not accept community uploads'}), 403
    if not org_db.ensure_engine():
        return jsonify({'error': 'Research-group database is not available'}), 503

    from flask import g

    g._tenant_token = activate(
        Tenant(id=int(org['id']), slug=org['slug'], name=org.get('name') or org['slug'], role=role,
               token_validated=validated)
    )
    return None


def clear_request_tenant(_exc=None):
    """Flask teardown hook."""
    from flask import g

    token = g.pop('_tenant_token', None)
    if token is not None:
        deactivate(token)
