"""
Integration tests: Auth backend API (password policy, email verification, invitations).
Run against auth-backend in Docker; requires AUTH_URL. Uses BACKEND_URL for integration_env only.
"""

import os
import time
import pytest
import requests

# Strong password that satisfies: min 10 chars, upper, lower, digit, special
STRONG_PASSWORD = "SecureP@ss1word"


def _auth_url(auth_url):
    return auth_url.rstrip("/")


def test_register_weak_password_too_short(auth_url, integration_env):
    """POST /auth/register with password shorter than 10 chars returns 400."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/register"
    r = requests.post(
        url,
        json={
            "email": f"test-short-pw-{int(time.time())}@example.com",
            "password": "Ab1!",
            "name": "Test",
        },
        timeout=10,
    )
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data
    assert "10" in data["error"] or "character" in data["error"].lower()


def test_register_common_password_rejected(auth_url, integration_env):
    """POST /auth/register with common password returns 400."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/register"
    # Use a password that meets complexity (upper, lower, digit, special, 10+ chars)
    # but is in the common-password list so the auth backend rejects it as "too common"
    r = requests.post(
        url,
        json={
            "email": f"test-common-pw-{int(time.time())}@example.com",
            "password": "Password1!",
            "name": "Test",
        },
        timeout=10,
    )
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data
    assert "common" in data["error"].lower() or "stronger" in data["error"].lower()


def test_register_strong_password_success(auth_url, integration_env):
    """POST /auth/register with strong password returns 201 and token/user."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/register"
    email = f"test-strong-{int(time.time())}@example.com"
    r = requests.post(
        url,
        json={"email": email, "password": STRONG_PASSWORD, "name": "Integration Test"},
        timeout=10,
    )
    assert r.status_code == 201
    data = r.json() if r.content else {}
    assert data.get("success") is True
    assert "token" in data
    assert "user" in data
    assert data["user"].get("email", "").lower() == email.lower()
    assert data["user"].get("email_verified") is False


def test_verify_email_invalid_token(auth_url, integration_env):
    """POST /auth/verify-email with invalid token returns 400."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/verify-email"
    r = requests.post(url, json={"token": "invalid-token-12345"}, timeout=10)
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data
    assert "invalid" in data["error"].lower() or "expired" in data["error"].lower()


def test_change_password_weak_rejected(auth_url, integration_env, admin_token):
    """POST /auth/change-password with weak new password returns 400."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/change-password"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "currentPassword": os.environ.get("E2E_ADMIN_PASSWORD", "testpassword123"),
            "newPassword": "short",
        },
        timeout=10,
    )
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data


def test_invitation_invalid_token(auth_url, integration_env):
    """GET /auth/invitation/:token with invalid token returns 404."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/invitation/invalid-token-12345"
    r = requests.get(url, timeout=10)
    assert r.status_code == 404
    data = r.json() if r.content else {}
    assert "error" in data


def test_login_requires_email_and_password(auth_url, integration_env):
    """POST /auth/login without email or password returns 400."""
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    url = f"{_auth_url(auth_url)}/auth/login"
    r = requests.post(url, json={}, timeout=10)
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data
