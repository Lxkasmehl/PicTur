"""
Complete Backend Reset Script
Clears ALL data from the backend:
- Legacy Django SQLite DB and media (if still present from old installs)
- Official turtle data (State/Location folders)
- Uploaded data (Review Queue, Community Uploads)
- Legacy VLAD/FAISS artifacts (optional fallback files)

Important: Legacy index/vocab files under backend/turtles/ are removed together so the
deprecated VLAD/FAISS fallback state stays consistent when experimenting.
"""

import os
import shutil
import sys
from pathlib import Path

base_dir = os.path.dirname(os.path.abspath(__file__))
turtles_dir = os.path.join(base_dir, "turtles")

try:
    from dotenv import load_dotenv
    for env_path in [Path(base_dir) / ".env", Path(base_dir).parent / ".env"]:
        if env_path.exists():
            load_dotenv(env_path, override=False)
            break
except ImportError:
    pass


def clear_legacy_django_storage():
    """Remove leftover Django SQLite DB and media directory (pre-Flask-only installs)."""
    print("🗄️  Clearing legacy Django storage (if present)...")

    db_path = os.path.join(turtles_dir, "db.sqlite3")
    if os.path.isfile(db_path):
        try:
            os.remove(db_path)
            print(f"   ✅ Removed {db_path}")
        except OSError as e:
            print(f"   ⚠️  Could not remove database file: {e}")
    else:
        print("   ℹ️  No legacy db.sqlite3 under backend/turtles/")

    media_dir = os.path.join(turtles_dir, "media")
    if os.path.isdir(media_dir):
        try:
            print(f"   🗑️  Removing legacy media directory {media_dir}...")
            shutil.rmtree(media_dir)
            print("   ✅ Removed legacy media directory")
        except OSError as e:
            print(f"   ⚠️  Could not remove media directory: {e}")
    else:
        print("   ℹ️  No legacy media directory")


def clear_official_turtle_data():
    """Delete all official turtle data folders (State/Location/TurtleID)"""
    print("\n🐢 Clearing official turtle data...")
    
    data_dir = os.path.join(base_dir, 'data')
    if not os.path.exists(data_dir):
        print("   ℹ️  Data directory does not exist (already empty)")
        return
    
    deleted_folders = 0
    deleted_files = 0
    
    # List of folders to keep (Review_Queue, Community_Uploads)
    keep_folders = {'Review_Queue', 'Community_Uploads'}
    
    for item in os.listdir(data_dir):
        item_path = os.path.join(data_dir, item)
        
        # Skip special folders (they'll be handled separately)
        if item in keep_folders:
            continue
        
        # Skip if it's not a directory
        if not os.path.isdir(item_path):
            continue
        
        try:
            # Count files before deletion
            file_count = sum([len(files) for r, d, files in os.walk(item_path)])
            deleted_files += file_count
            
            # Delete the entire State/Location folder structure
            shutil.rmtree(item_path)
            deleted_folders += 1
            print(f"   🗑️  Deleted: {item} ({file_count} files)")
        except Exception as e:
            print(f"   ❌ Error deleting {item}: {e}")
    
    print(f"   ✅ Deleted {deleted_folders} location folders ({deleted_files} files)")


def clear_uploaded_data():
    """Clear Review Queue and Community Uploads"""
    print("\n📤 Clearing uploaded data...")
    
    data_dir = os.path.join(base_dir, 'data')
    upload_folders = ['Review_Queue', 'Community_Uploads']
    
    total_deleted = 0
    
    for folder_name in upload_folders:
        folder_path = os.path.join(data_dir, folder_name)
        
        if not os.path.exists(folder_path):
            print(f"   ℹ️  {folder_name} does not exist (already empty)")
            continue
        
        deleted_count = 0
        try:
            for item in os.listdir(folder_path):
                item_path = os.path.join(folder_path, item)
                try:
                    if os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                    else:
                        os.remove(item_path)
                    deleted_count += 1
                except Exception as e:
                    print(f"   ⚠️  Error deleting {item}: {e}")
            
            print(f"   ✅ Cleared {folder_name} ({deleted_count} items)")
            total_deleted += deleted_count
        except Exception as e:
            print(f"   ❌ Error clearing {folder_name}: {e}")
    
    print(f"   ✅ Total uploaded items deleted: {total_deleted}")


def clear_training_data():
    """Delete deprecated VLAD/FAISS artifacts."""
    print("\n🧠 Clearing deprecated VLAD/FAISS artifacts...")
    
    data_dir = os.path.join(base_dir, 'data')
    turtles_dir_path = os.path.join(base_dir, 'turtles')
    
    # Delete legacy .npz files (deprecated path only)
    npz_count = 0
    if os.path.exists(data_dir):
        for root, dirs, files in os.walk(data_dir):
            for file in files:
                if file.endswith(".npz"):
                    file_path = os.path.join(root, file)
                    try:
                        os.remove(file_path)
                        npz_count += 1
                    except Exception as e:
                        print(f"   ⚠️  Error deleting {file_path}: {e}")
    
    print(f"   ✅ Deleted {npz_count} .npz files")
    
    # Delete all deprecated index/vocab files together.
    model_files = [
        os.path.join(turtles_dir_path, 'vlad_vocab.pkl'),
        os.path.join(turtles_dir_path, 'turtles.index'),
        os.path.join(turtles_dir_path, 'global_vlad_array.npy'),
        os.path.join(turtles_dir_path, 'metadata.pkl'),
        os.path.join(turtles_dir_path, 'trained_kmeans_vocabulary.pkl'),
    ]
    
    model_count = 0
    for model_path in model_files:
        if os.path.exists(model_path):
            try:
                os.remove(model_path)
                model_count += 1
                print(f"   🗑️  Deleted: {os.path.basename(model_path)}")
            except Exception as e:
                print(f"   ❌ Error deleting {os.path.basename(model_path)}: {e}")
    
    print(f"   ✅ Deleted {model_count} model files")


