"""
Unit tests for the scoped offline-backup download (team leads + admins).

Pins:
  - ``resolve_backup_scope`` resolves + CLAMPS the requested slice against the
    caller's areas (global admin: everything / a State / a Location; team lead:
    only their areas, whole-state or out-of-state requests 403'd).
  - the token is a self-contained capability: it round-trips the resolved
    roots/sheets, and the download streams the TOKEN's roots — tampering the
    URL's ?area= cannot widen the archive.
  - the token-mint endpoint is limited to team leads + admins (regular staff and
    community are 403'd).
  - the global-admin ``scope=all`` archive is unchanged (whole data/ tree + the
    original whole-server README).

These tests never touch Google Sheets (the services are patched to None, so
``owning_sheet`` falls back to the path segment and the sheets_export loop is a
no-op) and run against a tiny tmp data/ tree.
"""

import io
import zipfile
from unittest.mock import MagicMock

import jwt
import pytest

import config
import routes.admin_backup as backup_mod
from auth import mint_download_token, verify_download_token
from tests.scope_test_utils import (
    auth_header,
    community_ctx,
    global_admin_ctx,
    global_staff_ctx,
    patch_validate,
    scoped_ctx,
    team_lead_ctx,
)


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def backup_env(tmp_path, monkeypatch):
    """A tmp data/ tree + patched manager + hermetic (no-Sheets) services."""
    base = tmp_path / "data"
    for rel in ("Kansas", "Kansas/Topeka", "Kansas/Lawrence", "Nebraska"):
        d = base / rel
        d.mkdir(parents=True, exist_ok=True)
        (d / "marker.txt").write_text(f"marker for {rel}\n", encoding="utf-8")

    mock_manager = MagicMock()
    mock_manager.base_dir = str(base)
    ready = MagicMock()
    ready.wait.return_value = True

    from services import manager_service

    monkeypatch.setattr(manager_service, "manager", mock_manager)
    monkeypatch.setattr(manager_service, "manager_ready", ready)
    # Hermetic: no Google Sheets — owning_sheet falls back to the top path
    # segment, and the sheets_export loop is skipped entirely.
    monkeypatch.setattr(backup_mod, "get_sheets_service", lambda: None)
    monkeypatch.setattr(backup_mod, "get_community_sheets_service", lambda: None)
    return {"base": base}


# ---------------------------------------------------------------------------
# resolve_backup_scope — global caller
# ---------------------------------------------------------------------------


def test_global_admin_all_is_whole_tree_and_all_sheets(backup_env):
    r = backup_mod.resolve_backup_scope(global_admin_ctx(), "all", None)
    assert r["roots"] == [""]  # whole data/ tree
    assert r["sheets"] == "*"  # every tab
    assert r["label"] == "all"
    assert r["scope"] == "all"


def test_global_admin_area_state(backup_env):
    r = backup_mod.resolve_backup_scope(global_admin_ctx(), "area", "Kansas")
    assert r["roots"] == ["Kansas"]
    assert r["sheets"] == ["Kansas"]
    assert r["scope"] == "area"
    assert r["area"] == "Kansas"


def test_global_admin_area_location(backup_env):
    r = backup_mod.resolve_backup_scope(global_admin_ctx(), "area", "Kansas/Topeka")
    assert r["roots"] == ["Kansas/Topeka"]
    assert r["sheets"] == ["Kansas"]  # owning sheet is the top-level segment


def test_global_admin_area_missing_folder_is_400(backup_env):
    with pytest.raises(ValueError):
        backup_mod.resolve_backup_scope(global_admin_ctx(), "area", "Atlantis")


def test_bad_scope_is_400(backup_env):
    with pytest.raises(ValueError):
        backup_mod.resolve_backup_scope(global_admin_ctx(), "sheet", None)


def test_area_traversal_is_rejected(backup_env):
    with pytest.raises(ValueError):
        backup_mod.resolve_backup_scope(global_admin_ctx(), "area", "Kansas/../../etc")


# ---------------------------------------------------------------------------
# resolve_backup_scope — scoped team lead
# ---------------------------------------------------------------------------


def test_team_lead_all_is_clamped_to_owned_areas(backup_env):
    r = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "all", None)
    assert r["roots"] == ["Kansas/Topeka"]
    assert r["sheets"] == ["Kansas"]
    assert r["label"] == "my-areas"


def test_team_lead_multi_area_all(backup_env):
    r = backup_mod.resolve_backup_scope(
        team_lead_ctx(["Kansas/Topeka", "Nebraska"]), "all", None
    )
    assert sorted(r["roots"]) == ["Kansas/Topeka", "Nebraska"]
    assert r["sheets"] == ["Kansas", "Nebraska"]


