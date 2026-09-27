"""
Unit tests for the research-group API (/api/v2/orgs/<slug>/...).

Runs against a temporary SQLite database and storage root. The auth backend is faked at
auth.validate_with_auth_service and the matcher at orgs.matching._brain, so no services, GPU or
network are needed. Pins: role checks come from live memberships (not the JWT role claim), strict
isolation between groups, the submission -> review -> turtle flow, and signed media URLs.
"""

import io
import os
import threading
from unittest.mock import patch

import pytest

ORG_A = {'id': 10, 'slug': 'alpha', 'name': 'Alpha', 'kind': 'db', 'accepts_community': True}
ORG_B = {'id': 11, 'slug': 'beta', 'name': 'Beta', 'kind': 'db', 'accepts_community': True}
ORG_CLOSED = {'id': 12, 'slug': 'closed', 'name': 'Closed', 'kind': 'db', 'accepts_community': False}
ORG_MAIN = {'id': 1, 'slug': 'main', 'name': 'Main', 'kind': 'sheets', 'accepts_community': True}
ORGS = {o['slug']: o for o in (ORG_A, ORG_B, ORG_CLOSED, ORG_MAIN)}

# token -> (user, super admin?, {org_id: role}); main-group role 'admin' must NOT leak into groups
USERS = {
    'a-admin': ({'id': 1, 'email': 'a-admin@x.org', 'role': 'admin'}, False, {10: 'admin'}),
    'a-staff': ({'id': 2, 'email': 'a-staff@x.org', 'role': 'community'}, False, {10: 'staff'}),
    'b-staff': ({'id': 3, 'email': 'b-staff@x.org', 'role': 'community'}, False, {11: 'staff'}),
    'main-admin': ({'id': 4, 'email': 'main@x.org', 'role': 'admin'}, False, {}),
    'citizen': ({'id': 5, 'email': 'citizen@x.org', 'role': 'community'}, False, {}),
    'super': ({'id': 6, 'email': 'super@x.org', 'role': 'community'}, True, {}),
}


def _fake_validate(auth_header, org_slug=None):
    token = auth_header.split(' ', 1)[-1]
    if token not in USERS:
        return False, 'Invalid or expired token', None
    user, sa, roles = USERS[token]
    memberships = [
        {'org_id': 1, 'slug': 'main', 'kind': 'sheets', 'role': user['role']},
        *[
            {'org_id': oid, 'slug': next(o['slug'] for o in ORGS.values() if o['id'] == oid),
             'kind': 'db', 'role': role}
            for oid, role in roles.items()
        ],
    ]
    return True, None, {
        'valid': True,
        'user': user,
        'is_super_admin': sa,
        'memberships': memberships,
        'org': ORGS.get(org_slug),
    }


class FakeBrain:
    """Stands in for TurtleDeepMatcher's research-group cache API.
    'Matching' returns every cached turtle with a fixed score (respecting the region filter)."""

    def __init__(self):
        self.org_caches = {}

    def has_org_cache(self, org_id):
        return org_id in self.org_caches

    def load_org_cache(self, org_id, entries):
        self.org_caches[org_id] = [
            {'site_id': tid, 'location': rid, 'file_path': pt} for pt, tid, rid in entries if os.path.exists(pt)
        ]
        return len(self.org_caches[org_id])

    def add_to_org_cache(self, org_id, pt_path, turtle_id, region_id):
        cache = [c for c in self.org_caches.get(org_id, []) if c['site_id'] != turtle_id]
        cache.append({'site_id': turtle_id, 'location': region_id, 'file_path': pt_path})
        self.org_caches[org_id] = cache
        return True

    def remove_from_org_cache(self, org_id, turtle_id):
        self.org_caches[org_id] = [c for c in self.org_caches.get(org_id, []) if c['site_id'] != turtle_id]

    def update_org_cache_location(self, org_id, turtle_id, region_id):
        for c in self.org_caches.get(org_id, []):
            if c['site_id'] == turtle_id:
                c['location'] = region_id

    def match_against_org_cache(self, org_id, query_feats, region_ids=None):
        return [
            {'site_id': c['site_id'], 'location': c['location'], 'file_path': c['file_path'],
             'score': 100, 'confidence': 0.9}
            for c in self.org_caches.get(org_id, [])
            if region_ids is None or c['location'] in region_ids
        ]

    def process_and_save(self, image_path, pt_path):
        with open(pt_path, 'wb') as f:
            f.write(b'features')
        return True

    def extract_query_features(self, path):
        return ['q'] if os.path.exists(path) else None


