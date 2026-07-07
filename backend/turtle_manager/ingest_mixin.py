"""
Flash-drive ingest, missing-turtle report, and folder-structure helpers.
"""
import csv
import json
import os
import re
import shutil
import time
import uuid

import sys
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    import sys; sys.path.insert(0, _backend_dir)

from .path_utils import (
    _extract_exif_date, _date_suffix, _find_image_next_to_pt, _find_image_in_dir,
    _ref_data_folder_score, _is_turtle_data_folder, _basename_matches_turtle_id,
    _safe_folder_name, _BIO_ID_RE, _CARAPACE_RE, _looks_like_primary_id,
    canonical_new_turtle_folder_id, _parse_bio_id, _detect_photo_type,
    _location_dir_from_sheet_name, _resolved_path_under_base,
    _MAX_TURTLE_DIR_DEPTH, _turtle_dir_depth, _clamp_turtle_dir_depth,
    _expand_flat_drive_folder_prefix, _IMAGE_EXTENSIONS,
    DRIVE_LOCATION_TO_BACKEND_PATH, DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP, LOCATION_NAME_MAP,
    _resolve_drive_state_name, _resolve_drive_location_name,
)

try:
    from turtles.image_processing import brain
except ImportError:
    from image_processing import brain  # type: ignore

from additional_image_labels import (
    label_query_matches, migrate_labels_to_archive, normalize_additional_type,
    normalize_label_list, read_labels_for_file, set_labels_for_file,
)


class TurtleIngestMixin:
    """Flash-drive ingest, missing-turtle report, and folder-structure helpers.

    Mixin for TurtleManager.
    """
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

    def _create_modern_turtle_structure(self, turtle_dir):
        """Create the full modern reference-folder layout under ``turtle_dir``.

        ``plastron/`` and ``carapace/``, each with ``Old References/`` and
        ``Other Plastrons``/``Other Carapaces``. Shared by ``_process_single_turtle``
        and ``resolve_or_create_canonical_turtle_dir``.
        """
        # Tripwire: callers clamp before this, so a too-deep path means a create
        # site was missed. Warn (don't fail) so the regression is visible in logs.
        depth = _turtle_dir_depth(self.base_dir, turtle_dir)
        if depth is not None and depth > _MAX_TURTLE_DIR_DEPTH:
            print(
                f"⚠️ Creating turtle folder below State/Location/<turtle> (depth {depth}): "
                f"{turtle_dir} — should have been clamped upstream."
            )
        for subdir in ('plastron', 'plastron/Old References', 'plastron/Other Plastrons',
                       'carapace', 'carapace/Old References', 'carapace/Other Carapaces'):
            os.makedirs(os.path.join(turtle_dir, subdir), exist_ok=True)

    def _process_single_turtle(self, source_path, location_dir, turtle_id, photo_type="plastron"):
        """Creates folders and generates .pt tensor file using SuperPoint.

        Args:
            photo_type: 'plastron' (default) saves to plastron/, 'carapace' saves to carapace/.
        """
        turtle_dir = os.path.join(location_dir, turtle_id)
        # Never create a new turtle below State/Location (no 4-level sub-site nesting).
        turtle_dir = _clamp_turtle_dir_depth(self.base_dir, turtle_dir)

        if photo_type == "carapace":
            data_dir = os.path.join(turtle_dir, 'carapace')
        else:
            data_dir = os.path.join(turtle_dir, 'plastron')

        os.makedirs(data_dir, exist_ok=True)
        # Create the full folder structure for both photo types
        self._create_modern_turtle_structure(turtle_dir)

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

