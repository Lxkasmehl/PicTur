import os
import shutil
import time
import cv2 as cv
import json
import sys
import uuid

# --- PATH HACK ---
# This ensures we can find the 'turtles' package regardless of where we run this script
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from additional_image_labels import (
    label_query_matches,
    normalize_additional_type,
    normalize_label_list,
)

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

_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


def _find_image_next_to_pt(pt_path):
    """Case-insensitive lookup: return the actual image file next to a .pt path.

    Linux is case-sensitive, so a hardcoded lowercase-only extension list fails
    for files named e.g. ``F128.JPG``. Scan the directory and match the stem
    with any supported image extension regardless of case.

    Returns the discovered image path, or ``None`` when no image is found.
    """
    if not pt_path or not pt_path.endswith('.pt'):
        return None
    base = pt_path[:-3]
    dir_path = os.path.dirname(base) or '.'
    base_name = os.path.basename(base)
    if not os.path.isdir(dir_path):
        return None
    try:
        entries = os.listdir(dir_path)
    except OSError:
        return None
    for fname in entries:
        stem, ext = os.path.splitext(fname)
        if stem == base_name and ext.lower() in _IMAGE_EXTENSIONS:
            return os.path.join(dir_path, fname)
    return None


def _find_image_in_dir(dir_path, stem):
    """Case-insensitive sibling: find ``<stem>.<ext>`` in ``dir_path`` for any image ext."""
    if not os.path.isdir(dir_path):
        return None
    try:
        entries = os.listdir(dir_path)
    except OSError:
        return None
    for fname in entries:
        fstem, ext = os.path.splitext(fname)
        if fstem == stem and ext.lower() in _IMAGE_EXTENSIONS:
            return os.path.join(dir_path, fname)
    return None

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


def _location_dir_from_sheet_name(sheet_name):
    """Turn a sheet/location string (e.g. Kansas/Topeka) into a relative path under data/."""
    if not sheet_name or not isinstance(sheet_name, str):
        return None
    raw = sheet_name.strip().replace("\\", "/")
    parts = []
    for p in raw.split("/"):
        if not str(p).strip():
            continue
        seg = _safe_folder_name(p)
        if seg in (".", ".."):
            continue
        parts.append(seg)
    if not parts:
        return None
    return os.path.join(*parts)


def _resolved_path_under_base(base_dir, *relative_parts):
    """realpath(join(base_dir, *parts)); return it only if it stays under realpath(base_dir).

    Blocks ``..``, absolute segments in *relative_parts*, and symlink escapes before makedirs.
    """
    if not relative_parts:
        return None
    if any(p is None or p == "" for p in relative_parts):
        return None
    try:
        candidate = os.path.join(base_dir, *relative_parts)
    except (TypeError, ValueError):
        return None
    real_base = os.path.realpath(base_dir)
    real_candidate = os.path.realpath(candidate)
    try:
        if os.path.commonpath([real_candidate, real_base]) != real_base:
            return None
    except ValueError:
        return None
    return real_candidate


# --- FLASH DRIVE INGEST: Map drive folder names to backend folder names ---
# When folder names on the flash drive don't match backend/Google Sheets, add mappings here.
# Ingest will route files to the correct backend State/Location based on these maps.

