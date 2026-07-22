"""
safe_fs — make the permanent turtle dataset undeletable by the app.

The on-disk turtle dataset is a permanent research asset. A directory is
protected when it IS a *turtle folder* (holds a ``plastron/``, ``carapace/`` or
legacy ``ref_data/`` reference subdir) OR when it *contains* such a folder at any
depth (a ``State/``, ``State/Location/``, combo-sheet ``NebraskaCPBS/`` or
``Incidental Places/`` directory). Protected folders may be moved, renamed, or
archived (delete-becomes-reversible) — never destroyed, even by an admin, and
never by accident.

Legitimate deletes keep working untouched: temp files, ``.pt`` tensors,
``Review_Queue`` packets, staged files, and the reference-swap
archive-then-remove all operate on non-turtle-data paths (or on exempt transient
areas) and are unaffected.

Pure module: no Flask, no brain/VRAM, no Sheets. It reuses the leaf predicate
``path_utils._is_turtle_data_folder`` so there is a single source of truth for
"is this a turtle folder". It can be imported either as ``turtle_manager.safe_fs``
(package context) or, by standalone scripts that must avoid loading SuperPoint,
as a top-level ``safe_fs`` (with ``turtle_manager/`` on ``sys.path``).
"""
import os
import re
import shutil
import tempfile
import time

try:
    from .path_utils import _is_turtle_data_folder
except ImportError:  # standalone import (scripts put turtle_manager/ on sys.path)
    from path_utils import _is_turtle_data_folder


# Absolute default data dir, resolved exactly the way TurtleManager does it:
# safe_fs.py lives in backend/turtle_manager/, so two dirnames up + 'data' is
# backend/data. Callers with their own base (the manager passes self.base_dir;
# tests pass tmp_path) override via the base_dir argument, so this default only
# matters for standalone scripts operating on the real data tree.
BASE_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data'
)

# Directory name for archived (delete-becomes-reversible) turtle folders.
ARCHIVE_DIR_NAME = '_Archive'

# Transient / derived areas under the data root whose contents are legitimately
# deletable even if a stray marker made them look like turtle data:
#   - Review_Queue  : community/admin upload packets (candidate_matches, etc.)
#   - benchmarks    : runtime benchmark logs
# NOTE: Community_Uploads and 'Incidental Places' are deliberately NOT exempt —
# their turtle folders hold real reference photos and stay protected. _Archive is
# ALSO NOT exempt: it holds whole archived turtle folders (a rolled-back new
# turtle can be the sole copy of its photos), so archived data is protected like
# the live dataset — it can only be purged via the explicit --force-destroy-dataset
# path (which bypasses the guard entirely), never by a routine reset or an
# accidental guarded delete.
_EXEMPT_RELATIVE_AREAS = ('Review_Queue', 'benchmarks')


class UndeletableTurtleDataError(Exception):
    """Raised when a delete would destroy a protected turtle-data folder."""


def _raise(err):
    """os.walk onerror hook: re-raise so a mid-walk scandir failure fails closed."""
    raise err


def _norm_real(path):
    """realpath + normcase so containment compares consistently on Windows and Linux.

    normcase is a no-op on Linux (case-sensitive, matching production) and
    lowercases + normalizes separators on Windows (local dev), mirroring how the
    rest of the backend compares data paths.
    """
    return os.path.normcase(os.path.realpath(path))


def _is_within(path, ancestor):
    """True if ``path`` is ``ancestor`` or resolves to somewhere underneath it."""
    try:
        p = _norm_real(path)
        a = _norm_real(ancestor)
    except OSError:
        return False
    if p == a:
        return True
    try:
        return os.path.commonpath([p, a]) == a
    except (ValueError, OSError):
        return False


def is_or_contains_turtle_data(path):
    """True if ``path`` IS a turtle folder or CONTAINS one at any depth.

    Fail closed: any race / ``OSError`` while probing is treated as "cannot prove
    this is safe to delete" and returns True. The walk exits early on the first
    turtle folder found (so guarding a populated ``State/`` tree is cheap), does
    not follow directory symlinks (``followlinks=False`` prevents symlink loops),
    tracks visited real paths as a second loop guard, and re-raises any scandir
    error via ``onerror`` so a partial listing never masks protected data.
    """
    if not path:
        return True  # cannot prove safe → protect
    try:
        if not os.path.isdir(path):
            # A missing dir has nothing to protect; a file is guarded by its own
            # callers (soft-delete / .pt removal), never by this folder predicate.
            return False
    except OSError:
        return True
    seen = set()
    try:
        for root, dirs, files in os.walk(path, onerror=_raise, followlinks=False):
            try:
                if _is_turtle_data_folder(root):
                    return True
                rp = os.path.realpath(root)
            except OSError:
                return True
            if rp in seen:
                dirs[:] = []
                continue
            seen.add(rp)
    except OSError:
        return True
    return False


