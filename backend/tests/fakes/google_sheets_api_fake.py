"""
Fake Google Sheets API v4 `spreadsheets.values` behaviour for unit tests.

Models the production bug class from sparse single-column reads:

- Requesting **only column A** (`…!A:A`): the API does not return rows where column A
  is empty, even if columns B/C contain biology IDs. That made `len(values)` too small
  and the next `update()` targeted an existing turtle row (e.g. overwriting M617's line).

- Requesting a **multi-column block** (`…!A:C` or `…!A2:C`): rows are included if any
  requested column has data in that row (we return a dense slice of the in-memory grid).

This is enough to assert *behaviour* (which row gets written; max biology suffix) rather
than only implementation details (which range string was passed).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


def _tail_after_bang(range_str: str) -> str:
    if '!' not in range_str:
        return range_str
    return range_str.split('!')[-1].strip("'")


def _pad_row(row: list[str], width: int) -> list[str]:
    out = list(row)
    while len(out) < width:
        out.append('')
    return out[:width]


@dataclass
class GoogleSheetsValuesFake:
    """
    In-memory sheet grid: row 0 = header (sheet row 1), row i = sheet row i+1.
    Columns are 0-based (A=0, B=1, C=2, …).
    """

    grid: list[list[str]]
    last_get_range: str | None = None
    last_update_range: str | None = None
    last_update_body: dict[str, Any] | None = None

    # For assertions: 1-based sheet row number targeted by the last update()
    last_update_sheet_row: int | None = None

    def spreadsheets(self) -> GoogleSheetsValuesFake:
        return self

    def values(self) -> GoogleSheetsValuesFake:
        return self

    def get(self, spreadsheetId: str | None = None, range: str | None = None, **kwargs: Any):
        assert range is not None
        self.last_get_range = range
        tail = _tail_after_bang(range)
        values = self._values_for_range(tail)
        return _Execute({'values': values})

    def update(
        self,
        spreadsheetId: str | None = None,
        range: str | None = None,
        body: dict[str, Any] | None = None,
        valueInputOption: str | None = None,
        **kwargs: Any,
    ):
        assert range is not None and body is not None
        self.last_update_range = range
        self.last_update_body = body
        tail = _tail_after_bang(range)
        row_1based: int | None = None
        m_row = re.match(r'^(\d+):(\d+)$', tail)
        if m_row and m_row.group(1) == m_row.group(2):
            row_1based = int(m_row.group(1))
        else:
            m_rect = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', tail)
            if m_rect:
                row_1based = int(m_rect.group(2))
        if row_1based is not None:
            self.last_update_sheet_row = row_1based
            row_idx = row_1based - 1
            new_row = body.get('values', [[]])[0]
            while len(self.grid) <= row_idx:
                self.grid.append([])
            width = max(len(new_row), len(self.grid[row_idx]) if self.grid[row_idx] else 0, 3)
            base = _pad_row(self.grid[row_idx], width)
            for i, val in enumerate(new_row):
                if i < len(base):
                    base[i] = val if val is not None else ''
            self.grid[row_idx] = _pad_row(base, width)
        return _Execute({})

    def _values_for_range(self, tail: str) -> list[list[str]]:
        """
        Emulate Sheets `values.get` for a few range shapes used by our code.

        - `A:C` — full columns A–C: all rows currently in `grid` (includes header row).
        - `A2:C` — same columns, data rows only (sheet rows 2+), i.e. `grid[1:]`.
        - `A:A` — **single column A**: header row plus only rows where column A is non-empty.
          Rows with empty Primary ID but biology ID in C are **omitted** (sparse-column bug).
        """
        # Unbounded column range starting at a row, e.g. A2:C (used by get_max_biology_id_number)
        m_unbounded = re.match(r'^([A-Z]+)(\d+):([A-Z]+)$', tail)
        if m_unbounded:
            c0 = _letters_to_index(m_unbounded.group(1))
            r_start = int(m_unbounded.group(2)) - 1
            c1 = _letters_to_index(m_unbounded.group(3))
            out: list[list[str]] = []
            for idx in range(r_start, len(self.grid)):
                row = _pad_row(self.grid[idx], max(c0, c1) + 1)
                out.append([row[j] for j in range(c0, c1 + 1)])
            return out

        if re.fullmatch(r'[A-Z]+:[A-Z]+', tail):
            start_c, end_c = tail.split(':')
            c0 = _letters_to_index(start_c)
            c1 = _letters_to_index(end_c)
            if c0 == 0 and c1 == 0 and start_c == 'A' and end_c == 'A':
                return self._column_a_sparse()
            out = []
            for r in self.grid:
                row = _pad_row(r, max(c1 + 1, len(r)))
                out.append([row[j] if j < len(row) else '' for j in range(c0, c1 + 1)])
            return out

        m_box = re.match(r'^([A-Z]+)(\d+):([A-Z]+)(\d+)$', tail)
        if m_box:
            c0 = _letters_to_index(m_box.group(1))
            c1 = _letters_to_index(m_box.group(3))
            r_start = int(m_box.group(2)) - 1
            r_end = int(m_box.group(4))
            out = []
            for idx in range(r_start, min(r_end, len(self.grid))):
                row = _pad_row(self.grid[idx], max(c0, c1) + 1)
                out.append([row[j] for j in range(c0, c1 + 1)])
            return out

        raise ValueError(f'Unsupported fake range tail: {tail!r}')

    def _column_a_sparse(self) -> list[list[str]]:
        """Single-column A: omit rows with empty column A (after header)."""
        if not self.grid:
            return []
        out: list[list[str]] = []
        header = _pad_row(self.grid[0], 1)
        out.append([header[0]])
        for r in range(1, len(self.grid)):
            row = _pad_row(self.grid[r], 1)
            cell_a = (row[0] or '').strip()
            if cell_a:
                out.append([row[0]])
        return out


class _Execute:
    def __init__(self, payload: dict[str, Any]):
        self._payload = payload

    def execute(self) -> dict[str, Any]:
        return self._payload


def _letters_to_index(letters: str) -> int:
    n = 0
    for c in letters.upper():
        n = n * 26 + (ord(c) - ord('A') + 1)
    return n - 1


def next_row_if_len_plus_one_matches_create_turtle(values_rows_including_header: int) -> int:
    """Mirrors create_turtle_data: next_row = len(values) + 1 (row 1 = headers)."""
    return values_rows_including_header + 1 if values_rows_including_header else 2


def ground_truth_last_occupied_sheet_row(grid: list[list[str]], width: int = 3) -> int:
    """Last 1-based sheet row index that has any non-empty cell in cols A..width."""
    last = 1
    for i, row in enumerate(grid):
        r = _pad_row(row, width)
        if any((c or '').strip() for c in r[:width]):
            last = i + 1
    return last


def ground_truth_max_biology_suffix(grid: list[list[str]], id_col: int = 2) -> int:
    """Max numeric suffix in biology ID column (column index id_col), 0 if none."""
    from sheets.migration import _biology_id_sequence_number

    m = 0
    for i, row in enumerate(grid):
        if i == 0:
            continue
        r = _pad_row(row, id_col + 1)
        cell = (r[id_col] or '').strip()
        if not cell:
            continue
        num = _biology_id_sequence_number(cell)
        if num is not None and num > m:
            m = num
    return m
