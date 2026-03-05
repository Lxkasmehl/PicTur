"""
Google Sheets API Service
Handles all interactions with Google Sheets for turtle data management.
"""

import os
import ssl
import threading
import time
from http.client import IncompleteRead
from typing import Dict, List, Optional, Any
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Import modules
from sheets.columns import COLUMN_MAPPING, FIELD_TO_COLUMN
from sheets import helpers
from sheets import crud
from sheets import migration
from sheets import sheet_management


class GoogleSheetsService:
    """
    Service for interacting with Google Sheets API.
    Handles authentication, reading, writing, and updating turtle data.
    """

    # Column mapping: Google Sheets column headers to internal field names
    COLUMN_MAPPING = COLUMN_MAPPING

    # Reverse mapping: internal field names to Google Sheets column headers
    FIELD_TO_COLUMN = FIELD_TO_COLUMN

    # Reentrant lock for all Google Sheets API access (avoids SSL/connection errors from concurrent use)
    LIST_SHEETS_CACHE_TTL_SEC = 30

    def __init__(self, spreadsheet_id: Optional[str] = None, credentials_path: Optional[str] = None):
        """
        Initialize Google Sheets Service.
        
        Args:
            spreadsheet_id: Google Sheets spreadsheet ID (from URL)
            credentials_path: Path to service account credentials JSON file
        """
        self.spreadsheet_id = spreadsheet_id or os.environ.get('GOOGLE_SHEETS_SPREADSHEET_ID')
        if not self.spreadsheet_id:
            raise ValueError("Google Sheets Spreadsheet ID must be provided via environment variable or parameter")
        
        # Load credentials
        credentials_file = credentials_path or os.environ.get('GOOGLE_SHEETS_CREDENTIALS_PATH')
        if not credentials_file:
            raise ValueError("Google Sheets credentials path must be provided via environment variable or parameter")
        
        if not os.path.exists(credentials_file):
            raise FileNotFoundError(f"Credentials file not found: {credentials_file}")
        
        # Reentrant lock so the same thread can call list_sheets from within ensure_primary_id_column
        self._api_lock = threading.RLock()
        # Cache for list_sheets to reduce API calls and SSL issues
        self._list_sheets_cache = None
        self._list_sheets_cache_time = 0.0
        # Cache for column indices (header row) to avoid duplicate reads in same create flow
        self._column_indices_cache = {}  # sheet_name -> (indices_dict, timestamp)
        self.COLUMN_INDICES_CACHE_TTL_SEC = 15
        # RLock so the same thread can re-acquire (e.g. reinit from within a locked block)
        self._api_lock = threading.RLock()

        # Authenticate
        try:
            credentials = service_account.Credentials.from_service_account_file(
                credentials_file,
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            self.service = build('sheets', 'v4', credentials=credentials)
        except Exception as e:
            raise Exception(f"Failed to authenticate with Google Sheets: {str(e)}")

    # Helper methods that delegate to module functions
    def _escape_sheet_name(self, sheet_name: str) -> str:
        """Escape sheet name for use in A1 notation."""
        return helpers.escape_sheet_name(sheet_name)
    
    def _get_sheet_name_for_region(self, sheet_name: Optional[str] = None, state: Optional[str] = None, location: Optional[str] = None) -> str:
        """Determine which sheet (tab) to use."""
        return helpers.get_sheet_name_for_region(sheet_name, state, location)
    
    def _find_column_index(self, sheet_name: str, column_header: str) -> Optional[int]:
        """Find the column index for a given header in a sheet."""
        return helpers.find_column_index(self.service, self.spreadsheet_id, sheet_name, column_header)
    
    def _invalidate_column_indices_cache(self, sheet_name: Optional[str] = None):
        """Invalidate cached column indices (e.g. after inserting a column)."""
        if sheet_name is None:
            self._column_indices_cache.clear()
        else:
            self._column_indices_cache.pop(sheet_name, None)

    def _get_all_column_indices(self, sheet_name: str) -> Dict[str, int]:
        """Get all column indices for a sheet by reading the header row (with short TTL cache)."""
        now = time.time()
        entry = self._column_indices_cache.get(sheet_name)
        if entry is not None:
            indices, ts = entry
            if (now - ts) < self.COLUMN_INDICES_CACHE_TTL_SEC:
                return indices
            self._column_indices_cache.pop(sheet_name, None)
        indices = helpers.get_all_column_indices(
            self.service, self.spreadsheet_id, sheet_name, self.list_sheets
        )
        if indices:
            self._column_indices_cache[sheet_name] = (indices, now)
        return indices

    def _find_row_by_primary_id(self, sheet_name: str, primary_id: str, id_column: str = 'Primary ID') -> Optional[int]:
        """Find the row index (1-based) for a turtle with a given primary ID."""
        return sheet_management.find_row_by_primary_id(
            self.service, self.spreadsheet_id, sheet_name, primary_id, id_column, self.list_sheets
        )
    
    def _ensure_primary_id_column(self, sheet_name: str) -> bool:
        """Ensure the "Primary ID" column exists in the sheet. Retries on SSL/connection errors."""
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                with self._api_lock:
                    return sheet_management.ensure_primary_id_column(
                        self.service, self.spreadsheet_id, sheet_name,
                        self._get_all_column_indices,
                        invalidate_column_indices_cache_func=self._invalidate_column_indices_cache,
                    )
            except (ssl.SSLError, IncompleteRead, OSError) as e:
                err_msg = str(e).lower()
                if attempt < max_attempts - 1 and (
                    'ssl' in err_msg or 'decryption' in err_msg or 'incompleteread' in err_msg
                    or 'wrong_version' in err_msg or 'cipher' in err_msg or 'mac' in err_msg
                ):
                    print(f"SSL/connection error in ensure_primary_id_column: {e}. Reinitializing and retrying...")
                    try:
                        self._reinitialize_service()
                        time.sleep(0.5)
                    except Exception:
                        pass
                    continue
                print(f"Error ensuring Primary ID column: {e}")
                return False
    
    def _column_index_to_letter(self, col_idx: int) -> str:
        """Convert a 0-based column index to Google Sheets column letter."""
        return helpers.column_index_to_letter(col_idx)
    
    def _reinitialize_service(self):
        """Reinitialize the Google Sheets service (useful for SSL connection issues)."""
        with self._api_lock:
            try:
                credentials_file = os.environ.get('GOOGLE_SHEETS_CREDENTIALS_PATH')
                if not credentials_file:
                    raise ValueError("Google Sheets credentials path not found")
                
                credentials = service_account.Credentials.from_service_account_file(
                    credentials_file,
                    scopes=['https://www.googleapis.com/auth/spreadsheets']
                )
                self.service = build('sheets', 'v4', credentials=credentials)
                self._invalidate_list_sheets_cache()
                print("✅ Google Sheets service reinitialized")
            except Exception as e:
                print(f"⚠️ Failed to reinitialize Google Sheets service: {e}")
                raise

    # Public CRUD methods (all run under _api_lock to avoid concurrent API use and SSL errors)
    def get_turtle_data(self, primary_id: str, sheet_name: str, state: Optional[str] = None, location: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get turtle data from Google Sheets by primary ID."""
        with self._api_lock:
            return crud.get_turtle_data(
                self.service, self.spreadsheet_id, primary_id, sheet_name, state, location,
                self._ensure_primary_id_column, self._find_row_by_primary_id, self._get_all_column_indices
            )
    
    def create_turtle_data(self, turtle_data: Dict[str, Any], sheet_name: str, state: Optional[str] = None, location: Optional[str] = None) -> Optional[str]:
        """Create a new turtle entry in Google Sheets."""
        with self._api_lock:
            return crud.create_turtle_data(
                self.service, self.spreadsheet_id, turtle_data, sheet_name, state, location,
                self._ensure_primary_id_column, self._get_all_column_indices
            )
    
    def update_turtle_data(self, primary_id: str, turtle_data: Dict[str, Any], sheet_name: str, state: Optional[str] = None, location: Optional[str] = None) -> bool:
        """Update existing turtle data in Google Sheets."""
        with self._api_lock:
            return crud.update_turtle_data(
                self.service, self.spreadsheet_id, primary_id, turtle_data, sheet_name, state, location,
                self._ensure_primary_id_column, self._find_row_by_primary_id, self._get_all_column_indices
            )
    
    def delete_turtle_data(self, primary_id: str, sheet_name: str) -> bool:
        """Delete turtle data from Google Sheets by removing the entire row."""
        with self._api_lock:
            return crud.delete_turtle_data(
                self.service, self.spreadsheet_id, primary_id, sheet_name, self._find_row_by_primary_id
            )
    
    def find_turtle_sheet(self, primary_id: str) -> Optional[str]:
        """Find which sheet contains a turtle with the given primary ID."""
        with self._api_lock:
            return crud.find_turtle_sheet(
                self.service, self.spreadsheet_id, primary_id, self.list_sheets, self._find_row_by_primary_id
            )

    # Migration methods
    def generate_primary_id(self, state: Optional[str] = None, location: Optional[str] = None) -> str:
        """Generate a new unique primary ID for a turtle."""
        with self._api_lock:
            return migration.generate_primary_id(
                self.service, self.spreadsheet_id, self.list_sheets, self._find_row_by_primary_id, state, location
            )

    def generate_biology_id(self, gender: str = 'U', sheet_name: Optional[str] = None) -> str:
        """
        Generate the next biology ID (ID column): one letter (M/F/U) + next sequence number.
        The number is scoped to the given sheet only.
        Gender: M=Male, F=Female, U=Unknown/Juvenile.
        """
        if not sheet_name or not sheet_name.strip():
            raise ValueError("sheet_name is required for biology ID generation")
        with self._api_lock:
            return migration.generate_biology_id(
                self.service, self.spreadsheet_id, sheet_name.strip(), self._get_all_column_indices, gender
            )
    
    def needs_migration(self) -> bool:
        """Check if migration is needed (i.e., there are turtles with ID but no Primary ID)."""
        with self._api_lock:
            return migration.needs_migration(
                self.service, self.spreadsheet_id, self.list_sheets, self._ensure_primary_id_column
            )
    
    def migrate_ids_to_primary_ids(self) -> Dict[str, int]:
        """Migrate all turtles from using "ID" column to "Primary ID" column."""
        with self._api_lock:
            return migration.migrate_ids_to_primary_ids(
                self.service, self.spreadsheet_id, self.list_sheets, self._ensure_primary_id_column, self.generate_primary_id
            )

    def get_sheet_values(self, range_name: str) -> Optional[Dict[str, Any]]:
        """Get values for a range (e.g. "Sheet1!A:Z"). Runs under API lock; retries on SSL/connection errors."""
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                with self._api_lock:
                    result = self.service.spreadsheets().values().get(
                        spreadsheetId=self.spreadsheet_id,
                        range=range_name,
                    ).execute()
                    return result
            except (ssl.SSLError, IncompleteRead, OSError) as e:
                err_msg = str(e).lower()
                if attempt < max_attempts - 1 and (
                    'ssl' in err_msg or 'decryption' in err_msg or 'incompleteread' in err_msg
                    or 'wrong_version' in err_msg or 'cipher' in err_msg or 'mac' in err_msg
                ):
                    try:
                        self._reinitialize_service()
                        time.sleep(0.5)
                    except Exception:
                        pass
                    continue
                raise
        return None

    # Sheet management methods
    def _invalidate_list_sheets_cache(self):
        """Invalidate cached sheet list (e.g. after creating a new sheet)."""
        self._list_sheets_cache = None

    def list_sheets(self) -> List[str]:
        """List all available sheets (tabs) in the spreadsheet.
        Uses a reentrant lock and short-lived cache to avoid concurrent Google API calls
        that can trigger SSL errors (DECRYPTION_FAILED_OR_BAD_RECORD_MAC, WRONG_VERSION_NUMBER).
        """
        with self._api_lock:
            now = time.time()
            if (
                self._list_sheets_cache is not None
                and (now - self._list_sheets_cache_time) < self.LIST_SHEETS_CACHE_TTL_SEC
            ):
                return list(self._list_sheets_cache)
            result = sheet_management.list_sheets(
                self.service, self.spreadsheet_id, self._reinitialize_service
            )
            self._list_sheets_cache = result
            self._list_sheets_cache_time = time.time()
            return result

    def create_sheet_with_headers(self, sheet_name: str) -> bool:
        """Create a new sheet (tab) with all required headers."""
        with self._api_lock:
            result = sheet_management.create_sheet_with_headers(
                self.service, self.spreadsheet_id, sheet_name, self.COLUMN_MAPPING, self.list_sheets
            )
            if result:
                self._invalidate_list_sheets_cache()
            return result
