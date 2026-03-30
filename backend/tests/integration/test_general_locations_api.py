"""
Integration tests: GET/POST /api/general-locations (catalog for admin turtle forms).

Requires Docker integration stack and seeded staff/admin users:

  BACKEND_URL=http://localhost:5000 AUTH_URL=http://localhost:3001/api pytest tests/integration/test_general_locations_api.py -v

POST tests only cover validation errors (no catalog file mutation). Optional successful POST
(writes general_locations.json in the backend container) is gated by env
GENERAL_LOCATIONS_INTEGRATION_POST=1.
"""

import os
import uuid

import pytest
import requests


def _backend(backend_url):
    return backend_url.rstrip("/")


def test_get_general_locations_as_admin_returns_catalog(client):
    """GET returns success and catalog-shaped payload."""
    r = client.get("/api/general-locations")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("success") is True
    assert "catalog" in data
    catalog = data["catalog"]
    assert isinstance(catalog.get("states"), dict)
    assert isinstance(catalog.get("sheet_defaults"), dict)
    assert isinstance(data.get("states"), list)
    assert isinstance(data.get("sheet_defaults"), list)


def test_get_general_locations_as_staff_returns_200(backend_url, auth_url, integration_env, staff_token):
    """Staff may load the catalog (same as other operational routes using require_admin)."""
    if not integration_env or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded staff) to run")
    url = f"{_backend(backend_url)}/api/general-locations"
    r = requests.get(
        url,
        headers={"Authorization": f"Bearer {staff_token}"},
        timeout=15,
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert "catalog" in data


def test_get_general_locations_without_auth_returns_401(backend_url, integration_env):
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run")
    url = f"{_backend(backend_url)}/api/general-locations"
    r = requests.get(url, timeout=10)
    assert r.status_code == 401


def test_post_general_locations_missing_state_returns_400(client):
    r = client.post(
        "/api/general-locations",
        json={"general_location": "Somewhere"},
        content_type="application/json",
    )
    assert r.status_code == 400
    assert "state" in (r.get_json() or {}).get("error", "").lower()


def test_post_general_locations_missing_general_location_returns_400(client):
    r = client.post(
        "/api/general-locations",
        json={"state": "Kansas"},
        content_type="application/json",
    )
    assert r.status_code == 400
    assert "general_location" in (r.get_json() or {}).get("error", "").lower()


@pytest.mark.skipif(
    not os.environ.get("GENERAL_LOCATIONS_INTEGRATION_POST"),
    reason="Set GENERAL_LOCATIONS_INTEGRATION_POST=1 to run (mutates catalog in backend container)",
)
def test_post_general_locations_adds_unique_location(client):
    """Adds a one-off location name; only for explicit integration runs."""
    suffix = uuid.uuid4().hex[:8]
    name = f"E2E Int Test Loc {suffix}"
    r = client.post(
        "/api/general-locations",
        json={"state": "Kansas", "general_location": name},
        content_type="application/json",
    )
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    assert data.get("success") is True
    catalog = data.get("catalog") or {}
    kansas = catalog.get("states", {}).get("Kansas") or []
    assert any(name == x or name.lower() == str(x).lower() for x in kansas)
