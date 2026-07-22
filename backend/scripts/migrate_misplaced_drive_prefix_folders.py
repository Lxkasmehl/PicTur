"""
Move turtle folders that were created under a mistaken top-level drive key.

When ``new_location`` once started with a *General Location* segment (e.g. ``CPBS``)
instead of the sheet tab (``NebraskaCPBS``), turtles could land under::

    data/CPBS/<anything>/F233/

instead of::

    data/NebraskaCPBS/CPBS/F233/

This script finds every directory under ``data/<drive_key>/`` that looks like a
turtle folder (has ``plastron/``, ``carapace/``, or legacy ``ref_data/``) for
each ``drive_key`` in the flat-ingest map, and plans a move to the canonical
``data/<State>/<Location>/<turtle_id>/`` path from ``DRIVE_LOCATION_TO_BACKEND_PATH``.

Imports only the **pure** ``path_utils`` / ``safe_fs`` modules (the single source
of truth for the turtle-folder predicate and the undeletable-dataset guard), NOT
the ``turtle_manager`` package — so SuperPoint/torch is never loaded. Keep the
``DRIVE_LOCATION_TO_BACKEND_PATH`` dict in sync with ``turtle_manager.py``.

Usage (dry run — default, prints planned moves only)::

    cd backend
    python migrate_misplaced_drive_prefix_folders.py

    docker compose exec backend python migrate_misplaced_drive_prefix_folders.py

Execute moves (data directory inside the backend container is usually ``/app/data``,
see ``DATA_DIR`` in ``Dockerfile`` and the ``backend-data`` volume in ``docker-compose.yml``)::

    docker compose exec backend python migrate_misplaced_drive_prefix_folders.py --apply

Only one wrong prefix (e.g. only CPBS)::

    python migrate_misplaced_drive_prefix_folders.py --only CPBS
    python migrate_misplaced_drive_prefix_folders.py --only CPBS --apply

After ``--apply``, empty directories under the old prefix are removed (bottom-up),
possibly in two passes. If anything remains under a wrong top-level key (files or
turtle-shaped folders), the script prints ``LEFTOVER`` lines and exits with code ``1``
so you can fix or delete stragglers manually — the app should not keep indexing
ghost paths.

Exit codes: ``0`` — success; ``1`` — filesystem error during ``--apply``, skipped
conflicts, or **leftovers** still present under a wrong drive-key prefix after the run.
"""

from __future__ import annotations

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))  # scripts/ for ingest_common etc.
# turtle_manager/ on path so the PURE path_utils / safe_fs modules import
# standalone — WITHOUT triggering turtle_manager/__init__ (which loads SuperPoint).
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'turtle_manager'))

import argparse
import os
import shutil
import sys
from typing import Dict, List, Optional, Sequence, Tuple

# Single source of truth for the turtle-folder predicate + the delete guard.
from path_utils import _is_turtle_data_folder
from safe_fs import guarded_rmdir, UndeletableTurtleDataError

# SYNC: must match turtle_manager.DRIVE_LOCATION_TO_BACKEND_PATH
DRIVE_LOCATION_TO_BACKEND_PATH: Dict[str, str] = {
    "Dee Hobelman": "Kansas/Dee Hobelman",
    "Karlyle Woods": "Kansas/Karlyle Woods",
    "Lawrence": "Kansas/Lawrence",
    "North Topeka": "Kansas/North Topeka",
    "Other": "Kansas/Other",
    "West Topeka": "Kansas/West Topeka",
    "CPBS": "NebraskaCPBS/CPBS",
    "Crescent Lake": "NebraskaCL/Crescent Lake",
}

# Do not treat these as mistaken drive keys even if a name collided (should not).
SKIP_TOP_LEVEL_NAMES = frozenset(
    {
        "Review_Queue",
        "Community_Uploads",
        "Incidental Places",
        "benchmarks",
        "Community",
        "__pycache__",
    }
)


