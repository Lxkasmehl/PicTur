"""
Turtle Manager and Google Sheets Service initialization
"""

import http.client
import os
import socket
import ssl
import threading
import time

from googleapiclient.errors import HttpError

from google_sheets_service import GoogleSheetsService

# Initialize Turtle Manager in background thread to avoid blocking server start
# This allows the server to start immediately and respond to health checks
manager = None
manager_ready = threading.Event()

# Initialize Google Sheets Service (lazy initialization)
sheets_service = None
community_sheets_service = None
migration_checked = False
migration_running = False


def get_sheets_service():
    """Lazy initialization of Google Sheets Service (research spreadsheet)"""
    global sheets_service, migration_checked, migration_running
    if sheets_service is None:
        try:
            sheets_service = GoogleSheetsService()
            # Check if migration is needed on first access (but don't block on errors)
            if not migration_checked and not migration_running:
                migration_checked = True
                # Run migration check in background - don't wait for it
                try:
                    check_and_run_migration()
                except Exception as migration_error:
                    print(f"⚠️ Warning: Migration check failed (non-critical): {migration_error}")
        except Exception as e:
            print(f"⚠️ Warning: Google Sheets Service not available: {e}")
            err_str = str(e).lower()
            if "credentials" in err_str and "not found" in err_str:
                print("   For Docker: place your Service Account JSON in backend/credentials/ on the host.")
                print("   Name it google-sheets-credentials.json or set GOOGLE_SHEETS_CREDENTIALS_PATH in .env to /app/credentials/YourFilename.json")
            print("   Google Sheets features will be disabled.")
            # Don't raise - return None so endpoints can handle gracefully
    return sheets_service


def get_community_sheets_service():
    """Lazy initialization of Google Sheets Service for community-facing spreadsheet.
    Returns None if GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID is not set."""
    global community_sheets_service
    community_id = os.environ.get('GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID', '').strip()
    if not community_id:
        return None
    if community_sheets_service is None:
        try:
            community_sheets_service = GoogleSheetsService(
                spreadsheet_id=community_id,
                apply_general_location_sheet_validation=False,
            )
        except Exception as e:
            print(f"⚠️ Warning: Community Google Sheets not available: {e}")
            return None
    return community_sheets_service


def reset_sheets_service():
    """Reset the Google Sheets service (useful for connection issues)"""
    global sheets_service, community_sheets_service
    sheets_service = None
    community_sheets_service = None
    return get_sheets_service()


# --- Sheets availability with bounded retry -------------------------------
# A transient Sheets outage must never cause a NEW turtle to be born with a
# non-canonical (bio-only) folder. New-turtle create points run their Sheets
# work through call_sheets_with_retry, which retries TRANSIENT failures and,
# if the connection can't be re-established, raises a 503 so the caller aborts
# and creates nothing -- rather than degrading to a bio-only folder.

SHEETS_RETRY_MAX_ATTEMPTS = int(os.environ.get('SHEETS_RETRY_MAX_ATTEMPTS', '3'))
SHEETS_RETRY_BACKOFF_SEC = float(os.environ.get('SHEETS_RETRY_BACKOFF_SEC', '1.5'))


class SheetsServiceUnavailableError(Exception):
    """Google Sheets was reachable-but-flaky and stayed unavailable after a
    bounded retry. Maps to HTTP 503 (retryable). PERMANENT config errors
    (missing credentials, unset community spreadsheet id) do NOT raise this."""

    def __init__(self,
                 message="Google Sheets is temporarily unavailable. Please try again in a moment.",
                 status_code=503):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def is_transient_sheets_error(exc):
    """True for outages worth retrying (network/server), False for permanent
    config/auth errors that won't fix themselves in a few seconds. Permanent
    cases are checked FIRST because FileNotFoundError is itself an OSError."""
    if isinstance(exc, SheetsServiceUnavailableError):
        return True
    # PERMANENT — never retry.
    if isinstance(exc, (FileNotFoundError, ValueError)):
        return False
    msg = str(exc).lower()
    if 'credentials' in msg and 'not found' in msg:
        return False
    if isinstance(exc, HttpError):
        status = getattr(getattr(exc, 'resp', None), 'status', None)
        try:
            status = int(status)
        except (TypeError, ValueError):
            status = None
        return status in (429, 500, 502, 503, 504)  # 401/403/404 -> permanent
    # TRANSIENT — network/socket/SSL drops (OSError catch-all last).
    if isinstance(exc, (ssl.SSLError, socket.timeout, http.client.IncompleteRead,
                        ConnectionError, TimeoutError, OSError)):
        return True
    return False


def _research_service_strict():
    """Research Sheets service, constructing if needed and RAISING on failure
    (so call_sheets_with_retry can classify/retry) instead of swallowing to
    None like get_sheets_service()."""
    global sheets_service
    if sheets_service is None:
        sheets_service = GoogleSheetsService()
    return sheets_service


