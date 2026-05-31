"""Bulk operations on Google Sheets turtle data."""

import time
from typing import Any, Dict, List

from googleapiclient.errors import HttpError

from .helpers import column_index_to_letter, escape_sheet_name
from .lookup import _read_sheet_grid, column_index_for_header


def find_rows_by_general_location(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    general_location: str,
) -> List[Dict[str, Any]]:
    """
    Return all data rows in sheet_name where "General Location" equals general_location
    (case-insensitive). Each result: {row_index (1-based), primary_id, id, name}.
    """
    values = _read_sheet_grid(service, spreadsheet_id, sheet_name)
    if not values or len(values) < 2:
        return []

    headers = values[0]
    idx_gl = column_index_for_header(headers, 'General Location')
    if idx_gl is None:
        return []

    idx_primary = column_index_for_header(headers, 'Primary ID')
    idx_id = column_index_for_header(headers, 'ID')
    idx_name = column_index_for_header(headers, 'Name')

    target = general_location.strip().lower()
    matches: List[Dict[str, Any]] = []

    for row_idx, row in enumerate(values[1:], start=2):
        if idx_gl >= len(row):
            continue
        cell = str(row[idx_gl] or '').strip()
        if cell.lower() != target:
            continue

        def _cell(i):
            if i is None or i >= len(row):
                return ''
            return str(row[i] or '').strip()

        matches.append({
            'row_index': row_idx,
            'primary_id': _cell(idx_primary),
            'id': _cell(idx_id),
            'name': _cell(idx_name),
        })

    return matches


def bulk_update_general_location(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    old_general_location: str,
    new_general_location: str,
) -> int:
    """
    Update the "General Location" column for all rows in sheet_name where its value
    matches old_general_location (case-insensitive). Returns the number of updated rows.
    Batches writes in groups of 50 and retries once on rate-limit (HTTP 429).
    """
    values = _read_sheet_grid(service, spreadsheet_id, sheet_name)
    if not values or len(values) < 2:
        return 0

    headers = values[0]
    idx_gl = column_index_for_header(headers, 'General Location')
    if idx_gl is None:
        return 0

    col_letter = column_index_to_letter(idx_gl)
    escaped = escape_sheet_name(sheet_name)
    target = old_general_location.strip().lower()

    update_data = []
    for row_idx, row in enumerate(values[1:], start=2):
        if idx_gl >= len(row):
            continue
        cell = str(row[idx_gl] or '').strip()
        if cell.lower() == target:
            update_data.append({
                'range': f'{escaped}!{col_letter}{row_idx}',
                'values': [[new_general_location]],
            })

    if not update_data:
        return 0

    batch_size = 50
    for i in range(0, len(update_data), batch_size):
        batch = update_data[i:i + batch_size]
        body = {'valueInputOption': 'RAW', 'data': batch}
        try:
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body=body,
            ).execute()
        except HttpError as exc:
            if exc.resp.status == 429:
                time.sleep(60)
                service.spreadsheets().values().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body=body,
                ).execute()
            else:
                raise
        if i + batch_size < len(update_data):
            time.sleep(1)

    return len(update_data)
