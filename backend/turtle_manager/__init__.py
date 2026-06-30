"""
turtle_manager package — core TurtleManager and all mixins.

External callers can continue to do:
    from turtle_manager import TurtleManager
    from turtle_manager import BASE_DATA_DIR, DRIVE_LOCATION_TO_BACKEND_PATH, ...
    from turtle_manager import brain  # the SuperPoint/LightGlue brain singleton
"""
import sys as _sys
import types as _types

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

# ---------------------------------------------------------------------------
# brain — the SuperPoint/LightGlue singleton, exposed at package level so
# tests can patch it via `turtle_manager.brain = mock` or
# `patch("turtle_manager.brain", mock)`.
#
# Each mixin imports brain directly from turtles.image_processing. To keep
# all references in sync, we (a) expose brain here, and (b) propagate any
# assignment to this attribute into every already-loaded sub-module's
# namespace via a module __setattr__ hook.
# ---------------------------------------------------------------------------

_BRAIN_SUBMODS = (
    'turtle_manager.manager',
    'turtle_manager.reference_mixin',
    'turtle_manager.flags_mixin',
    'turtle_manager.review_mixin',
    'turtle_manager.merge_mixin',
    'turtle_manager.ingest_mixin',
    'turtle_manager.identifier_plastron_mixin',
    'turtle_manager.additional_images_mixin',
    'turtle_manager.deletion_mixin',
    'turtle_manager.folder_resolver_mixin',
)


def _propagate_brain(b):
    """Push *b* into every already-loaded sub-module that holds a local 'brain' name."""
    for _mod_name in _BRAIN_SUBMODS:
        _mod = _sys.modules.get(_mod_name)
        if _mod is not None and hasattr(_mod, 'brain'):
            _types.ModuleType.__setattr__(_mod, 'brain', b)


# Module __setattr__ so `turtle_manager.brain = mock` propagates to sub-modules
# (used by tests that do `tm.brain = mock_brain` without a full module reload).
class _TurtleManagerPackage(_types.ModuleType):
    def __setattr__(self, name, value):
        _types.ModuleType.__setattr__(self, name, value)
        if name == 'brain':
            _propagate_brain(value)


_sys.modules[__name__].__class__ = _TurtleManagerPackage

# Import brain from turtles.image_processing (same source as the sub-modules).
# Falls back gracefully so unit tests that mock sys.modules don't hard-exit.
try:
    from turtles.image_processing import brain  # noqa: F401  (re-exported)
except ImportError:
    try:
        from image_processing import brain  # noqa: F401
    except ImportError:
        brain = None  # noqa: F841 — will be replaced by tests or real import

# Propagate whatever brain we just resolved into already-loaded sub-modules.
# This runs on every importlib.reload(turtle_manager) too, so the reload
# pattern used by tests (mock sys.modules + reload) correctly replaces brain
# in all sub-module namespaces.
_propagate_brain(brain)
