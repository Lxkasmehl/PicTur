"""
Signed, short-lived URLs for research-group photos.

URLs are relative to the API base (e.g. http://host:5000/api). <img src> cannot send an Authorization header, so API responses embed image URLs carrying a token
that authorizes exactly one file of one group. Tokens are minted only after the normal
authorization of the request that lists the image.
"""

import time

import jwt

from config import JWT_SECRET

MEDIA_TTL_SECONDS = 6 * 3600
_PURPOSE = 'org_media'


def sign(org_id: int, kind: str, obj_id: int, ttl: int = MEDIA_TTL_SECONDS) -> str:
    now = int(time.time())
    payload = {'purpose': _PURPOSE, 'org': int(org_id), 'k': kind, 'id': int(obj_id), 'iat': now, 'exp': now + ttl}
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def verify(token: str, org_id: int, kind: str, obj_id: int) -> bool:
    if not token:
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return False
    return (
        payload.get('purpose') == _PURPOSE
        and payload.get('org') == int(org_id)
        and payload.get('k') == kind
        and payload.get('id') == int(obj_id)
    )


def image_url(slug: str, org_id: int, image_id: int) -> str:
    return f'/v2/orgs/{slug}/media/image/{image_id}?t={sign(org_id, "image", image_id)}'


def submission_url(slug: str, org_id: int, submission_id: int) -> str:
    return f'/v2/orgs/{slug}/media/submission/{submission_id}?t={sign(org_id, "submission", submission_id)}'
