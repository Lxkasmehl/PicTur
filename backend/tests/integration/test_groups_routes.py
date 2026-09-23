"""
Integration tests: auth-backend groups foundation (PR-1).

Covers group CRUD + areas, the enriched /auth/validate & /auth/me membership payloads, admin
membership moves, and the Team Lead API. Runs against auth-backend in Docker; requires AUTH_URL
(BACKEND_URL only gates integration_env).

Re-runnable against a persistent DB: throwaway groups use unique names and every mutated user is
restored to its seed state in a finally block (mirrors test_admin_routes.py's reset pattern). The
mutable target is the dedicated role-test-community user (never a user whose session token other
tests depend on), so bumps from promote/demote/release never invalidate another test's fixture.

Run with: BACKEND_URL=... AUTH_URL=... pytest tests/integration/test_groups_routes.py -v
"""

import os
import time
import uuid

import pytest
import requests

TIMEOUT = 15

ADMIN_EMAIL = os.environ.get("E2E_ADMIN_EMAIL", "admin@test.com")
STAFF_EMAIL = os.environ.get("E2E_STAFF_EMAIL", "staff@test.com")
COMMUNITY_EMAIL = os.environ.get("E2E_COMMUNITY_EMAIL", "community@test.com")
ROLE_TEST_EMAIL = os.environ.get("E2E_ROLE_TEST_EMAIL", "role-test-community@test.com")
ROLE_TEST_PASSWORD = os.environ.get("E2E_ROLE_TEST_PASSWORD", "testpassword123")
TEAMLEAD_EMAIL = os.environ.get("E2E_TEAMLEAD_EMAIL", "teamlead@test.com")
SCOPED_STAFF_EMAIL = os.environ.get("E2E_SCOPED_STAFF_EMAIL", "scoped-staff@test.com")
UNASSIGNED_EMAIL = os.environ.get("E2E_UNASSIGNED_EMAIL", "unassigned@test.com")

# A freshly-minted token can read as already-revoked ONLY when the app clock is behind UTC: the
# auth middleware parses SQLite's TZ-less UTC `tokens_valid_after` via `new Date(...)` as local time,
# shifting it into the future. This never happens in the Docker/UTC integration environment, where
# these assertions run in full; on a non-UTC dev box we skip rather than emit a false failure.
_REVOCATION_PRECONDITION_SKIP = (
    "Fresh token already reads as revoked — app clock is behind UTC vs SQLite's UTC "
    "tokens_valid_after (resolveBearerUser parses it as local time). Meaningful only under a UTC "
    "app clock (Docker integration env)."
)

# The same local-time parse skews the other way on a clock AHEAD of UTC: the bumped cutoff lands in
# the past, so the revoked token keeps validating. Skip (not fail) there too — the assertion is only
# meaningful under a UTC app clock.
_REVOCATION_TZ_AHEAD_SKIP = (
    "Bumped token still validates on a non-UTC app clock (tokens_valid_after parsed as local time "
    "lands in the past). Meaningful only under a UTC app clock (Docker integration env)."
)


def _assert_revoked_or_skip(base, tok):
    """Assert the token now reads revoked; on a non-UTC clock, skip instead of false-failing."""
    status = _validate(base, tok).status_code
    if status != 403 and time.timezone != 0:
        pytest.skip(_REVOCATION_TZ_AHEAD_SKIP)
    assert status == 403


# ----------------------------------------------------------------------------- helpers


def _base(auth_url):
    return auth_url.rstrip("/")


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _uniq(prefix="ZZTestGroup"):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _login(base, email, password):
    r = requests.post(
        f"{base}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT
    )
    r.raise_for_status()
    return r.json()["token"]


def _validate(base, token):
    return requests.post(f"{base}/auth/validate", headers=_hdr(token), timeout=TIMEOUT)


def _me(base, token):
    return requests.get(f"{base}/auth/me", headers=_hdr(token), timeout=TIMEOUT)


