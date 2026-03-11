"""
Integration tests: POST /api/sheets/generate-id (biology ID: gender + sequence number).
Auto-generated ID field (separate from Primary ID) for the Create New Turtle form.
Run against backend in Docker; requires admin auth.
"""

import re
import pytest

BIOLOGY_ID_PATTERN = re.compile(r"^[MFJU]\d+$")


def test_generate_id_requires_auth(backend_url, integration_env):
    """POST /api/sheets/generate-id without Authorization returns 401."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    import requests

    r = requests.post(
        f"{backend_url}/api/sheets/generate-id",
        json={"sex": "F", "sheet_name": "Kansas"},
        timeout=10,
    )
    assert r.status_code == 401
    data = r.json() if r.content else {}
    assert "error" in data


def test_generate_id_missing_sheet_name(client):
    """POST /api/sheets/generate-id without sheet_name returns 400."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sex": "F"},
        content_type="application/json",
    )
    assert r.status_code == 400
    data = r.get_json()
    assert data is not None
    assert "error" in data
    assert "sheet_name" in data["error"].lower()


def test_generate_id_success(client):
    """POST /api/sheets/generate-id with sheet_name and sex returns 200 and id (M/F/J/U + number)."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sex": "F", "sheet_name": "Kansas"},
        content_type="application/json",
    )
    # 200 when Sheets configured; 503 when not
    if r.status_code == 503:
        data = r.get_json() or {}
        assert "error" in data
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data is not None
    assert data.get("success") is True
    assert "id" in data
    id_value = data["id"]
    assert isinstance(id_value, str)
    assert BIOLOGY_ID_PATTERN.match(id_value), f"ID should match M/F/J/U + digits, got {id_value!r}"
    assert id_value[0] == "F", "Requested sex F so ID should start with F"


def test_generate_id_gender_prefix(client):
    """Biology ID first character reflects requested gender (M, F, J, U)."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sex": "M", "sheet_name": "Kansas"},
        content_type="application/json",
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("success") is True and data.get("id")
    assert data["id"][0] == "M"


def test_generate_id_unknown_gender_defaults_to_u(client):
    """When sex is missing or invalid, ID defaults to U prefix."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sheet_name": "Kansas"},
        content_type="application/json",
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("success") is True and data.get("id")
    assert data["id"][0] == "U"


def test_generate_id_accepts_target_spreadsheet_research(client):
    """POST with target_spreadsheet=research (default) returns same as omitting it."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sex": "F", "sheet_name": "Kansas", "target_spreadsheet": "research"},
        content_type="application/json",
    )
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("success") is True
    assert "id" in data
    assert data["id"][0] == "F"


def test_generate_id_accepts_target_spreadsheet_community(client):
    """POST with target_spreadsheet=community uses community spreadsheet for sequence (503 if not configured)."""
    r = client.post(
        "/api/sheets/generate-id",
        json={"sex": "M", "sheet_name": "CommunitySheet", "target_spreadsheet": "community"},
        content_type="application/json",
    )
    # 200 if community spreadsheet configured; 503 if not
    if r.status_code == 503:
        data = r.get_json() or {}
        assert "error" in data
        pytest.skip("Community spreadsheet not configured")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("success") is True
    assert "id" in data
    assert data["id"][0] == "M"
