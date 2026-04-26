"""
Integration tests: mark-deceased lookup-options (GET) and turtle/mark-deceased (POST).
Run against backend in Docker with BACKEND_URL + AUTH_URL (see conftest).
"""

import pytest
import requests


def test_lookup_options_requires_auth(backend_url, integration_env):
    """GET /api/sheets/mark-deceased/lookup-options without Authorization returns 401."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    r = requests.get(
        f"{backend_url}/api/sheets/mark-deceased/lookup-options",
        params={"sheet_name": "Kansas", "field": "biology_id"},
        timeout=10,
    )
    assert r.status_code == 401
    data = r.json() if r.content else {}
    assert "error" in data


def test_lookup_options_forbidden_community(backend_url, community_token, integration_env):
    """Community JWT cannot list lookup options (staff/admin only)."""
    if not integration_env or not community_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL and seed community user")
    r = requests.get(
        f"{backend_url}/api/sheets/mark-deceased/lookup-options",
        params={"sheet_name": "Kansas", "field": "biology_id"},
        headers={"Authorization": f"Bearer {community_token}"},
        timeout=15,
    )
    assert r.status_code == 403
    data = r.json() if r.content else {}
    assert "error" in data


def test_lookup_options_missing_sheet_name(client):
    """GET without sheet_name returns 400."""
    r = client.get(
        "/api/sheets/mark-deceased/lookup-options",
        params={"field": "biology_id"},
    )
    assert r.status_code == 400
    data = r.get_json()
    assert data is not None and "error" in data
    assert "sheet" in data["error"].lower()


def test_lookup_options_invalid_field(client):
    """GET with field not in primary_id | biology_id | name returns 400."""
    r = client.get(
        "/api/sheets/mark-deceased/lookup-options",
        params={"sheet_name": "Kansas", "field": "invalid"},
    )
    assert r.status_code == 400
    data = r.get_json()
    assert data is not None and "error" in data


def test_lookup_options_success_shape(client):
    """GET with valid params returns JSON with success and options list (or 503 if Sheets off)."""
    r = client.get(
        "/api/sheets/mark-deceased/lookup-options",
        params={"sheet_name": "Kansas", "field": "biology_id"},
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data is not None
    assert data.get("success") is True
    assert "options" in data
    assert isinstance(data["options"], list)
    assert data.get("count") == len(data["options"])


def test_mark_deceased_requires_auth(backend_url, integration_env):
    """POST /api/sheets/turtle/mark-deceased without token returns 401."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    r = requests.post(
        f"{backend_url}/api/sheets/turtle/mark-deceased",
        json={"sheet_name": "Kansas", "biology_id": "F1"},
        timeout=10,
    )
    assert r.status_code == 401


def test_mark_deceased_missing_lookup_identifiers(client):
    """POST with sheet_name but no primary_id/biology_id/name returns 400."""
    r = client.post(
        "/api/sheets/turtle/mark-deceased",
        json={"sheet_name": "Kansas"},
        content_type="application/json",
    )
    assert r.status_code == 400
    data = r.get_json()
    assert data is not None and "error" in data


def test_mark_deceased_multiple_lookup_identifiers(client):
    """POST with more than one lookup field returns 400."""
    r = client.post(
        "/api/sheets/turtle/mark-deceased",
        json={
            "sheet_name": "Kansas",
            "biology_id": "F1",
            "name": "Some Turtle",
        },
        content_type="application/json",
    )
    assert r.status_code == 400


def test_mark_deceased_not_found_safe_id(client):
    """POST with a biology ID that should not exist returns 404 (no sheet mutation)."""
    r = client.post(
        "/api/sheets/turtle/mark-deceased",
        json={
            "sheet_name": "Kansas",
            "biology_id": "UNLIKELY_E2E_NO_MATCH_99999",
        },
        content_type="application/json",
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 404
    data = r.get_json()
    assert data is not None and "error" in data


def test_lookup_options_staff_token_allowed(backend_url, staff_token, integration_env):
    """Staff role may call lookup-options (same as admin for sheets routes)."""
    if not integration_env or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL and seed staff user")
    r = requests.get(
        f"{backend_url}/api/sheets/mark-deceased/lookup-options",
        params={"sheet_name": "Kansas", "field": "name"},
        headers={"Authorization": f"Bearer {staff_token}"},
        timeout=30,
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert isinstance(data.get("options"), list)
