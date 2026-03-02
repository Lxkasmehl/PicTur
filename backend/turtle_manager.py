import os
import shutil
import time
import cv2 as cv
import json
import sys

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
LOCATION_NAME_MAP = {
    # Add mappings if needed, e.g., "CBPS": "WT",
}


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
        """Creates the folder roots for Community and Incidental finds."""
        for special_folder in ["Community_Uploads", "Incidental_Finds"]:
            path = os.path.join(self.base_dir, special_folder)
            os.makedirs(path, exist_ok=True)

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

    def get_all_locations(self):
        """Scans the data folder to build a list of locations for the GUI Dropdown."""
        locations = ["Incidental_Finds", "Community_Uploads"]
        if os.path.exists(self.base_dir):
            # Loop through States
            for state in sorted(os.listdir(self.base_dir)):
                state_path = os.path.join(self.base_dir, state)
                if not os.path.isdir(state_path) or state.startswith('.'): continue
                if state in ["Review_Queue", "Community_Uploads", "Incidental_Finds", "benchmarks"]: continue

                # Loop through Locations
                for loc in sorted(os.listdir(state_path)):
                    if os.path.isdir(os.path.join(state_path, loc)) and not loc.startswith('.'):
                        locations.append(f"{state}/{loc}")
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

        # Iterate directly over the locations in the selected folder
        for location_name in os.listdir(drive_root_path):
            location_source_path = os.path.join(drive_root_path, location_name)

            if not os.path.isdir(location_source_path) or location_name.startswith(
                    '.') or location_name == "System Volume Information":
                continue

            official_name = self.get_official_location_name(location_name)
            location_dest_path = os.path.join(self.base_dir, official_name)
            os.makedirs(location_dest_path, exist_ok=True)

            for filename in os.listdir(location_source_path):
                if not filename.lower().endswith(('.jpg', '.jpeg', '.png')): continue
                turtle_id = filename[:4].strip().rstrip('_')
                source_path = os.path.join(location_source_path, filename)

                status = self._process_single_turtle(source_path, location_dest_path, turtle_id)
                if status == "created":
                    count_new += 1
                elif status == "skipped":
                    count_skipped += 1

        self.refresh_database_index()
        total_time = time.time() - ingest_start_time
        print(f"\n🎉 Ingest Complete. New: {count_new}, Skipped: {count_skipped}")
        print(f"⏱️ Total Ingest Time: {total_time:.2f}s")

    def _process_single_turtle(self, source_path, location_dir, turtle_id):
        """Creates folders and generates .pt tensor file using SuperPoint (No SIFT)."""
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

    # --- FAST VRAM SEARCH LOGIC ---
    def search_for_matches(self, query_image_path, location_filter="All Locations"):
        """VRAM Cached Deep Search. Bypasses disk, replaces old SIFT/RANSAC/Mirror logic."""
        filename = os.path.basename(query_image_path)
        t_start = time.time()

        # Clean location filter if needed
        loc = None if not location_filter or location_filter == "All Locations" else location_filter.strip()

        print(f"🔍 Deep Searching {filename} (VRAM Cached Mode)...")

        # Call the new VRAM Matcher
        results = brain.match_query_robust_vram(query_image_path, loc)
        t_elapsed = time.time() - t_start

        if results:
            print(f"✅ Found {len(results)} matches in {t_elapsed:.2f}s")
        else:
            print(f"⚠️ No matches found in {t_elapsed:.2f}s")

        return results[:5], t_elapsed

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
    def create_review_packet(self, image_path, user_info=None):
        """Creates a pending packet in Review Queue, generates candidates, preps extra dirs."""
        req_id = f"Req_{int(time.time())}_{os.path.basename(image_path)}"
        packet_dir = os.path.join(self.review_queue_dir, req_id)
        os.makedirs(packet_dir, exist_ok=True)

        # 1. Copy the raw uploaded image into the packet
        shutil.copy2(image_path, packet_dir)

        # 2. Run the AI Search to find candidates
        print(f"🔍 Generating candidates for Review Packet: {req_id}...")
        results, _ = self.search_for_matches(image_path)

        # 3. Create candidate directory and populate it
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')
        os.makedirs(candidates_dir, exist_ok=True)

        for rank, match in enumerate(results, start=1):
            turtle_id = match.get('site_id', 'Unknown')
            score = int(match.get('score', 0))
            pt_path = match.get('file_path', '')

            # Resolve original image
            ref_img_path = None
            if pt_path and pt_path.endswith('.pt'):
                base_path = pt_path[:-3]
                for ext in ['.jpg', '.jpeg', '.png']:
                    if os.path.exists(base_path + ext):
                        ref_img_path = base_path + ext
                        break

            if ref_img_path:
                ext = os.path.splitext(ref_img_path)[1]
                cand_filename = f"Rank{rank}_ID{turtle_id}_Score{score}{ext}"
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

    def get_review_queue(self):
        """Scans the 'Review_Queue' folder and returns the list of pending requests."""
        queue_items = []
        if os.path.exists(self.review_queue_dir):
            for req_id in os.listdir(self.review_queue_dir):
                req_path = os.path.join(self.review_queue_dir, req_id)
                if os.path.isdir(req_path):
                    queue_items.append({'request_id': req_id, 'path': req_path, 'status': 'pending'})
        return queue_items

    # MERGE FIX: Massive hybrid function. Keeps partner's manifest/metadata merging,
    # but integrates your replace_reference and VRAM reloading features without SIFT.
    def approve_review_packet(self, request_id, match_turtle_id=None, replace_reference=False, new_location=None,
                              new_turtle_id=None, uploaded_image_path=None, find_metadata=None):
        """
        Processes approval.
        - If replace_reference=True: Upgrades SuperPoint .pt master.
        - Merges date-stamped additional_images and updates find_metadata.json.
        """
        query_image = None
        packet_dir = os.path.join(self.review_queue_dir, request_id)

        # Locate Image
        if os.path.exists(packet_dir):
            for f in os.listdir(packet_dir):
                if f.lower().endswith(('.jpg', '.png', '.jpeg')) and f != 'metadata.json':
                    query_image = os.path.join(packet_dir, f)
                    break
        elif uploaded_image_path and os.path.exists(uploaded_image_path):
            query_image = uploaded_image_path

        if not query_image or not os.path.exists(query_image):
            return False, "Error: No image found."

        # Scenario A: Adding to an existing turtle
        if match_turtle_id:
            target_dir = self._get_turtle_folder(match_turtle_id)
            if not target_dir: return False, f"Could not find folder for {match_turtle_id}"

            ref_dir = os.path.join(target_dir, 'ref_data')
            loose_dir = os.path.join(target_dir, 'loose_images')
            os.makedirs(loose_dir, exist_ok=True)

            # --- USER'S REPLACE REFERENCE LOGIC ---
            if replace_reference:
                print(f"✨ UPGRADING REFERENCE for {match_turtle_id}...")
                old_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")
                old_img_path = None
                for ext in ['.jpg', '.jpeg', '.png']:
                    possible = os.path.join(ref_dir, f"{match_turtle_id}{ext}")
                    if os.path.exists(possible):
                        old_img_path = possible
                        break

                if old_img_path:
                    archive_name = f"Archived_Master_{int(time.time())}{os.path.splitext(old_img_path)[1]}"
                    shutil.move(old_img_path, os.path.join(loose_dir, archive_name))
                    print(f"   📦 Archived old master to {archive_name}")

                if os.path.exists(old_pt_path):
                    os.remove(old_pt_path)

                new_ext = os.path.splitext(query_image)[1]
                new_master_path = os.path.join(ref_dir, f"{match_turtle_id}{new_ext}")
                new_pt_path = os.path.join(ref_dir, f"{match_turtle_id}.pt")

                shutil.copy2(query_image, new_master_path)
                brain.process_and_save(new_master_path, new_pt_path)

                obs_name = f"Obs_{int(time.time())}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

                self.refresh_database_index()
                print(f"   ✅ {match_turtle_id} upgraded successfully.")

            # --- STANDARD OBSERVATION ADDITION ---
            else:
                print(f"📸 Adding observation to {match_turtle_id}...")
                obs_name = f"Obs_{int(time.time())}_{os.path.basename(query_image)}"
                shutil.copy2(query_image, os.path.join(loose_dir, obs_name))

        # Scenario B: Creating a completely new turtle
        elif new_location and new_turtle_id:
            print(f"🐢 Creating new turtle {new_turtle_id} at {new_location}...")
            sheet_name = new_location.split("/")[0].strip() or new_location
            location_dir = os.path.join(self.base_dir, sheet_name)
            os.makedirs(location_dir, exist_ok=True)

            status = self._process_single_turtle(query_image, location_dir, new_turtle_id)

            if status == "created":
                print(f"✅ New turtle {new_turtle_id} created successfully at {new_location}")
                print("♻️  Rebuilding search index to include new turtle...")
                self.refresh_database_index()
            elif status == "skipped":
                return False, f"Turtle {new_turtle_id} already exists at {new_location}"
            else:
                return False, f"Failed to process image for new turtle {new_turtle_id}"
        else:
            return False, "Either match_turtle_id or both new_location and new_turtle_id must be provided"

        # --- PARTNER'S DASHBOARD & MANIFEST LOGIC ---
        target_turtle_id = match_turtle_id if match_turtle_id else new_turtle_id
        location_hint = (new_location or "").split("/")[0].strip() if new_location else None
        target_dir = self._get_turtle_folder(target_turtle_id, location_hint)

        if target_dir:
            # Save Find Metadata
            if find_metadata is not None and isinstance(find_metadata, dict):
                meta_path = os.path.join(target_dir, 'find_metadata.json')
                with open(meta_path, 'w') as f:
                    json.dump(find_metadata, f)

            # Merge Additional Images (Conditions, Microhabitats)
            if os.path.isdir(packet_dir):
                src_additional = os.path.join(packet_dir, 'additional_images')
                dest_additional = os.path.join(target_dir, 'additional_images')

                if os.path.isdir(src_additional):
                    os.makedirs(dest_additional, exist_ok=True)
                    for date_folder in os.listdir(src_additional):
                        src_date_dir = os.path.join(src_additional, date_folder)
                        if not os.path.isdir(src_date_dir): continue

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

        # Cleanup Processed Packet
        if os.path.exists(packet_dir):
            try:
                shutil.rmtree(packet_dir)
                print(f"🗑️ Queue Item {request_id} deleted (Processed).")
            except Exception as e:
                return True, f"Processed successfully (cleanup warning: {str(e)})"

        return True, "Processed successfully"

    def reject_review_packet(self, request_id):
        """Delete a review queue packet without processing (e.g. junk/spam)."""
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.exists(packet_dir) or not os.path.isdir(packet_dir):
            return False, "Request not found"
        try:
            shutil.rmtree(packet_dir)
            print(f"🗑️ Queue Item {request_id} deleted (Rejected/Discarded).")
            return True, "Deleted"
        except Exception as e:
            return False, str(e)

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

    def add_additional_images_to_packet(self, request_id, files_with_types):
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.isdir(packet_dir): return False, "Request not found"
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
            if typ not in ('microhabitat', 'condition', 'other'): typ = 'other'
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

            if not src or not os.path.isfile(src): continue
            ext = os.path.splitext(src)[1] or '.jpg'
            safe_name = f"{typ}_{int(time.time() * 1000)}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            manifest.append(
                {"filename": safe_name, "type": typ, "timestamp": ts, "original_source": os.path.basename(src)})

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)
        return True, "OK"

    def remove_additional_image_from_packet(self, request_id, filename):
        packet_dir = os.path.join(self.review_queue_dir, request_id)
        if not os.path.isdir(packet_dir): return False, "Request not found"
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

    def add_additional_images_to_turtle(self, turtle_id, files_with_types, sheet_name=None):
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir): return False, "Turtle folder not found"
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(turtle_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f: manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = (item.get('type') or 'other').lower()
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            safe_name = f"{typ}_{int(time.time() * 1000)}_{os.path.basename(src)}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            manifest.append({"filename": safe_name, "type": typ, "timestamp": ts})

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
            if not os.path.isdir(state_path) or state.startswith('.'): continue
            if state in ["Review_Queue", "Community_Uploads", "Incidental_Finds"]: continue
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