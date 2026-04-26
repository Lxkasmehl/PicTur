"""
Google Sheets row styling (e.g. deceased turtles).
"""

from typing import Optional

from googleapiclient.errors import HttpError

from .helpers import escape_sheet_name


def is_deceased_yes(value: Optional[str]) -> bool:
    """Treat common truthy sheet values as deceased."""
    if value is None:
        return False
    s = str(value).strip().lower()
    return s in ('yes', 'y', 'true', '1', 'deceased', 'dead')


def _sheet_numeric_id(service, spreadsheet_id: str, sheet_name: str) -> Optional[int]:
    try:
        spreadsheet = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        for sheet in spreadsheet.get('sheets', []):
            if sheet.get('properties', {}).get('title') == sheet_name:
                return sheet.get('properties', {}).get('sheetId')
    except HttpError:
        pass
    return None


def _header_column_count(service, spreadsheet_id: str, sheet_name: str) -> int:
    escaped = escape_sheet_name(sheet_name)
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{escaped}!1:1',
        ).execute()
        row = (result.get('values') or [[]])[0]
        return max(len(row), 1)
    except HttpError:
        return 26


def apply_deceased_row_background(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    row_1based: int,
    deceased: bool,
) -> bool:
    """
    Set or clear a light gray background for the entire data row (row_1based, 1 = header).
    """
    if row_1based < 2:
        return False
    sheet_id = _sheet_numeric_id(service, spreadsheet_id, sheet_name)
    if sheet_id is None:
        return False
    num_cols = _header_column_count(service, spreadsheet_id, sheet_name)
    start_row = row_1based - 1
    end_row = row_1based

    if deceased:
        bg = {'red': 0.88, 'green': 0.88, 'blue': 0.88}
    else:
        bg = {'red': 1.0, 'green': 1.0, 'blue': 1.0}

    body = {
        'requests': [
            {
                'repeatCell': {
                    'range': {
                        'sheetId': sheet_id,
                        'startRowIndex': start_row,
                        'endRowIndex': end_row,
                        'startColumnIndex': 0,
                        'endColumnIndex': num_cols,
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': bg,
                        }
                    },
                    'fields': 'userEnteredFormat.backgroundColor',
                }
            }
        ]
    }
    try:
        service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
        return True
    except HttpError as e:
        print(f'apply_deceased_row_background failed: {e}')
        return False
