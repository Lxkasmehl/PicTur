"""
Migration functions for Google Sheets
"""

import re
import time
import random
from typing import Dict, Optional, Tuple
from googleapiclient.errors import HttpError
from .helpers import escape_sheet_name, column_index_to_letter
from .sheet_management import ensure_primary_id_column

# Biology ID: one letter + digits (e.g. F1, F001). Legacy: Null.1, F.26
BIOLOGY_ID_PATTERN = re.compile(r'^[A-Za-z](\d+)$')
_NULL_BIOLOGY_PATTERN = re.compile(r'(?i)^null[.\s]*(\d+)$')
_LETTER_DOT_DIGITS_PATTERN = re.compile(r'(?i)^([mfju])[.\s]+(\d+)$')
# Any M/F/J/U + digits in the cell (handles "J666 (UT1 …)", notes like "duplicate with M542", "F46/F74")
_MFJU_EMBEDDED_PATTERN = re.compile(r'(?i)\b([MFJU])(\d+)\b')


def _parse_biology_id_parts_exact_cell(cell: str) -> Optional[Tuple[str, int]]:
    """Parse when the cell is only a biology ID (or legacy Null / F.26 forms), no trailing notes."""
    c = (cell or '').strip()
    if not c:
        return None
    m = BIOLOGY_ID_PATTERN.match(c)
    if m:
        letter = c[0].upper()
        if letter not in ('M', 'F', 'J', 'U'):
            letter = 'U'
        return letter, int(m.group(1))
    m = _NULL_BIOLOGY_PATTERN.match(c)
    if m:
        return 'U', int(m.group(1))
    m = _LETTER_DOT_DIGITS_PATTERN.match(c)
    if m:
        return m.group(1).upper(), int(m.group(2))
    return None


def _parse_biology_id_parts(cell: str) -> Optional[Tuple[str, int]]:
    """Return (M/F/J/U, sequence number) if cell looks like a biology ID, else None."""
    c = (cell or '').strip()
    if not c:
        return None
    exact = _parse_biology_id_parts_exact_cell(c)
    if exact:
        return exact
    # Sheet often has free text after the ID, e.g. "M637 (UT 713 7/16/25)" or "J666 (UT1 4/13/2026)".
    m = re.match(r'(?i)^\s*([MFJU])(\d+)\b', c)
    if m:
        return m.group(1).upper(), int(m.group(2))
    return None


def normalize_biology_id_display(cell: str) -> str:
    """
    Canonical form: one of MFJU + three-digit sequence (F001, M026).
    Unrecognized values are returned stripped unchanged.
    """
    parsed = _parse_biology_id_parts(cell)
    if not parsed:
        return (cell or '').strip()
    letter, num = parsed
    return f'{letter}{num:03d}'


def _biology_id_sequence_number(cell: str) -> Optional[int]:
    """
    Highest numeric suffix in this cell for max-ID scan (shared sequence across M/F/J/U in a tab).
    Includes every MFJU+digits token (so annotated IDs and "F46/F74" both contribute the right max).
    """
    c = (cell or '').strip()
    if not c:
        return None
    nums: list[int] = []
    for m in _MFJU_EMBEDDED_PATTERN.finditer(c):
        nums.append(int(m.group(2)))
    exact = _parse_biology_id_parts_exact_cell(c)
    if exact:
        nums.append(exact[1])
    if not nums:
        return None
    return max(nums)


def generate_primary_id(service, spreadsheet_id: str, list_sheets_func=None, find_row_by_primary_id_func=None,
                       state: Optional[str] = None, location: Optional[str] = None) -> str:
    """
    Generate a new unique primary ID for a turtle (T + timestamp + random).
    Uniqueness is ensured by timestamp and random component; no sheet scan needed.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        list_sheets_func: Function to list all sheets
        find_row_by_primary_id_func: Function to find row by primary ID
        state: State name (optional, not used for ID generation)
        location: Optional specific location (optional, not used for ID generation)
        
    Returns:
        New unique primary ID
    """
    # Generate ID from timestamp + random. No need to scan all sheets (saves many API reads
    # and avoids rate limit when adding multiple turtles). Collision probability is negligible.
    timestamp = int(time.time() * 1000)
    random_part = random.randint(10000, 99999)
    return f"T{timestamp}{random_part}"