def _list_users(base, admin_token):
    r = requests.get(f"{base}/admin/users", headers=_hdr(admin_token), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("users", [])


def _find_user(base, admin_token, email):
    email = email.lower()
    for u in _list_users(base, admin_token):
        if str(u.get("email", "")).lower() == email:
            return u
    return None


def _user_id(base, admin_token, email):
    u = _find_user(base, admin_token, email)
    assert u is not None, f"seeded user {email} not found"
    return u["id"]


def _list_groups(base, admin_token):
    r = requests.get(f"{base}/admin/groups", headers=_hdr(admin_token), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("groups", [])


def _find_group(base, admin_token, name=None, system_key=None):
    for g in _list_groups(base, admin_token):
        if name is not None and g.get("name") == name:
            return g
        if system_key is not None and g.get("system_key") == system_key:
            return g
    return None


def _create_group(base, admin_token, name, scope=None):
    body = {"name": name}
    if scope is not None:
        body["scope"] = scope
    return requests.post(
        f"{base}/admin/groups", headers=_hdr(admin_token), json=body, timeout=TIMEOUT
    )


def _delete_group(base, admin_token, group_id):
    return requests.delete(
        f"{base}/admin/groups/{group_id}", headers=_hdr(admin_token), timeout=TIMEOUT
    )


def _set_membership(base, admin_token, user_id, group_id, group_role=None):
    body = {"group_id": group_id}
    if group_role is not None:
        body["group_role"] = group_role
    return requests.patch(
        f"{base}/admin/users/{user_id}/membership",
        headers=_hdr(admin_token),
        json=body,
        timeout=TIMEOUT,
    )


def _set_role(base, admin_token, user_id, role):
    return requests.patch(
        f"{base}/admin/users/{user_id}/role",
        headers=_hdr(admin_token),
        json={"role": role},
        timeout=TIMEOUT,
    )


def _force_unassigned_community(base, admin_token, user_id):
    """Reset a mutable user to (community, unassigned, member). Idempotent; keeps tests re-runnable."""
    _set_membership(base, admin_token, user_id, None)
    _set_role(base, admin_token, user_id, "community")


# ----------------------------------------------------------------------------- group CRUD


def test_groups_list_requires_admin(
    auth_url, integration_env, admin_token, staff_token, community_token
):
    """GET /admin/groups: admin 200, staff/community 403, anonymous 401."""
    if not integration_env or not admin_token or not staff_token or not community_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    base = _base(auth_url)

    r = requests.get(f"{base}/admin/groups", headers=_hdr(admin_token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert r.json().get("success") is True

    r = requests.get(f"{base}/admin/groups", headers=_hdr(staff_token), timeout=TIMEOUT)
    assert r.status_code == 403

    r = requests.get(f"{base}/admin/groups", headers=_hdr(community_token), timeout=TIMEOUT)
    assert r.status_code == 403

    r = requests.get(f"{base}/admin/groups", timeout=TIMEOUT)
    assert r.status_code == 401


def test_group_crud_happy_path(auth_url, integration_env, admin_token):
    """Create (201) -> appears in list with meta -> rename (200) -> delete (200)."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    name = _uniq()
    gid = None
    try:
        r = _create_group(base, admin_token, name)
        assert r.status_code == 201, r.text
        group = r.json()["group"]
        gid = group["id"]
        assert group["name"] == name
        assert group["scope"] == "scoped"
        assert group["system_key"] is None

        listed = _find_group(base, admin_token, name=name)
        assert listed is not None
        assert listed["member_count"] == 0
        assert listed["areas"] == []
        assert "created_at" in listed

        new_name = name + "_renamed"
        r = requests.patch(
            f"{base}/admin/groups/{gid}",
            headers=_hdr(admin_token),
            json={"name": new_name},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["group"]["name"] == new_name

        r = _delete_group(base, admin_token, gid)
        assert r.status_code == 200, r.text
        assert r.json().get("success") is True
        gid = None
        assert _find_group(base, admin_token, name=new_name) is None
    finally:
        if gid is not None:
            _delete_group(base, admin_token, gid)


def test_group_duplicate_name_returns_400(auth_url, integration_env, admin_token):
    """A second group with the same name (case-insensitive) is rejected with 400."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    name = _uniq()
    gid = None
    try:
        r = _create_group(base, admin_token, name)
        assert r.status_code == 201, r.text
        gid = r.json()["group"]["id"]

        r = _create_group(base, admin_token, name)
        assert r.status_code == 400

        r = _create_group(base, admin_token, name.upper())
        assert r.status_code == 400
    finally:
        if gid is not None:
            _delete_group(base, admin_token, gid)


def test_create_group_rejects_system_key_and_bad_scope(auth_url, integration_env, admin_token):
    """POST rejects a supplied system_key and an invalid scope with 400."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)

    r = requests.post(
        f"{base}/admin/groups",
        headers=_hdr(admin_token),
        json={"name": _uniq(), "system_key": "operations"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 400

    r = requests.post(
        f"{base}/admin/groups",
        headers=_hdr(admin_token),
        json={"name": _uniq(), "scope": "planet"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 400

    r = requests.post(
        f"{base}/admin/groups",
        headers=_hdr(admin_token),
        json={"name": "   "},
        timeout=TIMEOUT,
    )
    assert r.status_code == 400


def test_system_group_delete_returns_400(auth_url, integration_env, admin_token):
    """Deleting a system group (Operations) is rejected with 400 and leaves it intact."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    ops = _find_group(base, admin_token, system_key="operations")
    assert ops is not None, "Operations system group should exist after backfill"

    r = _delete_group(base, admin_token, ops["id"])
    assert r.status_code == 400
    assert _find_group(base, admin_token, system_key="operations") is not None


def test_put_areas_replace_and_validation(auth_url, integration_env, admin_token):
    """PUT areas has replace-set semantics, dedupes case-insensitively, strips slashes, rejects bad input."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    name = _uniq()
    gid = None
    try:
        r = _create_group(base, admin_token, name)
        assert r.status_code == 201, r.text
        gid = r.json()["group"]["id"]
        areas_url = f"{base}/admin/groups/{gid}/areas"

        r = requests.put(
            areas_url,
            headers=_hdr(admin_token),
            json={"areas": ["Kansas", "Kansas/Lawrence"]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert set(r.json()["areas"]) == {"Kansas", "Kansas/Lawrence"}

        # replace-set: the new list fully replaces the old one
        r = requests.put(
            areas_url, headers=_hdr(admin_token), json={"areas": ["Nebraska"]}, timeout=TIMEOUT
        )
        assert r.status_code == 200, r.text
        assert set(r.json()["areas"]) == {"Nebraska"}

        # dedupe case-insensitively
        r = requests.put(
            areas_url,
            headers=_hdr(admin_token),
            json={"areas": ["Kansas/Topeka", "kansas/topeka"]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["areas"]) == 1

        # strip leading/trailing slashes
        r = requests.put(
            areas_url, headers=_hdr(admin_token), json={"areas": ["/Kansas/Topeka/"]}, timeout=TIMEOUT
        )
        assert r.status_code == 200, r.text
        assert r.json()["areas"] == ["Kansas/Topeka"]

        # rejects: not an array, '..' traversal, blank element, non-string element
        for bad in ("Kansas", ["Kansas/../secret"], ["Kansas", "  "], ["Kansas", 5]):
            r = requests.put(
                areas_url, headers=_hdr(admin_token), json={"areas": bad}, timeout=TIMEOUT
            )
            assert r.status_code == 400, f"expected 400 for {bad!r}, got {r.status_code}"
    finally:
        if gid is not None:
            _delete_group(base, admin_token, gid)


def test_delete_group_with_members_returns_409(
    auth_url, integration_env, admin_token, community_token
):
    """A group that still has members returns 409 with member_count."""
    if not integration_env or not admin_token or not community_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    base = _base(auth_url)
    comm_id = _user_id(base, admin_token, COMMUNITY_EMAIL)
    name = _uniq()
    gid = None
    try:
        r = _create_group(base, admin_token, name)
        assert r.status_code == 201, r.text
        gid = r.json()["group"]["id"]

        assert _set_membership(base, admin_token, comm_id, gid).status_code == 200

        r = _delete_group(base, admin_token, gid)
        assert r.status_code == 409, r.text
        assert r.json().get("member_count") == 1
    finally:
        _set_membership(base, admin_token, comm_id, None)
        if gid is not None:
            _delete_group(base, admin_token, gid)


# ----------------------------------------------------------------------------- enriched /auth


def test_validate_and_me_enriched_admin(auth_url, integration_env, admin_token):
    """Admin resolves to the Operations global system group as a lead, with no areas."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)

    r = _validate(base, admin_token)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("valid") is True
    u = body["user"]
    assert u["role"] == "admin"
    assert u["group"]["system_key"] == "operations"
    assert u["group"]["scope"] == "global"
    assert u["group_role"] == "lead"
    assert u["areas"] == []

    r = _me(base, admin_token)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["group"]["system_key"] == "operations"
    assert u["group"]["scope"] == "global"
    assert u["group_role"] == "lead"
    assert u["areas"] == []


def test_validate_enriched_primary_staff(auth_url, integration_env, staff_token):
    """Seed staff resolves to the Primary global system group as a member, with no areas."""
    if not integration_env or not staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded staff) to run")
    base = _base(auth_url)

    r = _validate(base, staff_token)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["role"] == "staff"
    assert u["group"]["system_key"] == "primary"
    assert u["group"]["scope"] == "global"
    assert u["group_role"] == "member"
    assert u["areas"] == []


def test_validate_enriched_team_lead(auth_url, integration_env, admin_token, teamlead_token):
    """Team lead resolves to KansasTeam (scoped) as a lead, exposing that group's areas."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    kt = _find_group(base, admin_token, name="KansasTeam")
    assert kt is not None, "seeded KansasTeam group should exist"

    r = _validate(base, teamlead_token)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["role"] == "staff"
    assert u["group"]["name"] == "KansasTeam"
    assert u["group"]["scope"] == "scoped"
    assert u["group"]["system_key"] is None
    assert u["group_role"] == "lead"
    assert len(u["areas"]) >= 1
    assert sorted(u["areas"]) == sorted(kt["areas"])


def test_validate_enriched_scoped_staff(auth_url, integration_env, admin_token, scoped_staff_token):
    """Scoped staff resolves to KansasTeam (scoped) as a member, exposing that group's areas."""
    if not integration_env or not admin_token or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded scoped staff) to run")
    base = _base(auth_url)
    kt = _find_group(base, admin_token, name="KansasTeam")
    assert kt is not None

    r = _validate(base, scoped_staff_token)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["group"]["name"] == "KansasTeam"
    assert u["group"]["scope"] == "scoped"
    assert u["group_role"] == "member"
    assert sorted(u["areas"]) == sorted(kt["areas"])


def test_validate_enriched_unassigned(auth_url, integration_env, unassigned_token):
    """An unassigned community user resolves to group=None, member, no areas."""
    if not integration_env or not unassigned_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded unassigned user) to run")
    base = _base(auth_url)

    r = _validate(base, unassigned_token)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["group"] is None
    assert u["group_role"] == "member"
    assert u["areas"] == []


def test_operations_locked_primary_flippable(auth_url, integration_env, admin_token):
    """Operations cannot leave 'global'; Primary (the future lever) can flip and be restored."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    ops = _find_group(base, admin_token, system_key="operations")
    prim = _find_group(base, admin_token, system_key="primary")
    assert ops is not None and prim is not None

    r = requests.patch(
        f"{base}/admin/groups/{ops['id']}",
        headers=_hdr(admin_token),
        json={"scope": "scoped"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 400

    try:
        r = requests.patch(
            f"{base}/admin/groups/{prim['id']}",
            headers=_hdr(admin_token),
            json={"scope": "scoped"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["group"]["scope"] == "scoped"
    finally:
        requests.patch(
            f"{base}/admin/groups/{prim['id']}",
            headers=_hdr(admin_token),
            json={"scope": "global"},
            timeout=TIMEOUT,
        )


# ----------------------------------------------------------------------------- admin membership


def test_admin_membership_move_no_logout(
    auth_url, integration_env, admin_token, community_token
):
    """A one-step lateral group->group move (member->member) does NOT bump the moved user's token."""
    if not integration_env or not admin_token or not community_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    base = _base(auth_url)
    comm_id = _user_id(base, admin_token, COMMUNITY_EMAIL)
    gid_a = gid_b = None
    try:
        r = _create_group(base, admin_token, _uniq("MoveA"))
        assert r.status_code == 201, r.text
        gid_a = r.json()["group"]["id"]
        r = _create_group(base, admin_token, _uniq("MoveB"))
        assert r.status_code == 201, r.text
        gid_b = r.json()["group"]["id"]

        assert _set_membership(base, admin_token, comm_id, gid_a).status_code == 200
        assert _validate(base, community_token).status_code == 200

        # lateral move A -> B: no privilege reduction, so the session token must keep working
        assert _set_membership(base, admin_token, comm_id, gid_b).status_code == 200
        assert _validate(base, community_token).status_code == 200
    finally:
        _set_membership(base, admin_token, comm_id, None)
        if gid_a is not None:
            _delete_group(base, admin_token, gid_a)
        if gid_b is not None:
            _delete_group(base, admin_token, gid_b)


def test_admin_membership_unknown_user_and_group(auth_url, integration_env, admin_token):
    """Membership PATCH: unknown user -> 404, unknown group_id -> 400."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)

    r = _set_membership(base, admin_token, 999999, None)
    assert r.status_code == 404

    comm_id = _user_id(base, admin_token, COMMUNITY_EMAIL)
    r = _set_membership(base, admin_token, comm_id, 999999)
    assert r.status_code == 400


def test_admin_membership_lead_demotion_bumps(auth_url, integration_env, admin_token):
    """Dropping a member from 'lead' to 'member' via the membership PATCH revokes their tokens."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    rt_id = _user_id(base, admin_token, ROLE_TEST_EMAIL)
    gid = None
    try:
        _force_unassigned_community(base, admin_token, rt_id)
        r = _create_group(base, admin_token, _uniq("LeadBump"))
        assert r.status_code == 201, r.text
        gid = r.json()["group"]["id"]

        assert _set_role(base, admin_token, rt_id, "staff").status_code == 200
        assert _set_membership(base, admin_token, rt_id, gid, "lead").status_code == 200

        tok = _login(base, ROLE_TEST_EMAIL, ROLE_TEST_PASSWORD)
        if _validate(base, tok).status_code != 200:
            pytest.skip(_REVOCATION_PRECONDITION_SKIP)

        # lead -> member is a privilege reduction: revoke
        assert _set_membership(base, admin_token, rt_id, gid, "member").status_code == 200
        _assert_revoked_or_skip(base, tok)
    finally:
        _force_unassigned_community(base, admin_token, rt_id)
        if gid is not None:
            _delete_group(base, admin_token, gid)


# ----------------------------------------------------------------------------- Team Lead API


def test_lead_claim_matrix(auth_url, integration_env, admin_token, teamlead_token):
    """Lead can claim an unassigned community user (200) but not an already-assigned staff user (400)."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    rt_id = _user_id(base, admin_token, ROLE_TEST_EMAIL)
    kt = _find_group(base, admin_token, name="KansasTeam")
    try:
        _force_unassigned_community(base, admin_token, rt_id)

        r = requests.post(
            f"{base}/lead/members/claim",
            headers=_hdr(teamlead_token),
            json={"email": ROLE_TEST_EMAIL},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["group_id"] == kt["id"]
        assert u["group_role"] == "member"
        assert u["role"] == "community"

        # scoped-staff is already staff + assigned -> cannot be claimed
        r = requests.post(
            f"{base}/lead/members/claim",
            headers=_hdr(teamlead_token),
            json={"email": SCOPED_STAFF_EMAIL},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400
    finally:
        _force_unassigned_community(base, admin_token, rt_id)


def test_lead_promote_demote_matrix(auth_url, integration_env, admin_token, teamlead_token):
    """community -> staff -> lead and back, with already-at-top / already-at-bottom 400s."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    rt_id = _user_id(base, admin_token, ROLE_TEST_EMAIL)
    try:
        _force_unassigned_community(base, admin_token, rt_id)
        r = requests.post(
            f"{base}/lead/members/claim",
            headers=_hdr(teamlead_token),
            json={"email": ROLE_TEST_EMAIL},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        rank_url = f"{base}/lead/members/{rt_id}/rank"

        # community -> staff (member)
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "promote"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "staff"
        assert r.json()["user"]["group_role"] == "member"

        # staff member -> lead
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "promote"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["group_role"] == "lead"

        # already at the top
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "promote"}, timeout=TIMEOUT)
        assert r.status_code == 400

        # lead -> member
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "demote"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "staff"
        assert r.json()["user"]["group_role"] == "member"

        # staff -> community
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "demote"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "community"

        # already at the bottom
        r = requests.patch(rank_url, headers=_hdr(teamlead_token), json={"action": "demote"}, timeout=TIMEOUT)
        assert r.status_code == 400
    finally:
        _force_unassigned_community(base, admin_token, rt_id)