def _iter_turtle_dirs_under(wrong_root: str) -> List[str]:
    """All turtle-like directories anywhere under wrong_root (deepest paths first)."""
    found: List[str] = []
    for dirpath, _dirnames, _filenames in os.walk(wrong_root):
        if "__pycache__" in dirpath.split(os.sep):
            continue
        if _is_turtle_data_folder(dirpath):
            found.append(dirpath)
    # Move deeper paths first so siblings under the same junk folder behave predictably
    found.sort(key=lambda p: (-p.count(os.sep), p))
    return found


def _target_base(data_root: str, drive_key: str) -> Optional[str]:
    mapped = DRIVE_LOCATION_TO_BACKEND_PATH.get(drive_key)
    if not mapped or "/" not in mapped:
        return None
    return os.path.normpath(os.path.join(data_root, *mapped.split("/")))


def _drive_keys_for_run(only_keys: Optional[Sequence[str]]) -> List[str]:
    keys = list(DRIVE_LOCATION_TO_BACKEND_PATH.keys())
    if only_keys:
        wanted = {k.strip() for k in only_keys if k.strip()}
        keys = [k for k in keys if k in wanted]
    return keys


def _conflict_reason(dest: str) -> Optional[str]:
    """If dest exists and we should not replace it, return a short reason."""
    if not os.path.lexists(dest):
        return None
    if os.path.islink(dest):
        return "destination is a symlink"
    if not os.path.isdir(dest):
        return "destination exists and is not a directory"
    try:
        entries = os.listdir(dest)
    except OSError as e:
        return f"cannot list destination: {e}"
    if not entries:
        # Empty dir: apply path will rmdir before shutil.move (avoids move-into-dir nesting).
        return None
    if _is_turtle_data_folder(dest):
        return "destination already contains a turtle folder (non-empty)"
    return "destination directory is non-empty"


def _prune_empty_under(root: str) -> int:
    removed = 0
    if not os.path.isdir(root):
        return 0
    for dirpath, _dirnames, _filenames in os.walk(root, topdown=False):
        try:
            if os.path.isdir(dirpath) and not os.listdir(dirpath):
                # Empty dirs are never turtle data, so the guard passes; routing
                # through it means a dir that concurrently became a turtle folder
                # fails closed (skipped) instead of being removed.
                guarded_rmdir(dirpath)
                removed += 1
        except (OSError, UndeletableTurtleDataError):
            continue
    return removed


def _prune_empty_twice(wrong_root: str) -> int:
    """Run bottom-up empty-dir removal twice (nested chains)."""
    total = _prune_empty_under(wrong_root)
    total += _prune_empty_under(wrong_root)
    return total


def _leftovers_under_wrong_roots(data_root: str, drive_keys: Sequence[str]) -> List[str]:
    """Human-readable problems if mistaken top-level trees were not fully removed."""
    out: List[str] = []
    for drive_key in drive_keys:
        if drive_key in SKIP_TOP_LEVEL_NAMES:
            continue
        wrong_root = os.path.join(data_root, drive_key)
        if not os.path.isdir(wrong_root):
            continue
        for dirpath, _dirnames, filenames in os.walk(wrong_root):
            if _is_turtle_data_folder(dirpath):
                out.append(f"LEFTOVER TURTLE under wrong prefix [{drive_key}]: {dirpath}")
            for fn in filenames:
                out.append(f"LEFTOVER FILE under wrong prefix [{drive_key}]: {os.path.join(dirpath, fn)}")
    return out


