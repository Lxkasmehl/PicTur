"""
Integration tests: Flask scope enforcement against the seeded personas (PR-2).

Requires the Docker integration stack (backend + auth) and seeded users:

  BACKEND_URL=http://localhost:5000 AUTH_URL=http://localhost:3001/api \
    pytest tests/integration/test_scoped_enforcement.py -v

Personas (from the e2e seed): scoped-staff@test.com is a KansasTeam member whose
only area is ``Kansas/Topeka`` (top-level tab ``Kansas``); staff@test.com is a
global Primary member; admin@test.com is a global Operations lead. These tests
only READ (list endpoints) and attempt one deliberately out-of-scope write that
is rejected before any Sheets mutation, so they never change data.
"""

import os

import pytest
import requests

TIMEOUT = 20


def _backend(backend_url):
    return backend_url.rstrip("/")


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _get(backend_url, path, token):
    return requests.get(f"{_backend(backend_url)}{path}", headers=_hdr(token), timeout=TIMEOUT)


def test_scoped_staff_sheets_are_a_subset(
    backend_url, integration_env, admin_token, staff_token, scoped_staff_token
):
    """Scoped staff (KansasTeam) see only their tab(s); global staff match admin."""
    if not integration_env or not admin_token or not staff_token or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded users) to run")

    admin_sheets = set(_get(backend_url, "/api/sheets/sheets", admin_token).json().get("sheets", []))
    global_sheets = set(_get(backend_url, "/api/sheets/sheets", staff_token).json().get("sheets", []))
    scoped_sheets = set(_get(backend_url, "/api/sheets/sheets", scoped_staff_token).json().get("sheets", []))

    # A global staff (Primary) is unchanged — identical to what admin sees.
    assert global_sheets == admin_sheets
    # KansasTeam's only area is Kansas/Topeka, so the only visible tab is "Kansas".
    assert scoped_sheets <= {"Kansas"}
    assert scoped_sheets <= admin_sheets


def test_scoped_staff_locations_are_scoped(backend_url, integration_env, scoped_staff_token):
    """/api/locations for scoped staff keeps Community_Uploads + only Kansas entries."""
    if not integration_env or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded scoped staff) to run")
    r = _get(backend_url, "/api/locations", scoped_staff_token)
    assert r.status_code == 200, r.text
    locs = r.json().get("locations", [])
    assert all(loc == "Community_Uploads" or loc.split("/")[0] == "Kansas" for loc in locs), locs


def test_scoped_staff_turtles_list_is_scoped(backend_url, integration_env, scoped_staff_token):
    """Every turtle row a scoped member sees belongs to its Kansas tab."""
    if not integration_env or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded scoped staff) to run")
    r = _get(backend_url, "/api/sheets/turtles", scoped_staff_token)
    assert r.status_code == 200, r.text
    turtles = r.json().get("turtles", [])
    assert all((t.get("sheet_name") or "") == "Kansas" for t in turtles), [t.get("sheet_name") for t in turtles]


def test_scoped_staff_out_of_scope_write_is_forbidden(
    backend_url, integration_env, scoped_staff_token
):
    """A scoped member is 403 on a write to a sheet outside its areas.

    Uses generate-id for NebraskaCPBS (KansasTeam owns only Kansas/Topeka): the
    scope guard rejects it before any Sheets call, so nothing is mutated. The
    "global staff unchanged" half of this requirement is covered by
    test_scoped_staff_sheets_are_a_subset (global == admin)."""
    if not integration_env or not scoped_staff_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded scoped staff) to run")
    url = f"{_backend(backend_url)}/api/sheets/generate-id"
    r = requests.post(
        url, headers=_hdr(scoped_staff_token),
        json={"sex": "F", "sheet_name": "NebraskaCPBS"}, timeout=TIMEOUT,
    )
    assert r.status_code == 403, r.text
    assert "outside your group" in (r.json() or {}).get("error", "")
