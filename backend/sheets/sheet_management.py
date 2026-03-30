"""
Sheet management functions for Google Sheets
"""

from typing import Optional, Dict, List
from googleapiclient.errors import HttpError
import ssl
import time
from .helpers import escape_sheet_name, is_backup_sheet
from general_locations_catalog import get_general_location_options_for_sheet

GENERAL_LOCATION_VALIDATION_START_ROW = 1  # Row 2 in Sheets UI
GENERAL_LOCATION_VALIDATION_END_ROW = 100000


def _sheets_v4_client_and_id(service_or_wrapper):
    """
    Return (raw googleapiclient sheets v4 resource, spreadsheet_id).

    Routes pass GoogleSheetsService, which stores the discovery client on .service
    and the id on .spreadsheet_id. Other functions in this module use the raw client.
    """
    api = getattr(service_or_wrapper, 'service', None)
    spreadsheet_id = getattr(service_or_wrapper, 'spreadsheet_id', None)
    if api is not None and spreadsheet_id:
        return api, spreadsheet_id
    return None, None


def _get_sheet_id(service, spreadsheet_id: str, sheet_name: str) -> Optional[int]:
    """Return the sheet ID for a tab name."""
    spreadsheet = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    for sheet in spreadsheet.get('sheets', []):
        if sheet.get('properties', {}).get('title') == sheet_name:
            return sheet.get('properties', {}).get('sheetId')
    return None


def _get_general_location_column_index(service, spreadsheet_id: str, sheet_name: str) -> Optional[int]:
    """Return the zero-based column index for the General Location column."""
    try:
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!1:1"
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name,
        ).execute()
        values = result.get('values', [])
        if not values:
            return None
        headers = values[0]
        for idx, header in enumerate(headers):
            h = ' '.join((header or '').strip().split())
            if h.casefold() == 'general location':
                return idx
    except Exception:
        return None
    return None


def _build_general_location_validation_values(sheet_name: str) -> List[str]:
    """Return the dropdown values for General Location, including blank."""
    options = get_general_location_options_for_sheet(sheet_name)
    locations = list(options.get('locations', []))
    values = ['']
    for location in locations:
        if location not in values:
            values.append(location)
    return values


def _apply_general_location_validation(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    sheet_id: Optional[int] = None,
    column_index: Optional[int] = None,
) -> bool:
    """Apply the General Location data validation to a sheet tab."""
    if is_backup_sheet(sheet_name):
        return False

    try:
        if sheet_id is None:
            sheet_id = _get_sheet_id(service, spreadsheet_id, sheet_name)
        if sheet_id is None:
            print(f"WARNING: Could not determine sheet ID for '{sheet_name}' when applying General Location validation")
            return False
        if column_index is None:
            column_index = _get_general_location_column_index(service, spreadsheet_id, sheet_name)
        if column_index is None:
            print(f"WARNING: Could not determine General Location column for '{sheet_name}'")
            return False

        values = _build_general_location_validation_values(sheet_name)
        if not values:
            return False

        requests = [{
            'setDataValidation': {
                'range': {
                    'sheetId': sheet_id,
                    'startRowIndex': GENERAL_LOCATION_VALIDATION_START_ROW,
                    'endRowIndex': GENERAL_LOCATION_VALIDATION_END_ROW,
                    'startColumnIndex': column_index,
                    'endColumnIndex': column_index + 1,
                },
                'rule': {
                    'condition': {
                        'type': 'ONE_OF_LIST',
                        'values': [{'userEnteredValue': value} for value in values],
                    },
                    'showCustomUi': True,
                    'strict': True,
                },
            }
        }]
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': requests},
        ).execute()
        return True
    except HttpError as e:
        print(f"Error applying General Location validation for '{sheet_name}': {e}")
        return False
    except Exception as e:
        print(f"Error applying General Location validation for '{sheet_name}': {e}")
        return False


