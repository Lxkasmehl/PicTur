"""Per-IP sliding-window rate limits for multipart image uploads."""

import os
import time
from threading import Lock

from werkzeug.http import parse_list_header

# 15-minute window; separate caps for anonymous vs staff/admin.
_WINDOW_SEC = int(os.environ.get('UPLOAD_RATE_WINDOW_SEC', '900'))
_MAX_COMMUNITY = int(os.environ.get('UPLOAD_RATE_MAX_COMMUNITY', '40'))
_MAX_PRIVILEGED = int(os.environ.get('UPLOAD_RATE_MAX_PRIVILEGED', '200'))

_buckets: dict[str, list[float]] = {}
_lock = Lock()


def _trusted_proxy_count() -> int:
    try:
        from config import TRUSTED_PROXY_COUNT
        return TRUSTED_PROXY_COUNT
    except ImportError:
        return max(0, int(os.environ.get('TRUSTED_PROXY_COUNT', '0')))


def client_ip(request) -> str:
    """Client IP for rate limiting; matches werkzeug ProxyFix x_for semantics."""
    trusted = _trusted_proxy_count()
    if trusted:
        forwarded = request.headers.get('X-Forwarded-For', '')
        if forwarded:
            values = parse_list_header(forwarded)
            if len(values) >= trusted:
                return values[-trusted]
    return request.remote_addr or '127.0.0.1'


def _policy_tier(role: str) -> str:
    if role in ('staff', 'admin'):
        return 'privileged'
    return 'community'


def _bucket_key(ip: str, role: str) -> str:
    return f'{ip}:{_policy_tier(role)}'


def _max_hits_for_role(role: str) -> int:
    if role in ('staff', 'admin'):
        return _MAX_PRIVILEGED
    return _MAX_COMMUNITY


def upload_rate_limit_ok(request, role: str = 'community') -> bool:
    ip = client_ip(request)
    key = _bucket_key(ip, role)
    now = time.time()
    window_start = now - _WINDOW_SEC
    max_hits = _max_hits_for_role(role)

    with _lock:
        hits = [t for t in _buckets.get(key, []) if t > window_start]
        if len(hits) >= max_hits:
            _buckets[key] = hits
            return False
        hits.append(now)
        _buckets[key] = hits
    return True


def upload_rate_limit_response():
    from flask import jsonify
    return jsonify({
        'error': 'Too many uploads in a short time. Please wait a few minutes and try again.',
    }), 429