def get_max_biology_id_number(service, spreadsheet_id: str, sheet_name: str,
                               get_all_column_indices_func=None) -> int:
    """
    Scan the biology "ID" column and return the highest numeric suffix (shared across M/F/J/U in the tab).
    Reads columns A through the ID column so rows are not dropped when the API omits sparse single-column
    ranges (same failure mode as reading only Primary ID column A for row count).
    Accepts F1/F001, F.26, Null.1 (treated as U…), IDs with trailing notes like ``J666 (UT1 …)``, etc.
    Retries on 429 (rate limit) to avoid returning 0 and causing duplicate biology IDs.

    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        sheet_name: Name of the sheet (tab) to scan
        get_all_column_indices_func: Function(sheet_name) -> dict of header -> col index

    Returns:
        The maximum number found (0 if no valid IDs).
    """
    from .helpers import SHEETS_RATE_LIMIT_RETRY_WAIT_SEC, SHEETS_RATE_LIMIT_MAX_RETRIES

    backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
    if sheet_name in backup_sheet_names:
        return 0

    try:
        column_indices = get_all_column_indices_func(sheet_name) if get_all_column_indices_func else {}
        id_col_idx = column_indices.get('ID')
        if id_col_idx is None:
            return 0

        # Do not read the ID column alone: values.get on a single column can omit rows where
        # that cell is empty even when other columns in the same row have data (same class of
        # bug as create_turtle_data with A:A only). Read from column A through the rightmost of
        # Primary ID and ID so row arrays align with column indices and high biology IDs (e.g.
        # J666) are not missing from the scan.
        primary_col_idx = column_indices.get('Primary ID')
        escaped_sheet = escape_sheet_name(sheet_name)
        prim = primary_col_idx if primary_col_idx is not None else 0
        start_idx = 0
        end_idx = max(prim, id_col_idx)
        col_start = column_index_to_letter(start_idx)
        col_end = column_index_to_letter(end_idx)
        range_name = f"{escaped_sheet}!{col_start}2:{col_end}"
        values = []
        last_error = None
        for attempt in range(SHEETS_RATE_LIMIT_MAX_RETRIES + 1):
            try:
                result = service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=range_name
                ).execute()
                values = result.get('values', [])
                break
            except HttpError as e:
                last_error = e
                status = getattr(e, 'resp', None) and getattr(e.resp, 'status', None)
                if status == 429 and attempt < SHEETS_RATE_LIMIT_MAX_RETRIES:
                    wait_sec = SHEETS_RATE_LIMIT_RETRY_WAIT_SEC * (attempt + 1)
                    print(f"Rate limit (429) reading ID column from sheet '{sheet_name}', waiting {wait_sec}s before retry ({attempt + 1}/{SHEETS_RATE_LIMIT_MAX_RETRIES})")
                    time.sleep(wait_sec)
                    continue
                print(f"Warning: Error reading ID column from sheet '{sheet_name}': {e}")
                return 0
        else:
            if last_error:
                print(f"Warning: Error reading ID column from sheet '{sheet_name}': {last_error}")
            return 0

        max_num = 0
        for row in values:
            if not row:
                continue
            if not isinstance(row, list):
                continue
            raw = row[id_col_idx] if len(row) > id_col_idx else ''
            cell = (raw or '').strip()
            if not cell:
                continue
            num = _biology_id_sequence_number(cell)
            if num is not None and num > max_num:
                max_num = num
        return max_num
    except HttpError as e:
        print(f"Warning: Error reading ID column from sheet '{sheet_name}': {e}")
        return 0
    except Exception as e:
        print(f"Warning: Error scanning sheet '{sheet_name}' for biology ID: {e}")
        return 0


