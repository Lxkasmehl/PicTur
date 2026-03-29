"""
Pytest configuration and fixtures for backend tests.

Integration tests (tests/integration/) run against the real backend and auth-backend
running in Docker. Start services with:

  docker compose -f docker-compose.integration.yml up -d --build

Then run:

  BACKEND_URL=http://localhost:5000 AUTH_URL=http://localhost:3001/api pytest tests/integration -v

BACKEND_URL and AUTH_URL can be set in the environment or via pytest -e (e.g. -e BACKEND_URL=...).
When not set, integration tests are skipped (so "pytest tests/" still runs unit tests only).
"""

import os
import pytest
import requests


def _response_with_get_json(resp: requests.Response):
    """Attach get_json to response so tests can use r.get_json() like Flask test client."""
    resp.get_json = lambda: resp.json() if resp.content else None
    return resp


class BackendApiClient:
    """HTTP client for backend API with admin JWT. Mirrors Flask test client interface used by integration tests."""

    def __init__(self, base_url: str, token: str):
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"} if token else {}

    def _url(self, path: str) -> str:
        path = path if path.startswith("/") else "/" + path
        return self._base + path

    def get(self, path: str, **kwargs) -> requests.Response:
        headers = {**self._headers, **kwargs.pop("headers", {})}
        r = requests.get(self._url(path), headers=headers, timeout=30, **kwargs)
        return _response_with_get_json(r)

    def post(self, path: str, data=None, json=None, content_type=None, **kwargs) -> requests.Response:
        headers = dict(self._headers)
        if content_type:
            headers["Content-Type"] = content_type
        if json is not None:
            r = requests.post(self._url(path), json=json, headers=headers, timeout=30, **kwargs)
        elif data and isinstance(data, dict):
            # Support multipart form: split file-like values into files=, rest into data=
            files = {}
            form_data = {}
            for k, v in data.items():
                is_file = hasattr(v, "read")
                if not is_file and isinstance(v, (tuple, list)) and len(v) >= 2:
                    # (filename, fileobj) or (fileobj, filename) for requests
                    is_file = hasattr(v[0], "read") or hasattr(v[1], "read")
                if is_file:
                    if isinstance(v, (tuple, list)):
                        # requests expects (filename, fileobj); normalize if reversed
                        files[k] = (v[1], v[0]) if hasattr(v[0], "read") else v
                    else:
                        files[k] = (v, "file")
                else:
                    form_data[k] = v
            if files:
                r = requests.post(self._url(path), files=files, data=form_data, headers=headers, timeout=30, **kwargs)
            else:
                r = requests.post(self._url(path), data=data, headers=headers, timeout=30, **kwargs)
        else:
            r = requests.post(self._url(path), data=data, headers=headers, timeout=30, **kwargs)
        return _response_with_get_json(r)

    def delete(self, path: str, json=None, content_type=None, **kwargs) -> requests.Response:
        headers = dict(self._headers)
        if content_type:
            headers["Content-Type"] = content_type
        r = requests.delete(self._url(path), json=json, headers=headers, timeout=30, **kwargs)
        return _response_with_get_json(r)


@pytest.fixture(scope="session")
def backend_url():
    """Backend base URL (e.g. http://localhost:5000). Set BACKEND_URL env to run integration tests."""
    return os.environ.get("BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="session")
def auth_url():
    """Auth API base URL (e.g. http://localhost:3001/api). Set AUTH_URL env to run integration tests."""
    return os.environ.get("AUTH_URL", "").rstrip("/")


@pytest.fixture(scope="session")
def integration_env(backend_url, auth_url):
    """True if both BACKEND_URL and AUTH_URL are set (Docker integration test run)."""
    return bool(backend_url and auth_url)


def _login_token(auth_url, email, password):
    """Login to auth-backend and return JWT token."""
    login_url = f"{auth_url}/auth/login"
    r = requests.post(
        login_url,
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("token")


@pytest.fixture(scope="session")
def admin_token(auth_url, integration_env):
    """Obtain admin JWT by logging in to auth-backend. Requires Docker services and seeded test user."""
    if not integration_env:
        return None
    try:
        return _login_token(
            auth_url,
            os.environ.get("E2E_ADMIN_EMAIL", "admin@test.com"),
            os.environ.get("E2E_ADMIN_PASSWORD", "testpassword123"),
        )
    except Exception as e:
        pytest.skip(f"Cannot get admin token from auth-backend at {auth_url}/auth/login: {e}")


@pytest.fixture(scope="session")
def staff_token(auth_url, integration_env):
    """Obtain staff JWT by logging in to auth-backend. Requires seeded staff test user."""
    if not integration_env:
        return None
    try:
        return _login_token(
            auth_url,
            os.environ.get("E2E_STAFF_EMAIL", "staff@test.com"),
            os.environ.get("E2E_STAFF_PASSWORD", "testpassword123"),
        )
    except Exception as e:
        pytest.skip(f"Cannot get staff token from auth-backend at {auth_url}/auth/login: {e}")


@pytest.fixture(scope="session")
def community_token(auth_url, integration_env):
    """Obtain community JWT by logging in to auth-backend. Requires seeded community test user."""
    if not integration_env:
        return None
    try:
        return _login_token(
            auth_url,
            os.environ.get("E2E_COMMUNITY_EMAIL", "community@test.com"),
            os.environ.get("E2E_COMMUNITY_PASSWORD", "testpassword123"),
        )
    except Exception as e:
        pytest.skip(f"Cannot get community token from auth-backend at {auth_url}/auth/login: {e}")


@pytest.fixture(scope="session")
def api_client(backend_url, admin_token, integration_env):
    """HTTP client for backend API with admin auth. Skip integration tests if BACKEND_URL/AUTH_URL not set."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and start Docker) to run integration tests")
    return BackendApiClient(backend_url, admin_token)


# Alias for integration tests: they expect a fixture named "client"
@pytest.fixture(scope="session")
def client(api_client):
    """Alias for api_client so existing integration tests can use the same fixture name."""
    return api_client
