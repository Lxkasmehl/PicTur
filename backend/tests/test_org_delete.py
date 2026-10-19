"""
Deleting a research group (super admins only): usage report, confirmation rules, and that the
group's database rows, files and caches are purged after the auth service removed it.
"""

import os
from unittest.mock import patch

from tests.test_tenant_routing import _h, env  # noqa: F401 - pytest fixture


def _seed(env):
    c = env['client']
    r = c.post('/api/sheets/sheets', json={'sheet_name': 'Ohio'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 200, r.get_json()
    # instantiates the group's TurtleManager (and its data dir)
    assert c.get('/api/locations', headers=_h('a-staff', 'alpha')).status_code == 200


def _add_queue_packet(org_id):
    import tenant

    packet = os.path.join(tenant.data_dir(org_id), 'Review_Queue', 'Req_1_test')
    os.makedirs(packet, exist_ok=True)
    with open(os.path.join(packet, 'photo.jpg'), 'wb') as f:
        f.write(b'\xff\xd8\xff')


def test_usage_requires_super_admin(env):
    c = env['client']
    assert c.get('/api/org/usage', headers=_h('a-admin', 'alpha')).status_code == 403
    r = c.get('/api/org/usage', headers=_h('super', 'alpha'))
    assert r.status_code == 200
    assert r.get_json()['usage']['has_data'] is False


def test_main_group_cannot_be_deleted(env):
    r = env['client'].delete('/api/org', json={'confirm_slug': 'main'}, headers=_h('super'))
    assert r.status_code in (400, 403)


def test_empty_group_is_deleted_and_purged(env):
    import tenant
    from orgs.db import Session
    from orgs.models import SheetTab
    from services import manager_service

    _seed(env)
    c = env['client']
    assert 10 in manager_service._tenant_managers
    with patch('routes.org_admin._delete_in_auth_service', return_value=(True, 200, None)) as auth_del:
        r = c.delete('/api/org', json={'confirm_slug': 'alpha'}, headers=_h('super', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert r.get_json()['purged'] is True
    auth_del.assert_called_once_with(10, 'alpha')
    assert not os.path.exists(os.path.dirname(tenant.data_dir(10)))
    assert 10 not in manager_service._tenant_managers
    assert not any(k[0] == 10 for k in manager_service._tenant_sheets)
    assert Session.query(SheetTab).filter(SheetTab.org_id == 10).count() == 0
    Session.rollback()


def test_wrong_slug_is_rejected(env):
    with patch('routes.org_admin._delete_in_auth_service') as auth_del:
        r = env['client'].delete('/api/org', json={'confirm_slug': 'alph'}, headers=_h('super', 'alpha'))
    assert r.status_code == 400
    auth_del.assert_not_called()


def test_group_admin_cannot_delete(env):
    with patch('routes.org_admin._delete_in_auth_service') as auth_del:
        r = env['client'].delete('/api/org', json={'confirm_slug': 'alpha'}, headers=_h('a-admin', 'alpha'))
    assert r.status_code == 403
    auth_del.assert_not_called()


def test_group_with_data_needs_its_full_name(env):
    import tenant

    _seed(env)
    _add_queue_packet(10)
    c = env['client']
    usage = c.get('/api/org/usage', headers=_h('super', 'alpha')).get_json()['usage']
    assert usage['review_queue'] == 1
    assert usage['photos'] == 1
    assert usage['has_data'] is True

    with patch('routes.org_admin._delete_in_auth_service', return_value=(True, 200, None)) as auth_del:
        r = c.delete('/api/org', json={'confirm_slug': 'alpha'}, headers=_h('super', 'alpha'))
        assert r.status_code == 409
        auth_del.assert_not_called()
        assert os.path.isdir(tenant.data_dir(10))

        r = c.delete('/api/org', json={'confirm_slug': 'alpha', 'confirm_name': 'Alpha'},
                     headers=_h('super', 'alpha'))
    assert r.status_code == 200, r.get_json()
    assert not os.path.exists(tenant.data_dir(10))


def test_auth_failure_keeps_everything(env):
    import tenant

    _seed(env)
    with patch('routes.org_admin._delete_in_auth_service', return_value=(False, 503, 'down')):
        r = env['client'].delete('/api/org', json={'confirm_slug': 'alpha'}, headers=_h('super', 'alpha'))
    assert r.status_code == 503
    assert os.path.isdir(tenant.data_dir(10))
