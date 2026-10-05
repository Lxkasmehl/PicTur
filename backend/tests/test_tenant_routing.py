"""
Research groups run through the SAME routes as the main group (X-Org-Slug selects the group).

Pins: roles come from the group membership (never the JWT role claim), each group has its own
TurtleManager / data dir / matching caches / Sheets books / locations catalog, the main group is
untouched, background threads keep their group, and backup download tokens are bound to a group.
The auth backend is faked at auth.validate_with_auth_service; storage is SQLite + tmp dirs.
"""

import threading
from unittest.mock import patch

import jwt
import pytest

import config

ORGS = {
    'alpha': {'id': 10, 'slug': 'alpha', 'name': 'Alpha', 'kind': 'db', 'accepts_community': True},
    'beta': {'id': 11, 'slug': 'beta', 'name': 'Beta', 'kind': 'db', 'accepts_community': False},
    'main': {'id': 1, 'slug': 'main', 'name': 'Main', 'kind': 'sheets', 'accepts_community': True},
}
# token -> (jwt role claim = main-group role, super admin?, {org_id: role})
USERS = {
    'a-admin': ('community', False, {10: 'admin'}),
    'a-staff': ('community', False, {10: 'staff'}),
    'b-staff': ('community', False, {11: 'staff'}),
    'main-admin': ('admin', False, {}),
    'super': ('community', True, {}),
}


def _jwt(name):
    role = USERS[name][0]
    return jwt.encode({'id': hash(name) % 10000, 'email': f'{name}@x.org', 'role': role},
                      config.JWT_SECRET, algorithm='HS256')


def _h(name, slug=None):
    h = {'Authorization': f'Bearer {_jwt(name)}'}
    if slug:
        h['X-Org-Slug'] = slug
    return h


def _fake_validate(auth_header, org_slug=None):
    token = auth_header.split(' ', 1)[-1]
    payload = jwt.decode(token, config.JWT_SECRET, algorithms=['HS256'])
    name = payload['email'].split('@')[0]
    _role, sa, roles = USERS[name]
    memberships = [{'org_id': oid, 'slug': next(s for s, o in ORGS.items() if o['id'] == oid),
                    'kind': 'db', 'role': r} for oid, r in roles.items()]
    return True, None, {'valid': True, 'user': payload, 'is_super_admin': sa,
                        'memberships': memberships, 'org': ORGS.get(org_slug)}


@pytest.fixture
def env(tmp_path, monkeypatch):
    from orgs import db as org_db
    from services import manager_service
    import general_locations_catalog as glc

    monkeypatch.setenv('ORG_DATA_DIR', str(tmp_path / 'org_data'))
    main_catalog = tmp_path / 'main_catalog.json'
    monkeypatch.setattr(glc, '_CATALOG_FILE', str(main_catalog))
    org_db.reset_for_tests()
    org_db.init_engine(f"sqlite:///{(tmp_path / 'orgs.sqlite').as_posix()}")
    manager_service._tenant_managers.clear()
    manager_service._tenant_sheets.clear()
    public = [o for o in ORGS.values() if o['accepts_community']]
    with patch('auth.validate_with_auth_service', side_effect=_fake_validate), \
            patch('auth.check_auth_revocation', return_value=(True, None)), \
            patch('tenant._fetch_public_orgs', return_value=public):
        from app import app

        app.config['TESTING'] = True
        yield {'client': app.test_client(), 'tmp': tmp_path, 'main_catalog': main_catalog}
    manager_service._tenant_managers.clear()
    manager_service._tenant_sheets.clear()
    org_db.reset_for_tests()