def sync_general_location_validations(service, sheet_names: Optional[List[str]] = None) -> int:
    """Sync General Location dropdown validation across one or more sheets."""
    api, spreadsheet_id = _sheets_v4_client_and_id(service)
    if api is None or not spreadsheet_id:
        print(
            'ERROR: sync_general_location_validations requires GoogleSheetsService '
            '(with .service and .spreadsheet_id)'
        )
        return 0

    if sheet_names is None:
        try:
            sheet_names = service.list_sheets()
        except Exception:
            sheet_names = []

    processed = 0
    try:
        spreadsheet = api.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        title_to_id = {
            sheet.get('properties', {}).get('title'): sheet.get('properties', {}).get('sheetId')
            for sheet in spreadsheet.get('sheets', [])
        }
        for sheet_name in sheet_names:
            if not sheet_name or is_backup_sheet(sheet_name):
                continue
            sheet_id = title_to_id.get(sheet_name)
            if sheet_id is None:
                continue
            if _apply_general_location_validation(api, spreadsheet_id, sheet_name, sheet_id):
                processed += 1
    except Exception as e:
        print(f"Error syncing General Location validation: {e}")
    return processed


def ensure_primary_id_column(service, spreadsheet_id: str, sheet_name: str, get_all_column_indices_func,
                             invalidate_column_indices_cache_func=None) -> bool:
    """
    Ensure the "Primary ID" column exists in the sheet.
    If it doesn't exist, adds it as the first column.
    Skips backup sheets.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        sheet_name: Name of the sheet (tab)
        get_all_column_indices_func: Function to get all column indices
        invalidate_column_indices_cache_func: Optional callback(sheet_name) to invalidate column cache after insert
        
    Returns:
        True if column exists or was created, False otherwise
    """
    # Skip backup sheets - they should not be modified
    if is_backup_sheet(sheet_name):
        return False  # Don't try to modify backup sheets
    
    try:
        column_indices = get_all_column_indices_func(sheet_name)
        # Retry once on empty read (transient API/list_sheets cache issues when adding to new sheet)
        if not column_indices:
            time.sleep(0.5)
            column_indices = get_all_column_indices_func(sheet_name)
        # If we still couldn't read headers, do NOT insert to avoid duplicating "Primary ID" columns.
        if not column_indices:
            print(f"WARNING: Could not read column headers for sheet '{sheet_name}' (empty or API error). "
                  "Skipping Primary ID column insert to avoid duplicating columns.")
            return False
        
        # Check if Primary ID column already exists
        if 'Primary ID' in column_indices:
            return True
        
        # Primary ID column doesn't exist - we need to add it (sheet has other headers but no Primary ID)
        print(f"WARNING: 'Primary ID' column not found in sheet '{sheet_name}'. "
              f"Please add a 'Primary ID' column to the sheet. Available columns: {list(column_indices.keys())}")
        
        # Try to add it using batchUpdate
        try:
            # Get sheet ID
            spreadsheet = service.spreadsheets().get(
                spreadsheetId=spreadsheet_id
            ).execute()
            
            sheet_id = None
            for sheet in spreadsheet.get('sheets', []):
                if sheet['properties']['title'] == sheet_name:
                    sheet_id = sheet['properties']['sheetId']
                    break
            
            if sheet_id is None:
                print(f"ERROR: Could not find sheet '{sheet_name}'")
                return False
            
            # Insert a new column at position 0 (before column A)
            requests = [{
                'insertDimension': {
                    'range': {
                        'sheetId': sheet_id,
                        'dimension': 'COLUMNS',
                        'startIndex': 0,
                        'endIndex': 1
                    }
                }
            }]
            
            body = {'requests': requests}
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body=body
            ).execute()
            
            # Now add the header "Primary ID" to cell A1
            escaped_sheet = escape_sheet_name(sheet_name)
            range_name = f"{escaped_sheet}!A1"
            body = {
                'values': [['Primary ID']]
            }
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption='RAW',
                body=body
            ).execute()
            if invalidate_column_indices_cache_func:
                invalidate_column_indices_cache_func(sheet_name)
            print(f"✅ Created 'Primary ID' column in sheet '{sheet_name}'")
            return True
            
        except Exception as e:
            print(f"ERROR: Could not automatically create 'Primary ID' column: {e}")
            print(f"Please manually add a 'Primary ID' column to sheet '{sheet_name}'")
            return False
            
    except Exception as e:
        print(f"Error ensuring Primary ID column: {e}")
        return False


