"""
File storage of the database-backed research groups.

Layout: ORG_DATA_DIR/<org_id>/{submissions/<uuid>/, turtles/<turtle_id>/}. The root is a sibling
of the main group's data dir on purpose: the main group's folder walks (index, crash recovery)
and the unauthenticated /api/images endpoint must never see these files.
Database rows store paths relative to the group's root.
"""

import os
import shutil
import uuid
from pathlib import Path

_DEFAULT_ROOT = Path(__file__).resolve().parent.parent / 'org_data'


def data_root() -> str:
    return os.path.abspath(os.environ.get('ORG_DATA_DIR') or str(_DEFAULT_ROOT))


def org_root(org_id: int) -> str:
    return os.path.join(data_root(), str(int(org_id)))


def abs_path(org_id: int, rel_path: str) -> str:
    """Absolute path of a stored file; refuses anything outside the group's root."""
    root = org_root(org_id)
    full = os.path.abspath(os.path.join(root, rel_path))
    if os.path.commonpath([full, root]) != root:
        raise ValueError('Path escapes the research group storage root')
    return full


def rel_path(org_id: int, full_path: str) -> str:
    return os.path.relpath(full_path, org_root(org_id)).replace(os.sep, '/')


def new_submission_dir(org_id: int) -> str:
    path = os.path.join(org_root(org_id), 'submissions', uuid.uuid4().hex)
    os.makedirs(path, exist_ok=True)
    return path


def turtle_dir(org_id: int, turtle_id: int) -> str:
    path = os.path.join(org_root(org_id), 'turtles', str(int(turtle_id)))
    os.makedirs(path, exist_ok=True)
    return path


def feature_path_for(image_path: str) -> str:
    return os.path.splitext(image_path)[0] + '.pt'


def move_into_turtle_dir(org_id: int, turtle_id: int, src_full: str) -> str:
    """Copy an image (and its .pt, if any) into the turtle's folder. Returns the new image path.
    Copies instead of moving so a failed database commit leaves the submission intact."""
    dest_dir = turtle_dir(org_id, turtle_id)
    ext = os.path.splitext(src_full)[1].lower() or '.jpg'
    dest = os.path.join(dest_dir, f'{uuid.uuid4().hex}{ext}')
    shutil.copy2(src_full, dest)
    src_pt = feature_path_for(src_full)
    if os.path.exists(src_pt):
        shutil.copy2(src_pt, feature_path_for(dest))
    return dest


def remove_quietly(*paths: str) -> None:
    for p in paths:
        if p and os.path.isfile(p):
            try:
                os.remove(p)
            except OSError:
                pass


def remove_tree_quietly(path: str) -> None:
    if path and os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
