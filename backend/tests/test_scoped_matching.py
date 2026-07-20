"""
Unit tests: scoped-group members get an areas-limited match filter and in/out-of
-scope flags on the staff/admin match endpoints (/api/upload staff branch and
/api/match/quick-check), while global users are unchanged and the community
upload path is untouched. The manager + ingest are mocked (no AI runs).
"""

import io
from unittest.mock import MagicMock, patch

import pytest

from tests.scope_test_utils import (
    global_admin_ctx,
    scoped_ctx,
    community_ctx,
    auth_header,
)


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def env(tmp_path):
    """Patched upload folder, identity ingest, ready mock manager."""
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    review_dir = tmp_path / "review_queue"
    review_dir.mkdir()

    mock_manager = MagicMock()
    mock_manager.review_queue_dir = str(review_dir)
    mock_manager.search_for_matches.return_value = ([], 0.1)

    with patch("routes.upload.UPLOAD_FOLDER", str(upload_dir)), \
            patch("routes.upload.ingest_saved_upload", side_effect=lambda p, **kw: p), \
            patch("routes.upload.manager_service.manager", mock_manager), \
            patch("routes.upload.manager_service.manager_ready") as ready:
        ready.wait.return_value = True
        yield {"manager": mock_manager, "upload_dir": upload_dir, "review_dir": review_dir}


def _file(extra=None):
    payload = {"file": (io.BytesIO(b"\xff\xd8\xff\xe0 fake jpeg"), "q.jpg")}
    if extra:
        payload.update(extra)
    return payload


# ------------------------------------------------------------- /api/upload staff

def test_upload_scoped_blank_sheet_forces_areas_and_flags(app_client, env):
    """A scoped staff with a blank match_sheet searches its areas (scope_forced),
    and out-of-area candidates are flagged in_scope=False / scope_expanded=True."""
    env["manager"].search_for_matches.return_value = (
        [
            {"site_id": "F1", "location": "Kansas/Topeka", "confidence": 0.9, "file_path": "/x/a.pt"},
            {"site_id": "F2", "location": "Nebraska/CPBS", "confidence": 0.5, "file_path": "/x/b.pt"},
        ],
        0.2,
    )
    with patch("routes.upload.validate_and_get_context",
               return_value=(True, None, scoped_ctx(areas=["Kansas/Topeka"]))):
        r = app_client.post(
            "/api/upload",
            data=_file(),
            content_type="multipart/form-data",
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    # Blank sheet => forced to the group's areas.
    kwargs = env["manager"].search_for_matches.call_args.kwargs
    assert kwargs["location_filter"] == ["Kansas/Topeka"]
    assert body["scope_expanded"] is True
    by_id = {m["turtle_id"]: m for m in body["matches"]}
    assert by_id["F1"]["in_scope"] is True
    assert by_id["F2"]["in_scope"] is False


def test_upload_scoped_persists_scope_metadata(app_client, env):
    """The packet metadata records scope_expanded and the effective scope_filter."""
    import json
    import os

    env["manager"].search_for_matches.return_value = (
        [{"site_id": "F1", "location": "Nebraska", "confidence": 0.9, "file_path": "/x/a.pt"}],
        0.2,
    )
    with patch("routes.upload.validate_and_get_context",
               return_value=(True, None, scoped_ctx(areas=["Kansas/Topeka"]))):
        r = app_client.post(
            "/api/upload",
            data=_file(),
            content_type="multipart/form-data",
            headers=auth_header("staff"),
        )
    request_id = r.get_json()["request_id"]
    meta_path = os.path.join(env["review_dir"], request_id, "metadata.json")
    with open(meta_path) as f:
        meta = json.load(f)
    assert meta["scope_expanded"] is True
    assert meta["scope_filter"] == ["Kansas/Topeka"]


def test_upload_global_unchanged(app_client, env):
    """A global admin passes the requested sheet straight through, no expansion."""
    env["manager"].search_for_matches.return_value = (
        [{"site_id": "F1", "location": "Nebraska", "confidence": 0.9, "file_path": "/x/a.pt"}],
        0.2,
    )
    with patch("routes.upload.validate_and_get_context",
               return_value=(True, None, global_admin_ctx())):
        r = app_client.post(
            "/api/upload",
            data=_file(extra={"match_sheet": "Kansas"}),
            content_type="multipart/form-data",
            headers=auth_header("admin"),
        )
    assert r.status_code == 200
    body = r.get_json()
    assert env["manager"].search_for_matches.call_args.kwargs["location_filter"] == "Kansas"
    assert body["scope_expanded"] is False
    assert body["matches"][0]["in_scope"] is True   # global => every candidate in scope


def test_community_upload_untouched(app_client, env):
    """A community upload never enters the scoped staff branch (background packet)."""
    with patch("auth.validate_and_get_context",
               return_value=(True, None, community_ctx())):
        r = app_client.post(
            "/api/upload",
            data=_file(extra={"state": "Kansas", "location": "Topeka"}),
            content_type="multipart/form-data",
            headers=auth_header("community"),
        )
    assert r.status_code == 200
    body = r.get_json()
    assert "Waiting for admin review" in body["message"]
    assert "scope_expanded" not in body           # community response shape unchanged
    env["manager"].search_for_matches.assert_not_called()


# ------------------------------------------------------- /api/match/quick-check

def test_quick_check_scoped_narrows_and_flags(app_client, env):
    """Quick check narrows a requested sheet to the owned sub-areas and flags results."""
    env["manager"].search_for_matches.return_value = (
        [
            {"site_id": "C1", "location": "Kansas/Topeka", "confidence": 0.9, "score": 400, "file_path": "/x/a.pt"},
            {"site_id": "C2", "location": "Kansas/Lawrence", "confidence": 0.4, "score": 100, "file_path": "/x/b.pt"},
        ],
        0.3,
    )
    with patch("auth.validate_and_get_context",
               return_value=(True, None, scoped_ctx(areas=["Kansas/Topeka"]))):
        r = app_client.post(
            "/api/match/quick-check",
            data=_file(extra={"match_sheet": "Kansas"}),
            content_type="multipart/form-data",
            headers=auth_header("staff"),
        )
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    # Requesting the whole Kansas tab while owning only Topeka narrows the filter.
    assert env["manager"].search_for_matches.call_args.kwargs["location_filter"] == ["Kansas/Topeka"]
    assert body["scope_expanded"] is True         # Lawrence hit is out of scope
    by_id = {m["turtle_id"]: m for m in body["matches"]}
    assert by_id["C1"]["in_scope"] is True
    assert by_id["C2"]["in_scope"] is False


def test_quick_check_global_passthrough(app_client, env):
    with patch("auth.validate_and_get_context",
               return_value=(True, None, global_admin_ctx())):
        r = app_client.post(
            "/api/match/quick-check",
            data=_file(extra={"match_sheet": "Kansas"}),
            content_type="multipart/form-data",
            headers=auth_header("admin"),
        )
    assert r.status_code == 200
    assert env["manager"].search_for_matches.call_args.kwargs["location_filter"] == "Kansas"
    assert r.get_json()["scope_expanded"] is False