def _collect_moves(
    data_root: str,
    only_keys: Optional[Sequence[str]],
) -> Tuple[List[Tuple[str, str, str]], List[str]]:
    """
    Returns (moves, conflicts) where each move is (drive_key, src, dest_abs)
    and conflicts are human-readable lines.
    """
    moves: List[Tuple[str, str, str]] = []
    conflicts: List[str] = []
    keys = _drive_keys_for_run(only_keys)

    for drive_key in keys:
        if drive_key in SKIP_TOP_LEVEL_NAMES:
            continue
        wrong_root = os.path.join(data_root, drive_key)
        if not os.path.isdir(wrong_root):
            continue
        target_base = _target_base(data_root, drive_key)
        if not target_base:
            continue

        for src in _iter_turtle_dirs_under(wrong_root):
            turtle_id = os.path.basename(src)
            dest = os.path.join(target_base, turtle_id)
            try:
                src_real = os.path.realpath(src)
                dest_real = os.path.realpath(dest)
                if src_real == dest_real:
                    continue
            except OSError:
                pass

            reason = _conflict_reason(dest)
            if reason:
                conflicts.append(
                    f"CONFLICT [{drive_key}] {src} -> {dest}: {reason}"
                )
                continue
            moves.append((drive_key, src, dest))

    return moves, conflicts


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-root",
        default=None,
        help="Data directory (default: env DATA_DIR if set, else ./data next to this script). In Docker: /app/data",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually move folders (default is dry run)",
    )
    parser.add_argument(
        "--only",
        action="append",
        dest="only_keys",
        metavar="KEY",
        help="Restrict to one mistaken top-level name (repeatable), e.g. CPBS",
    )
    args = parser.parse_args(argv)

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_root = (
        args.data_root
        or os.environ.get("DATA_DIR")
        or os.path.join(backend_dir, "data")
    )
    data_root = os.path.normpath(os.path.realpath(data_root))

    if not os.path.isdir(data_root):
        print(f"ERROR: data root not found: {data_root}", file=sys.stderr)
        return 1

    moves, conflicts = _collect_moves(data_root, args.only_keys)

    for line in conflicts:
        print(line)

    if not moves and not conflicts:
        print("Nothing to do (no misplaced turtle folders under known drive keys).")
        return 0

    for drive_key, src, dest in moves:
        mode = "MOVE" if args.apply else "PLAN"
        print(f"{mode} [{drive_key}] {src}  ->  {dest}")

    if not args.apply:
        print(f"\nDry run: {len(moves)} move(s) planned. Re-run with --apply to execute.")
        if conflicts:
            print(
                f"Note: {len(conflicts)} conflict(s) listed above — resolve before --apply "
                "if those turtles need moving too."
            )
        return 0

    # --apply
    os.makedirs(data_root, exist_ok=True)
    errors = 0
    touched_wrong_roots: List[str] = []
    for drive_key, src, dest in moves:
        wrong_root = os.path.join(data_root, drive_key)
        touched_wrong_roots.append(wrong_root)
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.isdir(dest) and not os.listdir(dest):
                try:
                    # Empty dest → guard passes; fails closed if it isn't.
                    guarded_rmdir(dest)
                except (OSError, UndeletableTurtleDataError):
                    pass
            shutil.move(src, dest)
            print(f"OK [{drive_key}] moved to {dest}")
        except OSError as e:
            print(f"ERROR moving {src} -> {dest}: {e}", file=sys.stderr)
            errors += 1

    pruned_total = 0
    for wrong_root in sorted(set(touched_wrong_roots)):
        if os.path.isdir(wrong_root):
            pruned_total += _prune_empty_twice(wrong_root)

    if pruned_total:
        print(f"Removed {pruned_total} empty director(ies) under old prefix(es).")

    keys_audit = _drive_keys_for_run(args.only_keys)
    leftovers = _leftovers_under_wrong_roots(data_root, keys_audit)
    if leftovers:
        for line in leftovers:
            print(line, file=sys.stderr)
        print(
            "ERROR: Wrong-prefix tree is not fully empty — remove or relocate the paths above, "
            "then re-run (or widen cleanup manually).",
            file=sys.stderr,
        )

    if errors:
        return 1
    if conflicts:
        print(
            f"Note: {len(conflicts)} conflict(s) were skipped; fix those manually.",
            file=sys.stderr,
        )
        return 1
    if leftovers:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
