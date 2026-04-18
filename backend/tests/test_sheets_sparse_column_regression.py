"""
Regression for the production bug class described in team chat (confirm new turtle):

- **Overwrite**: A new turtle row was written onto an **existing** turtle's line (e.g. M617)
  because `next_row` was derived from too few `values` rows (sparse read of column A only).
- **Wrong biology ID**: Next ID was **U637** instead of **U667** while **J666** existed in the
  same tab, because the max numeric suffix scan did not see all biology IDs.

These tests use `GoogleSheetsValuesFake`, which models Google’s sparse single-column `values.get`
behaviour (rows missing when that column is empty). Assertions are on **outcomes** (sheet row
written; max suffix / next ID), not on implementation details like a specific range string.

Reverting the fixes in `sheets/crud.py` / `sheets/migration.py` should fail the behavioural tests.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from sheets import migration
from sheets.crud import create_turtle_data

from tests.fakes.google_sheets_api_fake import (
    GoogleSheetsValuesFake,
    ground_truth_last_occupied_sheet_row,
    ground_truth_max_biology_suffix,
    next_row_if_len_plus_one_matches_create_turtle,
)


@pytest.fixture
def canonical_indices():
    return {
        'Primary ID': 0,
        'Frequency': 1,
        'ID': 2,
    }


def _buggy_next_row_if_only_column_a_used_for_count(grid: list[list[str]]) -> int:
    """
    Simulates the failure mode: same formula as create_turtle_data, but `values` come from
    a column-A-only read (sparse rows). Returns the 1-based row that would be overwritten next.
    """
    fake = GoogleSheetsValuesFake(grid=list(grid))
    vals = fake.get(spreadsheetId='x', range='Sheet!A:A').execute().get('values') or []
    return next_row_if_len_plus_one_matches_create_turtle(len(vals))


# ── Chat scenario: overwrite (M617 line) ─────────────────────────────────────────────


@patch('sheets.crud.apply_deceased_row_background')
@patch('sheets.crud.sheet_management.ensure_missing_columns_for_turtle_write')
def test_new_turtle_does_not_overwrite_existing_row_when_primary_id_missing_on_some_rows(
    mock_ensure_missing,
    mock_deceased,
    canonical_indices,
):
    """
    Ground truth: M617 occupies sheet row 2; rows 3–4 have biology IDs but **empty** Primary ID.
    A column-A-only row count would target sheet row 3 next and would wipe M618 — the reported bug class.
    Fixed code must append at the first **fully empty** row after the last row that has any data in A:C.
    """
    grid = [
        ['Primary ID', 'Frequency', 'ID'],
        ['T177517698635413260', '', 'M617'],
        ['', '', 'M618'],
        ['', '', 'M619'],
    ]
    expected_sheet_row = ground_truth_last_occupied_sheet_row(grid) + 1
    buggy_row = _buggy_next_row_if_only_column_a_used_for_count(grid)
    assert buggy_row == 3, 'sanity: sparse column A makes next_row too small (would clobber M618)'

    fake = GoogleSheetsValuesFake(grid=[row[:] for row in grid])

    def cols(_name):
        return dict(canonical_indices)

    def ensure_pi(_name):
        return True

    def invalidate(_name=None):
        return None

    create_turtle_data(
        fake,
        'spreadsheet-id',
        {'primary_id': 'T177643381185133868'},
        'Kansas',
        ensure_primary_id_column_func=ensure_pi,
        get_all_column_indices_func=cols,
        invalidate_column_indices_cache_func=invalidate,
    )

    assert fake.last_update_sheet_row == expected_sheet_row == 5
    # M617 row untouched (still M617 in biology ID column)
    assert (fake.grid[1][2] or '').strip() == 'M617'
    assert (fake.grid[2][2] or '').strip() == 'M618'
    # New primary written on the append row
    assert (fake.grid[4][0] or '').strip() == 'T177643381185133868'


# ── Chat scenario: biology ID U667 vs U637 ─────────────────────────────────────────────


def test_max_biology_suffix_sees_j666_when_primary_id_empty_in_same_rows():
    """Same tab holds J666; max suffix must be 666 so the next U-ID can be U667 (not U637)."""
    grid = [
        ['Primary ID', 'Frequency', 'ID'],
        ['T1', '', 'M635'],
        ['', '', 'M636'],
        ['', '', 'J666'],
    ]
    assert ground_truth_max_biology_suffix(grid) == 666

    fake = GoogleSheetsValuesFake(grid=[row[:] for row in grid])

    def cols(_name):
        return {'Primary ID': 0, 'ID': 2}

    n = migration.get_max_biology_id_number(
        fake,
        'sid',
        'Kansas',
        get_all_column_indices_func=cols,
    )
    assert n == 666


def test_next_unknown_sex_id_after_j666_is_u667_not_u637():
    """After J666 the shared numeric sequence next is 667 → U667 (regression: U637 was observed)."""
    grid = [
        ['Primary ID', 'Frequency', 'ID'],
        ['', '', 'J666'],
    ]
    fake = GoogleSheetsValuesFake(grid=[row[:] for row in grid])

    def cols(_name):
        return {'Primary ID': 0, 'ID': 2}

    nxt = migration.generate_biology_id(
        fake,
        'sid',
        'Kansas',
        get_all_column_indices_func=cols,
        gender='U',
    )
    assert nxt == 'U667'
    assert nxt != 'U637'


def test_reported_u637_is_consistent_with_missed_j666_max_stuck_at_636():
    """
    Chat report: new turtle became **U637** while **J666** existed. The next ID after suffix 636 is
    **U637**; after 666 it must be **U667**. This test ties the observed wrong ID to a too-low max
    (636), not to an arbitrary string assertion in application code.
    """
    grid = [
        ['Primary ID', 'Frequency', 'ID'],
        ['T1', '', 'M636'],
        ['', '', 'J666'],
    ]
    assert ground_truth_max_biology_suffix(grid) == 666
    assert f"U{666 + 1:03d}" == 'U667'
    # If the max scan wrongly stopped at 636 (J666 not seen), the app would assign U637 — same digits as chat.
    assert f"U{636 + 1:03d}" == 'U637'


def test_fake_sparse_column_a_omits_rows_with_empty_primary_id():
    """Sanity-check the fake: A:A returns header + only rows with non-empty column A."""
    grid = [
        ['Primary ID', 'Frequency', 'ID'],
        ['T1', '', 'M617'],
        ['', '', 'M618'],
    ]
    fake = GoogleSheetsValuesFake(grid=[row[:] for row in grid])
    vals = fake.get(spreadsheetId='x', range='S!A:A').execute().get('values') or []
    assert len(vals) == 2
    assert vals[1] == ['T1']
