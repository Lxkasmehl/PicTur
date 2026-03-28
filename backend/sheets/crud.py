"""
CRUD operations for Google Sheets turtle data
"""

from typing import Dict, List, Optional, Any
from googleapiclient.errors import HttpError
from .helpers import escape_sheet_name, get_sheet_name_for_region
from .columns import COLUMN_MAPPING


def get_turtle_data(service, spreadsheet_id: str, primary_id: str, sheet_name: str, 
                   state: Optional[str] = None, location: Optional[str] = None,
                   ensure_primary_id_column_func=None, find_row_by_primary_id_func=None,
                   get_all_column_indices_func=None) -> Optional[Dict[str, Any]]:
    """
    Get turtle data from Google Sheets by primary ID.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        primary_id: Primary ID of the turtle
        sheet_name: Name of the sheet (tab) to search in (e.g., "Location A", "Location B")
        state: Optional state name (for backwards compatibility)
        location: Optional specific location (for backwards compatibility)
        ensure_primary_id_column_func: Function to ensure Primary ID column exists
        find_row_by_primary_id_func: Function to find row by primary ID
        get_all_column_indices_func: Function to get all column indices
        
    Returns:
        Dictionary with turtle data or None if not found
    """
    # Validate sheet_name before processing
    if not sheet_name or not sheet_name.strip():
        print(f"ERROR in get_turtle_data: sheet_name is empty! primary_id={primary_id}, state={state}, location={location}")
        raise ValueError("sheet_name must be provided and cannot be empty")
    
    sheet_name = get_sheet_name_for_region(sheet_name=sheet_name, state=state, location=location)
    
    try:
        # Ensure Primary ID column exists
        ensure_primary_id_column_func(sheet_name)
        
        # Find the row using Primary ID column first, then fall back to ID column
        # (biology ID like F001/M1). This handles the case where the AI match
        # system passes a folder name (biology ID) instead of the actual Primary ID.
        row_idx = find_row_by_primary_id_func(sheet_name, primary_id, 'Primary ID')
        if not row_idx:
            row_idx = find_row_by_primary_id_func(sheet_name, primary_id, 'ID')
        if not row_idx:
            return None
        
        # Get column indices
        column_indices = get_all_column_indices_func(sheet_name)
        
        # Get the row data
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!{row_idx}:{row_idx}"
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            return None
        
        row_data = values[0]
        
        # Map row data to field names
        turtle_data = {}
        for header, col_idx in column_indices.items():
            if header in COLUMN_MAPPING:
                field_name = COLUMN_MAPPING[header]
                value = row_data[col_idx] if col_idx < len(row_data) else ''
                turtle_data[field_name] = value.strip() if value else ''
        
        # Use the actual Primary ID from the row data if available (the caller may
        # have passed a biology ID like F001 which found the row via the ID column).
        turtle_data['primary_id'] = turtle_data.get('primary_id') or primary_id
        turtle_data['sheet_name'] = sheet_name
        turtle_data['row_index'] = row_idx
        
        return turtle_data
    except HttpError as e:
        print(f"Error getting turtle data: {e}")
        return None


