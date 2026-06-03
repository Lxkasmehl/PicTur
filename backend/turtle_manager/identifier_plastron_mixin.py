"""
Legacy ref_data identifier plastron management.
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


class TurtleIdentifierPlastronMixin:
    """Legacy ref_data identifier plastron management.

    Mixin for TurtleManager.
    """
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
            old_img_basename = os.path.basename(old_img_path)
            shutil.move(old_img_path, os.path.join(loose_dir, archive_name))
            # Tags follow the photo into loose_images/ archive.
            migrate_labels_to_archive(
                ref_dir, old_img_basename,
                loose_dir, archive_name,
            )
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

    def set_identifier_plastron_from_path(self, turtle_id, query_image, sheet_name, mode, primary_id=None):
        """
        Set or replace the SuperPoint identifier (ref_data master image + .pt).

        ``mode``: ``set_if_missing`` (error if already present) or ``replace`` (create or upgrade).
        ``sheet_name`` should be the turtle's location path when the folder may not exist yet.
        ``primary_id`` (optional) is tried first when resolving the folder — see
        ``resolve_turtle_dir_for_sheet_upload`` for the cross-state-collision rationale.
        """
        if mode not in ("set_if_missing", "replace"):
            return False, "Invalid mode"
        turtle_dir = self.resolve_turtle_dir_for_sheet_upload(turtle_id, sheet_name, primary_id=primary_id)
        if not turtle_dir:
            return False, (
                "Turtle folder not found. Use the full disk path as sheet_name (e.g. Kansas/North Topeka), "
                "not the Google tab name alone when sites live under the state. Set General location + Location "
                "on the row, or fix stray empty folders under data/<State>/."
            )
        # Use folder basename as ref stem so an existing combined-name folder
        # (``F004_T1771234567``) gets files named ``F004_T1771234567.{ext}``,
        # not ``F004.{ext}``. See replace_turtle_reference for the rationale.
        ref_stem = os.path.basename(turtle_dir)
        ref_dir = os.path.join(turtle_dir, "ref_data")
        loose_dir = os.path.join(turtle_dir, "loose_images")
        os.makedirs(ref_dir, exist_ok=True)
        os.makedirs(loose_dir, exist_ok=True)
        has_id = os.path.isfile(os.path.join(ref_dir, f"{ref_stem}.pt")) or bool(
            _find_image_in_dir(ref_dir, ref_stem)
        )
        if mode == "set_if_missing" and has_id:
            return False, (
                "This turtle already has an identifier plastron. Use replace mode, or upload "
                "a non-identifier plastron under Additional photos as type Plastron (additional)."
            )
        if not has_id:
            return self._create_identifier_plastron(ref_stem, query_image, ref_dir, loose_dir)
        return self._replace_identifier_plastron(ref_stem, query_image, ref_dir, loose_dir)