@pytest.fixture
def env(tmp_path, monkeypatch):
    from orgs import db as org_db

    monkeypatch.setenv('ORG_DATA_DIR', str(tmp_path / 'org_data'))
    upload_dir = tmp_path / 'uploads'
    upload_dir.mkdir()
    org_db.reset_for_tests()
    # ORGS_TEST_DATABASE_URL runs the same suite against PostgreSQL (tables are emptied first).
    pg_url = os.environ.get('ORGS_TEST_DATABASE_URL')
    if pg_url:
        engine = org_db.init_engine(pg_url)
        from orgs.models import Base

        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(table.delete())
    else:
        org_db.init_engine(f"sqlite:///{(tmp_path / 'orgs.sqlite').as_posix()}")
    brain = FakeBrain()
    public = [o for o in ORGS.values() if o['accepts_community']]
    with patch('auth.validate_with_auth_service', side_effect=_fake_validate), \
            patch('orgs.matching._brain', return_value=brain), \
            patch('orgs.tenancy._fetch_public_orgs', return_value=public), \
            patch('routes.orgs_api.UPLOAD_FOLDER', str(upload_dir)), \
            patch('routes.orgs_api.ingest_saved_upload', side_effect=lambda p, **kw: p), \
            patch('routes.orgs_api.upload_rate_limit_ok', return_value=True):
        from app import app

        app.config['TESTING'] = True
        yield {'client': app.test_client(), 'brain': brain, 'tmp': tmp_path}
    org_db.reset_for_tests()


def _h(token):
    return {'Authorization': f'Bearer {token}'}


def _photo(name='shell.jpg'):
    return {'file': (io.BytesIO(b'\xff\xd8\xff\xe0 fake jpeg'), name)}


def _submit(client, slug, token=None, **form):
    data = {**_photo(), **{k: str(v) for k, v in form.items()}}
    return client.post(
        f'/api/v2/orgs/{slug}/submissions',
        data=data,
        content_type='multipart/form-data',
        headers=_h(token) if token else {},
    )


def _new_turtle(client, slug='alpha', token='a-staff', **fields):
    r = _submit(client, slug, token)
    assert r.status_code == 201, r.get_json()
    sub = r.get_json()['submission']
    r = client.post(
        f'/api/v2/orgs/{slug}/submissions/{sub["id"]}/approve',
        json={'new_turtle': {'sex': 'F', **fields}},
        headers=_h(token),
    )
    assert r.status_code == 200, r.get_json()
    return r.get_json()['turtle']


# ---------------- access control ----------------

def test_main_group_role_does_not_grant_group_access(env):
    """A main-group admin (JWT role 'admin') without membership is only a visitor of Alpha."""
    r = env['client'].get('/api/v2/orgs/alpha/turtles', headers=_h('main-admin'))
    assert r.status_code == 403


def test_member_of_other_group_is_rejected(env):
    r = env['client'].get('/api/v2/orgs/alpha/turtles', headers=_h('b-staff'))
    assert r.status_code == 403


def test_super_admin_has_admin_rights_everywhere(env):
    r = env['client'].post('/api/v2/orgs/beta/regions', json={'name': 'North'}, headers=_h('super'))
    assert r.status_code == 201


def test_anonymous_needs_login_for_staff_routes(env):
    assert env['client'].get('/api/v2/orgs/alpha/turtles').status_code == 401


def test_classic_main_group_is_not_served(env):
    r = env['client'].get('/api/v2/orgs/main/turtles', headers=_h('main-admin'))
    assert r.status_code == 400


def test_unknown_group_404(env):
    assert env['client'].get('/api/v2/orgs/nope/regions', headers=_h('a-staff')).status_code == 404


def test_database_not_configured_returns_503(env):
    from orgs import db as org_db

    org_db.reset_for_tests()
    assert env['client'].get('/api/v2/orgs/alpha/regions', headers=_h('a-staff')).status_code == 503


