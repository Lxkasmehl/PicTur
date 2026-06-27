"""PR-A: Sheets outage must never birth a non-canonical turtle folder.

Covers the new prevention layer:
- transient/permanent classification + bounded retry (manager_service)
- generate_primary_id collision-resistant format (migration)
- get_max_biology_id_number raises on a read error instead of minting a dup 001
- update_turtle_data locates a "Null" (bio-only) row via the bio_id fallback
"""

from __future__ import annotations

import re
import socket
import ssl
from unittest.mock import MagicMock, patch

import pytest

from services import manager_service as ms
from sheets import crud, migration


# ── transient vs permanent classification ──────────────────────────────────


def test_is_transient_true_for_network_errors():
    assert ms.is_transient_sheets_error(ConnectionError("drop"))
    assert ms.is_transient_sheets_error(TimeoutError())
    assert ms.is_transient_sheets_error(socket.timeout())
    assert ms.is_transient_sheets_error(ssl.SSLError("handshake"))
    assert ms.is_transient_sheets_error(ms.SheetsServiceUnavailableError())


def test_is_transient_false_for_permanent_config_errors():
    # FileNotFoundError is itself an OSError -> must be classified permanent.
    assert not ms.is_transient_sheets_error(FileNotFoundError("creds.json"))
    assert not ms.is_transient_sheets_error(ValueError("Spreadsheet ID must be provided"))
    assert not ms.is_transient_sheets_error(Exception("Credentials file not found: x"))


# ── call_sheets_with_retry ──────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _no_real_sheets(monkeypatch):
    """Never construct a real GoogleSheetsService or sleep in these tests."""
    monkeypatch.setattr(ms, "_research_service_strict", lambda: object())
    monkeypatch.setattr(ms, "reset_sheets_service", lambda: None)
    monkeypatch.setattr(ms.time, "sleep", lambda _s: None)


def test_retry_permanent_error_propagates_without_retrying():
    calls = {"n": 0}

    def func(_svc):
        calls["n"] += 1
        raise ValueError("must be provided")  # permanent

    with pytest.raises(ValueError):
        ms.call_sheets_with_retry(func, max_attempts=3)
    assert calls["n"] == 1  # no retry on a permanent error


def test_retry_transient_then_success():
    calls = {"n": 0}

    def func(_svc):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("drop")
        return "ok"

    assert ms.call_sheets_with_retry(func, max_attempts=3) == "ok"
    assert calls["n"] == 3


def test_retry_exhausted_raises_503():
    def func(_svc):
        raise ConnectionError("drop")

    with pytest.raises(ms.SheetsServiceUnavailableError) as ei:
        ms.call_sheets_with_retry(func, max_attempts=2)
    assert ei.value.status_code == 503


def test_retry_community_unset_passes_none_no_retry(monkeypatch):
    monkeypatch.delenv("GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID", raising=False)
    seen = {}

    def func(service):
        seen["service"] = service
        return "skip-handled-by-caller"

    assert ms.call_sheets_with_retry(func, community=True) == "skip-handled-by-caller"
    assert seen["service"] is None  # unconfigured community sheet -> None sentinel


# ── generate_primary_id format / uniqueness ─────────────────────────────────


def test_generate_primary_id_shape_and_uniqueness():
    pid = migration.generate_primary_id(None, None)
    assert re.match(r"^T\d{10,}$", pid)  # every _PRIMARY_ID_RE matcher still works
    assert len(pid) >= 1 + 13 + 9  # ms timestamp + 9-digit secrets tail
    # 9-digit cryptographic tail -> same-millisecond burst does not collide.
    ids = {migration.generate_primary_id(None, None) for _ in range(200)}
    assert len(ids) == 200


# ── get_max_biology_id_number: raise on read error, 0 only when truly empty ──


def test_get_max_biology_id_raises_on_read_error():
    def boom(_sheet):
        raise RuntimeError("transient column-index read failure")

    with pytest.raises(RuntimeError):
        migration.get_max_biology_id_number(object(), "sid", "Kansas", boom)


def test_get_max_biology_id_zero_when_no_id_column():
    # A genuinely-empty sheet (no 'ID' column) still returns 0 -> not an error.
    assert migration.get_max_biology_id_number(object(), "sid", "Kansas", lambda _s: {}) == 0


# ── update_turtle_data: locate a Null (bio-only) row by bio_id ───────────────