def test_team_lead_area_within_scope_allowed(backup_env):
    r = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "area", "Kansas/Topeka")
    assert r["roots"] == ["Kansas/Topeka"]
    assert r["sheets"] == ["Kansas"]


def test_team_lead_area_whole_state_denied(backup_env):
    # Owning only Kansas/Topeka, the broader "Kansas" is out of scope.
    with pytest.raises(PermissionError):
        backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "area", "Kansas")


def test_team_lead_area_other_state_denied(backup_env):
    with pytest.raises(PermissionError):
        backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "area", "Nebraska")


def test_team_lead_owning_whole_state_can_pick_state_or_sublocation(backup_env):
    ctx = team_lead_ctx(["Kansas"])
    assert backup_mod.resolve_backup_scope(ctx, "area", "Kansas")["roots"] == ["Kansas"]
    assert backup_mod.resolve_backup_scope(ctx, "area", "Kansas/Topeka")["roots"] == ["Kansas/Topeka"]


def test_scoped_with_no_areas_denied(backup_env):
    with pytest.raises(PermissionError):
        backup_mod.resolve_backup_scope(team_lead_ctx([]), "all", None)


def test_team_lead_overlapping_areas_deduped(backup_env):
    # Owning both a state and one of its sublocations must not zip Topeka twice.
    r = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas", "Kansas/Topeka"]), "all", None)
    assert r["roots"] == ["Kansas"]


def test_team_lead_in_scope_area_without_folder_is_empty_not_400(backup_env):
    # A newly-assigned owned area with no on-disk folder yet is a valid (empty)
    # backup, not a confusing 400 — the dropdown always offers owned areas.
    r = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/NewSite"]), "area", "Kansas/NewSite")
    assert r["roots"] == ["Kansas/NewSite"]
    assert r["sheets"] == ["Kansas"]


# ---------------------------------------------------------------------------
# Sheet snapshot row-filter — a sub-location backup must not leak sibling rows
# ---------------------------------------------------------------------------


def _fake_sheets_service():
    svc = MagicMock()
    svc.COLUMN_MAPPING = {"Primary ID": "primary_id", "General Location": "general_location"}
    return svc


_ROWS = [
    ["Primary ID", "General Location"],
    ["T1", "Topeka"],
    ["T2", "Lawrence"],
    ["T3", "Topeka"],
    ["T4", ""],  # no general location — kept (matches in-app list_all_turtles)
]


def test_row_filter_drops_out_of_scope_sublocations():
    out = backup_mod._filter_sheet_values_for_roots(_ROWS, "Kansas", ["Kansas/Topeka"], _fake_sheets_service())
    ids = [r[0] for r in out[1:]]
    assert out[0] == _ROWS[0]          # header kept
    assert "T2" not in ids             # Lawrence (sibling sublocation) dropped
    assert ids == ["T1", "T3", "T4"]   # Topeka rows + the no-location row kept


def test_row_filter_whole_state_keeps_all_rows():
    out = backup_mod._filter_sheet_values_for_roots(_ROWS, "Kansas", ["Kansas"], _fake_sheets_service())
    assert [r[0] for r in out[1:]] == ["T1", "T2", "T3", "T4"]


def test_row_filter_no_general_location_column_is_unchanged():
    svc = MagicMock()
    svc.COLUMN_MAPPING = {"Primary ID": "primary_id"}  # no general_location column
    rows = [["Primary ID"], ["T1"], ["T2"]]
    assert backup_mod._filter_sheet_values_for_roots(rows, "Community", ["Kansas/Topeka"], svc) == rows


# ---------------------------------------------------------------------------
# Token: self-contained, tamper-proof capability
# ---------------------------------------------------------------------------


def test_token_round_trips_resolved_scope(backup_env):
    resolved = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "all", None)
    token = mint_download_token(7, resolved)
    got = verify_download_token(token)
    assert got["roots"] == ["Kansas/Topeka"]
    assert got["sheets"] == ["Kansas"]
    assert got["label"] == "my-areas"
    assert got["uid"] == 7


def test_verify_rejects_bad_tokens(backup_env):
    resolved = backup_mod.resolve_backup_scope(global_admin_ctx(), "all", None)
    token = mint_download_token(1, resolved)
    assert verify_download_token(token + "x") is None
    assert verify_download_token("") is None
    assert verify_download_token(None) is None
    # signed with the wrong secret
    bad = jwt.encode({"purpose": "backup_dl", "roots": [""]}, "wrong-secret", algorithm="HS256")
    assert verify_download_token(bad) is None
    # wrong purpose
    wrong = jwt.encode({"purpose": "other"}, config.JWT_SECRET, algorithm="HS256")
    assert verify_download_token(wrong) is None