def find_row_by_primary_id(service, spreadsheet_id: str, sheet_name: str, primary_id: str, id_column: str, list_sheets_func) -> Optional[int]:
    """
    Find the row index (1-based) for a turtle with a given primary ID.
    Searches in the "Primary ID" column (not the "ID" column).
    Skips backup sheets.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        sheet_name: Name of the sheet (tab)
        primary_id: Primary ID to search for
        id_column: Column header for the Primary ID column (default: 'Primary ID')
        list_sheets_func: Function to list available sheets
        
    Returns:
        Row index (1-based) or None if not found
    """
    # Skip backup sheets - they should not be accessed
    if is_backup_sheet(sheet_name):
        return None
    
    try:
        # First, verify the sheet exists
        available_sheets = list_sheets_func()
        if sheet_name not in available_sheets:
            print(f"Warning: Sheet '{sheet_name}' not found. Available sheets: {available_sheets}")
            return None
        
        # Get all values in the sheet
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!A:Z"  # Adjust range as needed
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values or len(values) < 2:
            return None
        
        # Find Primary ID column index
        headers = values[0]
        try:
            id_col_idx = headers.index(id_column)
        except ValueError:
            # Primary ID column doesn't exist - try to find in "ID" column as fallback
            print(f"Warning: Column '{id_column}' not found in sheet '{sheet_name}'. Trying 'ID' column as fallback. Available columns: {headers}")
            try:
                id_col_idx = headers.index('ID')
                # Found ID column - search there as fallback
                print(f"Found 'ID' column at index {id_col_idx}, searching there (migration recommended)")
            except ValueError:
                print(f"Error: Neither 'Primary ID' nor 'ID' column found in sheet '{sheet_name}'")
                return None
        
        # Search for the primary ID (starting from row 2, index 1)
        for row_idx, row in enumerate(values[1:], start=2):
            if len(row) > id_col_idx and row[id_col_idx] == primary_id:
                return row_idx
        
        return None
    except HttpError as e:
        print(f"Error finding row by primary ID in sheet '{sheet_name}': {e}")
        # Try to list available sheets for debugging
        try:
            available_sheets = list_sheets_func()
            print(f"Available sheets: {available_sheets}")
        except:
            pass
        return None


