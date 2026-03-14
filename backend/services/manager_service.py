"""
Turtle Manager and Google Sheets Service initialization
"""

import os
import threading
import time
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
            community_sheets_service = GoogleSheetsService(spreadsheet_id=community_id)
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