@patch("sheets.crud.apply_deceased_row_background")
@patch("sheets.crud.sheet_management.ensure_missing_columns_for_turtle_write")
def test_update_turtle_data_bio_id_fallback_writes_new_primary(mock_ensure, mock_deceased):
    """A freshly-minted primary isn't in the sheet yet, so it matches neither
    the Primary ID nor the ID column -- the bio_id fallback must locate the row
    so the new primary gets written into it."""
    new_primary = "T" + "1" * 22
    lookups = []

    def fake_find(_sheet, value, col):
        lookups.append((value, col))
        return 7 if (value == "F900" and col == "ID") else None

    indices = {"Primary ID": 0, "ID": 2}
    service = MagicMock()
    service.spreadsheets().values().get().execute.return_value = {"values": [["", "", "F900"]]}

    ok = crud.update_turtle_data(
        service, "sid", new_primary, {"primary_id": new_primary}, "Kansas",
        ensure_primary_id_column_func=lambda _s: True,
        find_row_by_primary_id_func=fake_find,
        get_all_column_indices_func=lambda _s: indices,
        invalidate_column_indices_cache_func=lambda _s=None: None,
        bio_id="F900",
    )

    assert ok is True
    assert ("F900", "ID") in lookups  # used the bio fallback
    # the new primary was written into the Primary ID cell (col 0) of the row
    written = service.spreadsheets().values().update.call_args.kwargs["body"]["values"][0]
    assert written[0] == new_primary


@patch("sheets.crud.apply_deceased_row_background")
@patch("sheets.crud.sheet_management.ensure_missing_columns_for_turtle_write")
def test_update_turtle_data_without_bio_id_still_returns_false_when_unmatched(mock_ensure, mock_deceased):
    """No bio_id supplied + primary not in the sheet -> unchanged behavior (False)."""
    ok = crud.update_turtle_data(
        object(), "sid", "Tnope", {"primary_id": "Tnope"}, "Kansas",
        ensure_primary_id_column_func=lambda _s: True,
        find_row_by_primary_id_func=lambda *_a: None,
        get_all_column_indices_func=lambda _s: {"Primary ID": 0, "ID": 2},
        invalidate_column_indices_cache_func=lambda _s=None: None,
    )
    assert ok is False


# ── _ensure_primary_for_new_sheet_turtle (Null-turtle mint) ─────────────────
# The CRUD layer SWALLOWS a transient read/write HttpError to None/False (it
# does not raise), so the helper must check those returns -- otherwise a Sheets
# outage would mint a primary, create the on-disk folder, and leave the sheet
# row's Primary ID empty (silent disk/sheet divergence). Caught in the PR-A
# bug-check; these lock the fix.


def _fake_service(**returns):
    svc = MagicMock()
    for name, value in returns.items():
        getattr(svc, name).return_value = value
    return svc


def test_ensure_primary_returns_existing_without_writing(monkeypatch):
    from routes import turtles as turtles_mod
    svc = _fake_service(get_turtle_data={"id": "F900", "primary_id": "T9999999999"})
    monkeypatch.setattr(ms, "_research_service_strict", lambda: svc)
    pid = turtles_mod._ensure_primary_for_new_sheet_turtle("F900", "F900", "Kansas/Lawrence")
    assert pid == "T9999999999"
    svc.update_turtle_data.assert_not_called()


def test_ensure_primary_mints_writes_and_scopes_to_tab(monkeypatch):
    from routes import turtles as turtles_mod
    svc = _fake_service(get_turtle_data={"id": "F900"},
                        generate_primary_id="T1234567890123", update_turtle_data=True)
    monkeypatch.setattr(ms, "_research_service_strict", lambda: svc)
    pid = turtles_mod._ensure_primary_for_new_sheet_turtle("F900", "F900", "NebraskaCPBS/CPBS/Shredder")
    assert pid == "T1234567890123"
    # the sheet write is scoped to the TAB (first hint segment), not the sub-site
    call = svc.update_turtle_data.call_args
    assert call.args[2] == "NebraskaCPBS"
    assert call.kwargs["bio_id"] == "F900"


def test_ensure_primary_503_when_write_silently_fails(monkeypatch):
    from routes import turtles as turtles_mod
    svc = _fake_service(get_turtle_data={"id": "F900"},
                        generate_primary_id="T1234567890123", update_turtle_data=False)
    monkeypatch.setattr(ms, "_research_service_strict", lambda: svc)
    with pytest.raises(ms.SheetsServiceUnavailableError):
        turtles_mod._ensure_primary_for_new_sheet_turtle("F900", "F900", "Kansas/Lawrence")


def test_ensure_primary_503_when_row_unreadable(monkeypatch):
    from routes import turtles as turtles_mod
    svc = _fake_service(get_turtle_data=None)  # swallowed transient read -> None
    monkeypatch.setattr(ms, "_research_service_strict", lambda: svc)
    with pytest.raises(ms.SheetsServiceUnavailableError):
        turtles_mod._ensure_primary_for_new_sheet_turtle("F900", "F900", "Kansas/Lawrence")
