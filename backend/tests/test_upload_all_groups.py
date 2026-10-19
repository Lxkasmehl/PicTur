"""
Community upload "to all research groups": one request, one review packet per group that accepts
community photos (each with its own copy of the files), and the single-group upload is unchanged.
"""

import io
import os
from unittest.mock import MagicMock, patch

import pytest

from tests.test_tenant_routing import env  # noqa: F401 - pytest fixture


@pytest.fixture
def spawned(env, tmp_path, monkeypatch):  # noqa: F811
    """Record (group slug, packet args) instead of building packets in threads."""
    import tenant
    from services import manager_service

    calls = []

    def fake_spawn(target, *args, **_kwargs):
        t = tenant.current()
        calls.append({'slug': t.slug if t else 'main', 'img': args[0], 'info': args[1],
                      'req_id': args[2], 'extras': args[3]})

    upload_dir = tmp_path / 'uploads'
    upload_dir.mkdir()
    monkeypatch.setattr('routes.upload.UPLOAD_FOLDER', str(upload_dir))
    monkeypatch.setattr(manager_service, '_main_manager', MagicMock())
    manager_service._main_manager_ready.set()
    with patch('tenant.spawn', side_effect=fake_spawn), \
            patch('routes.upload.ingest_saved_upload', side_effect=lambda p, **_k: p), \
            patch('routes.upload.upload_rate_limit_ok', return_value=True):
        yield env['client'], calls


def _form(**extra):
    data = {'file': (io.BytesIO(b'\xff\xd8\xffmain'), 'turtle.jpg'),
            'extra_microhabitat_0': (io.BytesIO(b'\xff\xd8\xffextra'), 'habitat.jpg')}
    data.update(extra)
    return data


def test_all_groups_creates_one_packet_per_accepting_group(spawned):
    client, calls = spawned
    r = client.post('/api/upload', data=_form(all_groups='1'), content_type='multipart/form-data')
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    # alpha accepts community uploads, beta does not
    assert sorted(body['groups']) == ['alpha', 'main']
    assert sorted(c['slug'] for c in calls) == ['alpha', 'main']
    assert len(set(body['request_ids'])) == 2

    by_slug = {c['slug']: c for c in calls}
    assert by_slug['main']['info']['photo_type'] == 'unclassified'
    assert by_slug['alpha']['info']['photo_type'] == 'carapace'
    assert sorted(by_slug['alpha']['info']['shared_with']) == ['Alpha', 'Main']
    # every packet owns its files (each build deletes them afterwards)
    imgs = {c['img'] for c in calls}
    extras = {c['extras'][0]['path'] for c in calls}
    assert len(imgs) == 2 and len(extras) == 2
    assert all(os.path.isfile(p) for p in imgs | extras)


def test_single_group_upload_is_unchanged(spawned):
    client, calls = spawned
    r = client.post('/api/upload', data=_form(), content_type='multipart/form-data',
                    headers={'X-Org-Slug': 'alpha'})
    assert r.status_code == 200, r.get_json()
    assert [c['slug'] for c in calls] == ['alpha']
    assert 'shared_with' not in calls[0]['info']


def test_all_groups_is_ignored_inside_a_group(spawned):
    client, calls = spawned
    r = client.post('/api/upload', data=_form(all_groups='1'), content_type='multipart/form-data',
                    headers={'X-Org-Slug': 'alpha'})
    assert r.status_code == 200
    assert [c['slug'] for c in calls] == ['alpha']


def test_group_list_unavailable_falls_back_to_main(spawned):
    client, calls = spawned
    with patch('tenant._fetch_public_orgs', return_value=[]):
        r = client.post('/api/upload', data=_form(all_groups='1'), content_type='multipart/form-data')
    assert r.status_code == 200
    assert [c['slug'] for c in calls] == ['main']