def test_region_management_requires_group_admin(env):
    c = env['client']
    assert c.post('/api/v2/orgs/alpha/regions', json={'name': 'X'}, headers=_h('a-staff')).status_code == 403
    r = c.post('/api/v2/orgs/alpha/regions', json={'name': 'Kansas'}, headers=_h('a-admin'))
    assert r.status_code == 201
    parent = r.get_json()['region']['id']
    r = c.post('/api/v2/orgs/alpha/regions', json={'name': 'Lawrence', 'parent_id': parent}, headers=_h('a-admin'))
    assert r.status_code == 201
    assert c.post('/api/v2/orgs/alpha/regions', json={'name': 'Kansas'}, headers=_h('a-admin')).status_code == 409
    # Community visitors can read regions (upload form) of groups accepting uploads.
    r = c.get('/api/v2/orgs/alpha/regions')
    assert r.status_code == 200
    assert {x['name'] for x in r.get_json()['regions']} == {'Kansas', 'Lawrence'}
    # Parent in use by a child -> cannot delete.
    assert c.delete(f'/api/v2/orgs/alpha/regions/{parent}', headers=_h('a-admin')).status_code == 409


def test_region_of_other_group_cannot_be_referenced(env):
    c = env['client']
    rb = c.post('/api/v2/orgs/beta/regions', json={'name': 'B-only'}, headers=_h('super')).get_json()['region']
    r = c.post('/api/v2/orgs/alpha/regions', json={'name': 'child', 'parent_id': rb['id']}, headers=_h('a-admin'))
    assert r.status_code == 404
    assert _submit(c, 'alpha', 'a-staff', region_id=rb['id']).status_code == 404


def test_closed_group_rejects_community_uploads(env):
    assert _submit(env['client'], 'closed').status_code == 404  # not in the public list
    assert _submit(env['client'], 'closed', 'citizen').status_code == 403


# ---------------- submission -> turtle flow ----------------

def test_staff_submission_creates_turtle_with_reference(env):
    c = env['client']
    turtle = _new_turtle(c, name='Shelly')
    assert turtle['bio_id'] == 'F1'
    assert turtle['primary_id'].startswith('T')
    assert turtle['sighting_count'] == 1
    assert len(turtle['images']) == 1 and turtle['images'][0]['is_reference'] is True
    # Reference is live in this group's cache, not in any other.
    assert [x['site_id'] for x in env['brain'].org_caches[10]] == [turtle['id']]
    assert 11 not in env['brain'].org_caches

    second = _new_turtle(c, name='Other')
    assert second['bio_id'] == 'F2'


def test_resighting_matches_existing_turtle_and_adds_sighting(env):
    c = env['client']
    turtle = _new_turtle(c)
    r = _submit(c, 'alpha', 'a-staff', observed_at='2026-05-01', lat=39.0, lon=-95.2)
    sub = r.get_json()['submission']
    assert sub['match_state'] == 'done'
    assert [x['turtle_id'] for x in sub['candidates']] == [turtle['id']]
    assert sub['candidates'][0]['turtle']['bio_id'] == 'F1'

    r = c.post(f'/api/v2/orgs/alpha/submissions/{sub["id"]}/approve',
               json={'turtle_id': turtle['id']}, headers=_h('a-staff'))
    assert r.status_code == 200
    detail = r.get_json()['turtle']
    assert detail['sighting_count'] == 2
    assert len(detail['images']) == 2
    assert sum(1 for i in detail['images'] if i['is_reference']) == 1
    assert any(s['lat'] == 39.0 for s in detail['sightings'])

    # Resolved submissions cannot be approved twice.
    r = c.post(f'/api/v2/orgs/alpha/submissions/{sub["id"]}/approve',
               json={'turtle_id': turtle['id']}, headers=_h('a-staff'))
    assert r.status_code == 409


def test_matching_never_returns_turtles_of_another_group(env):
    c = env['client']
    _new_turtle(c, 'alpha', 'a-staff')
    r = _submit(c, 'beta', 'b-staff')
    assert r.status_code == 201
    assert r.get_json()['submission']['candidates'] == []


