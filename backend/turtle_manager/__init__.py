"""
turtle_manager package — core TurtleManager and all mixins.

External callers can continue to do:
    from turtle_manager import TurtleManager
    from turtle_manager import BASE_DATA_DIR, DRIVE_LOCATION_TO_BACKEND_PATH, ...
"""
from .manager import TurtleManager
from .path_utils import (
    BASE_DATA_DIR,
    DRIVE_LOCATION_TO_BACKEND_PATH,
    DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP,
    LOCATION_NAME_MAP,
    canonical_new_turtle_folder_id,
    _extract_exif_date,
    _find_image_next_to_pt,
    _find_image_in_dir,
    _turtle_dir_depth,
    _clamp_turtle_dir_depth,
    _looks_like_primary_id,
    _safe_folder_name,
    _IMAGE_EXTENSIONS,
)

__all__ = [
    "TurtleManager",
    "BASE_DATA_DIR",
    "DRIVE_LOCATION_TO_BACKEND_PATH",
    "DRIVE_STATE_LEVEL_FOLDERS",
    "DRIVE_STATE_NAME_MAP",
    "LOCATION_NAME_MAP",
    "canonical_new_turtle_folder_id",
    "_extract_exif_date",
    "_find_image_next_to_pt",
    "_find_image_in_dir",
    "_turtle_dir_depth",
    "_clamp_turtle_dir_depth",
    "_looks_like_primary_id",
    "_safe_folder_name",
    "_IMAGE_EXTENSIONS",
]

from .folder_images import build_turtle_images_payload, dir_has_image, extract_upload_ts_from_filename, IMAGE_EXTENSIONS