def _community_service_strict():
    """Community Sheets service, or None when the community spreadsheet is not
    configured (the shipped default -- caller treats None as a skip, not an
    error). Raises on a configured-but-failing construction."""
    community_id = os.environ.get('GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID', '').strip()
    if not community_id:
        return None
    global community_sheets_service
    if community_sheets_service is None:
        community_sheets_service = GoogleSheetsService(
            spreadsheet_id=community_id,
            apply_general_location_sheet_validation=False,
        )
    return community_sheets_service


def call_sheets_with_retry(func, *, community=False, max_attempts=None, backoff=None):
    """Run ``func(service)`` with bounded retry on TRANSIENT Sheets failures.

    ``service`` is the live GoogleSheetsService, or None when ``community`` is
    set but the community spreadsheet is unconfigured (the caller handles that
    as today's skip). PERMANENT errors (missing creds, 401/403/404, bad config)
    propagate immediately so the caller maps them as it does today. When
    transient retries are exhausted, raises ``SheetsServiceUnavailableError``
    (HTTP 503). Between attempts the cached client is reset so the next
    construction re-establishes a dropped connection.
    """
    attempts = max_attempts or SHEETS_RETRY_MAX_ATTEMPTS
    wait = backoff if backoff is not None else SHEETS_RETRY_BACKOFF_SEC
    last_exc = None
    for attempt in range(attempts):
        try:
            service = _community_service_strict() if community else _research_service_strict()
            return func(service)
        except Exception as exc:  # noqa: BLE001 - classified below
            last_exc = exc
            if not is_transient_sheets_error(exc):
                raise
            if attempt < attempts - 1:
                reset_sheets_service()
                time.sleep(wait * (attempt + 1))
    raise SheetsServiceUnavailableError() from last_exc


def check_and_run_migration():
    """Check if migration is needed and run it in background if necessary"""
    global migration_running
    if migration_running:
        return
    
    def run_migration():
        global migration_running
        migration_running = True
        try:
            service = get_sheets_service()
            if service:
                # Check if migration is needed
                if service.needs_migration():
                    try:
                        print("🔄 Migration needed: Some turtles are missing Primary IDs. Starting automatic migration...")
                        stats = service.migrate_ids_to_primary_ids()
                        total = sum(stats.values())
                        if total > 0:
                            print(f"✅ Automatic migration completed: {total} turtles migrated across {len(stats)} sheets")
                        else:
                            print("ℹ️  No turtles needed migration")
                    except Exception as e:
                        print(f"⚠️  Error during automatic migration: {e}")
                        print("   You can manually trigger migration via POST /api/sheets/migrate-ids")
                else:
                    print("✅ All turtles have Primary IDs - no migration needed")
        except Exception as e:
            print(f"⚠️  Error checking migration status: {e}")
        finally:
            migration_running = False
    
    # Run migration in background thread to avoid blocking server start
    migration_thread = threading.Thread(target=run_migration, daemon=True)
    migration_thread.start()


def initialize_manager():
    """Initialize Turtle Manager in background thread (real TurtleManager only)."""
    global manager
    from turtle_manager import TurtleManager
    try:
        manager = TurtleManager()
        manager_ready.set()
        try:
            print("✅ TurtleManager initialized successfully")
        except UnicodeEncodeError:
            print("[OK] TurtleManager initialized successfully")
        # Ensure data folder structure matches admin and community spreadsheets (no reset required)
        _ensure_sheet_folders_on_startup()
    except Exception as e:
        try:
            print(f"❌ Error initializing TurtleManager: {str(e)}")
        except UnicodeEncodeError:
            print(f"[ERROR] Error initializing TurtleManager: {str(e)}")
        manager_ready.set()  # Set even on error so server can continue


def _ensure_sheet_folders_on_startup():
    """Fetch sheet names from admin and community spreadsheets and ensure matching folders exist under data/."""
    if manager is None:
        return
    admin_sheets = []
    community_sheets = []
    try:
        svc = get_sheets_service()
        if svc:
            admin_sheets = svc.list_sheets() or []
    except Exception:
        pass
    try:
        comm = get_community_sheets_service()
        if comm:
            community_sheets = comm.list_sheets() or []
    except Exception:
        pass
    try:
        manager.ensure_data_folders_from_sheets(admin_sheets, community_sheets)
    except Exception as e:
        try:
            print(f"⚠️ Could not ensure sheet folders: {e}")
        except UnicodeEncodeError:
            print("[WARN] Could not ensure sheet folders")


def initialize_sheets_migration():
    """Initialize Google Sheets Service and check for migration on startup"""
    # Wait a bit for server to be ready
    time.sleep(2)
    try:
        service = get_sheets_service()
        if service:
            # Migration check is already triggered in get_sheets_service()
            pass
    except Exception as e:
        # Sheets service not available, that's okay
        pass


# Start manager in background thread
manager_thread = threading.Thread(target=initialize_manager, daemon=True)
manager_thread.start()

# Start sheets migration check in background
sheets_migration_thread = threading.Thread(target=initialize_sheets_migration, daemon=True)
sheets_migration_thread.start()