def test_region_filter_prefers_region_then_widens(env):
    c = env['client']
    kansas = c.post('/api/v2/orgs/alpha/regions', json={'name': 'Kansas'}, headers=_h('a-admin')).get_json()['region']
    iowa = c.post('/api/v2/orgs/alpha/regions', json={'name': 'Iowa'}, headers=_h('a-admin')).get_json()['region']
    t_iowa = _new_turtle(c, region_id=iowa['id'])
    t_kansas = _new_turtle(c, region_id=kansas['id'])
    r = _submit(c, 'alpha', 'a-staff', region_id=kansas['id'])
    cands = r.get_json()['submission']['candidates']
    assert [(x['turtle_id'], x['in_region']) for x in cands] == [(t_kansas['id'], True), (t_iowa['id'], False)]


def test_group_data_is_invisible_to_other_groups(env):
    c = env['client']
    turtle = _new_turtle(c)
    assert c.get(f'/api/v2/orgs/beta/turtles/{turtle["id"]}', headers=_h('b-staff')).status_code == 404
    assert c.get('/api/v2/orgs/beta/turtles', headers=_h('b-staff')).get_json()['turtles'] == []
    assert c.patch(f'/api/v2/orgs/beta/turtles/{turtle["id"]}', json={'name': 'x'},
                   headers=_h('b-staff')).status_code == 404


def test_community_submission_is_matched_in_background_and_reviewable(env):
    c = env['client']
    _new_turtle(c)
    r = _submit(c, 'alpha', 'citizen', notes='Found near the pond')
    assert r.status_code == 201
    sub_id = r.get_json()['submission']['id']
    assert 'candidates' not in r.get_json()['submission']
    for t in threading.enumerate():
        if t.name == f'org-match-{sub_id}':
            t.join(timeout=10)

    subs = c.get('/api/v2/orgs/alpha/submissions', headers=_h('a-staff')).get_json()['submissions']
    mine = next(s for s in subs if s['id'] == sub_id)
    assert mine['match_state'] == 'done'
    assert mine['uploader_email'] == 'citizen@x.org'
    assert len(mine['candidates']) == 1

    # The uploader sees their own submission without candidates.
    own = c.get('/api/v2/orgs/alpha/submissions/mine', headers=_h('citizen')).get_json()['submissions']
    assert [s['id'] for s in own] == [sub_id]
    assert 'candidates' not in own[0]
    # ...but no staff views.
    assert c.get(f'/api/v2/orgs/alpha/submissions/{sub_id}', headers=_h('citizen')).status_code == 403

    assert c.post(f'/api/v2/orgs/alpha/submissions/{sub_id}/reject', headers=_h('a-staff')).status_code == 200
    pending = c.get('/api/v2/orgs/alpha/submissions', headers=_h('a-staff')).get_json()['submissions']
    assert sub_id not in [s['id'] for s in pending]


def test_anonymous_community_submission(env):
    r = _submit(env['client'], 'alpha')
    assert r.status_code == 201


def test_set_reference_and_delete_image(env):
    c = env['client']
    turtle = _new_turtle(c)
    sub = _submit(c, 'alpha', 'a-staff').get_json()['submission']
    detail = c.post(f'/api/v2/orgs/alpha/submissions/{sub["id"]}/approve',
                    json={'turtle_id': turtle['id']}, headers=_h('a-staff')).get_json()['turtle']
    old_ref = next(i for i in detail['images'] if i['is_reference'])
    new_img = next(i for i in detail['images'] if not i['is_reference'])
    assert c.delete(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}/images/{old_ref["id"]}',
                    headers=_h('a-staff')).status_code == 409
    r = c.post(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}/reference', json={'image_id': new_img['id']},
               headers=_h('a-staff'))
    assert r.status_code == 200
    refs = [i['id'] for i in r.get_json()['turtle']['images'] if i['is_reference']]
    assert refs == [new_img['id']]
    assert c.delete(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}/images/{old_ref["id"]}',
                    headers=_h('a-staff')).status_code == 200


def test_update_and_delete_turtle(env):
    c = env['client']
    turtle = _new_turtle(c)
    r = c.patch(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}',
                json={'name': 'Renamed', 'status': 'deceased', 'bio_id': 'HACK'}, headers=_h('a-staff'))
    assert r.status_code == 200
    body = r.get_json()['turtle']
    assert (body['name'], body['status'], body['bio_id']) == ('Renamed', 'deceased', 'F1')
    assert c.patch(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}', json={'sex': 'X'},
                   headers=_h('a-staff')).status_code == 400
    assert c.delete(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}', headers=_h('a-staff')).status_code == 403
    assert c.delete(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}', headers=_h('a-admin')).status_code == 200
    assert c.get(f'/api/v2/orgs/alpha/turtles/{turtle["id"]}', headers=_h('a-staff')).status_code == 404
    assert all(x['site_id'] != turtle['id'] for x in env['brain'].org_caches.get(10, []))


