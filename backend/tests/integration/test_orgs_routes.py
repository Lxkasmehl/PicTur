"""
Integration tests: research groups (organizations) in the auth backend.

Covers the permission matrix (super admin / group admin / staff / main-group admin / community),
member management with the last-admin guard, and that /auth/validate exposes live memberships.
Run with: BACKEND_URL=... AUTH_URL=... pytest tests/integration/test_orgs_routes.py -v
"""

import os
import uuid

import pytest
import requests


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _me(auth_url, token):
    r = requests.get(f"{auth_url}/auth/me", headers=_h(token), timeout=10)
    r.raise_for_status()
    return r.json()


@pytest.fixture
def new_org(auth_url, integration_env, super_admin_token):
    """A fresh database-backed group (unique slug per test)."""
    if not integration_env or not super_admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded super admin) to run")
    slug = f"it-{uuid.uuid4().hex[:10]}"
    r = requests.post(
        f"{auth_url}/orgs",
        headers=_h(super_admin_token),
        json={"slug": slug, "name": f"Integration {slug}"},
        timeout=10,
    )
    assert r.status_code == 201, r.text
    return r.json()["org"]


def test_public_orgs_lists_main_group(auth_url, integration_env):
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run")
    r = requests.get(f"{auth_url}/orgs/public", timeout=10)
    assert r.status_code == 200
    orgs = r.json()["orgs"]
    main = next(o for o in orgs if o["slug"] == "main")
    assert main["kind"] == "sheets"
    assert main["is_default"] is True


def test_me_includes_main_membership_from_user_role(auth_url, integration_env, staff_token):
    if not integration_env or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded staff) to run")
    data = _me(auth_url, staff_token)
    assert data["user"]["is_super_admin"] is False
    main = data["memberships"][0]
    assert main["slug"] == "main"
    assert main["role"] == "staff"


