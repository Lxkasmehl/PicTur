"""
Find turtle rows in a sheet by primary ID, biology ID (ID column), or name.
"""

import re
from typing import Any, Dict, List, Optional

from googleapiclient.errors import HttpError

from .helpers import escape_sheet_name
def normalize_biology_id(value: str) -> Optional[str]:
    """
    Canonical form for biology IDs: letter + number without leading zeros on the number
    (e.g. F01, F1, f 1 -> F1).
    """
    s = (value or '').strip().upper().replace(' ', '')
    if not s:
        return None
    m = re.match(r'^([FJMJU])(\d+)$', s)
    if m:
        return f'{m.group(1)}{int(m.group(2))}'
    return s


def biology_ids_match(cell: str, target: str) -> bool:
    t_norm = normalize_biology_id(target)
    if not t_norm:
        return False
    c_norm = normalize_biology_id(cell)
    if c_norm:
        return c_norm == t_norm
    return (cell or '').strip().upper() == (target or '').strip().upper()


def _read_sheet_grid(service, spreadsheet_id: str, sheet_name: str) -> Optional[List[List[Any]]]:
    escaped = escape_sheet_name(sheet_name)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{escaped}!A:ZZ',
        ).execute()
        return result.get('values') or []
    except HttpError as e:
        print(f'lookup: failed to read sheet {sheet_name!r}: {e}')
        return None


def column_index_for_header(headers: List[Any], header_name: str) -> Optional[int]:
    """First column index whose header matches after strip (Google cells often have stray spaces)."""
    want = (header_name or '').strip()
    for idx, h in enumerate(headers):
        if h is not None and str(h).strip() == want:
            return idx
    return None


def find_rows_by_lookup(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    list_sheets_func,
    *,
    primary_id: Optional[str] = None,
    biology_id: Optional[str] = None,
    name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Return matches as dicts: row_index (1-based), primary_id, id (biology), name.
    """
    available = list_sheets_func()
    if sheet_name not in available:
        return []

    values = _read_sheet_grid(service, spreadsheet_id, sheet_name)
    if not values or len(values) < 2:
        return []

    headers = values[0]

    def col(header: str) -> Optional[int]:
        return column_index_for_header(headers, header)

    idx_primary = col('Primary ID')
    idx_id = col('ID')
    idx_name = col('Name')

    matches: List[Dict[str, Any]] = []

    if primary_id:
        pid = primary_id.strip()
        if not pid:
            return []
        for row_idx, row in enumerate(values[1:], start=2):
            if idx_primary is not None and len(row) > idx_primary and (row[idx_primary] or '').strip() == pid:
                matches.append(_row_match(row_idx, row, idx_primary, idx_id, idx_name))
                break
            if idx_id is not None and len(row) > idx_id and (row[idx_id] or '').strip() == pid:
                matches.append(_row_match(row_idx, row, idx_primary, idx_id, idx_name))
                break
        return matches

    if biology_id:
        bid = biology_id.strip()
        if not bid or idx_id is None:
            return []
        for row_idx, row in enumerate(values[1:], start=2):
            if len(row) <= idx_id:
                continue
            cell = row[idx_id] or ''
            if biology_ids_match(str(cell), bid):
                matches.append(_row_match(row_idx, row, idx_primary, idx_id, idx_name))
        return matches

    if name:
        n = name.strip()
        if not n or idx_name is None:
            return []
        n_lower = n.lower()
        for row_idx, row in enumerate(values[1:], start=2):
            if len(row) <= idx_name:
                continue
            cell = (row[idx_name] or '').strip()
            if cell.lower() == n_lower:
                matches.append(_row_match(row_idx, row, idx_primary, idx_id, idx_name))
        return matches

    return []


def _row_match(
    row_idx: int,
    row: List[Any],
    idx_primary: Optional[int],
    idx_id: Optional[int],
    idx_name: Optional[int],
) -> Dict[str, Any]:
    def cell(i: Optional[int]) -> str:
        if i is None or i >= len(row):
            return ''
        return str(row[i]).strip() if row[i] is not None else ''

    return {
        'row_index': row_idx,
        'primary_id': cell(idx_primary),
        'id': cell(idx_id),
        'name': cell(idx_name),
    }


def deceased_value_for_sheet(deceased_bool: bool) -> str:
    return 'Yes' if deceased_bool else 'No'


# API field name -> exact Google Sheets header (must match COLUMN_MAPPING keys)
LOOKUP_FIELD_TO_HEADER = {
    'primary_id': 'Primary ID',
    'biology_id': 'ID',
    'name': 'Name',
}

# Safety cap (very large sheets)
_MAX_LOOKUP_OPTIONS = 20000


def unique_non_empty_column_values(
    grid: List[List[Any]],
    header_name: str,
    max_values: int = _MAX_LOOKUP_OPTIONS,
) -> List[str]:
    """
    From a sheet grid (row 0 = headers), return unique non-empty strings in column header_name,
    preserving first-seen casing, sorted case-insensitively.
    """
    if not grid or len(grid) < 2:
        return []
    headers = grid[0]
    col_idx = column_index_for_header(headers, header_name)
    if col_idx is None:
        return []

    seen = set()
    out: List[str] = []
    for row in grid[1:]:
        if len(row) <= col_idx:
            continue
        raw = row[col_idx]
        if raw is None:
            continue
        s = str(raw).strip()
        if not s:
            continue
        key = s.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_values:
            break

    out.sort(key=lambda x: x.casefold())
    return out


def list_unique_column_values(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    list_sheets_func,
    field: str,
) -> List[str]:
    """
    Unique non-empty cell values from one column (data rows only), sorted case-insensitively.
    field: primary_id | biology_id | name
    """
    if field not in LOOKUP_FIELD_TO_HEADER:
        return []

    available = list_sheets_func()
    if sheet_name not in available:
        return []

    values = _read_sheet_grid(service, spreadsheet_id, sheet_name)
    if not values:
        return []

    return unique_non_empty_column_values(values, LOOKUP_FIELD_TO_HEADER[field])
