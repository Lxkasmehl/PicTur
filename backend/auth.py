"""
JWT Authentication utilities and decorators
"""

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt
from functools import wraps
from flask import request, jsonify
from config import JWT_SECRET, AUTH_URL


def verify_jwt_token(token):
    """
    Verify JWT token and return decoded payload.
    Returns (success: bool, payload: dict or None, error: str or None)
    """
    if not token:
        return False, None, 'No token provided'

    try:
        if token.startswith('Bearer '):
            token = token[7:]
        token = token.strip()

        decoded = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return True, decoded, None
    except jwt.ExpiredSignatureError:
        return False, None, 'Token has expired'
    except jwt.InvalidTokenError as e:
        return False, None, f'Invalid token: {str(e)}'


def mint_download_token(user_id, scope, sheet, ttl_seconds=120):
    """Mint a short-lived, single-purpose token for a streaming backup download.

    A browser navigation/anchor download can't carry the Authorization header,
    so the frontend first calls the (header-authenticated) token endpoint and
    then puts this token in the download URL. Signed with JWT_SECRET; it carries
    the scope/sheet it authorizes so it can't be replayed for a different one.
    """
    now = int(time.time())
    payload = {
        'purpose': 'backup_dl',
        'uid': user_id,
        'scope': scope,
        'sheet': sheet or '',
        'iat': now,
        'exp': now + int(ttl_seconds),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def verify_download_token(token, scope, sheet):
    """Validate a backup-download token and confirm it authorizes (scope, sheet).

    Returns True only for an unexpired token minted by mint_download_token whose
    embedded scope/sheet match the request. Note: this intentionally does NOT
    re-run the auth-service revocation check — the token is issued immediately
    after a full admin+revocation check and lives only ~120s.
    """
    if not token:
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return False
    if payload.get('purpose') != 'backup_dl':
        return False
    if payload.get('scope') != scope:
        return False
    if (payload.get('sheet') or None) != (sheet or None):
        return False
    return True


def get_user_from_request():
    """
    Extract and verify user information from Authorization header.
    Returns (success: bool, user_data: dict or None, error: str or None)
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return False, None, 'Authorization header required'

    success, payload, error = verify_jwt_token(auth_header)
    if not success:
        return False, None, error

    return True, payload, None


# Print-once guard for the mixed-version-deploy warning (auth-backend older than
# PR-1). Benign under threaded=True: a race just prints the warning twice — it is
# a log flag, not load-bearing state — so it needs no lock.
_MISSING_GROUP_WARNED = False


def _post_validate(auth_header):
    """POST to ``{AUTH_URL}/auth/validate`` and return ``(allowed, error, body)``.

    Shared transport for the revocation check (``check_auth_revocation``) and the
    scope-context builder (``validate_and_get_context``). ``allowed`` is True only
    on HTTP 200; ``body`` is the parsed JSON of that 200 (or None). Fails closed
    when AUTH_URL is unset. Retries once against 127.0.0.1 only when the primary
    ``localhost`` host was unreachable (never after a definitive HTTP outcome such
    as a 403 revocation), preserving the existing revocation semantics.
    """
    if not AUTH_URL:
        return False, 'AUTH_URL must be set to verify staff/admin tokens (revocation check)', None

    def validate_against(auth_base_url):
        """Returns (allowed, error, connectivity_failure, body).

        connectivity_failure is True only when the auth service could not be reached
        (no HTTP response). Used to decide whether a localhost → 127.0.0.1 fallback
        is safe: never retry after a definitive HTTP outcome (e.g. 403 revocation).
        """
        url = f'{auth_base_url.rstrip("/")}/auth/validate'
        try:
            req = urllib.request.Request(url, method='POST', headers={'Authorization': auth_header})
            # Optional: don't verify SSL in dev if auth uses self-signed cert
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
                if resp.status != 200:
                    return False, f'Auth validation failed (HTTP {resp.status})', False, None
                try:
                    body = json.loads(resp.read().decode())
                except (ValueError, AttributeError, OSError):
                    body = None
                return True, None, False, body
        except urllib.error.HTTPError as e:
            error_message = None
            try:
                body = json.loads(e.read().decode())
                error_message = body.get('error')
            except (ValueError, AttributeError):
                error_message = None

            if e.code == 403:
                return False, error_message or 'Token has been revoked', False, None
            return False, error_message or f'Auth validation failed (HTTP {e.code})', False, None
        except (urllib.error.URLError, OSError, TimeoutError):
            # Fail closed: if we can't reach auth service, deny access
            return False, 'Unable to verify token; try again later', True, None

    allowed, revoke_error, primary_unreachable, body = validate_against(AUTH_URL)
    if allowed:
        return True, None, body

    # Windows/dev environments can resolve "localhost" to a different service than 127.0.0.1.
    # Retry once against 127.0.0.1 only when the primary host could not be reached — not after
    # a definitive HTTP response (403 revocation, 401, etc.), which would weaken revocation.
    parsed = urllib.parse.urlparse(AUTH_URL)
    if parsed.hostname == 'localhost' and primary_unreachable:
        fallback_netloc = parsed.netloc.replace('localhost', '127.0.0.1', 1)
        fallback_url = urllib.parse.urlunparse(parsed._replace(netloc=fallback_netloc))
        if fallback_url != AUTH_URL:
            retry_allowed, retry_error, _, retry_body = validate_against(fallback_url)
            if retry_allowed:
                return True, None, retry_body
            revoke_error = retry_error or revoke_error

    return False, revoke_error, None


def _build_scope_ctx(body):
    """Parse a ``/auth/validate`` 200 body into the per-request scope context dict.

    Authorization is done off this context (DB-fresh role + group areas), never
    off the JWT claim. Tolerates missing fields:
      - ``group`` present with a scope → ``is_global = role=='admin' or scope=='global'``.
      - ``group`` present but null (unassigned) → ``areas=[]``, ``is_global = role=='admin'``.
      - ``group`` KEY entirely absent → an auth-backend older than PR-1 (mixed-version
        deploy). We can't scope without areas, so treat staff as global too and warn
        ONCE per process, rather than locking every scoped route out during a rollout.
    """
    global _MISSING_GROUP_WARNED
    user = (body or {}).get('user') or {}
    role = user.get('role')
    areas_raw = user.get('areas')
    areas = [str(a).strip() for a in areas_raw if a and str(a).strip()] if isinstance(areas_raw, list) else []

    group_present = isinstance(user, dict) and 'group' in user
    group = user.get('group') if group_present else None
    group = group if isinstance(group, dict) else {}
    group_scope = group.get('scope')

    if not group_present:
        if not _MISSING_GROUP_WARNED:
            _MISSING_GROUP_WARNED = True
            try:
                print(
                    "⚠️  auth-backend /auth/validate returned no 'group' field — treating staff "
                    "as global (mixed-version deploy). Upgrade auth-backend to enable scoped-group "
                    "enforcement."
                )
            except UnicodeEncodeError:
                print("[WARN] auth-backend /auth/validate returned no 'group' field — treating staff as global.")
        is_global_flag = True
    else:
        is_global_flag = (role == 'admin') or (group_scope == 'global')

    return {
        'role': role,
        'user_id': user.get('id'),
        'email': user.get('email'),
        'group_id': group.get('id'),
        'group_name': group.get('name'),
        'group_scope': group_scope,
        'system_key': group.get('system_key'),
        'group_role': user.get('group_role'),
        'areas': areas,
        'is_global': bool(is_global_flag),
    }


def validate_and_get_context(auth_header):
    """Validate a token against the auth service and build its scope context.

    Returns ``(allowed: bool, error: str|None, ctx: dict|None)``. The guards MUST
    authorize off ``ctx`` (the validate-response body), never off JWT claims, so a
    freshly promoted/moved user takes effect without re-login. Same POST /
    fail-closed / localhost-retry transport as ``check_auth_revocation``.
    """
    allowed, error, body = _post_validate(auth_header)
    if not allowed:
        return False, error, None
    return True, None, _build_scope_ctx(body)


def check_auth_revocation(auth_header):
    """Thin (allowed, error) wrapper over the shared validate transport.

    Kept for callers that only need the yes/no revocation gate (e.g.
    ``_authorize_archive_request`` in admin_backup.py); returns just the pair so
    those call sites keep working unchanged. Fails closed when AUTH_URL is unset.
    """
    allowed, error, _ = _post_validate(auth_header)
    return allowed, error


def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401

        request.user = user_data
        return f(*args, **kwargs)
    return decorated_function


def optional_auth(f):
    """Decorator to make authentication optional"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        request.user = None
        auth_header = request.headers.get('Authorization')
        if auth_header:
            try:
                success, user_data, error = verify_jwt_token(auth_header)
                if success and user_data is not None:
                    request.user = user_data
            except Exception:
                request.user = None
        return f(*args, **kwargs)
    return decorated_function


def require_admin(f):
    """Decorator to require staff or admin role (turtle records, release, sheets, review).

    The JWT proves identity only (signature/expiry via get_user_from_request); the
    role/scope decision is made off the auth service's DB-fresh validate body, NOT
    the JWT's role claim — so a freshly promoted user's stale community JWT passes
    once the body says staff. Sets request.scope_ctx for the scoped-enforcement layer.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.method == 'OPTIONS':
            return jsonify({}), 200

        # Identity only: reject a missing/invalid/expired token. Do NOT pre-reject
        # on the JWT's (possibly stale) role claim.
        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401

        auth_header = request.headers.get('Authorization')
        allowed, revoke_error, ctx = validate_and_get_context(auth_header)
        if not allowed:
            return jsonify({'error': revoke_error or 'Token has been revoked'}), 403
        if (ctx or {}).get('role') not in ('staff', 'admin'):
            return jsonify({'error': 'Staff or admin access required'}), 403

        request.user = user_data
        request.scope_ctx = ctx
        return f(*args, **kwargs)
    return decorated_function


def require_admin_only(f):
    """Decorator: role must be admin (not staff) — e.g. full data backup download.

    Same validate-body authorization as require_admin (identity from the JWT, role
    from the DB-fresh validate response). Sets request.scope_ctx (always global for
    an admin) for consistency.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.method == 'OPTIONS':
            return jsonify({}), 200

        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401

        auth_header = request.headers.get('Authorization')
        allowed, revoke_error, ctx = validate_and_get_context(auth_header)
        if not allowed:
            return jsonify({'error': revoke_error or 'Token has been revoked'}), 403
        if (ctx or {}).get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        request.user = user_data
        request.scope_ctx = ctx
        return f(*args, **kwargs)
    return decorated_function
