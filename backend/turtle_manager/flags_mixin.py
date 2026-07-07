"""
Find-metadata flags, release flags, get_turtles_with_flags.
"""
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


class TurtleFlagsMixin:
    """Find-metadata flags, release flags, get_turtles_with_flags.

    Mixin for TurtleManager.
    """
    def _extract_find_metadata_from_packet(self, packet_dir):
        """Pull flag / find fields out of a review packet's ``metadata.json``.

        Used as a fallback in approval when the caller didn't supply
        ``find_metadata`` explicitly: the community/admin upload form already
        wrote the flag, physical_flag, and collected_to_lab values into the
        packet metadata at upload time, and historically the approval flow
        only forwarded those into ``find_metadata.json`` when the frontend
        sent them back in the approve request body. The two production
        approval call sites (``handleSaveAndApprove`` and
        ``handleConfirmNewTurtle`` in ``useAdminTurtleRecords.tsx``) don't
        pass them, so the data was silently dropped on every approval and
        the Release page never had anything to show.

        Returns a dict suitable for writing to ``find_metadata.json``, or
        ``None`` when no relevant fields are set on the packet.
        """
        if not packet_dir or not os.path.isdir(packet_dir):
            return None
        meta_path = os.path.join(packet_dir, 'metadata.json')
        if not os.path.isfile(meta_path):
            return None
        try:
            with open(meta_path, 'r') as f:
                packet_meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
        if not isinstance(packet_meta, dict):
            return None
        fields = (
            'collected_to_lab',
            'physical_flag',
            'digital_flag_lat',
            'digital_flag_lon',
            'digital_flag_source',
            'microhabitat_uploaded',
            'other_angles_uploaded',
        )
        out = {}
        for k in fields:
            v = packet_meta.get(k)
            if v not in (None, ''):
                out[k] = v
        return out if out else None

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
        """Scan data dir for turtles that have find_metadata.json.

        Excludes only the Review_Queue staging area (those packets are
        pre-approval and shouldn't surface on the Release page).
        Community_Uploads IS scanned: when an admin approves a community
        upload as a brand-new turtle and the approve flow keeps it under
        ``Community_Uploads/<sheet>/<turtle_id>/``, that turtle's
        find_metadata.json must still be discoverable so the field team
        can act on the digital flag.
        """
        results = []
        for state in sorted(os.listdir(self.base_dir)):
            state_path = os.path.join(self.base_dir, state)
            if not os.path.isdir(state_path) or state.startswith('.'):
                continue
            if state == "Review_Queue":
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