import csv
import os
import re
import shutil
import time
import cv2 as cv
import json
import sys
import uuid

# Pillow is already a dependency for SuperPoint preprocessing — used here for EXIF
try:
    from PIL import Image as _PILImage
    from PIL.ExifTags import TAGS as _EXIF_TAGS
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


def _extract_exif_date(image_path):
    """Read DateTimeOriginal from a JPG's EXIF and return YYYY-MM-DD or None.

    Falls back through DateTime and DateTimeDigitized when Original is missing.
    Returns None on any error (missing tag, bad format, unreadable file, no Pillow).
    """
    if not _PIL_AVAILABLE or not image_path or not os.path.isfile(image_path):
        return None
    try:
        with _PILImage.open(image_path) as img:
            exif = img.getexif()
            if not exif:
                return None
            # Build name → value map for the EXIF tags we care about
            wanted = {'DateTimeOriginal': None, 'DateTimeDigitized': None, 'DateTime': None}
            for tag_id, value in exif.items():
                name = _EXIF_TAGS.get(tag_id)
                if name in wanted and wanted[name] is None:
                    wanted[name] = value
            raw = wanted['DateTimeOriginal'] or wanted['DateTimeDigitized'] or wanted['DateTime']
            if not raw or not isinstance(raw, str):
                return None
            # EXIF date format: "YYYY:MM:DD HH:MM:SS"
            date_part = raw.split(' ')[0].strip()
            if len(date_part) == 10 and date_part[4] == ':' and date_part[7] == ':':
                return date_part.replace(':', '-')
    except Exception:
        return None
    return None


def _date_suffix(epoch_ms=None):
    """Return _YYYY-MM-DD using current time (or given epoch ms) for filename stamping."""
    if epoch_ms is not None:
        try:
            t = epoch_ms / 1000 if epoch_ms > 1_000_000_000_000 else epoch_ms
            return time.strftime('_%Y-%m-%d', time.gmtime(t))
        except (ValueError, OSError):
            pass
    return time.strftime('_%Y-%m-%d', time.gmtime())

# --- PATH HACK ---
# This ensures we can find the 'turtles' package regardless of where we run this script
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

# --- IMPORT THE BRAIN (SUPERPOINT/LIGHTGLUE) ---
try:
    from turtles.image_processing import brain
except ImportError as e1:
    try:
        from image_processing import brain
    except ImportError as e2:
        print(f"❌ CRITICAL: Could not import 'brain'.")
        print(f"Detailed Error 1: {e1}")
        print(f"Detailed Error 2: {e2}")
        sys.exit(1)

# --- CONFIGURATION ---
BASE_DATA_DIR = 'data'

# Characters invalid in folder names (Windows + common Unix); replaced with _ when syncing sheet names to disk
_FOLDER_NAME_INVALID = r'\/:*?"<>|'


def _safe_folder_name(sheet_name):
    """Sanitize sheet name for use as filesystem folder."""
    if not sheet_name or not isinstance(sheet_name, str):
        return "_"
    out = sheet_name.strip()
    for c in _FOLDER_NAME_INVALID:
        out = out.replace(c, "_")
    return out or "_"


# --- FILENAME PARSING ---
_BIO_ID_RE = re.compile(r'^([FMJUfmju]\d+)')
_CARAPACE_RE = re.compile(r'carapac|carapce|carapae', re.IGNORECASE)


def _parse_bio_id(filename):
    """Extract biology ID from a filename like 'F002 Plastron.jpg' -> 'F002'.

    Parses the letter prefix + all following digits (handles variable-length IDs).
    Returns the ID with the prefix uppercased, or None if no match.
    """
    m = _BIO_ID_RE.match(filename)
    if not m:
        return None
    raw = m.group(1)
    return raw[0].upper() + raw[1:]


def _detect_photo_type(filename):
    """Detect photo type from filename. Returns 'carapace' or 'plastron'."""
    if _CARAPACE_RE.search(filename):
        return 'carapace'
    return 'plastron'


# --- FLASH DRIVE INGEST: Map drive folder names to backend folder names ---
# When folder names on the flash drive don't match backend/Google Sheets, add mappings here.
# Ingest will route files to the correct backend State/Location based on these maps.

# Flat structure: when drive has location folders directly at root (no State parent),
# map each folder name to "State/Location". Takes precedence over hierarchical logic.
DRIVE_LOCATION_TO_BACKEND_PATH = {
    "North Topeka": "Kansas/North Topeka",
    "Lawrence": "Kansas/Lawrence",
    "Karlyle Woods": "Kansas/Karlyle Woods",
    "Valencia": "Kansas/Valencia",
    "CPBS": "NebraskaCPBS/CPBS",
    "Crescent Lake": "NebraskaCL/Crescent Lake",
}


# Flat structure: top-level folders that should be treated as State-level (not Location-level).
# Images directly inside these folders ingest to data/<State>/<TurtleID>/...
DRIVE_STATE_LEVEL_FOLDERS = {
    "Incidental Places": "Incidental Places",
    "Community": "Community",
}

# Hierarchical structure (drive_root/State/Location): map state/location names
DRIVE_STATE_NAME_MAP = {
    # Example: "KS": "Kansas",
    # Example: "Kansas_2024": "Kansas",
}

LOCATION_NAME_MAP = {
    # Example: "CBPS": "WT",
    # Example: "TPK": "Topeka",
}


def _resolve_drive_state_name(drive_state_name):
    """Map flash drive state folder name to backend state name."""
    return DRIVE_STATE_NAME_MAP.get(drive_state_name, drive_state_name)


def _resolve_drive_location_name(drive_location_name):
    """Map flash drive location folder name to backend location name."""
    return LOCATION_NAME_MAP.get(drive_location_name, drive_location_name)


