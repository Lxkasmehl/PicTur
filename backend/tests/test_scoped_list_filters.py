"""
Unit tests: list endpoints return an areas-limited subset for scoped-group members
and the full set for global users — locations, sheets tabs, the turtles list, and
the review queue (including a no-location community packet hidden from a scoped
member but shown to global).
"""

from unittest.mock import MagicMock, patch

import pytest

from tests.scope_test_utils import global_admin_ctx, scoped_ctx, auth_header

KS = ["Kansas/North Topeka"]


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def mgr():
    m = MagicMock()
    with patch("services.manager_service.manager", m), \
            patch("services.manager_service.manager_ready") as ready:
        ready.wait.return_value = True
        yield m


def _scoped(areas=KS):
    return patch("auth.validate_and_get_context", return_value=(True, None, scoped_ctx(areas=areas)))


def _global():
    return patch("auth.validate_and_get_context", return_value=(True, None, global_admin_ctx()))


# ----------------------------------------------------------------- locations

def test_locations_scoped_subset(app_client, mgr):
    mgr.get_all_locations.return_value = [
        "Community_Uploads", "Kansas", "Kansas/North Topeka", "Kansas/Lawrence", "Nebraska",
    ]
    with _scoped():
        r = app_client.get("/api/locations", headers=auth_header("staff"))
    assert r.status_code == 200
    locs = r.get_json()["locations"]
    assert set(locs) == {"Community_Uploads", "Kansas", "Kansas/North Topeka"}


def test_locations_global_full(app_client, mgr):
    full = ["Community_Uploads", "Kansas", "Kansas/Lawrence", "Nebraska"]
    mgr.get_all_locations.return_value = full
    with _global():
        r = app_client.get("/api/locations", headers=auth_header("admin"))
    assert r.get_json()["locations"] == full


# -------------------------------------------------------------------- sheets

def test_sheets_list_scoped_subset(app_client, mgr):
    svc = MagicMock()
    svc.list_sheets.return_value = ["Kansas", "Nebraska", "IowaHawkeye"]
    with _scoped(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.get("/api/sheets/sheets", headers=auth_header("staff"))
    assert r.status_code == 200
    assert r.get_json()["sheets"] == ["Kansas"]


def test_sheets_list_global_full(app_client, mgr):
    svc = MagicMock()
    svc.list_sheets.return_value = ["Kansas", "Nebraska", "IowaHawkeye"]
    with _global(), patch("routes.sheets.get_sheets_service", return_value=svc):
        r = app_client.get("/api/sheets/sheets", headers=auth_header("admin"))
    assert r.get_json()["sheets"] == ["Kansas", "Nebraska", "IowaHawkeye"]


# ------------------------------------------------------------- list_all_turtles

def _turtles_service():
    svc = MagicMock()
    svc.list_sheets.return_value = ["Kansas", "Nebraska"]
    svc.COLUMN_MAPPING = {
        "Primary ID": "primary_id",
        "General Location": "general_location",
        "Name": "name",
    }
    svc._ensure_primary_id_column.return_value = None
    svc.spreadsheet_id = "sid"
    values = {"values": [
        ["Primary ID", "General Location", "Name"],
        ["T1", "North Topeka", "Sheldon"],
    ]}
    svc.service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = values
    return svc


def test_list_all_turtles_scoped_drops_out_of_scope_sheet(app_client, mgr):
    with _scoped(), patch("routes.sheets.get_sheets_service", return_value=_turtles_service()):
        r = app_client.get("/api/sheets/turtles", headers=auth_header("staff"))
    assert r.status_code == 200
    turtles = r.get_json()["turtles"]
    # Only the Kansas/North Topeka row survives; the Nebraska sheet is dropped.
    assert len(turtles) == 1
    assert turtles[0]["sheet_name"] == "Kansas"


def test_list_all_turtles_global_full(app_client, mgr):
    with _global(), patch("routes.sheets.get_sheets_service", return_value=_turtles_service()):
        r = app_client.get("/api/sheets/turtles", headers=auth_header("admin"))
    assert r.get_json()["count"] == 2


# --------------------------------------------------------------- review queue

def _queue_items():
    return [
        {"path": "/p1", "request_id": "admin_1"},
        {"path": "/p2", "request_id": "Req_2"},
        {"path": "/p3", "request_id": "Req_3"},
    ]


def _formatted(packet_dir, request_id):
    meta = {
        "admin_1": {"match_sheet": "Kansas"},                       # in a scoped Kansas tab
        "Req_2": {"state": "Nebraska", "location": "CPBS"},          # other state
        "Req_3": {"photo_type": "unclassified"},                    # community, no location
    }[request_id]
    return {"request_id": request_id, "metadata": meta}


def test_review_queue_scoped_subset(app_client, mgr):
    mgr.get_review_queue.return_value = _queue_items()
    with _scoped(), patch("routes.review.format_review_packet_item", side_effect=_formatted):
        r = app_client.get("/api/review-queue", headers=auth_header("staff"))
    assert r.status_code == 200
    ids = [it["request_id"] for it in r.get_json()["items"]]
    assert ids == ["admin_1"]           # Nebraska + no-location community hidden


def test_review_queue_global_full(app_client, mgr):
    mgr.get_review_queue.return_value = _queue_items()
    with _global(), patch("routes.review.format_review_packet_item", side_effect=_formatted):
        r = app_client.get("/api/review-queue", headers=auth_header("admin"))
    ids = sorted(it["request_id"] for it in r.get_json()["items"])
    assert ids == ["Req_2", "Req_3", "admin_1"]
