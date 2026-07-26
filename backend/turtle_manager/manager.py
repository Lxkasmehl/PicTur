import csv
import os
import shutil
import time
import cv2 as cv
import json
import sys
import uuid

# --- PATH HACK ---
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from .path_utils import (
    _extract_exif_date,
    _date_suffix,
    _find_image_next_to_pt,
    _find_image_in_dir,
    _ref_data_folder_score,
    _is_turtle_data_folder,
    _basename_matches_turtle_id,
    _safe_folder_name,
    _BIO_ID_RE,
    _CARAPACE_RE,
    _PRIMARY_ID_RE,
    _looks_like_primary_id,
    canonical_new_turtle_folder_id,
    _parse_bio_id,
    _detect_photo_type,
    _location_dir_from_sheet_name,
    _resolved_path_under_base,
    _MAX_TURTLE_DIR_DEPTH,
    _turtle_dir_depth,
    _clamp_turtle_dir_depth,
    _FOLDER_NAME_INVALID,
    _IMAGE_EXTENSIONS,
    BASE_DATA_DIR,
    DRIVE_LOCATION_TO_BACKEND_PATH,
    DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP,
    LOCATION_NAME_MAP,
    _expand_flat_drive_folder_prefix,
    _resolve_drive_state_name,
    _resolve_drive_location_name,
)
from .merge_mixin import TurtleMergeMixin
from .reference_mixin import TurtleReferenceMixin
from .deletion_mixin import TurtleDeletionMixin
from .review_mixin import TurtleReviewMixin
from .folder_resolver_mixin import TurtleFolderResolverMixin
from .ingest_mixin import TurtleIngestMixin
from .identifier_plastron_mixin import TurtleIdentifierPlastronMixin
from .additional_images_mixin import TurtleAdditionalImagesMixin
from .flags_mixin import TurtleFlagsMixin

# Keep re available for the few inline usages still in this file
import re

from additional_image_labels import (
    label_query_matches,
    migrate_labels_to_archive,
    normalize_additional_type,
    normalize_label_list,
    read_labels_for_file,
    set_labels_for_file,
)

# --- IMPORT THE BRAIN (SUPERPOINT/LIGHTGLUE) ---
try:
    from turtles.image_processing import brain
except ImportError as e:
    print(f"❌ CRITICAL: Could not import 'brain'.")
    print(f"Detailed Error: {e}")
    sys.exit(1)


class TurtleManager(TurtleReferenceMixin, TurtleDeletionMixin, TurtleReviewMixin, TurtleFolderResolverMixin, TurtleIngestMixin, TurtleIdentifierPlastronMixin, TurtleAdditionalImagesMixin, TurtleFlagsMixin, TurtleMergeMixin):
    def __init__(self, base_data_dir='data'):
        import threading
        # backend/data/ — go up two levels: manager.py → turtle_manager/ → backend/
        self.base_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), base_data_dir)
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
        index = []
        for root, dirs, files in os.walk(self.base_dir):
            # Defensively prune Deleted/ subtrees so soft-deleted .pt files
            # (if any lingered across an older format) never enter the index.
            if 'Deleted' in dirs:
                dirs.remove('Deleted')
            # Prune _Archive/ (archived merge-secondary / rolled-back turtles):
            # an archived turtle must STOP matching, exactly like Deleted/.
            if '_Archive' in dirs:
                dirs.remove('_Archive')
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
                        index.append((os.path.join(root, file), turtle_id, location_name, photo_type))

        # Assign atomically so a concurrent refresh (now possible under the
        # threaded server) never observes a half-built index. Each caller
        # builds a complete index in a local, so "last writer wins" stays
        # consistent instead of interleaving appends into one shared list.
        self.db_index = index

        # Push the indexed files directly into the Brain's VRAM
        if hasattr(brain, 'load_database_to_vram'):
            print("⚡ Pushing database to Memory Cache...")
            brain.load_database_to_vram(index)

    # Folders that should never appear in user-facing location dropdowns
    SYSTEM_FOLDERS = {"Review_Queue", "Community_Uploads",
                      "Incidental Places", "benchmarks", "_Archive"}

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
    def search_for_matches(self, query_image_path, location_filter=None, photo_type="plastron",
                           expand_to_all_when_short=True):
        """VRAM cached SuperPoint/LightGlue search with multi-location scope.

        Args:
            photo_type: 'plastron' (default) or 'carapace' — selects which VRAM cache to search.
            expand_to_all_when_short: if True (default) and the location-scoped search returns
                fewer than 5 matches, re-runs against ALL locations to fill the top-5 with
                out-of-scope candidates. The diagnostic cross-check route disables this so
                a "no in-scope match" answer stays honest instead of leaking distant turtles
                into the result list — which also avoids the expensive full-cache pass when
                a small location has few above-threshold matches.
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
        # Skipped when expand_to_all_when_short=False (cross-check route) so the
        # diagnostic answer stays scoped to what the admin asked.
        if expand_to_all_when_short and loc_filter and len(results) < 5:
            print(f"📢 Only {len(results)} match(es) in scope — expanding to all locations...")
            results = brain.match_against_cache(query_feats, None, photo_type=photo_type)

        t_elapsed = time.time() - t_start

        if results:
            print(f"✅ Found {len(results)} matches in {t_elapsed:.2f}s")
        else:
            print(f"⚠️ No matches found in {t_elapsed:.2f}s")

        return results[:5], t_elapsed

