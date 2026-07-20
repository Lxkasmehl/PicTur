"""
Unit tests: the scoped write guards return 403 when a scoped-group member targets
a turtle/sheet outside its areas (and when the target is unresolvable), and 200
when in-scope; global users are never gated. Covers approve_review, the sheets
create/update writes, a turtles.py mutation, and merge (both ends must pass).
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from tests.scope_test_utils import global_admin_ctx, global_staff_ctx, scoped_ctx, auth_header

# Scoped member owns Kansas/North Topeka only.
KS = ["Kansas/North Topeka"]


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def mgr(tmp_path):
    """Mock manager with real in-/out-of-scope turtle folders on disk."""
    in_dir = tmp_path / "Kansas" / "North Topeka" / "F_IN_T1770000001"
    in_dir.mkdir(parents=True)
    out_dir = tmp_path / "Nebraska" / "CPBS" / "F_OUT_T1770000002"
    out_dir.mkdir(parents=True)
    folders = {
        "F_IN": str(in_dir), "T1770000001": str(in_dir),
        "F_OUT": str(out_dir), "T1770000002": str(out_dir),
    }

    m = MagicMock()
    m.base_dir = str(tmp_path)
    m._get_turtle_folder.side_effect = lambda tid, hint=None: folders.get(tid)
    m.approve_review_packet.return_value = (True, "approved")
    m.soft_delete_turtle_image.return_value = (True, {"was_reference": False})
    m.merge_turtles.return_value = (True, "merged")

    with patch("services.manager_service.manager", m), \
            patch("services.manager_service.manager_ready") as ready:
        ready.wait.return_value = True
        yield m


def _scoped(areas=KS):
    return patch("auth.validate_and_get_context", return_value=(True, None, scoped_ctx(areas=areas)))


def _global():
    return patch("auth.validate_and_get_context", return_value=(True, None, global_admin_ctx()))


# --------------------------------------------------------------- approve_review

def test_approve_match_in_scope_200(app_client, mgr):
    with _scoped():
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"match_turtle_id": "F_IN"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    mgr.approve_review_packet.assert_called_once()


def test_approve_match_out_of_scope_403(app_client, mgr):
    with _scoped():
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"match_turtle_id": "F_OUT"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    assert "outside your group" in r.get_json()["error"]
    mgr.approve_review_packet.assert_not_called()


def test_approve_match_out_of_scope_with_inscope_decoy_403(app_client, mgr):
    """Regression: an in-scope new_location decoy must not unlock an out-of-scope match.

    _approve_review_packet_locked writes onto the matched turtle's folder whenever
    match_turtle_id is present (Scenario A), ignoring new_location. So the scope gate
    must authorize match_turtle_id FIRST — otherwise a scoped member could pass an
    in-scope new_location as a decoy while the manager writes onto an out-of-scope
    turtle. The gate must resolve F_OUT (Nebraska) and deny despite new_location=Kansas.
    """
    with _scoped(), patch(
        "routes.review.normalize_new_turtle_location_for_disk",
        side_effect=lambda loc, sd, **kw: (loc, "North Topeka"),
    ):
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"match_turtle_id": "F_OUT", "new_location": "Kansas/North Topeka",
                  "new_turtle_id": "T1770000004"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403, r.get_json()
    assert "outside your group" in r.get_json()["error"]
    mgr.approve_review_packet.assert_not_called()


def test_approve_match_unresolvable_403(app_client, mgr):
    """A scoped member fails closed when the target turtle can't be resolved."""
    with _scoped():
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"match_turtle_id": "GHOST"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    mgr.approve_review_packet.assert_not_called()


def test_approve_new_turtle_out_of_scope_403(app_client, mgr):
    """A scoped member cannot create a new turtle at an out-of-scope destination.

    Location normalization is patched to identity so the *scope guard* (not the
    catalog validation) is what's exercised.
    """
    with _scoped(), patch(
        "routes.review.normalize_new_turtle_location_for_disk",
        side_effect=lambda loc, sd, **kw: (loc, "CPBS"),
    ):
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"new_location": "Nebraska/CPBS", "new_turtle_id": "T1770000004"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    assert "outside your group" in r.get_json()["error"]
    mgr.approve_review_packet.assert_not_called()


def test_approve_global_unrestricted(app_client, mgr):
    with _global():
        r = app_client.post(
            "/api/review/admin_x/approve",
            json={"match_turtle_id": "F_OUT"},
            headers=auth_header("admin"),
        )
    assert r.status_code == 200
    mgr.approve_review_packet.assert_called_once()


# ------------------------------------------------------------------- sheets