def _safe_folder_name(sheet_name: str) -> str:
    """Sanitize sheet name for use as filesystem folder (e.g. replace / \\ : * ? \" < > |)."""
    if not sheet_name or not isinstance(sheet_name, str):
        return "_"
    invalid = r'\/:*?"<>|'
    out = sheet_name.strip()
    for c in invalid:
        out = out.replace(c, "_")
    return out or "_"


def ensure_data_folders_from_sheets():
    """
    After reset, ensure data/ has at least:
    - Review_Queue, Community_Uploads
    - One folder per admin-facing sheet (State-level folders)
    - Community_Uploads/<sheet> for each community-facing sheet
    Uses GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID if set.
    """
    print("\n📁 Ensuring data folder structure from sheets...")
    data_dir = os.path.join(base_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, 'Review_Queue'), exist_ok=True)
    community_uploads_dir = os.path.join(data_dir, 'Community_Uploads')
    os.makedirs(community_uploads_dir, exist_ok=True)

    created_admin = 0
    created_community = 0

    try:
        # Ensure we can import Flask app services (add backend to path if needed)
        if base_dir not in sys.path:
            sys.path.insert(0, base_dir)
        from services import manager_service

        # Admin-facing sheet folders (one top-level folder per sheet)
        admin_sheets = []
        try:
            svc = manager_service.get_sheets_service()
            if svc:
                admin_sheets = svc.list_sheets()
        except Exception as e:
            print(f"   ℹ️  Could not read admin sheets (Google Sheets not configured or unavailable): {e}")

        for name in admin_sheets or []:
            safe = _safe_folder_name(name)
            if not safe:
                continue
            path = os.path.join(data_dir, safe)
            if not os.path.exists(path):
                os.makedirs(path, exist_ok=True)
                created_admin += 1
                print(f"   📁 Created admin folder: {safe}")

        # Community-facing sheet subfolders under Community_Uploads
        community_sheets = []
        try:
            comm = manager_service.get_community_sheets_service()
            if comm:
                community_sheets = comm.list_sheets()
        except Exception as e:
            print(f"   ℹ️  Could not read community sheets: {e}")

        for name in community_sheets or []:
            safe = _safe_folder_name(name)
            if not safe:
                continue
            path = os.path.join(community_uploads_dir, safe)
            if not os.path.exists(path):
                os.makedirs(path, exist_ok=True)
                created_community += 1
                print(f"   📁 Created Community_Uploads/{safe}")

    except Exception as e:
        print(f"   ⚠️  Could not create sheet-based folders: {e}")

    if created_admin or created_community:
        print(f"   ✅ Created {created_admin} admin folder(s), {created_community} community subfolder(s)")
    else:
        print("   ✅ Review_Queue and Community_Uploads ensured (no sheet list or already present)")


def reset_complete_backend():
    """Main function to reset everything"""
    print("=" * 60)
    print("⚠️  COMPLETE BACKEND RESET ⚠️")
    print("=" * 60)
    print("\nThis will delete:")
    print("  ❌ Legacy Django SQLite DB and media (if still present)")
    print("  ❌ All official turtle data (State/Location folders)")
    print("  ❌ All uploaded data (Review Queue, Community Uploads)")
    print("  ❌ All deprecated VLAD/FAISS artifacts (if present)")
    print("\n" + "=" * 60)
    
    confirmation = input("\n⚠️  Type 'RESET' (all caps) to confirm: ")
    
    if confirmation != 'RESET':
        print("\n❌ Operation cancelled.")
        return
    
    print("\n🚀 Starting reset...\n")
    
    try:
        # 1. Legacy Django files (harmless if already gone)
        clear_legacy_django_storage()
        
        # 2. Clear official turtle data
        clear_official_turtle_data()
        
        # 3. Clear uploaded data
        clear_uploaded_data()
        
        # 4. Clear training data
        clear_training_data()
        
        # 5. Ensure data folder structure (admin + community sheet folders)
        ensure_data_folders_from_sheets()
        
        print("\n" + "=" * 60)
        print("🎉 COMPLETE BACKEND RESET FINISHED!")
        print("=" * 60)
        print("\n✅ All data has been cleared.")
        print("✅ You can now start fresh with uploading turtles.")
        print("\n💡 Next steps:")
        print("   1. Start the backend server")
        print("   2. Upload new turtle images")
        print("   3. The system will automatically rebuild indexes")
        
    except Exception as e:
        print(f"\n❌ Error during reset: {e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    reset_complete_backend()
