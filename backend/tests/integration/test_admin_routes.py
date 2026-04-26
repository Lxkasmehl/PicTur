"""
Integration tests: Auth backend admin routes (GET /admin/users, PATCH /admin/users/:id/role).
Verifies that only admin can list users and change roles; staff gets 403.
Run with: BACKEND_URL=... AUTH_URL=... pytest tests/integration/test_admin_routes.py -v
"""

import os
import pytest
import requests


def _auth_url(auth_url):
    return auth_url.rstrip("/")


def test_get_users_as_admin_returns_200(auth_url, integration_env, admin_token):
    """GET /admin/users with admin token returns 200 and user list."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    url = f"{_auth_url(auth_url)}/admin/users"
    r = requests.get(
        url,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert "users" in data
    assert isinstance(data["users"], list)


def test_get_users_as_staff_returns_403(auth_url, integration_env, staff_token):
    """GET /admin/users with staff token returns 403."""
    if not integration_env or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded staff) to run")
    url = f"{_auth_url(auth_url)}/admin/users"
    r = requests.get(
        url,
        headers={"Authorization": f"Bearer {staff_token}"},
        timeout=10,
    )
    assert r.status_code == 403
    data = r.json() if r.content else {}
    assert "error" in data
    assert "admin" in data["error"].lower() or "access" in data["error"].lower()


def test_patch_user_role_as_admin_success(auth_url, integration_env, admin_token):
    """PATCH /admin/users/:id/role with admin token and valid role returns 200."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    # Demoting community -> staff -> community sets tokens_valid_after on that user (auth-backend).
    # Use the dedicated role-test seed user, not arbitrary community users (e.g. community@test.com),
    # or session-scoped JWTs used by other integration tests become 403.
    role_test_email = os.environ.get(
        "E2E_ROLE_TEST_EMAIL", "role-test-community@test.com"
    ).lower()
    list_url = f"{_auth_url(auth_url)}/admin/users"
    list_r = requests.get(
        list_url,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    list_r.raise_for_status()
    users = list_r.json().get("users", [])
    target = next(
        (
            u
            for u in users
            if u.get("email")
            and str(u["email"]).lower() == role_test_email
            and u.get("role") == "community"
        ),
        None,
    )
    if not target:
        pytest.skip(
            f"No seeded role-test community user (expected {role_test_email}); "
            "run auth-backend seed-test-users"
        )
    user_id = target["id"]
    url = f"{_auth_url(auth_url)}/admin/users/{user_id}/role"
    # Change to staff then back to community so test is idempotent
    r = requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        json={"role": "staff"},
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert data.get("user", {}).get("role") == "staff"
    # Restore to community
    requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        json={"role": "community"},
        timeout=10,
    )


def test_patch_user_role_as_staff_returns_403(auth_url, integration_env, admin_token, staff_token):
    """PATCH /admin/users/:id/role with staff token returns 403."""
    if not integration_env or not admin_token or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    list_url = f"{_auth_url(auth_url)}/admin/users"
    list_r = requests.get(
        list_url,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    list_r.raise_for_status()
    users = list_r.json().get("users", [])
    some_user_id = users[0]["id"] if users else 1
    url = f"{_auth_url(auth_url)}/admin/users/{some_user_id}/role"
    r = requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {staff_token}",
            "Content-Type": "application/json",
        },
        json={"role": "community"},
        timeout=10,
    )
    assert r.status_code == 403
    data = r.json() if r.content else {}
    assert "error" in data


def test_patch_user_role_invalid_role_returns_400(auth_url, integration_env, admin_token):
    """PATCH /admin/users/:id/role with invalid role returns 400."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    list_url = f"{_auth_url(auth_url)}/admin/users"
    list_r = requests.get(
        list_url,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    list_r.raise_for_status()
    users = list_r.json().get("users", [])
    some_user_id = users[0]["id"] if users else 1
    url = f"{_auth_url(auth_url)}/admin/users/{some_user_id}/role"
    r = requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        json={"role": "superadmin"},
        timeout=10,
    )
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert "error" in data
    assert "role" in data["error"].lower() or "community" in data["error"].lower()


def test_patch_user_role_nonexistent_user_returns_404(auth_url, integration_env, admin_token):
    """PATCH /admin/users/:id/role with non-existent user id returns 404."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    url = f"{_auth_url(auth_url)}/admin/users/999999/role"
    r = requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
        json={"role": "community"},
        timeout=10,
    )
    assert r.status_code == 404
    data = r.json() if r.content else {}
    assert "error" in data