def generate_biology_id(service, spreadsheet_id: str, sheet_name: str,
                       get_all_column_indices_func=None, gender: str = 'U') -> str:
    """
    Generate the next biology ID: one letter (M/F/J/U) + next sequence number.
    The number is one higher than the current maximum in the ID column of the given sheet only.

    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        sheet_name: Name of the sheet (tab) the turtle belongs to
        get_all_column_indices_func: Function(sheet_name) -> dict of header -> col index
        gender: One of 'M', 'F', 'J', 'U' (Male, Female, Juvenile, Unknown). Default 'U'.

    Returns:
        New ID string (e.g. 'M001', 'F002', 'J003', 'U004').
    """
    prefix = (gender or 'U').upper()
    if prefix not in ('M', 'F', 'J', 'U'):
        prefix = 'U'
    max_num = get_max_biology_id_number(
        service, spreadsheet_id, sheet_name, get_all_column_indices_func
    )
    next_num = max_num + 1
    return f'{prefix}{next_num:03d}'


def needs_migration(service, spreadsheet_id: str, list_sheets_func=None, ensure_primary_id_column_func=None) -> bool:
    """
    Check if migration is needed (i.e., there are turtles with ID but no Primary ID).
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        list_sheets_func: Function to list all sheets
        ensure_primary_id_column_func: Function to ensure Primary ID column exists
        
    Returns:
        True if migration is needed, False otherwise
    """
    try:
        all_sheets = list_sheets_func()
        if not all_sheets:
            return False  # No sheets available, nothing to migrate
        
        # Note: "Inital" is a typo in the actual sheet name
        backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
        sheets_to_check = [s for s in all_sheets if s not in backup_sheet_names]
        
        for sheet_name in sheets_to_check:
            try:
                # Ensure Primary ID column exists
                ensure_primary_id_column_func(sheet_name)
                
                # Get all rows from the sheet
                escaped_sheet = escape_sheet_name(sheet_name)
                range_name = f"{escaped_sheet}!A:ZZ"
                result = service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=range_name
                ).execute()
                
                values = result.get('values', [])
                if len(values) < 2:
                    continue  # No data rows
                
                # Get headers
                headers = values[0]
                column_indices = {}
                for idx, header in enumerate(headers):
                    if header and header.strip():
                        column_indices[header.strip()] = idx
                
                # Find Primary ID and ID column indices
                primary_id_col_idx = column_indices.get('Primary ID')
                id_col_idx = column_indices.get('ID')
                
                if primary_id_col_idx is None or id_col_idx is None:
                    continue
                
                # Check if any row has ID but no Primary ID
                for row_data in values[1:]:
                    if not row_data or len(row_data) == 0:
                        continue
                    
                    has_id = id_col_idx < len(row_data) and row_data[id_col_idx] and str(row_data[id_col_idx]).strip()
                    has_primary_id = primary_id_col_idx < len(row_data) and row_data[primary_id_col_idx] and str(row_data[primary_id_col_idx]).strip()
                    
                    if has_id and not has_primary_id:
                        return True  # Migration needed
                        
            except Exception as e:
                print(f"Warning: Error checking migration status for sheet '{sheet_name}': {e}")
                continue
        
        return False  # No migration needed
        
    except Exception as e:
        print(f"Error checking if migration is needed: {e}")
        import traceback
        traceback.print_exc()
        return False  # Assume no migration needed on error