class TurtleManager:
    def __init__(self, base_data_dir='data'):
        import threading
        # backend/data/
        self.base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), base_data_dir)
        self.review_queue_dir = os.path.join(self.base_dir, 'Review_Queue')
        # Serializes approve/reject so two admins can't double-process the same packet
        self._approval_lock = threading.Lock()

        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(self.review_queue_dir, exist_ok=True)

        # Create Community and Incidental roots
        self._ensure_special_directories()

        # Recover from interrupted operations before indexing
        self._recover_staged_files()
        self._cleanup_temp_files()

        # --- Indexing (VRAM Caching) ---
        self.db_index = []
        print("🐢 TurtleManager: Indexing Database & Loading VRAM...")
        self.refresh_database_index()
        print(f"✅ Indexed {len(self.db_index)} known turtles.")

    def set_device(self, mode):
        """Passes device toggle down to the deep learning brain."""
        brain.set_device(mode)

    def save_benchmark(self, device_mode, total_time):
        """Saves sequential benchmark files for runtime analysis."""
        bench_dir = os.path.join(self.base_dir, 'benchmarks')
        os.makedirs(bench_dir, exist_ok=True)
        prefix = device_mode.upper()

        idx = 1
        while os.path.exists(os.path.join(bench_dir, f"{prefix}_{idx}.txt")):
            idx += 1

        filepath = os.path.join(bench_dir, f"{prefix}_{idx}.txt")
        with open(filepath, "w") as f:
            f.write(f"TurtleVision Benchmark Log\n")
            f.write(f"Device Used: {prefix}\n")
            f.write(f"Total Batch Runtime: {total_time:.4f} seconds\n")
        print(f"⏱️ Benchmark saved to {filepath}")

    def _ensure_special_directories(self):
        """Creates the folder root for Community uploads."""
        path = os.path.join(self.base_dir, "Community_Uploads")
        os.makedirs(path, exist_ok=True)

    def _recover_staged_files(self):
        """Recover from interrupted reference replacements.

        Scans plastron/, ref_data/ (legacy), and carapace/ directories for
        orphaned _staged_ files.  If a staged .pt exists, the replacement was
        interrupted — promote the staged file to the canonical name so the
        turtle has a valid reference.
        """
        recovered = 0
        for root, dirs, files in os.walk(self.base_dir):
            dir_name = os.path.basename(root)
            if dir_name not in ('plastron', 'ref_data', 'carapace'):
                continue
            staged_files = [f for f in files if '_staged_' in f]
            if not staged_files:
                continue

            turtle_id = os.path.basename(os.path.dirname(root))

            # Group staged files by base turtle_id
            staged_pts = [f for f in staged_files if f.endswith('.pt')]
            staged_imgs = [f for f in staged_files if not f.endswith('.pt')]

            for staged_pt in staged_pts:
                canonical_pt = os.path.join(root, f"{turtle_id}.pt")
                staged_pt_path = os.path.join(root, staged_pt)
                # Promote staged .pt to canonical (overwrite if exists)
                try:
                    shutil.move(staged_pt_path, canonical_pt)
                    print(f"   🔧 Recovered staged .pt for {turtle_id} in {dir_name}/")
                    recovered += 1
                except OSError as e:
                    print(f"   ⚠️ Failed to recover {staged_pt}: {e}")

            for staged_img in staged_imgs:
                staged_img_path = os.path.join(root, staged_img)
                # Determine extension and promote to canonical image name
                ext = os.path.splitext(staged_img)[1]
                canonical_img = os.path.join(root, f"{turtle_id}{ext}")
                try:
                    shutil.move(staged_img_path, canonical_img)
                except OSError:
                    # Non-critical — image is also archived in loose_images
                    try:
                        os.remove(staged_img_path)
                    except OSError:
                        pass

        if recovered:
            print(f"🔧 Recovered {recovered} interrupted reference replacement(s).")

    def _cleanup_temp_files(self):
        """Remove orphaned temp files from uploads that were interrupted by a crash.

        Only deletes files in the system temp directory that match TurtleTracker
        naming patterns and are older than 1 hour.
        """
        import tempfile
        temp_dir = tempfile.gettempdir()
        threshold = time.time() - 3600  # 1 hour ago
        cleaned = 0
        # Patterns from upload.py: extra_{request_id}_{type}_{timestamp}{ext},
        # review_extra_{request_id}_{idx}_{timestamp}{ext}
        prefixes = ('extra_', 'review_extra_')
        image_exts = ('.jpg', '.jpeg', '.png', '.gif', '.webp')

        try:
            for fname in os.listdir(temp_dir):
                if not any(fname.startswith(p) for p in prefixes):
                    continue
                if not any(fname.lower().endswith(e) for e in image_exts):
                    continue
                fpath = os.path.join(temp_dir, fname)
                if not os.path.isfile(fpath):
                    continue
                try:
                    if os.path.getmtime(fpath) < threshold:
                        os.remove(fpath)
                        cleaned += 1
                except OSError:
                    pass
        except OSError:
            pass

        if cleaned:
            print(f"🧹 Cleaned {cleaned} orphaned temp file(s).")

    def ensure_data_folders_from_sheets(self, admin_sheet_names=None, community_sheet_names=None):
        """
        Ensure data/ contains folders for each admin sheet and Community_Uploads/<sheet> for each community sheet.
        Call with lists from Google Sheets (e.g. on startup) so folder structure matches spreadsheets without running reset.
        """
        admin_sheet_names = admin_sheet_names or []
        community_sheet_names = community_sheet_names or []
        community_uploads_dir = os.path.join(self.base_dir, "Community_Uploads")
        os.makedirs(community_uploads_dir, exist_ok=True)
        created_admin = 0
        created_community = 0
        for name in admin_sheet_names:
            safe = _safe_folder_name(name)
            if not safe:
                continue
            path = os.path.join(self.base_dir, safe)
            if not os.path.exists(path):
                os.makedirs(path, exist_ok=True)
                created_admin += 1
        for name in community_sheet_names:
            safe = _safe_folder_name(name)
            if not safe:
                continue
            path = os.path.join(community_uploads_dir, safe)
            if not os.path.exists(path):
                os.makedirs(path, exist_ok=True)
                created_community += 1
        if created_admin or created_community:
            try:
                print(f"📁 Data folders: created {created_admin} admin, {created_community} community sheet folder(s)")
            except UnicodeEncodeError:
                print("[OK] Data folders: created admin/community sheet folder(s)")

    def get_official_location_name(self, folder_name):
        """Translates acronyms (CBPS) to official names (Central Biological Preserve)."""
        return LOCATION_NAME_MAP.get(folder_name, folder_name)

    def refresh_database_index(self):
        """Scans for .pt files to build the search index and pushes to VRAM.

        Scans plastron/ (new), ref_data/ (legacy), and carapace/ subdirectories.
        Each index entry is a 4-tuple: (pt_path, turtle_id, location, photo_type).
        """
        self.db_index = []
        for root, dirs, files in os.walk(self.base_dir):
            # Defensively prune Deleted/ subtrees so soft-deleted .pt files
            # (if any lingered across an older format) never enter the index.
            if 'Deleted' in dirs:
                dirs.remove('Deleted')
            # Determine photo_type from the directory name
            dir_name = os.path.basename(root)
            if dir_name in ("plastron", "ref_data"):
                photo_type = "plastron"
            elif dir_name == "carapace":
                photo_type = "carapace"
            else:
                continue

            for file in files:
                if file.endswith(".pt"):
                    path_parts = root.split(os.sep)
                    if len(path_parts) >= 3:
                        turtle_id = path_parts[-2]
                        rel_path = os.path.relpath(root, self.base_dir)
                        # Strip the last 2 parts (TurtleID/plastron or TurtleID/carapace)
                        loc_parts = rel_path.split(os.sep)[:-2]
                        location_name = "/".join(loc_parts)
                        self.db_index.append((os.path.join(root, file), turtle_id, location_name, photo_type))

        # Push the indexed files directly into the Brain's VRAM
        if hasattr(brain, 'load_database_to_vram'):
            print("⚡ Pushing database to Memory Cache...")
            brain.load_database_to_vram(self.db_index)

    # Folders that should never appear in user-facing location dropdowns
    SYSTEM_FOLDERS = {"Review_Queue", "Community_Uploads",
                      "Incidental Places", "benchmarks"}

    def get_all_locations(self):
        """
        Scans the data folder to build a list of locations for the GUI Dropdown.

        Handles two folder patterns:
          1. State with sub-locations  — Kansas/Lawrence/TurtleID/ref_data/
          2. StateLocation combo sheet — NebraskaCPBS/TurtleID/ref_data/

        A subfolder is a *turtle folder* (not a location) when it contains a
        ``plastron/`` or ``ref_data/`` (legacy) directory.  Those are never
        listed in the dropdown.
        """
        locations = ["Community_Uploads"]

        if not os.path.exists(self.base_dir):
            return locations

        for entry in sorted(os.listdir(self.base_dir)):
            entry_path = os.path.join(self.base_dir, entry)
            if not os.path.isdir(entry_path) or entry.startswith('.'):
                continue
            if entry in self.SYSTEM_FOLDERS:
                continue

            # Always include the top-level name (state or combo-sheet)
            locations.append(entry)

            # Check children: only list them if they are location folders,
            # NOT turtle folders (turtle folders contain plastron/ or ref_data/).
            for sub in sorted(os.listdir(entry_path)):
                sub_path = os.path.join(entry_path, sub)
                if not os.path.isdir(sub_path) or sub.startswith('.'):
                    continue
                if os.path.isdir(os.path.join(sub_path, "plastron")) or os.path.isdir(os.path.join(sub_path, "ref_data")):
                    # This is a turtle folder — skip it
                    continue
                locations.append(f"{entry}/{sub}")

        return locations

    def create_new_location(self, state_name, location_name):
        """Allows Admin to generate a new research site folder from the GUI."""
        official_name = self.get_official_location_name(location_name)
        path = os.path.join(self.base_dir, state_name, official_name)

        if not os.path.exists(path):
            os.makedirs(path)
            print(f"✅ Created new location: {state_name}/{official_name}")
            return path
        else:
            print(f"⚠️ Location already exists: {state_name}/{official_name}")
            return path

    def process_manual_upload(self, image_path, location_selection):
        """Handles the GUI Manual Upload. Parses 'State/Location' string and calls the processor."""
        if "/" in location_selection:
            state, loc = location_selection.split("/", 1)
            location_dir = os.path.join(self.base_dir, state, loc)
        else:
            location_dir = os.path.join(self.base_dir, location_selection)

        if not os.path.exists(location_dir):
            os.makedirs(location_dir, exist_ok=True)

        filename = os.path.basename(image_path)
        turtle_id = _parse_bio_id(filename)
        if not turtle_id:
            turtle_id = filename[:4].strip().rstrip('_')
        photo_type = _detect_photo_type(filename)

        print(f"Manual Upload: Processing {turtle_id} ({photo_type}) into {location_dir}...")
        return self._process_single_turtle(image_path, location_dir, turtle_id, photo_type=photo_type)

    # MERGE FIX: Used your flat-folder ingest to fix nesting bugs, but kept partner's ingest timer.
    def ingest_flash_drive(self, drive_root_path):
        """Scans drive, extracts ID, creates folders, skips duplicates. (Flat-folder version)"""
        ingest_start_time = time.time()
        print(f"🐢 Starting Flat Ingest from: {drive_root_path}")
        if not os.path.exists(drive_root_path):
            print("❌ Error: Drive path does not exist.")
            return

        count_new = 0
        count_skipped = 0
        # Track biology IDs found on drive, grouped by sheet name (State)
        drive_ids_by_sheet = {}  # { sheet_name: set(bio_id, ...) }

        def process_location_folder(location_source_path, location_dest_path, sheet_name=None):
            """Process all turtle images in a location folder."""
            nonlocal count_new, count_skipped
            for filename in os.listdir(location_source_path):
                if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    continue
                turtle_id = _parse_bio_id(filename)
                if not turtle_id:
                    print(f"   ⚠️ Could not parse ID from: {filename}")
                    continue
                photo_type = _detect_photo_type(filename)
                # Track this ID for the missing turtle report
                if sheet_name:
                    drive_ids_by_sheet.setdefault(sheet_name, set()).add(turtle_id)
                source_path = os.path.join(location_source_path, filename)
                status = self._process_single_turtle(source_path, location_dest_path, turtle_id, photo_type=photo_type)
                if status == "created":
                    count_new += 1
                elif status == "skipped":
                    count_skipped += 1

        for top_level_name in os.listdir(drive_root_path):

            if top_level_name == "System Volume Information" or top_level_name.startswith('.'):
                continue

            top_level_path = os.path.join(drive_root_path, top_level_name)
            if not os.path.isdir(top_level_path):
                continue

            # Flat structure: location folders at root map directly to State/Location
            if top_level_name in DRIVE_LOCATION_TO_BACKEND_PATH:
                backend_path = DRIVE_LOCATION_TO_BACKEND_PATH[top_level_name]
                state_name, location_name = backend_path.split("/", 1)
                location_dest_path = os.path.join(self.base_dir, state_name, location_name)
                os.makedirs(location_dest_path, exist_ok=True)
                process_location_folder(top_level_path, location_dest_path, sheet_name=state_name)
                continue

            # Flat structure: State-level folders at root (not location folders)
            if top_level_name in DRIVE_STATE_LEVEL_FOLDERS:
                state_dest_name = DRIVE_STATE_LEVEL_FOLDERS[top_level_name]
                state_dest_path = os.path.join(self.base_dir, state_dest_name)
                os.makedirs(state_dest_path, exist_ok=True)
                process_location_folder(top_level_path, state_dest_path, sheet_name=state_dest_name)
                continue

            # Hierarchical structure: State/Location
            state_dest_name = _resolve_drive_state_name(top_level_name)
            state_dest_path = os.path.join(self.base_dir, state_dest_name)
            os.makedirs(state_dest_path, exist_ok=True)

            for location_name in os.listdir(top_level_path):
                location_source_path = os.path.join(top_level_path, location_name)
                if not os.path.isdir(location_source_path) or location_name.startswith('.'):
                    continue

                official_name = _resolve_drive_location_name(location_name)
                location_dest_path = os.path.join(state_dest_path, official_name)
                os.makedirs(location_dest_path, exist_ok=True)
                process_location_folder(location_source_path, location_dest_path, sheet_name=state_dest_name)
        # --- TIMER END ---
        total_time = time.time() - ingest_start_time
        print(f"\n🎉 Ingest Complete. New: {count_new}, Skipped: {count_skipped}")
        print(f"⏱️ Total Ingest Time: {total_time:.2f}s")

        # Rebuild search index so newly ingested turtles are immediately searchable
        if count_new > 0:
            print("♻️  Rebuilding search index to include ingested turtles...")
            self.refresh_database_index()
            print("✅ Search index updated.")

        # Generate missing turtle report by cross-referencing drive with Google Sheets
        if drive_ids_by_sheet:
            self._generate_missing_turtle_report(drive_ids_by_sheet)

    # Health status values that indicate a dead turtle (case-insensitive)
    _DEAD_STATUSES = {'dead', 'deceased', 'mortality', 'doa', 'found dead'}

    def _generate_missing_turtle_report(self, drive_ids_by_sheet):
        """Cross-reference ingested drive IDs with Google Sheets to find missing turtles.

        For each sheet that had turtles on the drive, fetches all non-dead turtles
        from that sheet and identifies which ones were NOT on the drive. Also checks
        which turtles are missing a carapace reference image.

        Writes CSV reports to backend/data/benchmarks/.
        """
        try:
            from services.manager_service import get_sheets_service
            service = get_sheets_service()
            if not service:
                print("⚠️ Google Sheets not configured — skipping missing turtle report.")
                return
        except Exception as e:
            print(f"⚠️ Could not get Sheets service for missing report: {e}")
            return

        timestamp = time.strftime('%Y-%m-%d_%H%M%S')
        benchmarks_dir = os.path.join(self.base_dir, 'benchmarks')
        os.makedirs(benchmarks_dir, exist_ok=True)

        all_missing = []
        all_missing_carapace = []
        total_in_sheets = 0
        total_on_drive = 0

        backup_sheets = {'Backup (Initial State)', 'Backup (Inital State)', 'Backup'}

        for sheet_name, drive_ids in drive_ids_by_sheet.items():
            if sheet_name in backup_sheets:
                continue

            try:
                # Fetch all rows from this sheet
                escaped = f"'{sheet_name}'" if any(c in sheet_name for c in " !@#$%^&*()-+=") else sheet_name
                result = service.service.spreadsheets().values().get(
                    spreadsheetId=service.spreadsheet_id,
                    range=f"{escaped}!A:Z"
                ).execute()
                values = result.get('values', [])
                if len(values) < 2:
                    continue

                headers = values[0]
                col_idx = {}
                for i, h in enumerate(headers):
                    if h and h.strip():
                        col_idx[h.strip()] = i

                id_col = col_idx.get('ID')
                health_col = col_idx.get('Health Status')
                name_col = col_idx.get('Name')
                primary_col = col_idx.get('Primary ID')
                location_col = col_idx.get('General Location')

                if id_col is None:
                    print(f"⚠️ Sheet '{sheet_name}' has no ID column — skipping.")
                    continue

                sheet_turtles = []
                for row in values[1:]:
                    bio_id = (row[id_col].strip() if id_col < len(row) else '') if id_col is not None else ''
                    if not bio_id:
                        continue
                    health = (row[health_col].strip() if health_col is not None and health_col < len(row) else '').lower()
                    if health in self._DEAD_STATUSES:
                        continue
                    name = row[name_col].strip() if name_col is not None and name_col < len(row) else ''
                    primary_id = row[primary_col].strip() if primary_col is not None and primary_col < len(row) else ''
                    gen_location = row[location_col].strip() if location_col is not None and location_col < len(row) else ''
                    sheet_turtles.append({
                        'biology_id': bio_id,
                        'primary_id': primary_id,
                        'name': name,
                        'sheet_name': sheet_name,
                        'general_location': gen_location,
                    })

                total_in_sheets += len(sheet_turtles)
                total_on_drive += len(drive_ids)

                # Find turtles in sheets but not on drive
                for t in sheet_turtles:
                    if t['biology_id'] not in drive_ids:
                        all_missing.append(t)
                        # Check if this turtle also has no carapace on disk
                        has_carapace = self._turtle_has_carapace(t['biology_id'], sheet_name)
                        if not has_carapace:
                            all_missing_carapace.append(t)

            except Exception as e:
                print(f"⚠️ Error reading sheet '{sheet_name}' for missing report: {e}")
                continue

        # Write summary
        print(f"\n📊 Missing Turtle Report:")
        print(f"   Sheets scanned: {len(drive_ids_by_sheet)}")
        print(f"   Living turtles in sheets: {total_in_sheets}")
        print(f"   Turtles on drive: {total_on_drive}")
        print(f"   Missing from drive: {len(all_missing)}")
        print(f"   Missing carapace: {len(all_missing_carapace)}")

        # Write CSVs
        if all_missing:
            csv_path = os.path.join(benchmarks_dir, f"{timestamp}_missing_turtles.csv")
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['biology_id', 'primary_id', 'name', 'sheet_name', 'general_location'])
                writer.writeheader()
                writer.writerows(all_missing)
            print(f"   📄 CSV: {csv_path}")

        if all_missing_carapace:
            csv_path = os.path.join(benchmarks_dir, f"{timestamp}_missing_carapace.csv")
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['biology_id', 'primary_id', 'name', 'sheet_name', 'general_location'])
                writer.writeheader()
                writer.writerows(all_missing_carapace)
            print(f"   📄 CSV: {csv_path}")

        if not all_missing and not all_missing_carapace:
            print("   ✅ No missing turtles found.")

    def _turtle_has_carapace(self, biology_id, sheet_name):
        """Check if a turtle has a carapace/ folder with a .pt file on disk."""
        # Search the data directory for this turtle's folder
        for root, dirs, files in os.walk(self.base_dir):
            if os.path.basename(root) == biology_id:
                carapace_dir = os.path.join(root, 'carapace')
                if os.path.isdir(carapace_dir):
                    for f in os.listdir(carapace_dir):
                        if f.endswith('.pt'):
                            return True
                return False
        return False

    def _process_single_turtle(self, source_path, location_dir, turtle_id, photo_type="plastron"):
        """Creates folders and generates .pt tensor file using SuperPoint.

        Args:
            photo_type: 'plastron' (default) saves to plastron/, 'carapace' saves to carapace/.
        """
        turtle_dir = os.path.join(location_dir, turtle_id)

        if photo_type == "carapace":
            data_dir = os.path.join(turtle_dir, 'carapace')
        else:
            data_dir = os.path.join(turtle_dir, 'plastron')

        os.makedirs(data_dir, exist_ok=True)
        # Create the full folder structure for both photo types
        for subdir in ('plastron', 'plastron/Old References', 'plastron/Other Plastrons',
                       'carapace', 'carapace/Old References', 'carapace/Other Carapaces'):
            os.makedirs(os.path.join(turtle_dir, subdir), exist_ok=True)

        ext = os.path.splitext(source_path)[1]
        dest_image_path = os.path.join(data_dir, f"{turtle_id}{ext}")
        dest_pt_path = os.path.join(data_dir, f"{turtle_id}.pt")

        # Also check legacy ref_data/ path for existing plastron turtles
        if os.path.exists(dest_pt_path):
            return "skipped"
        if photo_type == "plastron":
            legacy_pt = os.path.join(turtle_dir, 'ref_data', f"{turtle_id}.pt")
            if os.path.exists(legacy_pt):
                return "skipped"

        shutil.copy2(source_path, dest_image_path)
        try:
            success = brain.process_and_save(dest_image_path, dest_pt_path)
        except Exception as e:
            print(f"   ⚠️ SuperPoint crashed for {turtle_id}: {e}")
            # Clean up the copied image so a future ingest can retry
            try:
                if os.path.exists(dest_image_path):
                    os.remove(dest_image_path)
                if os.path.exists(dest_pt_path):
                    os.remove(dest_pt_path)
            except OSError:
                pass
            return "error"

        if success:
            print(f"   ✅ Processed New: {turtle_id} ({photo_type})")
            return "created"
        else:
            print(f"   ⚠️ SuperPoint Processing Failed: {turtle_id}")
            return "error"

    def handle_community_upload(self, image_path, finder_name="Anonymous"):
        """Saves an image to Community_Uploads and queues it."""
        dest_folder = os.path.join(self.base_dir, "Community_Uploads", finder_name)
        os.makedirs(dest_folder, exist_ok=True)

        filename = os.path.basename(image_path)
        saved_path = os.path.join(dest_folder, filename)
        shutil.copy2(image_path, saved_path)
        print(f"Saved community find by {finder_name}")

        self.create_review_packet(saved_path, user_info={"finder": finder_name})

    # MERGE FIX: Uses your AI candidate generation, but adds partner's 'additional_images' folder.
    def create_review_packet(self, image_path, user_info=None, req_id=None):
        """Creates a pending packet in Review Queue, generates candidates, preps extra dirs.

        photo_type in user_info controls which VRAM cache to search:
        - 'plastron' (default) or 'carapace' runs matching immediately.
        - 'unclassified' skips matching — admin must classify first via the review queue.
        """
        safe_name = os.path.basename(image_path).replace(" ", "_")
        if req_id is None:
            req_id = f"Req_{int(time.time() * 1000)}_{safe_name}_{uuid.uuid4().hex[:6]}"
        packet_dir = os.path.join(self.review_queue_dir, req_id)
        os.makedirs(packet_dir, exist_ok=True)

        # 1. Copy the raw uploaded image into the packet
        shutil.copy2(image_path, packet_dir)

        # 2. Determine photo_type from user_info
        meta = user_info if user_info else {}
        photo_type = meta.get('photo_type', 'plastron')

        # 3. Run the AI Search to find candidates (skip if unclassified)
        results = []
        if photo_type != 'unclassified':
            print(f"🔍 Generating candidates for Review Packet: {req_id} ({photo_type})...")
            results, _ = self.search_for_matches(image_path, photo_type=photo_type)
        else:
            print(f"⏳ Review Packet {req_id}: photo_type unclassified — skipping matching until admin classifies.")

        # 4. Create candidate directory and populate it
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')
        os.makedirs(candidates_dir, exist_ok=True)

        for rank, match in enumerate(results, start=1):
            turtle_id = match.get('site_id', 'Unknown')
            pt_path = match.get('file_path', '')

            ref_img_path = None
            if pt_path and pt_path.endswith('.pt'):
                base_path = pt_path[:-3]
                for ext in ['.jpg', '.jpeg', '.png']:
                    if os.path.exists(base_path + ext):
                        ref_img_path = base_path + ext
                        break

            if ref_img_path:
                ext = os.path.splitext(ref_img_path)[1]
                conf_int = int(round(match.get('confidence', 0.0) * 100))
                cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                shutil.copy2(ref_img_path, os.path.join(candidates_dir, cand_filename))

        # 5. Dump metadata for the frontend (includes photo_type)
        if 'photo_type' not in meta:
            meta['photo_type'] = photo_type
        with open(os.path.join(packet_dir, 'metadata.json'), 'w') as f:
            json.dump(meta, f)

        # 5. Create additional_images dir (Partner's Dashboard Support)
        additional_dir = os.path.join(packet_dir, 'additional_images')
        os.makedirs(additional_dir, exist_ok=True)

        print(f"📦 Review Packet {req_id} created with {len(results)} candidates.")
        return req_id

    def get_review_queue(self):
        """Scans the 'Review_Queue' folder and returns the list of pending requests."""
        queue_items = []
        if os.path.exists(self.review_queue_dir):
            for req_id in os.listdir(self.review_queue_dir):
                req_path = os.path.join(self.review_queue_dir, req_id)
                if os.path.isdir(req_path):
                    queue_items.append({'request_id': req_id, 'path': req_path, 'status': 'pending'})
        return queue_items

    def replace_turtle_reference(self, turtle_id, new_image_path, photo_type="plastron", sheet_name=None):
        """Atomically replace the plastron or carapace reference image for an existing turtle.

        Archives the old .pt+image to {photo_type}/Old References/, stages the new
        .pt+image, promotes atomically, and updates the VRAM cache. Guarded by
        _approval_lock so concurrent admin actions can't race.

        Args:
            turtle_id: Primary key of the turtle (folder name on disk).
            new_image_path: Path to the new reference image (must already exist on disk).
            photo_type: 'plastron' (default) or 'carapace'.
            sheet_name: Optional location hint to disambiguate multi-location turtles.

        Returns:
            (success: bool, message: str)
        """
        if photo_type not in ('plastron', 'carapace'):
            return False, f"Invalid photo_type: {photo_type}"
        if not new_image_path or not os.path.exists(new_image_path):
            return False, "New image file not found"

        with self._approval_lock:
            target_dir = self._get_turtle_folder(turtle_id, sheet_name)
            if not target_dir:
                return False, f"Could not find folder for {turtle_id}"

            if photo_type == "carapace":
                ref_dir = os.path.join(target_dir, 'carapace')
                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
                cache_attr = 'vram_cache_carapace'
                print_prefix = "✨ UPGRADING CARAPACE REFERENCE"
                archive_prefix = "Archived_Carapace"
            else:
                plastron_dir = os.path.join(target_dir, 'plastron')
                ref_data_dir = os.path.join(target_dir, 'ref_data')
                if os.path.isdir(plastron_dir):
                    ref_dir = plastron_dir
                elif os.path.isdir(ref_data_dir):
                    ref_dir = ref_data_dir
                else:
                    ref_dir = plastron_dir
                archive_dir = os.path.join(target_dir, 'plastron', 'Old References')
                cache_attr = 'vram_cache_plastron'
                print_prefix = "✨ UPGRADING REFERENCE"
                archive_prefix = "Archived_Master"
            os.makedirs(ref_dir, exist_ok=True)
            os.makedirs(archive_dir, exist_ok=True)

            print(f"{print_prefix} for {turtle_id}...")
            old_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")
            old_img_path = None
            for ext in ['.jpg', '.jpeg', '.png']:
                possible = os.path.join(ref_dir, f"{turtle_id}{ext}")
                if os.path.exists(possible):
                    old_img_path = possible
                    break

            op_ts = int(time.time() * 1000)
            new_ext = os.path.splitext(new_image_path)[1] or '.jpg'
            staged_master_path = os.path.join(ref_dir, f"{turtle_id}_staged_{op_ts}{new_ext}")
            staged_pt_path = os.path.join(ref_dir, f"{turtle_id}_staged_{op_ts}.pt")

            # Stage new master and .pt first; only promote if extraction succeeds.
            shutil.copy2(new_image_path, staged_master_path)
            try:
                staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
            except Exception as e:
                print(f"   ⚠️ SuperPoint crashed during reference upgrade for {turtle_id}: {e}")
                staged_ok = False
            if not staged_ok:
                for p in [staged_master_path, staged_pt_path]:
                    try:
                        if os.path.exists(p):
                            os.remove(p)
                    except OSError:
                        pass
                return False, f"Failed to extract features for replacement image of {turtle_id}"

            new_master_path = os.path.join(ref_dir, f"{turtle_id}{new_ext}")
            new_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")

            # Step 1: Archive old image to Old References (copy, not move).
            # Date suffix encodes the EXIF "taken" date (when known) or the upload date.
            if old_img_path:
                archive_date = _extract_exif_date(old_img_path) or time.strftime('%Y-%m-%d', time.gmtime())
                archive_name = f"{archive_prefix}_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                print(f"   📦 Archived old master to {archive_name}")

            # Step 2: Promote staged files atomically
            if os.path.exists(new_master_path) and new_master_path != staged_master_path:
                os.remove(new_master_path)
            shutil.move(staged_master_path, new_master_path)
            shutil.move(staged_pt_path, new_pt_path)
            # Mark the promoted master as uploaded NOW. The filename carries no
            # date stamp, so _extract_upload_date_from_filename falls back to
            # mtime — which shutil.copy2 inherits from the source. Without this
            # touch, the new reference won't appear in today's scratchpad.
            try:
                os.utime(new_master_path, None)
            except OSError:
                pass

            # Step 3: Clean up old image if it was a different extension
            if old_img_path and os.path.exists(old_img_path) and old_img_path != new_master_path:
                try:
                    os.remove(old_img_path)
                except OSError:
                    pass

            # Incremental VRAM cache update: evict old entry, add new
            cache = getattr(brain, cache_attr, [])
            setattr(brain, cache_attr, [c for c in cache if c['file_path'] != old_pt_path])
            rel_path = os.path.relpath(ref_dir, self.base_dir)
            loc_parts = rel_path.split(os.sep)[:-2]
            location_name = "/".join(loc_parts)
            brain.add_single_to_vram(new_pt_path, turtle_id, location_name, photo_type=photo_type)
            print(f"   ✅ {turtle_id} {photo_type} reference upgraded successfully.")
            return True, f"{photo_type.capitalize()} reference replaced for {turtle_id}"

    def replace_plastron_reference(self, turtle_id, new_image_path, sheet_name=None):
        """Convenience wrapper: replace plastron reference. See replace_turtle_reference."""
        return self.replace_turtle_reference(turtle_id, new_image_path, photo_type="plastron", sheet_name=sheet_name)

    def replace_carapace_reference(self, turtle_id, new_image_path, sheet_name=None):
        """Convenience wrapper: replace carapace reference. See replace_turtle_reference."""
        return self.replace_turtle_reference(turtle_id, new_image_path, photo_type="carapace", sheet_name=sheet_name)

    # ------------------------------------------------------------------
    # Soft delete / restore / list deleted
    #
    # .pt files are NEVER moved to Deleted/ — they are hard-deleted on soft
    # delete and regenerated fresh on restore-as-reference. This keeps the
    # Deleted folder images-only and guarantees .pt consistency on revert.
    # ------------------------------------------------------------------
    def _path_is_inside(self, child, parent):
        """True if `child` resolves to a path under `parent`."""
        try:
            child_abs = os.path.realpath(child)
            parent_abs = os.path.realpath(parent)
            return os.path.commonpath([child_abs, parent_abs]) == parent_abs
        except (ValueError, OSError):
            return False

    def _classify_active_ref(self, turtle_dir, abs_src):
        """Return 'plastron' / 'carapace' if abs_src is the active ref file, else None."""
        basename = os.path.basename(abs_src)
        stem, ext = os.path.splitext(basename)
        if ext.lower() not in ('.jpg', '.jpeg', '.png'):
            return None
        turtle_id = os.path.basename(turtle_dir)
        if stem != turtle_id:
            return None
        parent = os.path.dirname(abs_src)
        parent_name = os.path.basename(parent)
        if parent_name == 'plastron' and os.path.dirname(parent) == turtle_dir:
            return 'plastron'
        if parent_name == 'carapace' and os.path.dirname(parent) == turtle_dir:
            return 'carapace'
        # Legacy ref_data also counts as active plastron slot.
        if parent_name == 'ref_data' and os.path.dirname(parent) == turtle_dir:
            return 'plastron'
        return None

    def _find_most_recent_old_reference(self, ref_subdir):
        """Return the absolute path of the most recent image in `{...}/Old References/`, or None."""
        old_refs_dir = os.path.join(ref_subdir, 'Old References')
        if not os.path.isdir(old_refs_dir):
            return None
        candidates = []
        for fname in os.listdir(old_refs_dir):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            full = os.path.join(old_refs_dir, fname)
            # Prefer embedded ms timestamp (Archived_Master_{ms} / Archived_Carapace_{ms}),
            # fall back to mtime.
            score = None
            m = re.search(r'_(\d{10,})', fname)
            if m:
                try:
                    score = int(m.group(1))
                except ValueError:
                    pass
            if score is None:
                try:
                    score = int(os.path.getmtime(full) * 1000)
                except OSError:
                    continue
            candidates.append((score, full))
        if not candidates:
            return None
        candidates.sort(reverse=True)
        return candidates[0][1]

    def _evict_from_vram(self, pt_path, photo_type):
        cache_attr = 'vram_cache_carapace' if photo_type == 'carapace' else 'vram_cache_plastron'
        cache = getattr(brain, cache_attr, [])
        setattr(brain, cache_attr, [c for c in cache if c.get('file_path') != pt_path])

    def _location_name_for_ref_dir(self, ref_dir):
        rel_path = os.path.relpath(ref_dir, self.base_dir)
        loc_parts = rel_path.split(os.sep)[:-2]
        return "/".join(loc_parts)

    def soft_delete_turtle_image(self, turtle_id, src_path, sheet_name=None):
        """Move an image into `{turtle_dir}/Deleted/{original_rel_path}`.

        Hard-deletes the companion .pt (if any) since the design keeps Deleted/
        images-only. If the source was the active plastron or carapace
        reference, automatically reverts to the most recent Old Reference:
        moves that image into the active slot, regenerates its .pt, and
        updates the VRAM cache.

        Returns (success: bool, info: dict). Info contains:
            - 'moved_to': absolute path of the Deleted/ destination
            - 'was_reference': 'plastron' | 'carapace' | None
            - 'reverted': bool — whether an Old Reference was promoted
            - 'new_reference_path': absolute path of the newly-active ref, or None
            - 'error': error message when success is False
        """
        with self._approval_lock:
            turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
            if not turtle_dir:
                return False, {'error': f"Could not find folder for {turtle_id}"}
            abs_src = os.path.realpath(src_path)
            if not os.path.isfile(abs_src):
                return False, {'error': f"Image not found: {src_path}"}
            if not self._path_is_inside(abs_src, turtle_dir):
                return False, {'error': "Refusing to delete: path is outside the turtle folder"}
            # Never let Deleted/ be used as a source to Deleted/ (double-delete).
            rel = os.path.relpath(abs_src, turtle_dir)
            if rel.split(os.sep)[0] == 'Deleted':
                return False, {'error': "File is already in the Deleted folder"}

            was_reference = self._classify_active_ref(turtle_dir, abs_src)

            # Compute destination under Deleted/ preserving the original relative path.
            dest = os.path.join(turtle_dir, 'Deleted', rel)
            if os.path.exists(dest):
                # Collision in Deleted/ — suffix with a ms stamp to preserve history.
                stem, ext = os.path.splitext(dest)
                dest = f"{stem}_{int(time.time() * 1000)}{ext}"
            os.makedirs(os.path.dirname(dest), exist_ok=True)

            # Hard-delete the companion .pt (same basename stem, .pt extension)
            # before moving so we never leave a stale .pt pointing at a missing image.
            companion_pt = os.path.splitext(abs_src)[0] + '.pt'
            if os.path.isfile(companion_pt):
                try:
                    os.remove(companion_pt)
                except OSError as e:
                    print(f"   ⚠️ Could not remove companion .pt {companion_pt}: {e}")

            try:
                shutil.move(abs_src, dest)
            except OSError as e:
                return False, {'error': f"Failed to move image to Deleted/: {e}"}
            print(f"🗑️ Soft-deleted {rel} for {turtle_id} → Deleted/")

            info = {
                'moved_to': dest,
                'was_reference': was_reference,
                'reverted': False,
                'new_reference_path': None,
            }

            if was_reference:
                # Evict the deleted ref from VRAM using the path its .pt had.
                old_pt_path = os.path.splitext(abs_src)[0] + '.pt'
                self._evict_from_vram(old_pt_path, was_reference)

                ref_dir = os.path.dirname(abs_src)
                prev = self._find_most_recent_old_reference(ref_dir)
                if prev:
                    prev_ext = os.path.splitext(prev)[1] or '.jpg'
                    new_master_path = os.path.join(ref_dir, f"{turtle_id}{prev_ext}")
                    new_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")
                    try:
                        shutil.move(prev, new_master_path)
                    except OSError as e:
                        return True, {**info, 'error_promoting': f"Moved deleted ref but failed to promote previous: {e}"}
                    try:
                        ok = brain.process_and_save(new_master_path, new_pt_path)
                    except Exception as e:
                        print(f"   ⚠️ SuperPoint crashed during auto-revert for {turtle_id}: {e}")
                        ok = False
                    if ok:
                        loc_name = self._location_name_for_ref_dir(ref_dir)
                        brain.add_single_to_vram(new_pt_path, turtle_id, loc_name, photo_type=was_reference)
                        info['reverted'] = True
                        info['new_reference_path'] = new_master_path
                        print(f"   ✅ Auto-reverted {turtle_id} {was_reference} to most recent Old Reference.")
                    else:
                        info['error_promoting'] = "Previous reference promoted but .pt extraction failed"
                else:
                    print(f"   ⚠️ No Old References available for {turtle_id} {was_reference}; turtle now has no active ref.")

            return True, info

    def restore_turtle_image(self, turtle_id, deleted_rel_path, sheet_name=None):
        """Restore a previously soft-deleted image back to its original location.

        Fails if the destination already exists (user must soft-delete the occupant
        first). If the destination is an active-ref slot (plastron/{id}.ext or
        carapace/{id}.ext), regenerates the .pt and updates the VRAM cache.

        Returns (success: bool, info: dict). Info contains:
            - 'restored_to': absolute path the image was restored to
            - 'is_reference': 'plastron' | 'carapace' | None
            - 'error': message when success is False
            - 'collision': True when failure is due to target already existing
        """
        with self._approval_lock:
            turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
            if not turtle_dir:
                return False, {'error': f"Could not find folder for {turtle_id}"}

            # Accept either an absolute path or a relative-to-turtle-dir path.
            if os.path.isabs(deleted_rel_path):
                abs_src = os.path.realpath(deleted_rel_path)
                if not self._path_is_inside(abs_src, turtle_dir):
                    return False, {'error': "Path is outside the turtle folder"}
                rel = os.path.relpath(abs_src, turtle_dir)
            else:
                rel = deleted_rel_path
                abs_src = os.path.realpath(os.path.join(turtle_dir, rel))

            parts = rel.split(os.sep)
            if not parts or parts[0] != 'Deleted':
                return False, {'error': "Path is not inside Deleted/"}
            if not os.path.isfile(abs_src):
                return False, {'error': "Deleted image not found"}

            target_rel = os.sep.join(parts[1:])
            target_abs = os.path.join(turtle_dir, target_rel)
            if os.path.exists(target_abs):
                return False, {'error': "A file already exists at the restore location. Delete it first, then retry restore.", 'collision': True}

            os.makedirs(os.path.dirname(target_abs), exist_ok=True)
            try:
                shutil.move(abs_src, target_abs)
            except OSError as e:
                return False, {'error': f"Failed to move file: {e}"}

            is_reference = self._classify_active_ref(turtle_dir, target_abs)
            info = {'restored_to': target_abs, 'is_reference': is_reference}

            if is_reference:
                ref_dir = os.path.dirname(target_abs)
                new_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")
                # Defensive: evict any stale VRAM entry pointing at this turtle+type.
                self._evict_from_vram(new_pt_path, is_reference)
                try:
                    ok = brain.process_and_save(target_abs, new_pt_path)
                except Exception as e:
                    print(f"   ⚠️ SuperPoint crashed during restore for {turtle_id}: {e}")
                    ok = False
                if not ok:
                    info['warning'] = "Image restored but .pt extraction failed; try again or restart backend"
                else:
                    loc_name = self._location_name_for_ref_dir(ref_dir)
                    brain.add_single_to_vram(new_pt_path, turtle_id, loc_name, photo_type=is_reference)
                    print(f"   ✅ Restored {turtle_id} {is_reference} reference and refreshed VRAM.")

            # Clean up now-empty parent dirs inside Deleted/ (purely cosmetic).
            try:
                deleted_parent = os.path.dirname(abs_src)
                while deleted_parent and deleted_parent != turtle_dir:
                    if not os.listdir(deleted_parent):
                        os.rmdir(deleted_parent)
                        deleted_parent = os.path.dirname(deleted_parent)
                    else:
                        break
            except OSError:
                pass

            return True, info

    def list_deleted_turtle_images(self, turtle_id, sheet_name=None):
        """Enumerate every image under `{turtle_dir}/Deleted/` with its original path and category."""
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir:
            return []
        deleted_root = os.path.join(turtle_dir, 'Deleted')
        if not os.path.isdir(deleted_root):
            return []

        def _category_for(original_rel):
            parts = original_rel.split(os.sep)
            if len(parts) == 2 and parts[0] in ('plastron', 'carapace', 'ref_data'):
                return 'reference'
            if len(parts) >= 3 and parts[0] == 'plastron' and parts[1] == 'Old References':
                return 'plastron_old_ref'
            if len(parts) >= 3 and parts[0] == 'plastron' and parts[1] == 'Other Plastrons':
                return 'plastron_other'
            if len(parts) >= 3 and parts[0] == 'carapace' and parts[1] == 'Old References':
                return 'carapace_old_ref'
            if len(parts) >= 3 and parts[0] == 'carapace' and parts[1] == 'Other Carapaces':
                return 'carapace_other'
            if parts[0] == 'additional_images':
                return 'additional'
            if parts[0] == 'loose_images':
                return 'loose_legacy'
            return 'unknown'

        out = []
        for root, dirs, files in os.walk(deleted_root):
            for fname in files:
                if not fname.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    continue
                abs_path = os.path.join(root, fname)
                # Path relative to turtle_dir — always starts with 'Deleted/...'
                deleted_rel = os.path.relpath(abs_path, turtle_dir)
                original_rel = os.sep.join(deleted_rel.split(os.sep)[1:])
                original_abs = os.path.join(turtle_dir, original_rel)
                category = _category_for(original_rel)

                exif = _extract_exif_date(abs_path)
                try:
                    # Re-use the route-level helper if available; keep local fallback to mtime.
                    from routes.turtles import _extract_upload_date_from_filename as _eu
                    upload = _eu(fname, fallback_path=abs_path)
                except Exception:
                    try:
                        upload = time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(abs_path)))
                    except OSError:
                        upload = None

                out.append({
                    'path': abs_path,
                    'original_path': original_abs,
                    'deleted_rel_path': deleted_rel,
                    'category': category,
                    'timestamp': exif or upload,
                    'exif_date': exif,
                    'upload_date': upload,
                })
        return out

    def approve_review_packet(self, request_id, match_turtle_id=None, replace_reference=False,
                              new_location=None, new_turtle_id=None, uploaded_image_path=None,
                              find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None,
                              new_admin_location=None, photo_type="plastron",
                              delete_packet=True, replace_carapace_reference=False):
        """
        Processes approval of a review-queue packet.
        - replace_reference=True: Stages and upgrades the SuperPoint .pt master image safely.
        - replace_carapace_reference=True: Replace carapace reference using the FIRST carapace additional image.
        - is_community_upload: New turtle files go under data/Community_Uploads/<sheet_name>.
        - match_from_community: Matched turtle is in Community_Uploads; move folder to new_admin_location.
        - Merges date-stamped additional_images and updates find_metadata.json.
        - delete_packet=False: leaves the packet in the queue (caller handles deletion after Sheets sync).
        """
        with self._approval_lock:
            return self._approve_review_packet_locked(
                request_id, match_turtle_id=match_turtle_id,
                replace_reference=replace_reference, new_location=new_location,
                new_turtle_id=new_turtle_id, uploaded_image_path=uploaded_image_path,
                find_metadata=find_metadata, is_community_upload=is_community_upload,
                match_from_community=match_from_community,
                community_sheet_name=community_sheet_name,
                new_admin_location=new_admin_location, photo_type=photo_type,
                delete_packet=delete_packet,
                replace_carapace_reference=replace_carapace_reference,
            )

    def _approve_review_packet_locked(self, request_id, match_turtle_id=None, replace_reference=False,
                              new_location=None, new_turtle_id=None, uploaded_image_path=None,
                              find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None,
                              replace_carapace_reference=False,
                              new_admin_location=None, photo_type="plastron",
                              delete_packet=True):
        query_image = None
        packet_dir = self._resolve_packet_dir(request_id)

        # Early check: if packet was already processed by another admin, fail fast
        if packet_dir and not os.path.exists(packet_dir):
            if not (uploaded_image_path and os.path.exists(uploaded_image_path)):
                return False, "This item has already been processed by another admin"

        if packet_dir and os.path.exists(packet_dir):
            for f in os.listdir(packet_dir):
                if f.lower().endswith(('.jpg', '.png', '.jpeg')) and f != 'metadata.json':
                    query_image = os.path.join(packet_dir, f)
                    break
        elif uploaded_image_path and os.path.exists(uploaded_image_path):
            query_image = uploaded_image_path
        else:
            return False, "Request not found and no image path provided"

        if not query_image or not os.path.exists(query_image):
            return False, "Error: No image found."

        # Scenario A: Adding to an existing turtle
        if match_turtle_id:
            target_dir = self._get_turtle_folder(match_turtle_id)
            if not target_dir:
                return False, f"Could not find folder for {match_turtle_id}"

            if photo_type == "carapace":
                ref_dir = os.path.join(target_dir, 'carapace')
                loose_dir = os.path.join(target_dir, 'carapace', 'Other Carapaces')
                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
            else:
                # Prefer new 'plastron/' layout; fall back to legacy 'ref_data/' for old turtles
                plastron_dir = os.path.join(target_dir, 'plastron')
                ref_data_dir = os.path.join(target_dir, 'ref_data')
                if os.path.isdir(plastron_dir):
                    ref_dir = plastron_dir
                elif os.path.isdir(ref_data_dir):
                    ref_dir = ref_data_dir
                else:
                    ref_dir = plastron_dir
                loose_dir = os.path.join(target_dir, 'plastron', 'Other Plastrons')
                archive_dir = os.path.join(target_dir, 'plastron', 'Old References')
            os.makedirs(ref_dir, exist_ok=True)
            os.makedirs(loose_dir, exist_ok=True)
            os.makedirs(archive_dir, exist_ok=True)

            if replace_reference:
                print(f"✨ UPGRADING REFERENCE for {match_turtle_id}...")
                old_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")
                old_img_path = None
                for ext in ['.jpg', '.jpeg', '.png']:
                    possible = os.path.join(ref_dir, f"{match_turtle_id}{ext}")
                    if os.path.exists(possible):
                        old_img_path = possible
                        break

                op_ts = int(time.time() * 1000)
                new_ext = os.path.splitext(query_image)[1]
                staged_master_path = os.path.join(ref_dir, f"{match_turtle_id}_staged_{op_ts}{new_ext}")
                staged_pt_path = os.path.join(ref_dir, f"{match_turtle_id}_staged_{op_ts}.pt")

                # Extract features first; only replace old master if staging succeeds.
                shutil.copy2(query_image, staged_master_path)
                try:
                    staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
                except Exception as e:
                    print(f"   ⚠️ SuperPoint crashed during reference upgrade for {match_turtle_id}: {e}")
                    staged_ok = False
                if not staged_ok:
                    try:
                        if os.path.exists(staged_master_path):
                            os.remove(staged_master_path)
                        if os.path.exists(staged_pt_path):
                            os.remove(staged_pt_path)
                    except OSError:
                        pass
                    return False, f"Failed to extract features for replacement image of {match_turtle_id}"

                # Atomic replacement: promote new files FIRST, then clean up old.
                # This way a crash at any point either leaves the old reference intact
                # or the new reference fully in place — never a gap with no .pt file.
                new_master_path = os.path.join(ref_dir, f"{match_turtle_id}{new_ext}")
                new_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")

                # Step 1: Archive old image to Old References (copy, not move — original stays until step 3)
                if old_img_path:
                    archive_date = _extract_exif_date(old_img_path) or time.strftime('%Y-%m-%d', time.gmtime())
                    archive_name = f"Archived_Master_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                    shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                    print(f"   📦 Archived old master to {archive_name}")

                # Step 2: Promote staged files to canonical names (overwrites old .pt and image atomically)
                if os.path.exists(new_master_path):
                    os.remove(new_master_path)
                shutil.move(staged_master_path, new_master_path)
                shutil.move(staged_pt_path, new_pt_path)
                # Mark the promoted master as uploaded NOW so the scratchpad's
                # mtime fallback in _extract_upload_date_from_filename returns
                # today. Without this, copy2 preserves the source mtime and
                # the new reference never shows up in today's scratchpad.
                try:
                    os.utime(new_master_path, None)
                except OSError:
                    pass
                # At this point the new reference is live — crash here is safe.

                # Step 3: Clean up old image if it was a different extension
                if old_img_path and os.path.exists(old_img_path) and old_img_path != new_master_path:
                    try:
                        os.remove(old_img_path)
                    except OSError:
                        pass

                obs_date = _extract_exif_date(query_image) or time.strftime('%Y-%m-%d', time.gmtime())
                obs_name = f"Obs_{int(time.time())}_{obs_date}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

                # Incremental cache update: remove old entry and add updated one
                cache_attr = 'vram_cache_carapace' if photo_type == 'carapace' else 'vram_cache_plastron'
                cache = getattr(brain, cache_attr, [])
                setattr(brain, cache_attr, [c for c in cache if c['file_path'] != old_pt_path])
                rel_path = os.path.relpath(ref_dir, self.base_dir)
                loc_parts = rel_path.split(os.sep)[:-2]
                location_name = "/".join(loc_parts)
                brain.add_single_to_vram(new_pt_path, match_turtle_id, location_name, photo_type=photo_type)
                print(f"   ✅ {match_turtle_id} upgraded successfully.")

            else:
                print(f"📸 Adding observation to {match_turtle_id}...")
                obs_date = _extract_exif_date(query_image) or time.strftime('%Y-%m-%d', time.gmtime())
                obs_name = f"Obs_{int(time.time())}_{obs_date}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

        # Scenario B: Creating a new turtle
        elif new_location and new_turtle_id:
            print(f"🐢 Creating new turtle {new_turtle_id} at {new_location}...")
            parts = [p.strip() for p in new_location.split('/') if p.strip()]
            sheet_name = parts[0] if parts else new_location
            if is_community_upload:
                location_dir = os.path.join(self.base_dir, 'Community_Uploads', sheet_name)
            elif len(parts) >= 2:
                location_dir = os.path.join(self.base_dir, parts[0], parts[1])
            else:
                location_dir = os.path.join(self.base_dir, sheet_name)
            os.makedirs(location_dir, exist_ok=True)

            status = self._process_single_turtle(query_image, location_dir, new_turtle_id, photo_type=photo_type)

            if status == 'created':
                print(f"✅ New turtle {new_turtle_id} created successfully at {new_location}")
                # Incremental cache update: add new turtle without full rebuild
                subdir = 'carapace' if photo_type == 'carapace' else 'plastron'
                pt_path = os.path.join(location_dir, new_turtle_id, subdir, f"{new_turtle_id}.pt")
                rel_path = os.path.relpath(location_dir, self.base_dir)
                location_name = rel_path.replace(os.sep, "/")
                brain.add_single_to_vram(pt_path, new_turtle_id, location_name, photo_type=photo_type)
                print("✅ Search index updated.")
            elif status == 'skipped':
                return False, f"Turtle {new_turtle_id} already exists at {new_location}"
            else:
                return False, f"Failed to process image for new turtle {new_turtle_id}"
        else:
            return False, "Either match_turtle_id or both new_location and new_turtle_id must be provided"

        # Post-processing: find metadata, merge additional_images, community move
        target_turtle_id = match_turtle_id if match_turtle_id else new_turtle_id
        if new_location:
            first = (new_location or '').split('/')[0].strip()
            location_hint = f"Community_Uploads/{first}" if is_community_upload else first
        elif match_from_community and community_sheet_name:
            location_hint = f"Community_Uploads/{community_sheet_name}"
        else:
            location_hint = None
        target_dir = self._get_turtle_folder(target_turtle_id, location_hint)

        if target_dir:
            if find_metadata is not None and isinstance(find_metadata, dict):
                meta_path = os.path.join(target_dir, 'find_metadata.json')
                with open(meta_path, 'w') as f:
                    json.dump(find_metadata, f)

            # Merge additional_images from packet into turtle's additional_images folder by date
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                dest_additional = os.path.join(target_dir, 'additional_images')

                if os.path.isdir(src_additional):
                    os.makedirs(dest_additional, exist_ok=True)
                    for date_folder in os.listdir(src_additional):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir):
                            continue
                        dest_date_dir = os.path.join(dest_additional, date_folder)
                        os.makedirs(dest_date_dir, exist_ok=True)

                        src_manifest_path = os.path.join(src_date_dir, 'manifest.json')
                        dest_manifest_path = os.path.join(dest_date_dir, 'manifest.json')

                        existing_manifest = []
                        if os.path.isfile(dest_manifest_path):
                            try:
                                with open(dest_manifest_path, 'r') as f:
                                    existing_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                pass
                        existing_filenames = {e.get('filename') for e in existing_manifest if e.get('filename')}

                        if os.path.isfile(src_manifest_path):
                            try:
                                with open(src_manifest_path, 'r') as f:
                                    packet_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                packet_manifest = []
                            for entry in packet_manifest:
                                fn = entry.get('filename')
                                if not fn or not os.path.isfile(os.path.join(src_date_dir, fn)):
                                    continue
                                # Skip carapace/plastron — they go to carapace/ or plastron/ folders, not additional_images/
                                if entry.get('type', '') in ('carapace', 'plastron'):
                                    continue
                                shutil.copy2(os.path.join(src_date_dir, fn), os.path.join(dest_date_dir, fn))
                                if fn not in existing_filenames:
                                    existing_manifest.append(entry)
                                    existing_filenames.add(fn)
                            with open(dest_manifest_path, 'w') as f:
                                json.dump(existing_manifest, f, indent=4)

            # Process plastron/carapace additional images: create references or route
            # to Other Plastrons / Other Carapaces folders.
            # First carapace image becomes the reference (or replaces it); extras go to Other Carapaces.
            # Same logic for plastron images.
            _ref_type_to_dir = {'plastron': 'plastron', 'carapace': 'carapace'}
            _other_dir = {'plastron': 'plastron/Other Plastrons', 'carapace': 'carapace/Other Carapaces'}
            _carapace_ref_handled = False  # Only the FIRST carapace can become/replace a reference
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                if os.path.isdir(src_additional):
                    for date_folder in sorted(os.listdir(src_additional)):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir):
                            continue
                        manifest_path = os.path.join(src_date_dir, 'manifest.json')
                        if not os.path.isfile(manifest_path):
                            continue
                        try:
                            with open(manifest_path, 'r') as f:
                                manifest = json.load(f)
                        except (json.JSONDecodeError, OSError):
                            continue
                        for entry in manifest:
                            img_type = entry.get('type', '')
                            if img_type not in _ref_type_to_dir:
                                continue
                            fn = entry.get('filename')
                            if not fn:
                                continue
                            src_img = os.path.join(src_date_dir, fn)
                            if not os.path.isfile(src_img):
                                continue

                            dest_subdir = os.path.join(target_dir, _ref_type_to_dir[img_type])
                            os.makedirs(dest_subdir, exist_ok=True)
                            ext = os.path.splitext(fn)[1] or '.jpg'
                            dest_img = os.path.join(dest_subdir, f"{target_turtle_id}{ext}")
                            dest_pt = os.path.join(dest_subdir, f"{target_turtle_id}.pt")
                            # Also check legacy ref_data/ for existing plastron references
                            has_ref = os.path.exists(dest_pt)
                            if not has_ref and img_type == 'plastron':
                                has_ref = os.path.exists(os.path.join(target_dir, 'ref_data', f"{target_turtle_id}.pt"))

                            # Decide: create reference, replace reference, or route to Other folder
                            should_replace_carapace = (img_type == 'carapace' and replace_carapace_reference
                                                       and not _carapace_ref_handled)
                            is_first_carapace = (img_type == 'carapace' and not _carapace_ref_handled)

                            if should_replace_carapace and has_ref:
                                # Atomic carapace reference replacement (same pattern as plastron)
                                _carapace_ref_handled = True
                                print(f"✨ UPGRADING CARAPACE REFERENCE for {target_turtle_id}...")
                                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
                                os.makedirs(archive_dir, exist_ok=True)
                                op_ts = int(time.time() * 1000)
                                old_pt_path = dest_pt
                                old_img_path = None
                                for old_ext in ['.jpg', '.jpeg', '.png']:
                                    possible = os.path.join(dest_subdir, f"{target_turtle_id}{old_ext}")
                                    if os.path.exists(possible):
                                        old_img_path = possible
                                        break
                                staged_master = os.path.join(dest_subdir, f"{target_turtle_id}_staged_{op_ts}{ext}")
                                staged_pt = os.path.join(dest_subdir, f"{target_turtle_id}_staged_{op_ts}.pt")
                                shutil.copy2(src_img, staged_master)
                                try:
                                    staged_ok = brain.process_and_save(staged_master, staged_pt)
                                except Exception as e:
                                    print(f"   ⚠️ SuperPoint crashed during carapace upgrade for {target_turtle_id}: {e}")
                                    staged_ok = False
                                if not staged_ok:
                                    for p in [staged_master, staged_pt]:
                                        try:
                                            if os.path.exists(p): os.remove(p)
                                        except OSError: pass
                                    print(f"   ⚠️ Carapace reference upgrade failed for {target_turtle_id}")
                                    continue
                                if old_img_path:
                                    archive_date = _extract_exif_date(old_img_path) or time.strftime('%Y-%m-%d', time.gmtime())
                                    archive_name = f"Archived_Carapace_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                                    shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                                if os.path.exists(dest_img): os.remove(dest_img)
                                shutil.move(staged_master, dest_img)
                                shutil.move(staged_pt, dest_pt)
                                if old_img_path and os.path.exists(old_img_path) and old_img_path != dest_img:
                                    try: os.remove(old_img_path)
                                    except OSError: pass
                                cache = getattr(brain, 'vram_cache_carapace', [])
                                brain.vram_cache_carapace = [c for c in cache if c['file_path'] != old_pt_path]
                                rel = os.path.relpath(target_dir, self.base_dir)
                                loc = os.path.dirname(rel).replace(os.sep, "/")
                                brain.add_single_to_vram(dest_pt, target_turtle_id, loc, photo_type='carapace')
                                print(f"   ✅ Carapace reference upgraded for {target_turtle_id}")

                            elif not has_ref and (img_type == 'plastron' or is_first_carapace):
                                # No reference exists yet — create one
                                if img_type == 'carapace':
                                    _carapace_ref_handled = True
                                shutil.copy2(src_img, dest_img)
                                if brain.process_and_save(dest_img, dest_pt):
                                    rel = os.path.relpath(target_dir, self.base_dir)
                                    loc = os.path.dirname(rel).replace(os.sep, "/")
                                    brain.add_single_to_vram(dest_pt, target_turtle_id, loc, photo_type=img_type)
                                    print(f"   ✅ {img_type.capitalize()} reference created for {target_turtle_id}")
                                else:
                                    print(f"   ⚠️ {img_type.capitalize()} SuperPoint extraction failed for {target_turtle_id}")

                            else:
                                # Reference already exists and not replacing — route to Other folder
                                if img_type == 'carapace':
                                    _carapace_ref_handled = True
                                other_dir = os.path.join(target_dir, _other_dir[img_type])
                                os.makedirs(other_dir, exist_ok=True)
                                ts = int(time.time() * 1000)
                                other_name = f"{img_type}_{ts}{ext}"
                                shutil.copy2(src_img, os.path.join(other_dir, other_name))
                                print(f"   📸 {img_type.capitalize()} saved to {_other_dir[img_type]}: {other_name}")

            # Move turtle folder from Community_Uploads to admin location
            if match_from_community and new_admin_location and match_turtle_id and target_dir and os.path.isdir(target_dir):
                parts = [p.strip() for p in new_admin_location.split('/') if p.strip()]
                if parts:
                    dest_dir = os.path.join(self.base_dir, *parts, match_turtle_id)
                    if not os.path.exists(dest_dir):
                        try:
                            os.makedirs(os.path.dirname(dest_dir), exist_ok=True)
                            shutil.move(target_dir, dest_dir)
                            print(f"📁 Moved turtle from Community_Uploads to {new_admin_location}")
                            print("♻️  Rebuilding search index...")
                            self.refresh_database_index()
                            print("✅ Search index updated.")
                        except Exception as move_err:
                            print(f"⚠️ Failed to move turtle folder: {move_err}")
                    else:
                        print(f"⚠️ Destination {dest_dir} already exists; turtle left in place.")

        if delete_packet:
            self._delete_packet(packet_dir, query_image, request_id)

        return True, "Processed successfully"

    def _delete_packet(self, packet_dir, query_image=None, request_id=None):
        """Remove a processed packet directory or temp file."""
        if packet_dir and os.path.exists(packet_dir):
            try:
                shutil.rmtree(packet_dir)
                print(f"🗑️ Queue Item {request_id or 'unknown'} deleted (Processed).")
            except Exception as e:
                print(f"⚠️ Error deleting packet: {e}")
        elif query_image:
            import tempfile
            temp_dir = tempfile.gettempdir()
            if query_image.startswith(temp_dir):
                try:
                    os.remove(query_image)
                    print(f"🗑️ Temp file deleted: {os.path.basename(query_image)}")
                except Exception as e:
                    print(f"⚠️ Error deleting temp file: {e}")

    def rollback_new_turtle(self, turtle_id, location, photo_type="plastron"):
        """Roll back a new turtle creation — removes folder from disk and evicts from VRAM cache."""
        parts = [p.strip() for p in location.split('/') if p.strip()]
        if len(parts) >= 2:
            turtle_dir = os.path.join(self.base_dir, parts[0], parts[1], turtle_id)
        else:
            turtle_dir = os.path.join(self.base_dir, parts[0], turtle_id) if parts else None

        if turtle_dir and os.path.exists(turtle_dir):
            try:
                shutil.rmtree(turtle_dir)
                print(f"🔙 Rolled back turtle folder: {turtle_dir}")
            except Exception as e:
                print(f"⚠️ Failed to roll back turtle folder: {e}")

        # Evict from VRAM cache (check both new 'plastron' and legacy 'ref_data' paths)
        subdirs_to_check = ['carapace'] if photo_type == 'carapace' else ['plastron', 'ref_data']
        pt_path_fragments = [os.path.join(turtle_id, sd, f"{turtle_id}.pt") for sd in subdirs_to_check]
        for cache_attr in ('vram_cache_plastron', 'vram_cache_carapace'):
            cache = getattr(brain, cache_attr, [])
            before = len(cache)
            filtered = [c for c in cache if not any(c['file_path'].endswith(frag) for frag in pt_path_fragments)]
            if len(filtered) < before:
                setattr(brain, cache_attr, filtered)
                print(f"🔙 Evicted {turtle_id} from {cache_attr}")

    def reject_review_packet(self, request_id):
        """Delete a review queue packet without processing (e.g. junk/spam)."""
        with self._approval_lock:
            packet_dir = self._resolve_packet_dir(request_id)
            if not packet_dir or not os.path.exists(packet_dir) or not os.path.isdir(packet_dir):
                return False, "Request not found"
            try:
                shutil.rmtree(packet_dir)
                print(f"🗑️ Queue Item {request_id} deleted (Rejected/Discarded).")
                return True, "Deleted"
            except Exception as e:
                return False, str(e)

    def _resolve_packet_dir(self, request_id):
        """Safely resolve a review-queue packet directory, preventing path traversal."""
        packet_dir = os.path.realpath(os.path.join(self.review_queue_dir, request_id))
        real_queue = os.path.realpath(self.review_queue_dir)
        try:
            if os.path.commonpath([packet_dir, real_queue]) != real_queue:
                return None
        except ValueError:
            return None
        return packet_dir

    # --- PARTNER'S HELPER AND TRACKING FUNCTIONS (KEPT 100%) ---

    def _get_turtle_folder(self, turtle_id, location_hint=None):
        """Resolve turtle folder path by turtle_id and optional location_hint.

        When location_hint is provided, returns an exact match.
        Without a hint, scans the entire data directory. If multiple folders
        match the same turtle_id (biology IDs repeat across states), returns
        None to avoid silently picking the wrong turtle.
        """
        if location_hint and location_hint != "Unknown":
            possible_path = os.path.join(self.base_dir, location_hint, turtle_id)
            if os.path.exists(possible_path):
                return possible_path
        matches = []
        for root, dirs, files in os.walk(self.base_dir):
            if os.path.basename(root) == turtle_id:
                matches.append(root)
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            print(f"⚠️ Multiple folders found for '{turtle_id}': {matches}. "
                  f"Provide a location_hint to disambiguate.")
            return None
        return None


    def add_additional_images_to_packet(self, request_id, files_with_types):
        packet_dir = self._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir): return False, "Request not found"
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(packet_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f: manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = (item.get('type') or 'other').lower()
            if typ not in ('microhabitat', 'condition', 'carapace', 'plastron', 'other'): typ = 'other'
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            exif_date = _extract_exif_date(src)
            stamp_date = exif_date or time.strftime('%Y-%m-%d', time.gmtime())
            safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            manifest.append({
                "filename": safe_name, "type": typ, "timestamp": ts,
                "exif_date": exif_date, "original_source": os.path.basename(src),
            })

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)
        return True, "OK"

    def remove_additional_image_from_packet(self, request_id, filename):
        packet_dir = self._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir): return False, "Request not found"
        additional_dir = os.path.join(packet_dir, 'additional_images')
        if not os.path.isdir(additional_dir): return False, "No additional images"
        if not filename or os.path.basename(filename) != filename: return False, "Invalid filename"

        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f: manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f: json.dump(new_manifest, f, indent=4)
                try:
                    os.remove(file_path)
                    return True
                except OSError:
                    return False
            return False

        if try_delete(additional_dir): return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir): return True, None
        return False, "Image not found"

    def search_for_matches(self, query_image_path, location_filter=None, photo_type="plastron"):
        """VRAM cached SuperPoint/LightGlue search with multi-location scope.

        Args:
            photo_type: 'plastron' (default) or 'carapace' — selects which VRAM cache to search.
        """
        t_start = time.time()
        filename = os.path.basename(query_image_path)

        # Build location filter: selected location always includes Community_Uploads + Incidental Places
        raw_loc = (location_filter or '').strip() or None
        if raw_loc and raw_loc != 'All Locations':
            if raw_loc == 'Community_Uploads':
                loc_filter = ['Community_Uploads']
            else:
                loc_filter = [raw_loc, 'Community_Uploads', 'Incidental Places']
        else:
            loc_filter = None

        scope = f" (Location: {loc_filter})" if loc_filter else " (all locations)"
        print(f"🔍 Searching {filename} (VRAM Cached Mode, {photo_type}){scope}...")

        # Extract query features ONCE (expensive SuperPoint step)
        query_feats = brain.extract_query_features(query_image_path)
        if query_feats is None:
            print(f"⚠️ Could not read query image")
            return [], time.time() - t_start

        results = brain.match_against_cache(query_feats, loc_filter, photo_type=photo_type)

        # Fallback: if the location-scoped search found fewer than 5 results,
        # re-run against the entire dataset so the admin always gets candidates.
        # Reuses the already-extracted query features (no duplicate SuperPoint cost).
        if loc_filter and len(results) < 5:
            print(f"📢 Only {len(results)} match(es) in scope — expanding to all locations...")
            results = brain.match_against_cache(query_feats, None, photo_type=photo_type)

        t_elapsed = time.time() - t_start

        if results:
            print(f"✅ Found {len(results)} matches in {t_elapsed:.2f}s")
        else:
            print(f"⚠️ No matches found in {t_elapsed:.2f}s")

        return results[:5], t_elapsed

    def add_observation_to_turtle(self, source_image_path, turtle_id, location_hint=None):
        """
        Moves an uploaded image to the turtle's plastron/Other Plastrons folder as an observation copy.
        """
        target_dir = None
        if location_hint and location_hint != 'Unknown':
            possible_path = os.path.join(self.base_dir, location_hint, turtle_id)
            if os.path.exists(possible_path):
                target_dir = possible_path

        if not target_dir:
            print(f"Scanning for home of {turtle_id}...")
            for root, dirs, files in os.walk(self.base_dir):
                if os.path.basename(root) == turtle_id:
                    target_dir = root
                    break

        if not target_dir:
            return False, f"Could not find folder for {turtle_id}"

        loose_dir = os.path.join(target_dir, 'plastron', 'Other Plastrons')
        os.makedirs(loose_dir, exist_ok=True)

        filename = os.path.basename(source_image_path)
        obs_date = _extract_exif_date(source_image_path) or time.strftime('%Y-%m-%d', time.gmtime())
        save_name = f"Obs_{int(time.time())}_{obs_date}_{filename}"
        dest_path = os.path.join(loose_dir, save_name)

        try:
            shutil.copy2(source_image_path, dest_path)
            print(f"📸 Observation added to {turtle_id}: {save_name}")
            return True, dest_path
        except Exception as e:
            return False, str(e)

    def add_additional_images_to_turtle(self, turtle_id, files_with_types, sheet_name=None):
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir): return False, "Turtle folder not found"
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(turtle_dir, 'additional_images', today_str)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        date_dir_created = False

        # Routes for carapace/plastron images — go to proper subfolders, not additional_images/
        _other_dir = {'plastron': 'plastron/Other Plastrons', 'carapace': 'carapace/Other Carapaces'}

        for item in files_with_types:
            src = item.get('path')
            typ = (item.get('type') or 'other').lower()
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            exif_date = _extract_exif_date(src)
            stamp_date = exif_date or time.strftime('%Y-%m-%d', time.gmtime())

            if typ in _other_dir:
                # Route carapace/plastron to their proper folders
                dest_dir = os.path.join(turtle_dir, _other_dir[typ])
                os.makedirs(dest_dir, exist_ok=True)
                safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{os.path.basename(src)}"
                safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
                shutil.copy2(src, os.path.join(dest_dir, safe_name))
                print(f"📸 {typ.capitalize()} added to {turtle_id}/{_other_dir[typ]}: {safe_name}")
            else:
                # Microhabitat, condition, additional, other → additional_images/
                if not date_dir_created:
                    os.makedirs(date_dir, exist_ok=True)
                    if os.path.exists(manifest_path):
                        with open(manifest_path, 'r') as f: manifest = json.load(f)
                    date_dir_created = True
                safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{os.path.basename(src)}"
                safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
                dest = os.path.join(date_dir, safe_name)
                shutil.copy2(src, dest)
                manifest.append({
                    "filename": safe_name, "type": typ, "timestamp": ts, "exif_date": exif_date,
                })

        if date_dir_created:
            with open(manifest_path, 'w') as f:
                json.dump(manifest, f, indent=4)
        return True, "OK"

    def remove_additional_image_from_turtle(self, turtle_id, filename, sheet_name=None):
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir): return False, "Turtle folder not found"
        additional_dir = os.path.join(turtle_dir, 'additional_images')
        if not os.path.isdir(additional_dir): return False, "No additional images folder"
        if not filename or os.path.basename(filename) != filename: return False, "Invalid filename"

        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f: manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f: json.dump(new_manifest, f, indent=4)
                try:
                    os.remove(file_path)
                    return True
                except OSError:
                    return False
            return False

        if try_delete(additional_dir): return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir): return True, None
        return False, "Image not found"

    def _add_turtle_flag_if_present(self, results, turtle_path, turtle_id, location_label):
        """If turtle_path has find_metadata.json, append to results (skip if already released)."""
        meta_path = os.path.join(turtle_path, 'find_metadata.json')
        if not os.path.isfile(meta_path): return
        try:
            with open(meta_path, 'r') as f:
                find_metadata = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        if find_metadata.get('released_at'): return
        results.append({
            'turtle_id': turtle_id,
            'location': location_label,
            'path': turtle_path,
            'find_metadata': find_metadata,
        })

    def clear_release_flag(self, turtle_id, location_hint=None):
        """Mark turtle as released back to nature: clear digital flag and set released_at."""
        turtle_dir = self._get_turtle_folder(turtle_id, location_hint)
        if not turtle_dir or not os.path.isdir(turtle_dir): return False, "Turtle folder not found"
        meta_path = os.path.join(turtle_dir, 'find_metadata.json')
        if not os.path.isfile(meta_path): return False, "No find metadata"
        try:
            with open(meta_path, 'r') as f:
                find_metadata = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            return False, str(e)
        for key in ('digital_flag_lat', 'digital_flag_lon', 'digital_flag_source'):
            find_metadata.pop(key, None)
        find_metadata['released_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        try:
            with open(meta_path, 'w') as f:
                json.dump(find_metadata, f)
        except OSError as e:
            return False, str(e)
        return True, None

    def get_turtles_with_flags(self):
        """Scan data dir for turtles that have find_metadata.json."""
        results = []
        for state in sorted(os.listdir(self.base_dir)):
            state_path = os.path.join(self.base_dir, state)
            if not os.path.isdir(state_path) or state.startswith('.'):
                continue
            if state in ["Review_Queue", "Community_Uploads"]:
                continue
            for name in sorted(os.listdir(state_path)):
                sub_path = os.path.join(state_path, name)
                if not os.path.isdir(sub_path) or name.startswith('.'): continue
                self._add_turtle_flag_if_present(results, sub_path, name, state)
                for turtle_id in sorted(os.listdir(sub_path)):
                    turtle_path = os.path.join(sub_path, turtle_id)
                    if not os.path.isdir(turtle_path) or turtle_id.startswith('.'): continue
                    self._add_turtle_flag_if_present(results, turtle_path, turtle_id, f"{state}/{name}")
        return results


# --- TEST BLOCK ---
if __name__ == "__main__":
    manager = TurtleManager()
    print("\n--- Checking Queue Status ---")
    manager.get_review_queue()

    path = input("\n(Optional) Enter Flash Drive Path to test Ingest: ")
    if path:
        manager.ingest_flash_drive(path)