# Flat structure: when drive has location folders directly at root (no State parent),
# map each folder name to "State/Location". Takes precedence over hierarchical logic.
DRIVE_LOCATION_TO_BACKEND_PATH = {
    "Dee Hobelman": "Kansas/Dee Hobelman",
    "Karlyle Woods": "Kansas/Karlyle Woods",
    "Lawrence": "Kansas/Lawrence",
    "North Topeka": "Kansas/North Topeka",
    "Other": "Kansas/Other",
    "West Topeka": "Kansas/West Topeka",
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
        # backend/data/
        self.base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), base_data_dir)
        self.review_queue_dir = os.path.join(self.base_dir, 'Review_Queue')

        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(self.review_queue_dir, exist_ok=True)

        # Create Community and Incidental roots
        self._ensure_special_directories()

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
        """Scans for .pt files to build the search index and pushes to VRAM."""
        self.db_index = []
        for root, dirs, files in os.walk(self.base_dir):
            if "ref_data" in root:
                for file in files:
                    if file.endswith(".pt"):
                        path_parts = root.split(os.sep)
                        if len(path_parts) >= 3:
                            turtle_id = path_parts[-2]
                            rel_path = os.path.relpath(root, self.base_dir)
                            loc_parts = rel_path.split(os.sep)[:-2]
                            location_name = "/".join(loc_parts)
                            self.db_index.append((os.path.join(root, file), turtle_id, location_name))

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
        ``ref_data/`` directory.  Those are never listed in the dropdown.
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
            # NOT turtle folders (turtle folders contain ref_data/).
            for sub in sorted(os.listdir(entry_path)):
                sub_path = os.path.join(entry_path, sub)
                if not os.path.isdir(sub_path) or sub.startswith('.'):
                    continue
                if os.path.isdir(os.path.join(sub_path, "ref_data")):
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
        turtle_id = filename[:4].strip().rstrip('_')

        print(f"Manual Upload: Processing {turtle_id} into {location_dir}...")
        return self._process_single_turtle(image_path, location_dir, turtle_id)

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

        def process_location_folder(location_source_path, location_dest_path):
            """Process all turtle images in a location folder."""
            nonlocal count_new, count_skipped
            for filename in os.listdir(location_source_path):
                if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    continue
                turtle_id = filename[:4].strip().rstrip('_')
                source_path = os.path.join(location_source_path, filename)
                status = self._process_single_turtle(source_path, location_dest_path, turtle_id)
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
                process_location_folder(top_level_path, location_dest_path)
                continue

            # Flat structure: State-level folders at root (not location folders)
            if top_level_name in DRIVE_STATE_LEVEL_FOLDERS:
                state_dest_name = DRIVE_STATE_LEVEL_FOLDERS[top_level_name]
                state_dest_path = os.path.join(self.base_dir, state_dest_name)
                os.makedirs(state_dest_path, exist_ok=True)
                process_location_folder(top_level_path, state_dest_path)
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
                process_location_folder(location_source_path, location_dest_path)
        # --- TIMER END ---
        total_time = time.time() - ingest_start_time
        print(f"\n🎉 Ingest Complete. New: {count_new}, Skipped: {count_skipped}")
        print(f"⏱️ Total Ingest Time: {total_time:.2f}s")

    def _process_single_turtle(self, source_path, location_dir, turtle_id):
        """Creates folders and generates .pt tensor file using SuperPoint."""
        turtle_dir = os.path.join(location_dir, turtle_id)
        ref_dir = os.path.join(turtle_dir, 'ref_data')
        loose_dir = os.path.join(turtle_dir, 'loose_images')

        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)

        ext = os.path.splitext(source_path)[1]
        dest_image_path = os.path.join(ref_dir, f"{turtle_id}{ext}")
        dest_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")

        if os.path.exists(dest_pt_path):
            return "skipped"

        shutil.copy2(source_path, dest_image_path)
        success = brain.process_and_save(dest_image_path, dest_pt_path)

        if success:
            print(f"   ✅ Processed New: {turtle_id}")
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
        """Creates a pending packet in Review Queue, generates candidates, preps extra dirs."""
        safe_name = os.path.basename(image_path).replace(" ", "_")
        if req_id is None:
            req_id = f"Req_{int(time.time() * 1000)}_{safe_name}_{uuid.uuid4().hex[:6]}"
        packet_dir = os.path.join(self.review_queue_dir, req_id)
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')

        try:
            os.makedirs(packet_dir, exist_ok=True)

            # 1. Copy the raw uploaded image into the packet
            shutil.copy2(image_path, packet_dir)

            # 2. Run the AI Search to find candidates
            print(f"🔍 Generating candidates for Review Packet: {req_id}...")
            results, _ = self.search_for_matches(image_path)

            # 3. Create candidate directory and populate it
            os.makedirs(candidates_dir, exist_ok=True)

            for rank, match in enumerate(results, start=1):
                turtle_id = match.get('site_id', 'Unknown')
                score = int(match.get('score', 0))
                pt_path = match.get('file_path', '')

                # Resolve original image — case-insensitive so .JPG works on Linux
                ref_img_path = _find_image_next_to_pt(pt_path)

                if ref_img_path:
                    ext = os.path.splitext(ref_img_path)[1]
                    conf_int = int(round(match.get('confidence', 0.0) * 100))
                    cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                    shutil.copy2(ref_img_path, os.path.join(candidates_dir, cand_filename))

            # 4. Dump metadata for the frontend
            meta = user_info if user_info else {}
            with open(os.path.join(packet_dir, 'metadata.json'), 'w') as f:
                json.dump(meta, f)

            # 5. Create additional_images dir (Partner's Dashboard Support)
            additional_dir = os.path.join(packet_dir, 'additional_images')
            os.makedirs(additional_dir, exist_ok=True)

            print(f"📦 Review Packet {req_id} created with {len(results)} candidates.")
            return req_id
        except Exception as e:
            # Background uploads swallow exceptions; without this marker, the API treats
            # a missing candidate_matches dir as "still matching" forever.
            if os.path.isdir(packet_dir) and not os.path.isdir(candidates_dir):
                fail_path = os.path.join(packet_dir, 'match_search_failed.json')
                try:
                    with open(fail_path, 'w', encoding='utf-8') as f:
                        json.dump({'error': str(e)}, f)
                except OSError:
                    pass
            raise

    def get_review_queue(self):
        """Scans the 'Review_Queue' folder and returns the list of pending requests."""
        queue_items = []
        if os.path.exists(self.review_queue_dir):
            for req_id in os.listdir(self.review_queue_dir):
                req_path = os.path.join(self.review_queue_dir, req_id)
                if os.path.isdir(req_path):
                    queue_items.append({'request_id': req_id, 'path': req_path, 'status': 'pending'})
        return queue_items

    def approve_review_packet(self, request_id, match_turtle_id=None, replace_reference=False,
                              new_location=None, new_turtle_id=None, uploaded_image_path=None,
                              find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None,
                              new_admin_location=None):
        """
        Processes approval of a review-queue packet.
        - replace_reference=True: Stages and upgrades the SuperPoint .pt master image safely.
        - is_community_upload: New turtle files go under data/Community_Uploads/<sheet_name>.
        - match_from_community: Matched turtle is in Community_Uploads; move folder to new_admin_location.
        - Merges date-stamped additional_images and updates find_metadata.json.
        """
        query_image = None
        packet_dir = self._resolve_packet_dir(request_id)

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

            ref_dir = os.path.join(target_dir, 'ref_data')
            loose_dir = os.path.join(target_dir, 'loose_images')
            os.makedirs(loose_dir, exist_ok=True)

            if replace_reference:
                print(f"✨ UPGRADING REFERENCE for {match_turtle_id}...")
                old_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")
                # Case-insensitive lookup so .JPG old references are found on Linux
                old_img_path = _find_image_in_dir(ref_dir, match_turtle_id)

                op_ts = int(time.time() * 1000)
                new_ext = os.path.splitext(query_image)[1]
                staged_master_path = os.path.join(ref_dir, f"{match_turtle_id}_staged_{op_ts}{new_ext}")
                staged_pt_path = os.path.join(ref_dir, f"{match_turtle_id}_staged_{op_ts}.pt")

                # Extract features first; only replace old master if staging succeeds.
                shutil.copy2(query_image, staged_master_path)
                staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
                if not staged_ok:
                    try:
                        if os.path.exists(staged_master_path):
                            os.remove(staged_master_path)
                        if os.path.exists(staged_pt_path):
                            os.remove(staged_pt_path)
                    except OSError:
                        pass
                    return False, f"Failed to extract features for replacement image of {match_turtle_id}"

                if old_img_path:
                    archive_name = f"Archived_Master_{op_ts}{os.path.splitext(old_img_path)[1]}"
                    shutil.move(old_img_path, os.path.join(loose_dir, archive_name))
                    print(f"   📦 Archived old master to {archive_name}")

                if os.path.exists(old_pt_path):
                    os.remove(old_pt_path)

                new_master_path = os.path.join(ref_dir, f"{match_turtle_id}{new_ext}")
                new_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")
                if os.path.exists(new_master_path):
                    os.remove(new_master_path)
                shutil.move(staged_master_path, new_master_path)
                shutil.move(staged_pt_path, new_pt_path)

                obs_name = f"Obs_{int(time.time())}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))
                self.refresh_database_index()
                print(f"   ✅ {match_turtle_id} upgraded successfully.")

            else:
                print(f"📸 Adding observation to {match_turtle_id}...")
                obs_name = f"Obs_{int(time.time())}_{os.path.basename(query_image)}"
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

            status = self._process_single_turtle(query_image, location_dir, new_turtle_id)

            if status == 'created':
                print(f"✅ New turtle {new_turtle_id} created successfully at {new_location}")
                print("♻️  Rebuilding search index to include new turtle...")
                self.refresh_database_index()
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
                                if fn and os.path.isfile(os.path.join(src_date_dir, fn)):
                                    shutil.copy2(os.path.join(src_date_dir, fn), os.path.join(dest_date_dir, fn))
                                    if fn not in existing_filenames:
                                        existing_manifest.append(entry)
                                        existing_filenames.add(fn)
                            with open(dest_manifest_path, 'w') as f:
                                json.dump(existing_manifest, f, indent=4)

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

        if os.path.exists(packet_dir):
            try:
                shutil.rmtree(packet_dir)
                print(f"🗑️ Queue Item {request_id} deleted (Processed).")
            except Exception as e:
                print(f"⚠️ Error deleting packet: {e}")
                return True, f"Processed successfully (cleanup warning: {str(e)})"
        else:
            import tempfile
            temp_dir = tempfile.gettempdir()
            if query_image.startswith(temp_dir):
                try:
                    os.remove(query_image)
                    print(f"🗑️ Temp file deleted: {os.path.basename(query_image)}")
                except Exception as e:
                    print(f"⚠️ Error deleting temp file: {e}")

        return True, "Processed successfully"

    def reject_review_packet(self, request_id):
        """Delete a review queue packet without processing (e.g. junk/spam)."""
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
        """Resolve turtle folder path by turtle_id and optional location_hint."""
        if location_hint and location_hint != "Unknown":
            possible_path = os.path.join(self.base_dir, location_hint, turtle_id)
            if os.path.exists(possible_path):
                return possible_path
        for root, dirs, files in os.walk(self.base_dir):
            if os.path.basename(root) == turtle_id:
                return root
        return None

    def resolve_turtle_dir_for_sheet_upload(self, turtle_id, sheet_name):
        """
        Resolve or create the on-disk turtle folder for admin uploads from the Sheets browser.

        When ``sheet_name`` is set (e.g. Kansas/Topeka), prefers ``data/<sheet...>/<turtle_id>/``.
        If that path does not exist but another folder named ``turtle_id`` is found elsewhere,
        returns the existing folder (same behaviour as a plain search). If nothing exists,
        creates ``data/<sheet...>/<turtle_id>/`` with ``ref_data`` and ``loose_images``.
        """
        if not turtle_id or not isinstance(turtle_id, str):
            return None
        tid = turtle_id.strip()
        if not tid or os.path.isabs(tid) or "/" in tid or "\\" in tid or tid in (".", ".."):
            return None
        rel = _location_dir_from_sheet_name(sheet_name) if sheet_name else None
        if rel:
            explicit = _resolved_path_under_base(self.base_dir, rel, tid)
            if not explicit:
                return None
            if os.path.isdir(explicit):
                return explicit
            for root, dirs, files in os.walk(self.base_dir):
                if os.path.basename(root) == tid:
                    return root
            os.makedirs(os.path.join(explicit, "ref_data"), exist_ok=True)
            os.makedirs(os.path.join(explicit, "loose_images"), exist_ok=True)
            return explicit
        return self._get_turtle_folder(tid, None)

    def _create_identifier_plastron(self, turtle_id, query_image, ref_dir, loose_dir):
        """Write first ref_data/<turtle_id>.* + .pt from an image file (caller ensures no identifier)."""
        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)
        new_ext = os.path.splitext(query_image)[1] or ".jpg"
        dest_image = os.path.join(ref_dir, f"{turtle_id}{new_ext}")
        dest_pt = os.path.join(ref_dir, f"{turtle_id}.pt")
        if os.path.exists(dest_pt):
            try:
                os.remove(dest_pt)
            except OSError:
                pass
        if os.path.exists(dest_image):
            try:
                os.remove(dest_image)
            except OSError:
                pass
        shutil.copy2(query_image, dest_image)
        if not brain.process_and_save(dest_image, dest_pt):
            try:
                if os.path.isfile(dest_image):
                    os.remove(dest_image)
            except OSError:
                pass
            return False, "Failed to extract features for identifier image"
        self.refresh_database_index()
        return True, "Identifier plastron set"

    def _replace_identifier_plastron(self, turtle_id, query_image, ref_dir, loose_dir):
        """Archive old master image, replace .pt + master image (same staging flow as review approve)."""
        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)
        old_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")
        old_img_path = _find_image_in_dir(ref_dir, turtle_id)
        op_ts = int(time.time() * 1000)
        new_ext = os.path.splitext(query_image)[1] or ".jpg"
        staged_master_path = os.path.join(ref_dir, f"{turtle_id}_staged_{op_ts}{new_ext}")
        staged_pt_path = os.path.join(ref_dir, f"{turtle_id}_staged_{op_ts}.pt")
        shutil.copy2(query_image, staged_master_path)
        staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
        if not staged_ok:
            try:
                if os.path.exists(staged_master_path):
                    os.remove(staged_master_path)
                if os.path.exists(staged_pt_path):
                    os.remove(staged_pt_path)
            except OSError:
                pass
            return False, f"Failed to extract features for replacement image of {turtle_id}"
        if old_img_path:
            archive_name = f"Archived_Master_{op_ts}{os.path.splitext(old_img_path)[1]}"
            shutil.move(old_img_path, os.path.join(loose_dir, archive_name))
        if os.path.exists(old_pt_path):
            os.remove(old_pt_path)
        new_master_path = os.path.join(ref_dir, f"{turtle_id}{new_ext}")
        new_pt_path = os.path.join(ref_dir, f"{turtle_id}.pt")
        if os.path.exists(new_master_path):
            os.remove(new_master_path)
        shutil.move(staged_master_path, new_master_path)
        shutil.move(staged_pt_path, new_pt_path)
        obs_name = f"Obs_{int(time.time())}_{os.path.basename(query_image)}"
        shutil.copy2(query_image, os.path.join(loose_dir, obs_name))
        self.refresh_database_index()
        return True, "Identifier plastron replaced"

    def set_identifier_plastron_from_path(self, turtle_id, query_image, sheet_name, mode):
        """
        Set or replace the SuperPoint identifier (ref_data master image + .pt).

        ``mode``: ``set_if_missing`` (error if already present) or ``replace`` (create or upgrade).
        ``sheet_name`` should be the turtle's location path when the folder may not exist yet.
        """
        if mode not in ("set_if_missing", "replace"):
            return False, "Invalid mode"
        turtle_dir = self.resolve_turtle_dir_for_sheet_upload(turtle_id, sheet_name)
        if not turtle_dir:
            return False, (
                "Turtle folder not found. For a new sheet-only row, pass sheet_name (location) "
                "so the backend can create data/<location>/<turtle_id>/."
            )
        ref_dir = os.path.join(turtle_dir, "ref_data")
        loose_dir = os.path.join(turtle_dir, "loose_images")
        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)
        has_id = os.path.isfile(os.path.join(ref_dir, f"{turtle_id}.pt")) or bool(
            _find_image_in_dir(ref_dir, turtle_id)
        )
        if mode == "set_if_missing" and has_id:
            return False, (
                "This turtle already has an identifier plastron. Use replace mode, or upload "
                "a non-identifier plastron under Additional photos as type Plastron (additional)."
            )
        if not has_id:
            return self._create_identifier_plastron(turtle_id, query_image, ref_dir, loose_dir)
        return self._replace_identifier_plastron(turtle_id, query_image, ref_dir, loose_dir)

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
            typ = normalize_additional_type(item.get('type'))
            lbs = normalize_label_list(item.get('labels'))
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            ext = os.path.splitext(src)[1] or '.jpg'
            safe_name = f"{typ}_{int(time.time() * 1000)}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            entry = {
                'filename': safe_name,
                'type': typ,
                'timestamp': ts,
                'original_source': os.path.basename(src),
            }
            if lbs:
                entry['labels'] = lbs
            manifest.append(entry)

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

    def search_for_matches(self, query_image_path, location_filter=None):
        """VRAM cached SuperPoint/LightGlue search with multi-location scope."""
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
        print(f"🔍 Searching {filename} (VRAM Cached Mode){scope}...")

        results = brain.match_query_robust_vram(query_image_path, loc_filter)

        # Fallback: if the location-scoped search found fewer than 5 results,
        # re-run against the entire dataset so the admin always gets candidates.
        if loc_filter and len(results) < 5:
            print(f"📢 Only {len(results)} match(es) in scope — expanding to all locations...")
            results = brain.match_query_robust_vram(query_image_path, None)

        t_elapsed = time.time() - t_start

        if results:
            print(f"✅ Found {len(results)} matches in {t_elapsed:.2f}s")
        else:
            print(f"⚠️ No matches found in {t_elapsed:.2f}s")

        return results[:5], t_elapsed

    def add_observation_to_turtle(self, source_image_path, turtle_id, location_hint=None):
        """
        Moves an uploaded image to the turtle's loose_images folder as an observation copy.
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

        loose_dir = os.path.join(target_dir, 'loose_images')
        os.makedirs(loose_dir, exist_ok=True)

        filename = os.path.basename(source_image_path)
        save_name = f"Obs_{int(time.time())}_{filename}"
        dest_path = os.path.join(loose_dir, save_name)

        try:
            shutil.copy2(source_image_path, dest_path)
            print(f"📸 Observation added to {turtle_id}: {save_name}")
            return True, dest_path
        except Exception as e:
            return False, str(e)

    def add_additional_images_to_turtle(self, turtle_id, files_with_types, sheet_name=None):
        turtle_dir = self.resolve_turtle_dir_for_sheet_upload(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(turtle_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f: manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = normalize_additional_type(item.get('type'))
            lbs = normalize_label_list(item.get('labels'))
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            raw_name = item.get('original_filename')
            name_suffix = os.path.basename(raw_name) if raw_name else os.path.basename(src)
            safe_name = f"{typ}_{int(time.time() * 1000)}_{name_suffix}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            entry = {"filename": safe_name, "type": typ, "timestamp": ts}
            if lbs:
                entry["labels"] = lbs
            manifest.append(entry)

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)
        return True, "OK"

    def update_turtle_additional_image_labels(self, turtle_id, filename, sheet_name, labels):
        """Set labels on one manifest entry (additional_images)."""
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"
        if not filename or os.path.basename(filename) != filename:
            return False, "Invalid filename"
        lbs = normalize_label_list(labels)
        additional_dir = os.path.join(turtle_dir, 'additional_images')
        if not os.path.isdir(additional_dir):
            return False, "No additional images folder"

        def try_update(target_dir):
            manifest_path = os.path.join(target_dir, 'manifest.json')
            if not os.path.isfile(manifest_path):
                return False
            file_path = os.path.join(target_dir, filename)
            if not os.path.isfile(file_path):
                return False
            try:
                with open(manifest_path, 'r') as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                return False
            changed = False
            for entry in manifest:
                if entry.get('filename') == filename:
                    entry['labels'] = lbs
                    changed = True
                    break
            if not changed:
                return False
            try:
                with open(manifest_path, 'w') as f:
                    json.dump(manifest, f, indent=4)
            except OSError:
                return False
            return True

        if try_update(additional_dir):
            return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir) and try_update(date_dir):
                return True, None
        return False, "Image not found in manifest"

    def search_additional_images_by_label(self, query):
        """
        Scan all turtle additional_images manifests for entries whose labels match query (substring, case-insensitive).
        Excludes Review_Queue. Returns list of dicts with turtle_id, sheet_name (folder path), path, filename, type, labels, timestamp.
        """
        q = (query or '').strip()
        if not q:
            return []
        matches = []
        skip_top = {'Review_Queue', 'benchmarks'}
        for root, dirs, files in os.walk(self.base_dir):
            if os.path.basename(root) != 'additional_images':
                continue
            rel = os.path.relpath(root, self.base_dir)
            first = rel.split(os.sep)[0] if rel else ''
            if first in skip_top:
                continue
            turtle_dir = os.path.dirname(root)
            turtle_id = os.path.basename(turtle_dir)
            sheet_name = os.path.relpath(turtle_dir, self.base_dir)

            def scan_manifest_in(dir_path):
                manifest_path = os.path.join(dir_path, 'manifest.json')
                if not os.path.isfile(manifest_path):
                    return
                try:
                    with open(manifest_path, 'r') as f:
                        manifest = json.load(f)
                except (json.JSONDecodeError, OSError):
                    return
                if not isinstance(manifest, list):
                    return
                for entry in manifest:
                    fn = entry.get('filename')
                    if not fn:
                        continue
                    labels = entry.get('labels')
                    if not label_query_matches(labels, q):
                        continue
                    p = os.path.join(dir_path, fn)
                    if not os.path.isfile(p):
                        continue
                    kind = normalize_additional_type(entry.get('type'))
                    matches.append({
                        'turtle_id': turtle_id,
                        'sheet_name': sheet_name.replace(os.sep, '/'),
                        'path': p,
                        'filename': fn,
                        'type': kind,
                        'labels': normalize_label_list(labels),
                        'timestamp': entry.get('timestamp'),
                    })

            scan_manifest_in(root)
            for item in sorted(os.listdir(root)):
                sub = os.path.join(root, item)
                if os.path.isdir(sub):
                    scan_manifest_in(sub)

        matches.sort(key=lambda m: (m.get('sheet_name') or '', m.get('turtle_id') or '', m.get('filename') or ''))
        return matches

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