def _is_exempt(path, base_dir=None):
    """True for paths the guard must let through even if flagged as turtle data.

    Exempt: the system tempdir (upload staging), and (relative to ``base_dir``)
    ``Review_Queue``, ``benchmarks`` and ``_Archive``. ``base_dir`` defaults to
    the module ``BASE_DATA_DIR``.

    The tempdir exemption applies only *outside* the data root. In production the
    data root (``/app/data``) and the system tempdir (``/tmp``) are disjoint, so
    this is a no-op there. It matters only when the data root itself sits under
    the tempdir — which is exactly how tests build a fake base (``tmp_path`` lives
    under ``/tmp``): the dataset stays protected, while genuine staging files
    outside it stay deletable.
    """
    base = base_dir if base_dir is not None else BASE_DATA_DIR
    if _is_within(path, tempfile.gettempdir()) and not _is_within(path, base):
        return True
    for area in _EXEMPT_RELATIVE_AREAS:
        if _is_within(path, os.path.join(base, area)):
            return True
    return False


def assert_not_turtle_data(path, base_dir=None):
    """Raise ``UndeletableTurtleDataError`` if deleting ``path`` would lose turtle data."""
    if is_or_contains_turtle_data(path) and not _is_exempt(path, base_dir):
        raise UndeletableTurtleDataError(str(path))


def guarded_rmtree(path, base_dir=None):
    """``shutil.rmtree`` that refuses to destroy a protected turtle-data folder."""
    assert_not_turtle_data(path, base_dir)
    shutil.rmtree(path)


def guarded_rmdir(path, base_dir=None):
    """``os.rmdir`` (empty dirs only) that still refuses a protected turtle folder.

    Removing an empty directory is not data loss, so it is allowed (an empty dir
    is not turtle data). A non-empty turtle folder is refused by the assert; any
    other non-empty dir is refused by ``os.rmdir`` itself.
    """
    assert_not_turtle_data(path, base_dir)
    os.rmdir(path)


def _sanitized_relpath(src_abs, base):
    """Filesystem-safe token for the source's path relative to ``base``."""
    try:
        rel = os.path.relpath(src_abs, base)
    except ValueError:
        rel = os.path.basename(src_abs)
    if rel.startswith('..') or os.path.isabs(rel):
        rel = os.path.basename(src_abs)
    flat = rel.replace('\\', '/').replace('/', '__')
    safe = re.sub(r'[^A-Za-z0-9._-]+', '_', flat).strip('_')
    return safe or 'turtle'


def archive_turtle_folder(src, base_dir=None):
    """Move a turtle folder into ``<base>/_Archive/<UTC timestamp>_<relpath>/``.

    This is the "delete becomes reversible" primitive used in place of
    ``shutil.rmtree`` on turtle folders (merge secondary removal, new-turtle
    rollback, the merge CLI). Returns the destination path. The ``_Archive`` root
    is created lazily. A name collision (e.g. a concurrent archive of a
    same-named path in the same second) gets a ``__N`` counter suffix, so the
    move never clobbers or nests into an existing archive under the threaded
    server. No shared mutable module state is used.

    ``base_dir`` defaults to the module ``BASE_DATA_DIR``; callers inside the
    manager pass ``self.base_dir`` so an archive always lands under the same data
    root the folder came from (critical for tests using a temp base dir).
    """
    base = base_dir if base_dir is not None else BASE_DATA_DIR
    src_abs = os.path.abspath(src)
    if not os.path.isdir(src_abs):
        raise FileNotFoundError(f"archive_turtle_folder: source is not a directory: {src}")

    archive_root = os.path.join(base, ARCHIVE_DIR_NAME)
    os.makedirs(archive_root, exist_ok=True)

    ts = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    base_name = f"{ts}_{_sanitized_relpath(src_abs, base)}"
    dest = os.path.join(archive_root, base_name)
    counter = 1
    while os.path.exists(dest):
        dest = os.path.join(archive_root, f"{base_name}__{counter}")
        counter += 1

    shutil.move(src_abs, dest)
    print(f"🗄️ Archived turtle folder → {dest}")
    return dest