def test_group_tabs_are_created_and_listed_through_the_classic_route(env):
    c = env['client']
    r = c.post('/api/sheets/sheets', json={'sheet_name': 'Ohio'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    r = c.get('/api/sheets/sheets', headers=_h('a-staff', 'alpha'))
    assert r.status_code == 200
    assert r.get_json()['sheets'] == ['Ohio']
    # other group: its own (empty) book
    r = c.get('/api/sheets/sheets', headers=_h('b-staff', 'beta'))
    assert r.get_json()['sheets'] == []


def test_role_comes_from_membership_not_jwt(env):
    c = env['client']
    # main-group admin (JWT role admin) without membership is only a visitor of Alpha
    assert c.get('/api/sheets/sheets', headers=_h('main-admin', 'alpha')).status_code == 403
    # member of another group
    assert c.get('/api/sheets/sheets', headers=_h('b-staff', 'alpha')).status_code == 403
    # JWT role 'community' but group staff -> allowed
    assert c.get('/api/sheets/sheets', headers=_h('a-staff', 'alpha')).status_code == 200
    # super admin acts as admin everywhere
    assert c.get('/api/sheets/sheets', headers=_h('super', 'beta')).status_code == 200


def test_closed_group_rejects_visitors(env):
    c = env['client']
    assert c.get('/api/locations', headers={'X-Org-Slug': 'beta'}).status_code == 404
    assert c.get('/api/locations', headers=_h('a-staff', 'beta')).status_code == 403


def test_group_has_its_own_manager_data_dir_and_matcher(env):
    from services import manager_service
    import tenant
    from turtles.image_processing import BrainView, brain

    c = env['client']
    assert c.get('/api/locations', headers=_h('a-staff', 'alpha')).status_code == 200
    mgr = manager_service._tenant_managers[10]
    assert mgr.base_dir == tenant.data_dir(10)
    assert str(env['tmp'] / 'org_data') in mgr.base_dir
    assert isinstance(mgr._brain_view, BrainView)
    assert mgr._brain_view.vram_cache_carapace is not brain.vram_cache_carapace
    # the main group's manager is never replaced
    assert manager_service._main_manager is not mgr


def test_locations_catalog_is_per_group_and_starts_empty(env):
    c = env['client']
    c.post('/api/sheets/sheets', json={'sheet_name': 'Ohio'}, headers=_h('a-admin', 'alpha'))
    r = c.get('/api/general-locations', headers=_h('a-admin', 'alpha'))
    # no Kansas seed for research groups; the tab shows up as a program without locations
    assert r.get_json()['states'] == [{'state': 'Ohio', 'locations': []}]
    r = c.post('/api/general-locations', json={'state': 'Ohio', 'general_location': 'North Site'},
               headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert 'sync_warning' not in r.get_json()
    states = {s['state']: s['locations'] for s in r.get_json()['states']}
    assert states == {'Ohio': ['North Site']}
    # main group's catalog untouched
    assert not env['main_catalog'].exists() or 'Ohio' not in env['main_catalog'].read_text()
    # other group has its own catalog
    assert c.get('/api/general-locations', headers=_h('super', 'beta')).get_json()['states'] == []


def _tabs(c, slug='alpha'):
    return c.get('/api/sheets/sheets', headers=_h('a-admin', slug)).get_json()['sheets']


def test_group_programs_are_created_with_their_tab(env):
    c = env['client']
    r = c.post('/api/general-locations/programs', json={'name': 'River Survey'},
               headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert {s['state']: s['locations'] for s in r.get_json()['states']} == {'River Survey': []}
    assert _tabs(c) == ['River Survey']
    r = c.post('/api/general-locations', json={'state': 'Lake Survey', 'general_location': 'East'},
               headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert sorted(_tabs(c)) == ['Lake Survey', 'River Survey']
    r = c.post('/api/general-locations/programs', json={'name': 'a/b'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 400

    # A program with locations cannot be removed; an empty one goes away together with its tab
    r = c.delete('/api/general-locations/programs', json={'name': 'Lake Survey'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 400
    r = c.delete('/api/general-locations/programs', json={'name': 'River Survey'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert _tabs(c) == ['Lake Survey']
    assert [s['state'] for s in r.get_json()['states']] == ['Lake Survey']


def test_fixed_program_for_a_new_name_creates_its_tab(env):
    """Regression: creating a fixed program failed because its (not yet existing) tab was scanned."""
    c = env['client']
    r = c.post('/api/general-locations/sheet-defaults',
               json={'sheet_name': 'Testzeit', 'general_location': 'Test Site'},
               headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert r.get_json()['catalog']['sheet_defaults'] == {
        'Testzeit': {'state': 'Testzeit', 'general_location': 'Test Site'}}
    assert _tabs(c) == ['Testzeit']

    # Deleting the (empty) fixed program removes its tab, so it does not come back as a program
    r = c.delete('/api/general-locations',
                 json={'state': 'Testzeit', 'general_location': 'Test Site', 'force': True},
                 headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert _tabs(c) == []
    assert c.get('/api/general-locations', headers=_h('a-admin', 'alpha')).get_json()['states'] == []


def test_spawned_threads_keep_the_group():
    import tenant

    seen = {}
    token = tenant.activate(tenant.Tenant(id=10, slug='alpha', name='Alpha', role='staff'))
    try:
        t = tenant.spawn(lambda: seen.setdefault('t', tenant.current()))
        t.join(5)
        plain = threading.Thread(target=lambda: seen.setdefault('plain', tenant.current()))
        plain.start()
        plain.join(5)
    finally:
        tenant.deactivate(token)
    assert seen['t'].slug == 'alpha'
    assert seen['plain'] is None  # why routes must use tenant.spawn


def test_backup_download_token_is_bound_to_its_group():
    import auth
    import tenant

    token = tenant.activate(tenant.Tenant(id=10, slug='alpha', name='Alpha', role='admin'))
    try:
        dl = auth.mint_download_token(1, 'all', None)
        assert auth.verify_download_token(dl, 'all', None)
    finally:
        tenant.deactivate(token)
    # same token outside the group (main) or in another group is rejected
    assert not auth.verify_download_token(dl, 'all', None)
    other = tenant.activate(tenant.Tenant(id=11, slug='beta', name='Beta', role='admin'))
    try:
        assert not auth.verify_download_token(dl, 'all', None)
    finally:
        tenant.deactivate(other)
    assert auth.download_token_org(dl)['slug'] == 'alpha'


def test_main_group_requests_have_no_group_context(env):
    import tenant
    from app import app

    for headers in (_h('main-admin'), _h('main-admin', 'main')):
        with app.test_request_context('/api/locations', headers=headers):
            assert tenant.resolve_request_tenant() is None
            assert tenant.current() is None