# ---------------- media ----------------

def test_media_urls_are_signed_per_file(env):
    c = env['client']
    turtle = _new_turtle(c)
    url = turtle['images'][0]['url']
    assert url.startswith('/v2/orgs/alpha/media/image/')
    r = c.get('/api' + url)
    assert r.status_code == 200
    assert r.data.startswith(b'\xff\xd8')
    base = url.split('?')[0]
    assert c.get('/api' + base).status_code == 404
    assert c.get('/api' + base + '?t=forged').status_code == 404
    # A valid token for another object does not unlock this one.
    other = _new_turtle(c)['images'][0]['url']
    token_other = other.split('?t=')[1]
    assert c.get('/api' + base + '?t=' + token_other).status_code == 404


def test_files_live_outside_main_data_dir(env):
    turtle = _new_turtle(env['client'])
    root = env['tmp'] / 'org_data' / '10' / 'turtles' / str(turtle['id'])
    assert root.is_dir() and any(p.suffix == '.jpg' for p in root.iterdir())
    assert any(p.suffix == '.pt' for p in root.iterdir())


# ---------------- matcher cache isolation (real class, no torch work) ----------------

def test_matcher_org_caches_are_isolated_from_main_caches(tmp_path):
    from turtles.image_processing import TurtleDeepMatcher

    m = TurtleDeepMatcher.__new__(TurtleDeepMatcher)
    m.vram_cache_plastron = [{'site_id': 'main-p', 'location': 'Kansas', 'file_path': 'p', 'feats': {}}]
    m.vram_cache_carapace = [{'site_id': 'main-c', 'location': 'Kansas', 'file_path': 'c', 'feats': {}}]
    m.org_caches = {}
    m._gpu_lock = threading.Lock()
    m.device_str = 'cpu'
    m.device = 'cpu'
    m._load_feats_unlocked = lambda p: {}
    m._run_glue = lambda q, f: (0.8, 50)

    pts = []
    for i in range(3):
        p = tmp_path / f'{i}.pt'
        p.write_bytes(b'x')
        pts.append(str(p))
    assert m.load_org_cache(10, [(pts[0], 1, 100), (pts[1], 2, 200)]) == 2
    assert m.load_org_cache(11, [(pts[2], 3, None)]) == 1

    ids = lambda res: sorted(r['site_id'] for r in res)
    assert ids(m.match_against_org_cache(10, ['q'])) == [1, 2]
    assert ids(m.match_against_org_cache(10, ['q'], {200})) == [2]
    assert ids(m.match_against_org_cache(11, ['q'])) == [3]
    assert m.match_against_org_cache(99, ['q']) == []

    # Reloading a group leaves the main caches and other groups untouched.
    m.load_org_cache(10, [])
    assert m.org_caches[10] == [] and ids(m.org_caches[11]) == [3]
    assert [c['site_id'] for c in m.vram_cache_plastron] == ['main-p']
    assert [c['site_id'] for c in m.vram_cache_carapace] == ['main-c']

    # Main-group matching never sees group references.
    main = m.match_against_cache(['q'], photo_type='carapace')
    assert ids(main) == ['main-c']

    m.add_to_org_cache(11, pts[0], 3, 5)  # replaces turtle 3's reference
    assert len(m.org_caches[11]) == 1 and m.org_caches[11][0]['location'] == 5
    assert m.remove_from_org_cache(11, 3) == 1


def test_database_connects_lazily_after_startup_failure(env, monkeypatch, tmp_path):
    """PostgreSQL booting after the backend: the first request after start-up connects."""
    from orgs import db as org_db

    org_db.reset_for_tests()
    monkeypatch.setattr(org_db, '_last_attempt', 0.0)
    monkeypatch.setenv('DATABASE_URL', f"sqlite:///{(tmp_path / 'late.sqlite').as_posix()}")
    r = env['client'].get('/api/v2/orgs/alpha/regions', headers=_h('a-staff'))
    assert r.status_code == 200
    assert org_db.is_configured()