def _identity_gl():
    return patch(
        "routes.sheets.resolve_general_location_from_sheet_and_value",
        side_effect=lambda sheet, gl, **kw: gl or "",
    )


def _sheets_service():
    svc = MagicMock()
    svc.list_sheets.return_value = ["Kansas"]
    svc.generate_biology_id.return_value = "F001"
    svc.create_turtle_data.return_value = "T1770000009"
    svc.update_turtle_data.return_value = True
    svc.find_turtle_sheet.return_value = "Kansas"
    svc.get_turtle_data.return_value = {"general_location": "North Topeka", "id": "F001"}
    return svc


def test_sheets_create_in_scope_200(app_client, mgr):
    with _scoped(), _identity_gl(), \
            patch("routes.sheets.get_sheets_service", return_value=_sheets_service()):
        r = app_client.post(
            "/api/sheets/turtle",
            json={"sheet_name": "Kansas",
                  "turtle_data": {"primary_id": "T1770000009", "general_location": "North Topeka", "sex": "F"}},
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()


def test_sheets_create_out_of_scope_403(app_client, mgr):
    svc = _sheets_service()
    with _scoped(), _identity_gl(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.post(
            "/api/sheets/turtle",
            json={"sheet_name": "Nebraska",
                  "turtle_data": {"primary_id": "T1770000009", "general_location": "CPBS", "sex": "F"}},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    svc.create_turtle_data.assert_not_called()   # gate fired before any write


def test_sheets_update_out_of_scope_403(app_client, mgr):
    svc = _sheets_service()
    with _scoped(), _identity_gl(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.put(
            "/api/sheets/turtle/T1770000009",
            json={"sheet_name": "Nebraska",
                  "turtle_data": {"general_location": "CPBS", "sex": "F"}},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    svc.update_turtle_data.assert_not_called()
    svc.create_turtle_data.assert_not_called()


def test_sheets_generate_id_out_of_scope_403(app_client, mgr):
    svc = _sheets_service()
    with _scoped(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.post(
            "/api/sheets/generate-id",
            json={"sex": "F", "sheet_name": "Nebraska"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    svc.generate_biology_id.assert_not_called()


def test_create_sheet_scoped_member_403(app_client, mgr):
    """Creating a top-level sheet defines a new area — forbidden for a scoped group."""
    svc = _sheets_service()
    svc.create_sheet_with_headers.return_value = True
    with _scoped(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.post(
            "/api/sheets/sheets",
            json={"sheet_name": "BrandNewArea"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    svc.create_sheet_with_headers.assert_not_called()


def test_create_sheet_global_staff_200(app_client, mgr):
    """Global (Primary) staff keep the pre-scoping sheet-creation capability."""
    svc = _sheets_service()
    svc.list_sheets.return_value = ["Kansas"]
    svc.create_sheet_with_headers.return_value = True
    global_staff = patch(
        "auth.validate_and_get_context", return_value=(True, None, global_staff_ctx())
    )
    with global_staff, patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.post(
            "/api/sheets/sheets",
            json={"sheet_name": "BrandNewArea"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    svc.create_sheet_with_headers.assert_called_once()


# ----------------------------------------------------------------- turtles.py

def test_soft_delete_in_scope_200(app_client, mgr):
    with _scoped():
        r = app_client.delete(
            "/api/turtles/image",
            json={"turtle_id": "F_IN", "path": "/x/y.jpg", "sheet_name": "Kansas"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    mgr.soft_delete_turtle_image.assert_called_once()


def test_soft_delete_out_of_scope_403(app_client, mgr):
    with _scoped():
        r = app_client.delete(
            "/api/turtles/image",
            json={"turtle_id": "F_OUT", "path": "/x/y.jpg", "sheet_name": "Nebraska"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    mgr.soft_delete_turtle_image.assert_not_called()


# -------------------------------------------------------------------- merge

def test_merge_mixed_scope_403(app_client, mgr):
    """Merge must reject when only one of the two turtles is in scope."""
    with _scoped():
        r = app_client.post(
            "/api/turtles/merge",
            json={"primary_id": "T1770000001", "secondary_id": "T1770000002",
                  "primary_sheet": "Kansas", "secondary_sheet": "Nebraska"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 403
    mgr.merge_turtles.assert_not_called()


def test_merge_both_in_scope_200(app_client, mgr):
    """Both ends in scope → allowed (owns the whole Kansas + Nebraska here)."""
    with _scoped(areas=["Kansas", "Nebraska"]):
        r = app_client.post(
            "/api/turtles/merge",
            json={"primary_id": "T1770000001", "secondary_id": "T1770000002",
                  "primary_sheet": "Kansas", "secondary_sheet": "Nebraska"},
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    mgr.merge_turtles.assert_called_once()