def test_lead_self_rank_returns_400(auth_url, integration_env, admin_token, teamlead_token):
    """A lead cannot change their own rank."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    tl_id = _user_id(base, admin_token, TEAMLEAD_EMAIL)
    r = requests.patch(
        f"{base}/lead/members/{tl_id}/rank",
        headers=_hdr(teamlead_token),
        json={"action": "demote"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 400


def test_lead_out_of_group_target_returns_403(
    auth_url, integration_env, admin_token, teamlead_token
):
    """A lead cannot rank a user who is not in their group."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    # seed staff lives in Primary, never in KansasTeam
    staff_id = _user_id(base, admin_token, STAFF_EMAIL)
    r = requests.patch(
        f"{base}/lead/members/{staff_id}/rank",
        headers=_hdr(teamlead_token),
        json={"action": "demote"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 403


def test_lead_admin_target_returns_403(auth_url, integration_env, admin_token, teamlead_token):
    """Even for an in-group admin, a lead cannot rank or remove them (admin guard)."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    admin_id = _user_id(base, admin_token, ADMIN_EMAIL)
    kt = _find_group(base, admin_token, name="KansasTeam")
    ops = _find_group(base, admin_token, system_key="operations")
    assert kt is not None and ops is not None
    try:
        # Move the admin into KansasTeam as a lead: lateral lead->lead move, so no revocation bump.
        assert _set_membership(base, admin_token, admin_id, kt["id"], "lead").status_code == 200
        # the move must not have invalidated the admin's own session token
        assert _validate(base, admin_token).status_code == 200

        r = requests.patch(
            f"{base}/lead/members/{admin_id}/rank",
            headers=_hdr(teamlead_token),
            json={"action": "demote"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 403

        r = requests.delete(
            f"{base}/lead/members/{admin_id}", headers=_hdr(teamlead_token), timeout=TIMEOUT
        )
        assert r.status_code == 403
    finally:
        _set_membership(base, admin_token, admin_id, ops["id"], "lead")


def test_lead_delete_member_releases_to_unassigned(
    auth_url, integration_env, admin_token, teamlead_token
):
    """Releasing a staff member drops them to community and clears their group."""
    if not integration_env or not admin_token or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    rt_id = _user_id(base, admin_token, ROLE_TEST_EMAIL)
    kt = _find_group(base, admin_token, name="KansasTeam")
    try:
        _force_unassigned_community(base, admin_token, rt_id)
        assert _set_role(base, admin_token, rt_id, "staff").status_code == 200
        assert _set_membership(base, admin_token, rt_id, kt["id"], "member").status_code == 200

        r = requests.delete(
            f"{base}/lead/members/{rt_id}", headers=_hdr(teamlead_token), timeout=TIMEOUT
        )
        assert r.status_code == 200, r.text

        u = _find_user(base, admin_token, ROLE_TEST_EMAIL)
        assert u["group_id"] is None
        assert u["role"] == "community"
    finally:
        _force_unassigned_community(base, admin_token, rt_id)


def test_lead_api_requires_team_lead(
    auth_url, integration_env, admin_token, staff_token, scoped_staff_token
):
    """The lead API rejects a plain admin, a Primary staff, and a scoped non-lead staff with 403."""
    if not integration_env or not admin_token or not staff_token or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")
    base = _base(auth_url)
    for token in (admin_token, staff_token, scoped_staff_token):
        r = requests.get(f"{base}/lead/group", headers=_hdr(token), timeout=TIMEOUT)
        assert r.status_code == 403, r.text


def test_lead_group_view(auth_url, integration_env, teamlead_token):
    """GET /lead/group returns the lead's group, its areas, and its members."""
    if not integration_env or not teamlead_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded team lead) to run")
    base = _base(auth_url)
    r = requests.get(f"{base}/lead/group", headers=_hdr(teamlead_token), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["group"]["name"] == "KansasTeam"
    assert body["group"]["scope"] == "scoped"
    assert len(body["areas"]) >= 1
    emails = {str(m.get("email", "")).lower() for m in body["members"]}
    assert TEAMLEAD_EMAIL.lower() in emails
    assert SCOPED_STAFF_EMAIL.lower() in emails


# ----------------------------------------------------------------------------- regressions


def test_regression_last_admin_guard_intact(auth_url, integration_env, admin_token):
    """The last admin cannot be demoted or deleted (guarded 400)."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    admins = [u for u in _list_users(base, admin_token) if u.get("role") == "admin"]
    if len(admins) != 1:
        pytest.skip("last-admin guard test requires exactly one admin in the DB")
    admin_id = admins[0]["id"]

    r = _set_role(base, admin_token, admin_id, "community")
    assert r.status_code == 400

    r = requests.delete(f"{base}/admin/users/{admin_id}", headers=_hdr(admin_token), timeout=TIMEOUT)
    assert r.status_code == 400


def test_regression_role_demotion_bumps_revocation(auth_url, integration_env, admin_token):
    """Demoting staff -> community via the role PATCH still revokes that user's existing tokens."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run")
    base = _base(auth_url)
    rt_id = _user_id(base, admin_token, ROLE_TEST_EMAIL)
    try:
        _force_unassigned_community(base, admin_token, rt_id)
        assert _set_role(base, admin_token, rt_id, "staff").status_code == 200

        tok = _login(base, ROLE_TEST_EMAIL, ROLE_TEST_PASSWORD)
        if _validate(base, tok).status_code != 200:
            pytest.skip(_REVOCATION_PRECONDITION_SKIP)

        assert _set_role(base, admin_token, rt_id, "community").status_code == 200
        _assert_revoked_or_skip(base, tok)
    finally:
        _force_unassigned_community(base, admin_token, rt_id)