def create_turtle_data(service, spreadsheet_id: str, turtle_data: Dict[str, Any], sheet_name: str,
                      state: Optional[str] = None, location: Optional[str] = None,
                      ensure_primary_id_column_func=None, get_all_column_indices_func=None) -> Optional[str]:
    """
    Create a new turtle entry in Google Sheets.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        turtle_data: Dictionary with turtle data (using internal field names)
        sheet_name: Name of the sheet (tab) to create in (e.g., "Location A", "Location B")
        state: Optional state name (for backwards compatibility)
        location: Optional specific location (for backwards compatibility)
        ensure_primary_id_column_func: Function to ensure Primary ID column exists
        get_all_column_indices_func: Function to get all column indices
        
    Returns:
        Primary ID of the created turtle or None if failed
    """
    # Validate sheet_name before processing
    if not sheet_name or not sheet_name.strip():
        print(f"ERROR in create_turtle_data: sheet_name is empty! state={state}, location={location}, turtle_data keys={list(turtle_data.keys())}")
        raise ValueError("sheet_name must be provided and cannot be empty")
    
    sheet_name = get_sheet_name_for_region(sheet_name=sheet_name, state=state, location=location)
    
    try:
        # Ensure Primary ID column exists (do not insert when headers unreadable to avoid duplicate columns)
        if not ensure_primary_id_column_func(sheet_name):
            print(f"ERROR in create_turtle_data: Could not ensure Primary ID column for sheet '{sheet_name}'")
            return None
        
        # Get column indices
        column_indices = get_all_column_indices_func(sheet_name)
        if not column_indices:
            print(f"ERROR in create_turtle_data: No column headers for sheet '{sheet_name}'")
            return None
        
        # Get the next available row (find last row with data)
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!A:A"
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        next_row = len(values) + 1 if values else 2  # Start at row 2 (row 1 is headers)
        
        # Build the row data
        # First, get the maximum column index we need
        max_col_idx = max(column_indices.values()) if column_indices else 0
        
        # Create a list with empty strings for all columns
        row_data = [''] * (max_col_idx + 1)
        
        # Fill in the data
        for header, col_idx in column_indices.items():
            if header in COLUMN_MAPPING:
                field_name = COLUMN_MAPPING[header]
                if field_name in turtle_data:
                    row_data[col_idx] = str(turtle_data[field_name])
        
        # Ensure Primary ID is written (it's required)
        primary_id = turtle_data.get('primary_id') or turtle_data.get('id')
        if primary_id and 'Primary ID' in column_indices:
            primary_id_col_idx = column_indices['Primary ID']
            # Extend row_data if necessary
            while len(row_data) <= primary_id_col_idx:
                row_data.append('')
            row_data[primary_id_col_idx] = str(primary_id)
        
        # Write the row
        range_name = f"{escaped_sheet}!{next_row}:{next_row}"
        body = {
            'values': [row_data]
        }
        
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            body=body
        ).execute()
        
        # Return the primary ID
        return primary_id
    except HttpError as e:
        print(f"Error creating turtle data: {e}")
        return None


def update_turtle_data(service, spreadsheet_id: str, primary_id: str, turtle_data: Dict[str, Any], sheet_name: str,
                      state: Optional[str] = None, location: Optional[str] = None,
                      ensure_primary_id_column_func=None, find_row_by_primary_id_func=None,
                      get_all_column_indices_func=None) -> bool:
    """
    Update existing turtle data in Google Sheets.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        primary_id: Primary ID of the turtle to update
        turtle_data: Dictionary with updated turtle data (using internal field names)
        sheet_name: Name of the sheet (tab) to update in (e.g., "Location A", "Location B")
        state: Optional state name (for backwards compatibility)
        location: Optional specific location (for backwards compatibility)
        ensure_primary_id_column_func: Function to ensure Primary ID column exists
        find_row_by_primary_id_func: Function to find row by primary ID
        get_all_column_indices_func: Function to get all column indices
        
    Returns:
        True if successful, False otherwise
    """
    # Validate sheet_name before processing
    if not sheet_name or not sheet_name.strip():
        print(f"ERROR in update_turtle_data: sheet_name is empty! primary_id={primary_id}, state={state}, location={location}, turtle_data keys={list(turtle_data.keys())}")
        raise ValueError("sheet_name must be provided and cannot be empty")
    
    sheet_name = get_sheet_name_for_region(sheet_name=sheet_name, state=state, location=location)
    
    try:
        # Ensure Primary ID column exists
        ensure_primary_id_column_func(sheet_name)
        
        # Find the row
        row_idx = find_row_by_primary_id_func(sheet_name, primary_id)
        if not row_idx:
            return False
        
        # Get column indices
        column_indices = get_all_column_indices_func(sheet_name)
        
        # Get current row data
        escaped_sheet = escape_sheet_name(sheet_name)
        range_name = f"{escaped_sheet}!{row_idx}:{row_idx}"
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            return False
        
        row_data = list(values[0])
        
        # Update the row data
        for header, col_idx in column_indices.items():
            if header in COLUMN_MAPPING:
                field_name = COLUMN_MAPPING[header]
                if field_name in turtle_data:
                    # Extend row_data if necessary
                    while len(row_data) <= col_idx:
                        row_data.append('')
                    row_data[col_idx] = str(turtle_data[field_name])
        
        # Ensure Primary ID is updated (it's required and must match)
        if 'Primary ID' in column_indices:
            primary_id_col_idx = column_indices['Primary ID']
            while len(row_data) <= primary_id_col_idx:
                row_data.append('')
            row_data[primary_id_col_idx] = str(primary_id)
        
        # Write the updated row
        range_name = f"{escaped_sheet}!{row_idx}:{row_idx}"
        body = {
            'values': [row_data]
        }
        
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption='RAW',
            body=body
        ).execute()
        
        return True
    except HttpError as e:
        print(f"Error updating turtle data: {e}")
        return False


