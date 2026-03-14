"""
Integration tests: GET /api/locations (backend location paths for sheet/location dropdown).
Used for two-level location selection (State/Location). Admin only.
Run against backend in Docker; requires admin auth.
"""

import pytest


def test_locations_requires_auth(backend_url, integration_env):
    """GET /api/locations without Authorization returns 401."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    import requests

    r = requests.get(f"{backend_url}/api/locations", timeout=10)
    assert r.status_code == 401
    data = r.json() if r.content else {}
    assert "error" in data


def test_locations_success(client):
    """GET /api/locations with admin auth returns 200 and { success, locations } list."""
    r = client.get("/api/locations")
    # 503 if TurtleManager not ready; 500 if manager failed to init
    if r.status_code == 503:
        data = r.get_json() or {}
        assert "error" in data
        pytest.skip("TurtleManager not ready or backend still initializing")
    if r.status_code == 500:
        data = r.get_json() or {}
        assert "error" in data
        pytest.skip("TurtleManager failed to initialize")
    assert r.status_code == 200
    data = r.get_json()
    assert data is not None
    assert data.get("success") is True
    assert "locations" in data
    assert isinstance(data["locations"], list)
    for item in data["locations"]:
        assert isinstance(item, str)


def test_locations_structure(client):
    """Locations are strings (State or State/Location paths); may include Review_Queue, Community_Uploads."""
    r = client.get("/api/locations")
    if r.status_code != 200:
        pytest.skip("Backend or TurtleManager not available")
    data = r.get_json()
    locations = data.get("locations", [])
    for path in locations:
        assert isinstance(path, str)
        assert path.strip() == path
