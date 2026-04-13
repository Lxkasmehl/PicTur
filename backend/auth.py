"""
JWT Authentication utilities and decorators
"""

import json
import ssl
import urllib.error
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
        # Remove 'Bearer ' prefix if present
        if token.startswith('Bearer '):
            token = token[7:]
        
        decoded = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return True, decoded, None
    except jwt.ExpiredSignatureError:
        return False, None, 'Token has expired'
    except jwt.InvalidTokenError as e:
        return False, None, f'Invalid token: {str(e)}'


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


def check_auth_revocation(auth_header):
    """
    Call auth service to enforce demotion revocation (tokens_valid_after).
    Returns (allowed: bool, error_message: str or None).
    Fails closed when AUTH_URL is unset so demoted staff/admin tokens are not accepted.
    """
    if not AUTH_URL:
        return False, 'AUTH_URL must be set to verify staff/admin tokens (revocation check)'
    url = f'{AUTH_URL}/auth/validate'
    try:
        req = urllib.request.Request(url, method='POST', headers={'Authorization': auth_header})
        # Optional: don't verify SSL in dev if auth uses self-signed cert
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
            if resp.status != 200:
                return False, 'Token validation failed'
            return True, None
    except urllib.error.HTTPError as e:
        if e.code == 403:
            try:
                body = json.loads(e.read().decode())
                return False, body.get('error', 'Token has been revoked')
            except (ValueError, AttributeError):
                pass
        return False, 'Token has been revoked'
    except (urllib.error.URLError, OSError, TimeoutError):
        # Fail closed: if we can't reach auth service, deny access
        return False, 'Unable to verify token; try again later'


def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401
        
        # Attach user data to request for use in route
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
                # Any token error: treat as anonymous
                request.user = None
        return f(*args, **kwargs)
    return decorated_function


def require_admin(f):
    """Decorator to require staff or admin role (turtle records, release, sheets, review)."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Allow OPTIONS requests for CORS preflight
        if request.method == 'OPTIONS':
            return jsonify({}), 200

        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401

        if user_data.get('role') not in ('staff', 'admin'):
            return jsonify({'error': 'Staff or admin access required'}), 403

        # Enforce demotion revocation: auth service rejects tokens issued before tokens_valid_after
        auth_header = request.headers.get('Authorization')
        if auth_header:
            allowed, revoke_error = check_auth_revocation(auth_header)
            if not allowed:
                return jsonify({'error': revoke_error or 'Token has been revoked'}), 403

        # Attach user data to request for use in route
        request.user = user_data
        return f(*args, **kwargs)
    return decorated_function


def require_admin_only(f):
    """Decorator: role must be admin (not staff) — e.g. full data backup download."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.method == 'OPTIONS':
            return jsonify({}), 200

        success, user_data, error = get_user_from_request()
        if not success:
            return jsonify({'error': error or 'Authentication required'}), 401

        if user_data.get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        auth_header = request.headers.get('Authorization')
        if auth_header:
            allowed, revoke_error = check_auth_revocation(auth_header)
            if not allowed:
                return jsonify({'error': revoke_error or 'Token has been revoked'}), 403

        request.user = user_data
        return f(*args, **kwargs)
    return decorated_function
