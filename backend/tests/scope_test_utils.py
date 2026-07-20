"""
Shared helpers for scope-enforcement tests (PR-2).

The route guards now authorize off ``auth.validate_and_get_context`` (the auth
service's ``/auth/validate`` body), not off ``auth.check_auth_revocation``. These
factories build the per-request scope context dicts and patch the guard so unit
tests can exercise global vs scoped behavior without a live auth service.
"""

import jwt

import config


def global_admin_ctx():
    """Admin — Operations (global). Bypasses every filter/gate."""
    return {
        'role': 'admin',
        'user_id': 1,
        'email': 'admin@test.com',
        'group_id': 1,
        'group_name': 'Operations',
        'group_scope': 'global',
        'system_key': 'operations',
        'group_role': 'lead',
        'areas': [],
        'is_global': True,
    }


def global_staff_ctx():
    """Staff — Primary (global). Bypasses every filter/gate."""
    return {
        'role': 'staff',
        'user_id': 2,
        'email': 'staff@test.com',
        'group_id': 2,
        'group_name': 'Primary',
        'group_scope': 'global',
        'system_key': 'primary',
        'group_role': 'member',
        'areas': [],
        'is_global': True,
    }


def scoped_ctx(areas=None, role='staff', group_role='member'):
    """A scoped-group member (default staff) restricted to ``areas``.

    A community role or an empty area list is scoped with zero reach (the
    "waiting to be assigned" state); admin is always global regardless of group.
    """
    areas = list(areas or [])
    return {
        'role': role,
        'user_id': 3,
        'email': f'{role}-scoped@test.com',
        'group_id': 3,
        'group_name': 'KansasTeam',
        'group_scope': 'scoped',
        'system_key': None,
        'group_role': group_role,
        'areas': areas,
        'is_global': role == 'admin',
    }


def community_ctx():
    """A community (non-staff) user — no group, no areas, not global."""
    return {
        'role': 'community',
        'user_id': 4,
        'email': 'community@test.com',
        'group_id': None,
        'group_name': None,
        'group_scope': None,
        'system_key': None,
        'group_role': 'member',
        'areas': [],
        'is_global': False,
    }


def ctx_for_role(role):
    """Map a bare JWT role claim to a global context (admin/staff) or community."""
    if role == 'admin':
        return global_admin_ctx()
    if role == 'staff':
        return global_staff_ctx()
    return community_ctx()


def _role_from_auth_header(auth_header):
    """Decode the test JWT and read its role claim (defaults to community)."""
    if not auth_header:
        return 'community'
    tok = auth_header[7:] if auth_header.startswith('Bearer ') else auth_header
    try:
        payload = jwt.decode(tok, config.JWT_SECRET, algorithms=['HS256'])
        return payload.get('role', 'community')
    except Exception:
        return 'community'


def role_aware_validate(auth_header):
    """A ``validate_and_get_context`` stand-in that mirrors the token's role.

    Returns ``(True, None, ctx)`` where ctx is the global context matching the
    JWT's role claim — so ``_auth("community")`` still 403s on staff routes and
    ``_auth("admin")`` passes, exactly as the real auth service would (role is
    DB-fresh, approximated here by the JWT claim).
    """
    return True, None, ctx_for_role(_role_from_auth_header(auth_header))


def patch_validate(monkeypatch, ctx):
    """Patch the auth guards to always resolve to ``ctx`` (allowed).

    Patches both ``auth.validate_and_get_context`` (require_admin/only + the
    /api/upload staff branch) and ``auth.check_auth_revocation`` (admin_backup)
    so every guarded path sees the same context.
    """
    import auth

    monkeypatch.setattr(auth, 'validate_and_get_context', lambda auth_header: (True, None, ctx))
    monkeypatch.setattr(auth, 'check_auth_revocation', lambda auth_header: (True, None))
    return ctx


def bearer(role='admin', secret=None):
    """Mint a test JWT carrying ``role`` (identity only; scope comes from ctx)."""
    token = jwt.encode(
        {'role': role, 'sub': f'pytest-{role}'},
        secret or config.JWT_SECRET,
        algorithm='HS256',
    )
    return token if isinstance(token, str) else token.decode('ascii')


def auth_header(role='admin'):
    """Authorization header dict for a test JWT of the given role."""
    return {'Authorization': f'Bearer {bearer(role)}'}