def test_only_super_admin_can_create_orgs(auth_url, integration_env, admin_token):
    """A main-group admin is not a platform super admin."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    r = requests.post(
        f"{auth_url}/orgs",
        headers=_h(admin_token),
        json={"slug": f"nope-{uuid.uuid4().hex[:6]}", "name": "Nope"},
        timeout=10,
    )
    assert r.status_code == 403
    r = requests.get(f"{auth_url}/orgs", headers=_h(admin_token), timeout=10)
    assert r.status_code == 403


def test_create_org_rejects_bad_and_duplicate_slugs(auth_url, super_admin_token, new_org):
    for bad in ["under_score", "-dash", "has space", ""]:
        r = requests.post(
            f"{auth_url}/orgs",
            headers=_h(super_admin_token),
            json={"slug": bad, "name": "X"},
            timeout=10,
        )
        assert r.status_code == 400, bad
    r = requests.post(
        f"{auth_url}/orgs",
        headers=_h(super_admin_token),
        json={"slug": new_org["slug"], "name": "Dup"},
        timeout=10,
    )
    assert r.status_code == 409


def test_new_org_is_db_backed_and_listed(auth_url, super_admin_token, new_org):
    assert new_org["kind"] == "db"
    r = requests.get(f"{auth_url}/orgs", headers=_h(super_admin_token), timeout=10)
    assert r.status_code == 200
    listed = next(o for o in r.json()["orgs"] if o["id"] == new_org["id"])
    assert listed["member_count"] == 0


def test_member_management_flow(
    auth_url, super_admin_token, staff_token, admin_token, new_org
):
    """Super admin adds an existing account as group admin; that admin manages further members;
    non-members get 403; memberships show up in /auth/validate."""
    org_id = new_org["id"]
    staff_me = _me(auth_url, staff_token)["user"]
    admin_me = _me(auth_url, admin_token)["user"]

    # Non-members (even main-group admins) cannot see the group's members.
    r = requests.get(f"{auth_url}/orgs/{org_id}/members", headers=_h(admin_token), timeout=10)
    assert r.status_code == 403

    # Super admin makes the main-group staff account the admin of the new group.
    r = requests.post(
        f"{auth_url}/orgs/{org_id}/members",
        headers=_h(super_admin_token),
        json={"email": staff_me["email"], "role": "admin"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "added"

    # Membership is live in /auth/validate (no re-login needed).
    r = requests.post(f"{auth_url}/auth/validate", headers=_h(staff_token), timeout=10)
    assert r.status_code == 200
    memberships = {m["slug"]: m for m in r.json()["memberships"]}
    assert memberships[new_org["slug"]]["role"] == "admin"
    assert memberships[new_org["slug"]]["kind"] == "db"
    assert memberships["main"]["role"] == "staff"  # main-group role untouched

    # The new group admin adds the main-group admin as staff.
    r = requests.post(
        f"{auth_url}/orgs/{org_id}/members",
        headers=_h(staff_token),
        json={"email": admin_me["email"], "role": "staff"},
        timeout=10,
    )
    assert r.status_code == 200, r.text

    # Group staff cannot manage members.
    r = requests.get(f"{auth_url}/orgs/{org_id}/members", headers=_h(admin_token), timeout=10)
    assert r.status_code == 403

    # Unknown address -> invitation.
    invite_email = f"invitee-{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(
        f"{auth_url}/orgs/{org_id}/members",
        headers=_h(staff_token),
        json={"email": invite_email, "role": "staff"},
        timeout=10,
    )
    assert r.status_code == 201
    assert r.json()["status"] == "invited"
    r = requests.get(f"{auth_url}/orgs/{org_id}/members", headers=_h(staff_token), timeout=10)
    body = r.json()
    assert {m["email"] for m in body["members"]} == {staff_me["email"], admin_me["email"]}
    assert [i["email"] for i in body["invitations"]] == [invite_email]

    # Last admin cannot demote themselves.
    r = requests.patch(
        f"{auth_url}/orgs/{org_id}/members/{staff_me['id']}",
        headers=_h(staff_token),
        json={"role": "staff"},
        timeout=10,
    )
    assert r.status_code == 400

    # Remove the staff member; membership disappears from /auth/validate.
    r = requests.delete(
        f"{auth_url}/orgs/{org_id}/members/{admin_me['id']}",
        headers=_h(staff_token),
        timeout=10,
    )
    assert r.status_code == 200
    r = requests.post(f"{auth_url}/auth/validate", headers=_h(admin_token), timeout=10)
    assert new_org["slug"] not in {m["slug"] for m in r.json()["memberships"]}

    # Clean up: super admin removes the group admin (allowed even for the last admin).
    r = requests.delete(
        f"{auth_url}/orgs/{org_id}/members/{staff_me['id']}",
        headers=_h(super_admin_token),
        timeout=10,
    )
    assert r.status_code == 200


def test_main_org_members_not_managed_here(auth_url, super_admin_token, integration_env):
    if not integration_env or not super_admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded super admin) to run")
    r = requests.get(f"{auth_url}/orgs/1/members", headers=_h(super_admin_token), timeout=10)
    assert r.status_code == 400


def test_register_with_org_invitation(auth_url, super_admin_token, new_org):
    """Registering through an invitation link verifies the email and grants the membership."""
    email = f"reg-{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(
        f"{auth_url}/orgs/{new_org['id']}/members",
        headers=_h(super_admin_token),
        json={"email": email, "role": "admin"},
        timeout=10,
    )
    assert r.status_code == 201
    # Token only travels by email; read it back is not possible via the API, so exercise the
    # mismatch + invalid paths here and the happy path in the E2E suite (dev mail log).
    r = requests.post(
        f"{auth_url}/auth/register",
        json={"email": email, "password": "Testpassword123!", "org_invite_token": "bogus"},
        timeout=10,
    )
    assert r.status_code == 400
    r = requests.get(f"{auth_url}/orgs/invitations/bogus", timeout=10)
    assert r.status_code == 404


def test_super_admins_promote_list_and_demote(auth_url, super_admin_token, staff_token, integration_env):
    """Super admins manage super admins in the app; the change applies to the next request."""
    if not integration_env or not super_admin_token or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    base = f"{auth_url}/platform/super-admins"
    staff_email = os.environ.get("E2E_STAFF_EMAIL", "staff@test.com")

    assert requests.get(base, headers=_h(staff_token), timeout=10).status_code == 403
    r = requests.get(base, headers=_h(super_admin_token), timeout=10)
    assert r.status_code == 200
    assert any(s["email"] == "superadmin@test.com" for s in r.json()["super_admins"])

    r = requests.post(base, headers=_h(super_admin_token), json={"email": "nobody-here@test.com"}, timeout=10)
    assert r.status_code == 404

    r = requests.post(base, headers=_h(super_admin_token), json={"email": staff_email}, timeout=10)
    assert r.status_code == 200, r.text
    promoted = next(s for s in r.json()["super_admins"] if s["email"] == staff_email)
    try:
        # live: the staff account now sees the list without logging in again
        assert requests.get(base, headers=_h(staff_token), timeout=10).status_code == 200
    finally:
        r = requests.delete(f"{base}/{promoted['id']}", headers=_h(super_admin_token), timeout=10)
    assert r.status_code == 200, r.text
    assert all(s["email"] != staff_email for s in r.json()["super_admins"])
    assert requests.get(base, headers=_h(staff_token), timeout=10).status_code == 403
    assert requests.delete(f"{base}/{promoted['id']}", headers=_h(super_admin_token), timeout=10).status_code == 404
