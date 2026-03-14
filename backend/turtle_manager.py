# --- PATH HACK: Allow importing from the 'turtles' package ---
import os
import shutil
import time
import cv2 as cv
import json
import sys

# --- PATH SETUP ---
# This ensures we can find the 'turtles' package regardless of where we run this script
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

# --- IMPORT THE BRAIN ---
try:
    # Try importing as a package (Standard Django way)
    from turtles import image_processing
except ImportError:
    # Fallback: Try local import if files are flat
    import image_processing

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
        # backend/data/
        self.base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), base_data_dir)
        self.review_queue_dir = os.path.join(self.base_dir, 'Review_Queue')

        os.makedirs(self.base_dir, exist_ok=True)
        os.makedirs(self.review_queue_dir, exist_ok=True)

        self._ensure_special_directories()

        print("🐢 TurtleManager: Loading Search Index & Vocabulary...")
        image_processing.load_or_generate_persistent_data(self.base_dir)
        print("✅ Resources Ready.")

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

    def get_all_locations(self):
        """
        Scans the data folder to build a list of locations for the GUI Dropdown.
        Returns state names (e.g. "Kansas") and State/Location paths (e.g. "Kansas/Wichita"), plus "Community_Uploads".
        State-level folders from sheets are included even when they have no Location subfolders yet.
        """
        locations = ["Community_Uploads"]

        if os.path.exists(self.base_dir):
            for state in sorted(os.listdir(self.base_dir)):
                state_path = os.path.join(self.base_dir, state)
                if not os.path.isdir(state_path) or state.startswith('.'):
                    continue
                if state in ["Review_Queue", "Community_Uploads"]:
                    continue

                # Include state name so sheet-based folders appear in dropdowns even with no subfolders
                locations.append(state)

                for loc in sorted(os.listdir(state_path)):
                    if os.path.isdir(os.path.join(state_path, loc)) and not loc.startswith('.'):
                        locations.append(f"{state}/{loc}")

        return locations

    def process_manual_upload(self, image_path, location_selection):
        """
        Handles the GUI Manual Upload.
        Parses 'State/Location' string and calls the processor.
        """
        # 1. Determine Destination Folder
        if "/" in location_selection:
            state, loc = location_selection.split("/", 1)
            location_dir = os.path.join(self.base_dir, state, loc)
        else:
            # Handle roots like "Community_Uploads"
            location_dir = os.path.join(self.base_dir, location_selection)

        if not os.path.exists(location_dir):
            os.makedirs(location_dir, exist_ok=True)

        # 2. Extract ID (First 4 chars)
        filename = os.path.basename(image_path)
        turtle_id = filename[:4].strip().rstrip('_')

        # 3. Run the standard processor
        print(f"Manual Upload: Processing {turtle_id} into {location_dir}...")
        return self._process_single_turtle(image_path, location_dir, turtle_id)

    def get_review_queue(self):
        """
        RECOVERS STATE ON RESTART.
        Scans the 'Review_Queue' folder and returns the list of pending requests.
        """
        queue_items = []

        # If the server restarted, this loop finds all the folders we haven't finished yet
        if os.path.exists(self.review_queue_dir):
            for req_id in os.listdir(self.review_queue_dir):
                req_path = os.path.join(self.review_queue_dir, req_id)

                if os.path.isdir(req_path):
                    # Basic info to send to frontend
                    queue_items.append({
                        'request_id': req_id,
                        'path': req_path,
                        'status': 'pending'  # If it's in this folder, it is pending
                    })

        return queue_items

    def create_new_location(self, state_name, location_name):
        """
        Future Use: Allows Admin to generate a new research site folder from the GUI.
        """
        official_name = self.get_official_location_name(location_name)
        path = os.path.join(self.base_dir, state_name, official_name)

        if not os.path.exists(path):
            os.makedirs(path)
            print(f"✅ Created new location: {state_name}/{official_name}")
            return path
        else:
            print(f"⚠️ Location already exists: {state_name}/{official_name}")
            return path

    def ingest_flash_drive(self, drive_root_path):
        """
        Scans drive, extracts 'Letter+3Digit' ID, creates folders, and skips duplicates.
        """
        ingest_start_time = time.time()

        print(f"🐢 Starting Ingest from: {drive_root_path}")
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
        print(f"\n🎉 Ingest Complete. New: {count_new}, Skipped (Existing/Duplicates): {count_skipped}")
        print(f"⏱️ Total Ingest Time: {total_time:.2f}s")

    def _process_single_turtle(self, source_path, location_dir, turtle_id):
        """
        Checks if NPZ exists (Duplicate/Resume check).
        If new, renames image to 'TurtleID.jpg' and generates 'TurtleID.npz'.
        """
        # backend/data/State/Location/T101/
        turtle_dir = os.path.join(location_dir, turtle_id)
        ref_dir = os.path.join(turtle_dir, 'ref_data')
        loose_dir = os.path.join(turtle_dir, 'loose_images')

        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)

        # Rename files to match the ID exactly
        ext = os.path.splitext(source_path)[1]
        dest_image_path = os.path.join(ref_dir, f"{turtle_id}{ext}")
        dest_npz_path = os.path.join(ref_dir, f"{turtle_id}.npz")

        # THE "SKIP DUPLICATE" CHECK
        if os.path.exists(dest_npz_path):
            return "skipped"

        # If we get here, it is the FIRST time seeing this ID in this location.
        shutil.copy2(source_path, dest_image_path)
        success, _ = image_processing.process_image_through_SIFT(dest_image_path, dest_npz_path)

        if success:
            print(f"   ✅ Processed New: {turtle_id}")
            return "created"
        else:
            print(f"   ⚠️ SIFT Failed: {turtle_id}")
            return "error"

    def handle_community_upload(self, image_path, finder_name="Anonymous"):
        """
        Saves an image to 'backend/data/Community_Uploads/FinderName/'.
        """
        dest_folder = os.path.join(self.base_dir, "Community_Uploads", finder_name)
        os.makedirs(dest_folder, exist_ok=True)

        filename = os.path.basename(image_path)
        saved_path = os.path.join(dest_folder, filename)
        shutil.copy2(image_path, saved_path)
        print(f"Saved community find by {finder_name}")

        # Automatically Create a Review Packet for this upload
        self.create_review_packet(saved_path, user_info={"finder": finder_name})

    def create_review_packet(self, query_image_path, user_info=None):
        """
        Creates a folder in 'Review_Queue' containing the query image
        and copies of the Top 5 candidate matches found by AI.
        """
        # 1. Create Unique Request Folder
        request_id = f"Req_{int(time.time())}_{os.path.basename(query_image_path)}"
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')

        os.makedirs(packet_dir, exist_ok=True)
        os.makedirs(candidates_dir, exist_ok=True)

        # 2. Save the Query Image
        filename = os.path.basename(query_image_path)
        query_save_path = os.path.join(packet_dir, filename)
        shutil.copy2(query_image_path, query_save_path)

        # 3. Save Metadata (includes optional flag/collected_to_lab/digital_flag from upload)
        if user_info:
            with open(os.path.join(packet_dir, 'metadata.json'), 'w') as f:
                json.dump(user_info, f)

        # Create additional_images dir
        additional_dir = os.path.join(packet_dir, 'additional_images')
        os.makedirs(additional_dir, exist_ok=True)

        print(f"🐢 Analysis: Running Smart Search for {filename}...")

        # 4. Run AI Search
        results = image_processing.smart_search(query_save_path, k_results=5)

        # 5. Populate the Candidate Folder
        if results:
            for i, match in enumerate(results):
                match_id = match.get('site_id', 'Unknown')
                score = int(match.get('distance', 0) * 100)

                original_path = match.get('file_path')

                if original_path and os.path.exists(original_path):
                    base_path = os.path.splitext(original_path)[0]  # Remove .npz
                    possible_exts = ['.jpg', '.jpeg', '.png']
                    found_img = None
                    for ext in possible_exts:
                        if os.path.exists(base_path + ext):
                            found_img = base_path + ext
                            break

                    if found_img:
                        new_name = f"Rank{i + 1}_ID{match_id}_Score{score}.jpg"
                        shutil.copy2(found_img, os.path.join(candidates_dir, new_name))

        print(f"✅ Review Packet Created: {request_id}")
        return request_id

    def add_additional_images_to_packet(self, request_id, files_with_types):
        """
        Add extra images (e.g. microhabitat, condition) to an existing review packet.
        Organizes files into date-stamped folders: additional_images/YYYY-MM-DD/
        """
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.isdir(packet_dir):
            return False, "Request not found"

        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(packet_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)

        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = (item.get('type') or 'other').lower()
            if typ not in ('microhabitat', 'condition', 'other'):
                typ = 'other'

            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

            if not src or not os.path.isfile(src):
                continue

            ext = os.path.splitext(src)[1] or '.jpg'
            safe_name = f"{typ}_{int(time.time() * 1000)}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')

            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)

            manifest.append({
                "filename": safe_name,
                "type": typ,
                "timestamp": ts,
                "original_source": os.path.basename(src)
            })

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)

        return True, "OK"

    def remove_additional_image_from_packet(self, request_id, filename):
        """
        Remove one image from a packet's additional_images by filename.
        Scans root (legacy) and date folders to find and remove the target.
        """
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.isdir(packet_dir):
            return False, "Request not found"

        additional_dir = os.path.join(packet_dir, 'additional_images')
        if not os.path.isdir(additional_dir):
            return False, "No additional images"

        if not filename or os.path.basename(filename) != filename:
            return False, "Invalid filename"

        # Helper to try deleting from a specific directory
        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f:
                        manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f:
                        json.dump(new_manifest, f, indent=4)
                try:
                    os.remove(file_path)
                    return True
                except OSError:
                    return False
            return False

        # 1. Check legacy root folder first
        if try_delete(additional_dir):
            return True, None

        # 2. Scan date folders
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir):
                    return True, None

        return False, "Image not found"

    def add_additional_images_to_turtle(self, turtle_id, files_with_types, sheet_name=None):
        """
        Add extra images to a permanent turtle folder, organized by upload date.
        """
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"

        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(turtle_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)

        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = (item.get('type') or 'other').lower()
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

            if not src or not os.path.isfile(src):
                continue

            safe_name = f"{typ}_{int(time.time() * 1000)}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')

            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            manifest.append({"filename": safe_name, "type": typ, "timestamp": ts})

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)

        return True, "OK"

    def remove_additional_image_from_turtle(self, turtle_id, filename, sheet_name=None):
        """
        Remove one image from a turtle's additional_images folder by filename.
        Scans root (legacy) and date folders to find and remove the target.
        """
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"

        additional_dir = os.path.join(turtle_dir, 'additional_images')
        if not os.path.isdir(additional_dir):
            return False, "No additional images folder"

        if not filename or os.path.basename(filename) != filename:
            return False, "Invalid filename"

        # Helper to try deleting from a specific directory
        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f:
                        manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f:
                        json.dump(new_manifest, f, indent=4)
                try:
                    os.remove(file_path)
                    return True
                except OSError:
                    return False
            return False

        # 1. Check legacy root folder first
        if try_delete(additional_dir):
            return True, None

        # 2. Scan date folders
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir):
                    return True, None

        return False, "Image not found"

    # --- SEARCH & OBSERVATION LOGIC ---

    def search_for_matches(self, query_image_path, sheet_name=None):
        """
        Smart Search with "Auto-Mirror" fallback.
        1. Search Normal.
        2. If scores are low, flip image horizontal and search again.
        3. Return the best set of results.
        """
        total_search_start = time.time()
        # When a location is selected: search that location + Community_Uploads + Incidental_Finds.
        # When "Community_Uploads" is selected as scope: search only Community_Uploads.
        # When no sheet (all locations): no filter, search everything.
        raw_sheet = (sheet_name or '').strip() or None
        if raw_sheet:
            if raw_sheet == "Community_Uploads":
                location_filter = ["Community_Uploads"]
            else:
                location_filter = [raw_sheet, "Community_Uploads", "Incidental_Finds"]
        else:
            location_filter = None

        MATCH_CONFIDENCE_THRESHOLD = 15

        filename = os.path.basename(query_image_path)
        scope = f" (Location: {location_filter})" if location_filter else " (all locations)"
        print(f"🔍 Analyzing {filename} (Normal Orientation){scope}...")

        # 1. First Pass (Normal)
        candidates_normal = image_processing.smart_search(
            query_image_path, location_filter=location_filter, k_results=20
        )
        if raw_sheet and not candidates_normal:
            candidates_normal = image_processing.smart_search(
                query_image_path, location_filter=None, k_results=20
            )
        results_normal = []

        # Rerank with RANSAC
        if candidates_normal:
            results_normal = image_processing.rerank_results_with_spatial_verification(query_image_path,
                                                                                       candidates_normal)

        # Get best score
        best_score_normal = 0
        if results_normal:
            best_score_normal = results_normal[0].get('spatial_score', 0)

        # 2. Check Threshold
        if best_score_normal >= MATCH_CONFIDENCE_THRESHOLD:
            print(f"✅ Good match found ({best_score_normal} matches). Returning results.")
            print(f"⏱️ Total Search & Verify Logic: {time.time() - total_search_start:.4f}s")
            return results_normal[:5]

        # 3. Second Pass (Mirrored)
        print(f"⚠️ Low confidence ({best_score_normal} < {MATCH_CONFIDENCE_THRESHOLD}). Attempting Mirror Search...")

        # Generate Mirrored Image
        img = cv.imread(query_image_path)
        if img is None: return results_normal[:5]

        img_mirrored = cv.flip(img, 1)  # 1 = Horizontal Flip

        mirror_path = os.path.join(self.review_queue_dir, f"TEMP_MIRROR_{filename}")
        cv.imwrite(mirror_path, img_mirrored)

        try:
            candidates_mirror = image_processing.smart_search(
                mirror_path, location_filter=location_filter, k_results=20
            )
            if raw_sheet and not candidates_mirror:
                candidates_mirror = image_processing.smart_search(
                    mirror_path, location_filter=None, k_results=20
                )
            results_mirror = []
            if candidates_mirror:
                results_mirror = image_processing.rerank_results_with_spatial_verification(mirror_path,
                                                                                           candidates_mirror)

            best_score_mirror = 0
            if results_mirror:
                best_score_mirror = results_mirror[0].get('spatial_score', 0)

            print(f"   Normal Best: {best_score_normal} | Mirrored Best: {best_score_mirror}")

            # 4. Compare and Return Winner
            if best_score_mirror > best_score_normal:
                print("🪞 Mirrored orientation yielded better results! Switching view.")
                print(f"⏱️ Total Search & Verify Logic: {time.time() - total_search_start:.4f}s")
                for res in results_mirror:
                    res['is_mirrored'] = True
                return results_mirror[:5]
            else:
                print("   Normal orientation was better.")
                print(f"⏱️ Total Search & Verify Logic: {time.time() - total_search_start:.4f}s")
                return results_normal[:5]

        finally:
            if os.path.exists(mirror_path):
                os.remove(mirror_path)

    def add_observation_to_turtle(self, source_image_path, turtle_id, location_hint=None):
        """
        Called when you click "Match!" on the GUI.
        Moves the uploaded image to that Turtle's 'loose_images' folder,
        processes it, and then DELETES the temporary NPZ file.
        """
        target_dir = None
        if location_hint and location_hint != "Unknown":
            possible_path = os.path.join(self.base_dir, location_hint, turtle_id)
            if os.path.exists(possible_path):
                target_dir = possible_path

        if not target_dir:
            print(f"Scanning for home of {turtle_id}...")
            for root, dirs, files in os.walk(self.base_dir):
                if os.path.basename(root) == turtle_id:
                    target_dir = root
                    break

        if not target_dir: return False, f"Could not find folder for {turtle_id}"

        loose_dir = os.path.join(target_dir, 'loose_images')
        os.makedirs(loose_dir, exist_ok=True)

        filename = os.path.basename(source_image_path)
        save_name = f"Obs_{int(time.time())}_{filename}"
        dest_path = os.path.join(loose_dir, save_name)

        npz_name = os.path.splitext(save_name)[0] + ".npz"
        npz_path = os.path.join(loose_dir, npz_name)

        try:
            shutil.copy2(source_image_path, dest_path)
            print(f"📸 Image copied to {dest_path}")

            success, _ = image_processing.process_image_through_SIFT(dest_path, npz_path)

            if success:
                print(f"✅ Observation processed and added to {turtle_id}")
            else:
                print(f"⚠️ Warning: Image saved but SIFT processing failed for {os.path.basename(dest_path)}")

            if os.path.exists(npz_path):
                os.remove(npz_path)
                print(f"🗑️ Deleted temporary NPZ file: {os.path.basename(npz_path)}")

            return True, dest_path
        except Exception as e:
            return False, str(e)

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

    def approve_review_packet(self, request_id, match_turtle_id=None, new_location=None, new_turtle_id=None,
                              uploaded_image_path=None, find_metadata=None, is_community_upload=False,
                              match_from_community=False, community_sheet_name=None, new_admin_location=None):
        """
        Called when Admin approves a packet.
        - Merges date-stamped additional_images correctly.
        - is_community_upload: when True, new turtle files go under data/Community_Uploads/<sheet_name>.
        - match_from_community: when True, the matched turtle is in Community_Uploads; we move its folder to new_admin_location and caller removes from community sheet.
        """
        query_image = None
        packet_dir = os.path.join(self.review_queue_dir, request_id)

        if os.path.exists(packet_dir):
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

        if match_turtle_id:
            print(f"📸 Adding observation to existing Turtle {match_turtle_id}...")
            success, message = self.add_observation_to_turtle(query_image, match_turtle_id)
            if not success:
                return False, f"Failed to add to existing turtle: {message}"
            print(f"✅ Observation added to {match_turtle_id}")

        elif new_location and new_turtle_id:
            # Create new turtle. new_location can be "State", "State/Location", or (community) single sheet name.
            print(f"🐢 Creating new turtle {new_turtle_id} at {new_location}...")
            parts = [p.strip() for p in new_location.split("/") if p.strip()]
            sheet_name = parts[0] if parts else new_location
            if is_community_upload:
                # Community uploads: data/Community_Uploads/<sheet_name>/
                location_dir = os.path.join(self.base_dir, "Community_Uploads", sheet_name)
            elif len(parts) >= 2:
                # Two-level: data/<sheet>/<location>/<turtle_id>/
                location_dir = os.path.join(self.base_dir, parts[0], parts[1])
            else:
                # Single-level (backward compatible): data/<sheet>/<turtle_id>/
                location_dir = os.path.join(self.base_dir, sheet_name)
            os.makedirs(location_dir, exist_ok=True)

            status = self._process_single_turtle(query_image, location_dir, new_turtle_id)

            if status == "created":
                print(f"✅ New turtle {new_turtle_id} created successfully at {new_location}")
                print("♻️  Rebuilding search index to include new turtle...")
                image_processing.rebuild_index_and_reload(self.base_dir)
                print("✅ Search index updated.")
            elif status == "skipped":
                return False, f"Turtle {new_turtle_id} already exists at {new_location}"
            else:
                return False, f"Failed to process image for new turtle {new_turtle_id}"
        else:
            return False, "Either match_turtle_id or both new_location and new_turtle_id must be provided"

        target_turtle_id = match_turtle_id if match_turtle_id else new_turtle_id
        if new_location:
            first = (new_location or "").split("/")[0].strip()
            location_hint = f"Community_Uploads/{first}" if is_community_upload else first
        elif match_from_community and community_sheet_name:
            # So we find and move the folder under Community_Uploads, not an existing admin copy
            location_hint = f"Community_Uploads/{community_sheet_name}"
        else:
            location_hint = None
        target_dir = self._get_turtle_folder(target_turtle_id, location_hint)

        if target_dir:
            if find_metadata is not None and isinstance(find_metadata, dict):
                meta_path = os.path.join(target_dir, 'find_metadata.json')
                with open(meta_path, 'w') as f:
                    json.dump(find_metadata, f)

            # Merge additional_images from packet into turtle's additional_images folder by Date
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                dest_additional = os.path.join(target_dir, 'additional_images')

                if os.path.isdir(src_additional):
                    os.makedirs(dest_additional, exist_ok=True)

                    # Iterate over date folders in the packet
                    for date_folder in os.listdir(src_additional):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir): continue

                        dest_date_dir = os.path.join(dest_additional, date_folder)
                        os.makedirs(dest_date_dir, exist_ok=True)

                        src_manifest_path = os.path.join(src_date_dir, 'manifest.json')
                        dest_manifest_path = os.path.join(dest_date_dir, 'manifest.json')

                        # Load existing target manifest for this date if it exists
                        existing_manifest = []
                        if os.path.isfile(dest_manifest_path):
                            try:
                                with open(dest_manifest_path, 'r') as f:
                                    existing_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                pass

                        existing_filenames = {e.get('filename') for e in existing_manifest if e.get('filename')}

                        # Read source manifest and copy files
                        if os.path.isfile(src_manifest_path):
                            try:
                                with open(src_manifest_path, 'r') as f:
                                    packet_manifest = json.load(f)
                            except (json.JSONDecodeError, OSError):
                                packet_manifest = []

                            for entry in packet_manifest:
                                fn = entry.get('filename')
                                if fn and os.path.isfile(os.path.join(src_date_dir, fn)):
                                    shutil.copy2(
                                        os.path.join(src_date_dir, fn),
                                        os.path.join(dest_date_dir, fn)
                                    )
                                    if fn not in existing_filenames:
                                        existing_manifest.append(entry)
                                        existing_filenames.add(fn)

                            # Save merged manifest
                            with open(dest_manifest_path, 'w') as f:
                                json.dump(existing_manifest, f, indent=4)

            # Move turtle folder from Community_Uploads to admin location when admin re-found a community turtle
            if match_from_community and new_admin_location and match_turtle_id and target_dir and os.path.isdir(target_dir):
                parts = [p.strip() for p in new_admin_location.split("/") if p.strip()]
                if parts:
                    dest_dir = os.path.join(self.base_dir, *parts, match_turtle_id)
                    if not os.path.exists(dest_dir):
                        try:
                            os.makedirs(os.path.dirname(dest_dir), exist_ok=True)
                            shutil.move(target_dir, dest_dir)
                            print(f"📁 Moved turtle from Community_Uploads to {new_admin_location}")
                            print("♻️  Rebuilding search index...")
                            image_processing.rebuild_index_and_reload(self.base_dir)
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

    def _add_turtle_flag_if_present(self, results, turtle_path, turtle_id, location_label):
        """If turtle_path has find_metadata.json, append to results (skip if already released)."""
        meta_path = os.path.join(turtle_path, 'find_metadata.json')
        if not os.path.isfile(meta_path):
            return
        try:
            with open(meta_path, 'r') as f:
                find_metadata = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        if find_metadata.get('released_at'):
            return
        results.append({
            'turtle_id': turtle_id,
            'location': location_label,
            'path': turtle_path,
            'find_metadata': find_metadata,
        })

    def clear_release_flag(self, turtle_id, location_hint=None):
        """
        Mark turtle as released back to nature: clear digital flag and set released_at.
        """
        turtle_dir = self._get_turtle_folder(turtle_id, location_hint)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"
        meta_path = os.path.join(turtle_dir, 'find_metadata.json')
        if not os.path.isfile(meta_path):
            return False, "No find metadata"
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
        """
        Scan data dir for turtles that have find_metadata.json.
        """
        results = []
        for state in sorted(os.listdir(self.base_dir)):
            state_path = os.path.join(self.base_dir, state)
            if not os.path.isdir(state_path) or state.startswith('.'):
                continue
            if state in ["Review_Queue", "Community_Uploads"]:
                continue
            for name in sorted(os.listdir(state_path)):
                sub_path = os.path.join(state_path, name)
                if not os.path.isdir(sub_path) or name.startswith('.'):
                    continue
                self._add_turtle_flag_if_present(results, sub_path, name, state)
                for turtle_id in sorted(os.listdir(sub_path)):
                    turtle_path = os.path.join(sub_path, turtle_id)
                    if not os.path.isdir(turtle_path) or turtle_id.startswith('.'):
                        continue
                    self._add_turtle_flag_if_present(results, turtle_path, turtle_id, f"{state}/{name}")
        return results

    def reject_review_packet(self, request_id):
        """
        Delete a review queue packet without processing (e.g. junk/spam).
        """
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.exists(packet_dir) or not os.path.isdir(packet_dir):
            return False, "Request not found"
        real_packet = os.path.realpath(packet_dir)
        real_base = os.path.realpath(self.review_queue_dir)
        if not real_packet.startswith(real_base):
            return False, "Invalid request path"
        try:
            shutil.rmtree(packet_dir)
            print(f"🗑️ Queue Item {request_id} deleted (Rejected/Discarded).")
            return True, "Deleted"
        except Exception as e:
            return False, str(e)


# --- TEST BLOCK ---
if __name__ == "__main__":
    manager = TurtleManager()
    print("\n--- Checking Queue Status ---")
    manager.get_review_queue()

    path = input("\n(Optional) Enter Flash Drive Path to test Ingest: ")
    if path:
        manager.ingest_flash_drive(path)