def delete_turtle_data(service, spreadsheet_id: str, primary_id: str, sheet_name: str,
                      find_row_by_primary_id_func=None) -> bool:
    """
    Delete turtle data from Google Sheets by removing the entire row.
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        primary_id: Primary ID of the turtle to delete
        sheet_name: Name of the sheet (tab) to delete from
        find_row_by_primary_id_func: Function to find row by primary ID
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Find the row
        row_idx = find_row_by_primary_id_func(sheet_name, primary_id, 'Primary ID')
        if not row_idx:
            print(f"Warning: Turtle with Primary ID '{primary_id}' not found in sheet '{sheet_name}'")
            return False
        
        # Get sheet ID for batchUpdate
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
        
        # Delete the row using batchUpdate
        requests = [{
            'deleteDimension': {
                'range': {
                    'sheetId': sheet_id,
                    'dimension': 'ROWS',
                    'startIndex': row_idx - 1,  # Convert to 0-based
                    'endIndex': row_idx  # End index is exclusive
                }
            }
        }]
        
        body = {'requests': requests}
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ).execute()
        
        print(f"✅ Deleted turtle with Primary ID '{primary_id}' from sheet '{sheet_name}' (row {row_idx})")
        return True
        
    except HttpError as e:
        print(f"Error deleting turtle data: {e}")
        return False
    except Exception as e:
        print(f"Error deleting turtle data: {e}")
        return False


def find_turtle_sheet(service, spreadsheet_id: str, primary_id: str, list_sheets_func=None,
                     find_row_by_primary_id_func=None) -> Optional[str]:
    """
    Find which sheet contains a turtle with the given primary ID.
    Searches all sheets (except backup sheets).
    
    Args:
        service: Google Sheets API service object
        spreadsheet_id: Google Sheets spreadsheet ID
        primary_id: Primary ID to search for
        list_sheets_func: Function to list all sheets
        find_row_by_primary_id_func: Function to find row by primary ID
        
    Returns:
        Sheet name if found, None otherwise
    """
    try:
        all_sheets = list_sheets_func()  # Already excludes backup sheets
        # Search by Primary ID column first
        for sheet_name in all_sheets:
            row_idx = find_row_by_primary_id_func(sheet_name, primary_id, 'Primary ID')
            if row_idx:
                return sheet_name
        # Fallback: search by biology ID column (folder name like F001/M1)
        for sheet_name in all_sheets:
            row_idx = find_row_by_primary_id_func(sheet_name, primary_id, 'ID')
            if row_idx:
                return sheet_name
        return None
    except Exception as e:
        print(f"Error finding turtle sheet: {e}")
        return None
