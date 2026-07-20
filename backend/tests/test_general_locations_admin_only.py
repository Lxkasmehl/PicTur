"""
Unit tests for §7: general-locations mutations are admin-only, while the
read-only GET catalog stays staff-visible (the staff turtle form reads it).

Staff (global) get 403 on POST/DELETE/affected-turtles/sheet-defaults but 200 on
GET; admin gets 200 on a mutation. The auth guards are patched with role-specific
contexts; the admin mutation patches the catalog writer so the real catalog file
is never touched.
"""

from unittest.mock import patch

import pytest

from tests.scope_test_utils import global_admin_ctx, global_staff_ctx, auth_header


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


def _as_staff():
    return patch("auth.validate_and_get_context", return_value=(True, None, global_staff_ctx()))


def _as_admin():
    return patch("auth.validate_and_get_context", return_value=(True, None, global_admin_ctx()))


# ------------------------------------------------------ GET stays staff-visible

def test_get_catalog_staff_200(app_client):
    with _as_staff():
        r = app_client.get("/api/general-locations", headers=auth_header("staff"))
    assert r.status_code == 200
    assert r.get_json()["success"] is True
    assert "catalog" in r.get_json()


# --------------------------------------------------- mutations are admin-only

def test_post_add_location_staff_403(app_client):
    with _as_staff():
        r = app_client.post(
            "/api/general-locations",
            json={"state": "Kansas", "general_location": "New Site"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    assert "Admin access required" in r.get_json()["error"]


def test_delete_location_staff_403(app_client):
    with _as_staff():
        r = app_client.delete(
            "/api/general-locations",
            json={"state": "Kansas", "general_location": "North Topeka"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403


def test_affected_turtles_staff_403(app_client):
    with _as_staff():
        r = app_client.get(
            "/api/general-locations/affected-turtles?general_location=North+Topeka&state=Kansas",
            headers=auth_header("staff"),
        )
    assert r.status_code == 403


def test_add_sheet_default_staff_403(app_client):
    with _as_staff():
        r = app_client.post(
            "/api/general-locations/sheet-defaults",
            json={"sheet_name": "NebraskaCPBS", "general_location": "CPBS"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403


def test_remove_sheet_default_staff_403(app_client):
    with _as_staff():
        r = app_client.delete(
            "/api/general-locations/sheet-defaults",
            json={"sheet_name": "NebraskaCPBS"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403


def test_post_add_location_admin_200(app_client):
    """Admin passes the guard; the catalog writer is stubbed so nothing is mutated on disk."""
    fake_catalog = {"states": {"Kansas": ["New Site"]}, "sheet_defaults": {}}
    with _as_admin(), \
            patch("routes.general_locations.add_general_location", return_value=fake_catalog), \
            patch("routes.general_locations.get_sheets_service", return_value=None):
        r = app_client.post(
            "/api/general-locations",
            json={"state": "Kansas", "general_location": "New Site"},
            headers=auth_header("admin"),
        )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["success"] is True