def migrate_ids_to_primary_ids(service, spreadsheet_id: str, list_sheets_func=None,
                               ensure_primary_id_column_func=None, generate_primary_id_func=None) -> Dict[str, int]:
    """
    Migrate all turtles from using "ID" column to "Primary ID" column.
    Generates new unique Primary IDs for all turtles that don't have one.
    Uses batch updates to avoid rate limiting.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        list_sheets_func: Function to list all sheets
        ensure_primary_id_column_func: Function to ensure Primary ID column exists
        generate_primary_id_func: Function to generate a new primary ID
        
    Returns:
        Dictionary with sheet names as keys and number of migrated turtles as values
    """
    migration_stats = {}
    
    try:
        all_sheets = list_sheets_func()
        
        # Exclude backup sheets explicitly (note: "Inital" is a typo in the actual sheet name)
        backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
        sheets_to_migrate = [s for s in all_sheets if s not in backup_sheet_names]
        
        print(f"🔄 Starting migration for {len(sheets_to_migrate)} sheets (excluding backup sheets)")
        
        for sheet_name in sheets_to_migrate:
            try:
                # Ensure Primary ID column exists
                ensure_primary_id_column_func(sheet_name)
                
                # Get all rows from the sheet
                escaped_sheet = escape_sheet_name(sheet_name)
                range_name = f"{escaped_sheet}!A:ZZ"
                result = service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range=range_name
                ).execute()
                
                values = result.get('values', [])
                if len(values) < 2:
                    continue  # No data rows
                
                # Get headers
                headers = values[0]
                column_indices = {}
                for idx, header in enumerate(headers):
                    if header and header.strip():
                        column_indices[header.strip()] = idx
                
                # Find Primary ID and ID column indices
                primary_id_col_idx = column_indices.get('Primary ID')
                id_col_idx = column_indices.get('ID')
                
                if primary_id_col_idx is None:
                    print(f"Warning: 'Primary ID' column not found in sheet '{sheet_name}'")
                    continue
                
                if id_col_idx is None:
                    print(f"Info: 'ID' column not found in sheet '{sheet_name}', skipping migration")
                    continue
                
                # Collect rows that need migration (have ID but no Primary ID, OR have Primary ID but it's empty)
                rows_to_update = []
                for row_idx, row_data in enumerate(values[1:], start=2):
                    if not row_data or len(row_data) == 0:
                        continue
                    
                    # Check if row has ID but no Primary ID (or Primary ID is empty)
                    has_id = id_col_idx < len(row_data) and row_data[id_col_idx] and str(row_data[id_col_idx]).strip()
                    has_primary_id = primary_id_col_idx < len(row_data) and row_data[primary_id_col_idx] and str(row_data[primary_id_col_idx]).strip()
                    
                    # Migrate if: has ID but no Primary ID, OR Primary ID exists but is empty
                    if has_id and not has_primary_id:
                        # Generate new unique Primary ID
                        new_primary_id = generate_primary_id_func()
                        
                        # Store the row index and new Primary ID for batch update
                        rows_to_update.append((row_idx, new_primary_id))
                        print(f"  Row {row_idx}: Will migrate ID '{row_data[id_col_idx]}' -> Primary ID '{new_primary_id}'")
                
                if not rows_to_update:
                    migration_stats[sheet_name] = 0
                    continue
                
                # Batch update using batchUpdate (more efficient than individual updates)
                # Use batchUpdate with valueInputOption for multiple ranges
                data = []
                for row_idx, new_primary_id in rows_to_update:
                    # Update only the Primary ID cell for this row
                    range_name = f"{escaped_sheet}!{column_index_to_letter(primary_id_col_idx)}{row_idx}"
                    data.append({
                        'range': range_name,
                        'values': [[str(new_primary_id)]]
                    })
                
                # Split into batches of 50 to avoid too large requests
                batch_size = 50
                migrated_count = 0
                
                for i in range(0, len(data), batch_size):
                    batch = data[i:i+batch_size]
                    body = {
                        'valueInputOption': 'RAW',
                        'data': batch
                    }
                    
                    try:
                        service.spreadsheets().values().batchUpdate(
                            spreadsheetId=spreadsheet_id,
                            body=body
                        ).execute()
                        migrated_count += len(batch)
                        
                        # Small delay to avoid rate limiting
                        if i + batch_size < len(data):
                            time.sleep(1)  # Wait 1 second between batches
                            
                    except HttpError as e:
                        if e.resp.status == 429:
                            print(f"Rate limit hit for sheet '{sheet_name}', waiting 60 seconds...")
                            time.sleep(60)  # Wait 60 seconds if rate limited
                            # Retry this batch
                            try:
                                service.spreadsheets().values().batchUpdate(
                                    spreadsheetId=spreadsheet_id,
                                    body=body
                                ).execute()
                                migrated_count += len(batch)
                            except Exception as retry_error:
                                print(f"Error retrying batch update for sheet '{sheet_name}': {retry_error}")
                        else:
                            print(f"Error updating batch for sheet '{sheet_name}': {e}")
                
                migration_stats[sheet_name] = migrated_count
                print(f"✅ Migrated {migrated_count} turtles in sheet '{sheet_name}' with new unique Primary IDs")
                
            except Exception as e:
                print(f"Error migrating IDs in sheet '{sheet_name}': {e}")
                migration_stats[sheet_name] = 0
                continue
        
        return migration_stats
        
    except Exception as e:
        print(f"Error in migrate_ids_to_primary_ids: {e}")
        return migration_stats
