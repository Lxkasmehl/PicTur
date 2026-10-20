"""
Configurable turtle columns of database-backed research groups: validation, new tabs with the
chosen columns, custom columns stored and read back, renames that keep the data, and the main
group staying on the fixed Google Sheets columns.
"""

import pytest

import turtle_columns
from tests.test_tenant_routing import _h, env  # noqa: F401 - pytest fixture


def test_normalize_keeps_required_and_canonical_order():
    schema = turtle_columns.normalize_schema({'standard': ['name', 'sex'], 'custom': []})
    assert schema['standard'] == ['primary_id', 'id', 'name', 'sex', 'general_location']


@pytest.mark.parametrize('custom, message', [
    ([{'label': 'Name'}], 'already exists'),
    ([{'label': 'Eye'}, {'label': 'eye'}], 'already exists'),
    ([{'label': ''}], 'needs a name'),
    ([{'label': 'Color', 'type': 'select', 'options': []}], 'at least one option'),
    ([{'label': 'Color', 'type': 'bogus'}], 'Unknown column type'),
])
def test_normalize_rejects_bad_custom_columns(custom, message):
    with pytest.raises(ValueError, match=message):
        turtle_columns.normalize_schema({'custom': custom})


def test_normalize_rejects_unknown_standard_column():
    with pytest.raises(ValueError, match='Unknown standard'):
        turtle_columns.normalize_schema({'standard': ['nope']})


def test_custom_keys_are_stable_and_unique():
    schema = turtle_columns.normalize_schema({'custom': [
        {'label': 'Eye color', 'type': 'select', 'options': ['brown', 'red', 'brown']},
        {'label': 'Eye-color!', 'type': 'text'},
    ]})
    keys = [c['key'] for c in schema['custom']]
    assert keys == ['custom_eye_color', 'custom_eye_color_2']
    assert schema['custom'][0]['options'] == ['brown', 'red']
    again = turtle_columns.normalize_schema({'custom': [{**schema['custom'][1], 'label': 'Iris'}]})
    assert again['custom'][0]['key'] == 'custom_eye_color_2'


def test_default_is_every_standard_column(env):
    r = env['client'].get('/api/turtle-columns', headers=_h('a-staff', 'alpha'))
    assert r.status_code == 200
    body = r.get_json()
    assert body['configurable'] is True
    assert all(c['enabled'] for c in body['standard'])
    assert body['custom'] == []


def test_main_group_is_not_configurable(env):
    r = env['client'].post('/api/turtle-columns', json={'standard': ['name']}, headers=_h('main-admin'))
    assert r.status_code == 400


def test_staff_cannot_change_columns(env):
    r = env['client'].post('/api/turtle-columns', json={'standard': ['name']}, headers=_h('a-staff', 'alpha'))
    assert r.status_code == 403


def _configure(env, **schema):
    r = env['client'].post('/api/turtle-columns', json=schema, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _tab_headers(org_id, title):
    from orgs.sheets_store import make_sheets_service

    svc = make_sheets_service(org_id, 'research')
    return svc.service.spreadsheets().values().get(
        spreadsheetId=svc.spreadsheet_id, range=f"'{title}'!1:1").execute()['values'][0]


def test_new_tabs_use_the_chosen_columns_and_custom_values_round_trip(env):
    c = env['client']
    _configure(env, standard=['name', 'sex'],
               custom=[{'label': 'Eye color', 'type': 'select', 'options': ['brown', 'red']}])
    r = c.post('/api/sheets/sheets', json={'sheet_name': 'Ohio'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert _tab_headers(10, 'Ohio') == ['Primary ID', 'ID', 'Name', 'Sex', 'General Location', 'Eye color']
    r = c.post('/api/general-locations', json={'state': 'Ohio', 'general_location': 'North'},
               headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()

    r = c.post('/api/sheets/turtle', headers=_h('a-admin', 'alpha'), json={
        'sheet_name': 'Ohio',
        'turtle_data': {'primary_id': 'T1', 'id': 'F001', 'name': 'Shelly', 'sex': 'F', 'general_location': 'North',
                        'custom_eye_color': 'red'},
    })
    assert r.status_code in (200, 201), r.get_json()
    r = c.get('/api/sheets/turtle/T1?sheet_name=Ohio', headers=_h('a-staff', 'alpha'))
    assert r.status_code == 200, r.get_json()
    data = r.get_json().get('data') or r.get_json()
    assert data['custom_eye_color'] == 'red'
    assert data['name'] == 'Shelly'

    # renaming keeps the values (the header cell is rewritten)
    schema = _configure(env, standard=['name', 'sex'],
                        custom=[{'key': 'custom_eye_color', 'label': 'Iris color', 'type': 'select',
                                 'options': ['brown', 'red']}])
    assert schema['custom'][0]['key'] == 'custom_eye_color'
    assert 'Iris color' in _tab_headers(10, 'Ohio')
    r = c.get('/api/sheets/turtle/T1?sheet_name=Ohio', headers=_h('a-staff', 'alpha'))
    data = r.get_json().get('data') or r.get_json()
    assert data['custom_eye_color'] == 'red'


def test_other_groups_do_not_see_custom_columns(env):
    _configure(env, custom=[{'label': 'Eye color'}])
    r = env['client'].get('/api/turtle-columns', headers=_h('b-staff', 'beta'))
    assert r.get_json()['custom'] == []


def test_super_admin_reads_the_template_without_main_group_role(env):
    """Creating a group offers the main group's columns as template; super admins are often
    plain community members of the main group."""
    r = env['client'].get('/api/turtle-columns', headers=_h('super'))
    assert r.status_code == 200, r.get_json()
    assert r.get_json()['configurable'] is False
    assert 'species' in {c['key'] for c in r.get_json()['standard']}


def test_group_columns_stay_staff_only(env):
    r = env['client'].get('/api/turtle-columns', headers=_h('b-staff', 'alpha'))
    assert r.status_code == 403