def list_sheets(service, spreadsheet_id: str, reinitialize_service_func, max_retries: int = 2) -> list:
    """
    List all available sheets (tabs) in the spreadsheet.
    Excludes "Backup (Initial State)" sheet as it's read-only backup.
    Includes retry logic for SSL connection issues.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        reinitialize_service_func: Function to reinitialize the service
        max_retries: Maximum number of retry attempts
        
    Returns:
        List of sheet names (excluding backup sheets)
    """
    for attempt in range(max_retries):
        try:
            if service is None:
                print("Error: Google Sheets service not initialized")
                return []
            
            spreadsheet = service.spreadsheets().get(
                spreadsheetId=spreadsheet_id
            ).execute()
            
            sheets = spreadsheet.get('sheets', [])
            all_sheets = [sheet['properties']['title'] for sheet in sheets]
            
            # Exclude backup sheets (note: "Inital" is a typo in the actual sheet name)
            backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
            filtered_sheets = [s for s in all_sheets if s not in backup_sheet_names]
            
            return filtered_sheets
        except HttpError as e:
            print(f"Error listing sheets (HttpError): {e}")
            if attempt < max_retries - 1:
                print(f"Retrying... (attempt {attempt + 1}/{max_retries})")
                try:
                    reinitialize_service_func()
                    import time
                    time.sleep(1.0)  # Allow new connection to settle before retry
                    continue
                except:
                    pass
            import traceback
            traceback.print_exc()
            return []
        except (ssl.SSLError, AttributeError) as e:
            # SSL errors or connection issues - try reinitializing
            error_msg = str(e)
            if 'SSL' in error_msg or 'BIO' in error_msg or 'NoneType' in error_msg:
                print(f"SSL/Connection error listing sheets: {e}")
                if attempt < max_retries - 1:
                    print(f"Reinitializing service and retrying... (attempt {attempt + 1}/{max_retries})")
                    try:
                        reinitialize_service_func()
                        import time
                        time.sleep(1.0)  # Allow new connection to settle before retry
                        continue
                    except Exception as reinit_error:
                        print(f"Failed to reinitialize: {reinit_error}")
                else:
                    # Only print traceback on final failure
                    print(f"⚠️ Failed to list sheets after {max_retries} attempts")
                    return []
            else:
                raise
        except Exception as e:
            error_msg = str(e)
            if 'SSL' in error_msg or 'BIO' in error_msg or 'NoneType' in error_msg or 'read' in error_msg:
                # Treat as SSL/connection error
                print(f"Connection error listing sheets: {e}")
                if attempt < max_retries - 1:
                    print(f"Reinitializing service and retrying... (attempt {attempt + 1}/{max_retries})")
                    try:
                        reinitialize_service_func()
                        import time
                        time.sleep(1.0)  # Allow new connection to settle before retry
                        continue
                    except Exception as reinit_error:
                        print(f"Failed to reinitialize: {reinit_error}")
                else:
                    # Only print traceback on final failure
                    print(f"⚠️ Failed to list sheets after {max_retries} attempts")
                    return []
            else:
                print(f"Error listing sheets (Exception): {e}")
                # Only print traceback for unexpected errors
                if attempt >= max_retries - 1:
                    import traceback
                    traceback.print_exc()
                return []
    
    # If we get here, all retries failed
    return []


def create_sheet_with_headers(service, spreadsheet_id: str, sheet_name: str, column_mapping: Dict[str, str], list_sheets_func) -> bool:
    """
    Create a new sheet (tab) with all required headers.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        sheet_name: Name of the new sheet to create
        column_mapping: Dictionary mapping column headers to field names
        list_sheets_func: Function to list available sheets
        
    Returns:
        True if successful, False otherwise
    """
    # Skip backup sheets - they should not be created
    if is_backup_sheet(sheet_name):
        print(f"ERROR: Cannot create backup sheet '{sheet_name}'")
        return False
    
    try:
        # Check if sheet already exists
        existing_sheets = list_sheets_func()
        if sheet_name in existing_sheets:
            print(f"Sheet '{sheet_name}' already exists")
            return True  # Sheet exists, that's fine
        
        # Get all column headers from COLUMN_MAPPING
        headers = list(column_mapping.keys())
        
        # Create the new sheet
        requests = [{
            'addSheet': {
                'properties': {
                    'title': sheet_name
                }
            }
        }]
        
        body = {'requests': requests}
        response = service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ).execute()
        
        # Get the new sheet ID
        sheet_id = None
        for reply in response.get('replies', []):
            if 'addSheet' in reply:
                sheet_id = reply['addSheet']['properties']['sheetId']
                break
        
        if sheet_id is None:
            print(f"ERROR: Could not get sheet ID for new sheet '{sheet_name}'")
            return False
        
        # Write headers to row 1
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!1:1"
        body = {
            'values': [headers]
        }
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            body=body
        ).execute()

        general_location_idx = headers.index('General Location') if 'General Location' in headers else None
        _apply_general_location_validation(service, spreadsheet_id, sheet_name, sheet_id, general_location_idx)
        
        print(f"✅ Created new sheet '{sheet_name}' with {len(headers)} headers")
        return True
        
    except HttpError as e:
        print(f"Error creating sheet '{sheet_name}': {e}")
        return False
    except Exception as e:
        print(f"Error creating sheet '{sheet_name}': {e}")
        import traceback
        traceback.print_exc()
        return False