# ---------------------------------------------------------------------------
# Token-mint endpoint: team-lead + admin only
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ctx_factory,status",
    [
        (global_admin_ctx, 200),
        (lambda: team_lead_ctx(["Kansas/Topeka"]), 200),
        (lambda: scoped_ctx(["Kansas/Topeka"], role="staff", group_role="member"), 403),
        (global_staff_ctx, 403),  # Primary member: global staff but not a lead
        (community_ctx, 403),
    ],
)
def test_mint_endpoint_role_gate(app_client, backup_env, monkeypatch, ctx_factory, status):
    patch_validate(monkeypatch, ctx_factory())
    r = app_client.post("/api/backup/archive/token?scope=all", headers=auth_header("staff"))
    assert r.status_code == status
    if status == 200:
        assert r.get_json()["token"]


def test_mint_endpoint_requires_token(app_client, backup_env):
    r = app_client.post("/api/backup/archive/token?scope=all")
    assert r.status_code == 401


def test_mint_endpoint_team_lead_out_of_scope_area_403(app_client, backup_env, monkeypatch):
    patch_validate(monkeypatch, team_lead_ctx(["Kansas/Topeka"]))
    r = app_client.post(
        "/api/backup/archive/token?scope=area&area=Nebraska", headers=auth_header("staff")
    )
    assert r.status_code == 403


def test_mint_endpoint_team_lead_in_scope_area_200(app_client, backup_env, monkeypatch):
    patch_validate(monkeypatch, team_lead_ctx(["Kansas/Topeka"]))
    r = app_client.post(
        "/api/backup/archive/token?scope=area&area=Kansas/Topeka", headers=auth_header("staff")
    )
    assert r.status_code == 200
    got = verify_download_token(r.get_json()["token"])
    assert got["roots"] == ["Kansas/Topeka"]


# ---------------------------------------------------------------------------
# Download: streams the TOKEN's scope (tamper-proof) + global-all unchanged
# ---------------------------------------------------------------------------


def test_download_uses_token_scope_not_url(app_client, backup_env):
    """Tampering ?area= on the URL cannot widen the archive — the roots come from
    the signed token, so a Kansas/Topeka lead's download stays Kansas/Topeka."""
    resolved = backup_mod.resolve_backup_scope(team_lead_ctx(["Kansas/Topeka"]), "area", "Kansas/Topeka")
    token = mint_download_token(3, resolved)

    r = app_client.get(f"/api/backup/archive?dl={token}&scope=area&area=Nebraska")
    assert r.status_code == 200
    assert r.headers["Content-Type"].startswith("application/zip")
    # Filename reflects the TOKEN's label, not the tampered URL.
    assert "Kansas_Topeka" in r.headers["Content-Disposition"]

    names = zipfile.ZipFile(io.BytesIO(r.data)).namelist()
    assert any(n.startswith("data/Kansas/Topeka/") for n in names)
    assert not any(n.startswith("data/Nebraska") for n in names)
    assert not any(n.startswith("data/Kansas/Lawrence") for n in names)


def test_download_rejects_bad_token(app_client, backup_env):
    r = app_client.get("/api/backup/archive?dl=not-a-real-token&scope=all")
    assert r.status_code == 401


def test_download_global_all_is_whole_tree_and_original_readme(app_client, backup_env):
    """The global 'Everything' archive is unchanged: the whole data/ tree plus the
    original whole-server README."""
    resolved = backup_mod.resolve_backup_scope(global_admin_ctx(), "all", None)
    token = mint_download_token(1, resolved)

    r = app_client.get(f"/api/backup/archive?dl={token}")
    assert r.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(r.data))
    names = zf.namelist()
    assert "data/Kansas/marker.txt" in names
    assert "data/Kansas/Topeka/marker.txt" in names
    assert "data/Nebraska/marker.txt" in names

    readme = zf.read("sheets_export/README.txt").decode("utf-8")
    assert readme.startswith("TurtleTracker offline backup (admin download)")
    assert "recreate tabs and import the matching CSV files." in readme


def test_download_header_path_team_lead_out_of_scope_403(app_client, backup_env, monkeypatch):
    """The header (non-?dl=) path re-clamps from the live ctx: a team lead asking
    for another state via the header is 403'd before any bytes stream."""
    patch_validate(monkeypatch, team_lead_ctx(["Kansas/Topeka"]))
    r = app_client.get(
        "/api/backup/archive?scope=area&area=Nebraska", headers=auth_header("staff")
    )
    assert r.status_code == 403


def test_download_header_path_regular_staff_403(app_client, backup_env, monkeypatch):
    patch_validate(monkeypatch, global_staff_ctx())
    r = app_client.get("/api/backup/archive?scope=all", headers=auth_header("staff"))
    assert r.status_code == 403
