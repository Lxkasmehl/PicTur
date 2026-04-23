"""
Shared helpers for maintenance scripts: backfill_folder_names.py and ingest_rebuild_folder.py.

Read-only Sheets access + disk-layout helpers + dry-run reporter.
NEVER writes to Google Sheets.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional, Tuple

# Import the project's existing mapping so maintenance scripts stay in sync
# with the rest of the backend's location resolution.
from turtle_manager import DRIVE_LOCATION_TO_BACKEND_PATH

IMAGE_EXTS = ('.jpg', '.jpeg', '.png')
SKIP_FILES = {'desktop.ini', 'Thumbs.db', '.DS_Store'}
SKIP_DIRS = {'Review_Queue', 'Community_Uploads', 'Incidental Places',
             'benchmarks', 'Community', '__pycache__'}

# Primary-key pattern — current format is "T" + long numeric string.
# Kept deliberately broad so both current and legacy primary keys match.
PRIMARY_ID_RE = re.compile(r'^T\d{10,}$')

# Biology-ID pattern: letter (F/M/J/U) + digits, optionally zero-padded.
BIO_ID_RE = re.compile(r'^([A-Za-z])(\d+)$')


@dataclass
class SheetRow:
    """A single row read from a sheet tab. Read-only view."""
    spreadsheet_label: str          # 'research' or 'community'
    tab: str                        # sheet tab name
    row_index: int                  # 1-based, for audit
    primary_id: str                 # may be '' if row lacks one
    bio_id: str                     # may be '' if row lacks one
    general_location: str           # may be '' (unknown/dead)
    name: str = ''                  # turtle's name, if the sheet has one


def iter_sheet_rows(service, spreadsheet_label: str) -> Iterator[SheetRow]:
    """Yield every row across every tab of the given spreadsheet.

    READ-ONLY. Skips rows that have neither a primary_id nor a bio_id.
    If the sheet is missing a 'Primary ID' column, the primary_id field is ''.
    """
    if service is None:
        return

    try:
        tabs = service.list_sheets()
    except Exception as e:
        print(f"  ! Could not list tabs in {spreadsheet_label} spreadsheet: {e}", file=sys.stderr)
        return

    for tab in tabs:
        try:
            result = service.get_sheet_values(f"{_escape(tab)}!A:Z")
        except Exception as e:
            print(f"  ! Failed to read tab '{tab}' in {spreadsheet_label}: {e}", file=sys.stderr)
            continue

        if not result or 'values' not in result:
            continue
        rows = result['values']
        if not rows:
            continue

        headers = [h.strip() for h in rows[0]]
        try:
            primary_col = headers.index('Primary ID')
        except ValueError:
            primary_col = None
        try:
            id_col = headers.index('ID')
        except ValueError:
            id_col = None
        try:
            loc_col = headers.index('General Location')
        except ValueError:
            loc_col = None
        try:
            name_col = headers.index('Name')
        except ValueError:
            name_col = None

        if id_col is None and primary_col is None:
            continue  # nothing usable

        for i, row in enumerate(rows[1:], start=2):
            def _cell(idx):
                if idx is None or idx >= len(row):
                    return ''
                return (row[idx] or '').strip()

            primary_id = _cell(primary_col)
            bio_id = _cell(id_col)
            if not primary_id and not bio_id:
                continue

            yield SheetRow(
                spreadsheet_label=spreadsheet_label,
                tab=tab,
                row_index=i,
                primary_id=primary_id,
                bio_id=bio_id,
                general_location=_cell(loc_col),
                name=_cell(name_col),
            )


def resolve_backend_path(general_location: str) -> Optional[Tuple[str, str]]:
    """Map a sheet's 'General Location' value to (state, location) on disk.

    Returns None if the location is blank or not recognized in
    DRIVE_LOCATION_TO_BACKEND_PATH.
    """
    if not general_location:
        return None
    mapped = DRIVE_LOCATION_TO_BACKEND_PATH.get(general_location)
    if not mapped:
        return None
    if '/' not in mapped:
        return None
    state, location = mapped.split('/', 1)
    return state, location


def find_turtle_folder(
    data_root: str,
    state: str,
    location: str,
    bio_id: str = '',
    primary_id: str = '',
) -> Optional[str]:
    """Locate a turtle folder within {data_root}/{state}/{location}/.

    Prefers folders whose name contains primary_id (post-rename) over
    bare bio_id folders (pre-rename). Returns the first match or None.
    """
    loc_dir = os.path.join(data_root, state, location)
    if not os.path.isdir(loc_dir):
        return None

    try:
        entries = os.listdir(loc_dir)
    except OSError:
        return None

    # 1) Prefer combined name match
    if primary_id:
        for entry in entries:
            if primary_id in entry:
                full = os.path.join(loc_dir, entry)
                if os.path.isdir(full):
                    return full

    # 2) Fall back to exact bio_id match
    if bio_id:
        exact = os.path.join(loc_dir, bio_id)
        if os.path.isdir(exact):
            return exact

    return None


def find_folder_by_primary_in_state_root(data_root: str, state: str, primary_id: str) -> Optional[str]:
    """Find a misplaced folder whose NAME matches a primary_id, sitting directly
    under data/{state}/ instead of inside a location subfolder. Used by Job B
    of the rename script to detect the production bug.
    """
    state_dir = os.path.join(data_root, state)
    if not os.path.isdir(state_dir) or not primary_id:
        return None
    candidate = os.path.join(state_dir, primary_id)
    if os.path.isdir(candidate):
        return candidate
    return None


def list_all_states(data_root: str) -> List[str]:
    """List every state-level folder under data_root, excluding system folders."""
    if not os.path.isdir(data_root):
        return []
    out = []
    for entry in sorted(os.listdir(data_root)):
        if entry in SKIP_DIRS or entry in SKIP_FILES:
            continue
        full = os.path.join(data_root, entry)
        if os.path.isdir(full):
            out.append(entry)
    return out


def is_primary_key_only_folder(name: str) -> bool:
    """True if the folder name looks like a standalone primary key (no bio_id prefix)."""
    return bool(PRIMARY_ID_RE.match(name))


def is_bio_id_only_folder(name: str) -> bool:
    """True if the folder name looks like a standalone bio_id (no primary_id suffix)."""
    return bool(BIO_ID_RE.match(name))


def parse_combined_folder_name(name: str) -> Optional[Tuple[str, str]]:
    """Parse a '{bio_id}_{primary_id}' folder name. Returns (bio_id, primary_id) or None."""
    if '_' not in name:
        return None
    parts = name.split('_', 1)
    if len(parts) != 2:
        return None
    bio, primary = parts
    if not BIO_ID_RE.match(bio):
        return None
    if not PRIMARY_ID_RE.match(primary):
        return None
    return bio, primary


# --- Dry-run reporter ---------------------------------------------------------


@dataclass
class Operation:
    """A single planned change. Kind is free-form ('rename', 'move', 'mkdir', 'skip', 'warn')."""
    kind: str
    detail: str
    old_path: str = ''
    new_path: str = ''


@dataclass
class DryRunReporter:
    """Collects planned operations and prints a formatted manifest.

    Usage:
        reporter = DryRunReporter(apply=args.apply)
        reporter.plan('rename', old_path=..., new_path=..., detail='turtle F017 → F017_T177...')
        reporter.warn('no sheet row for F123')
        reporter.print_manifest()
    """
    apply: bool = False
    ops: List[Operation] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def plan(self, kind: str, detail: str = '', old_path: str = '', new_path: str = ''):
        self.ops.append(Operation(kind=kind, detail=detail, old_path=old_path, new_path=new_path))
        self.counts[kind] = self.counts.get(kind, 0) + 1

    def warn(self, msg: str):
        self.warnings.append(msg)

    def error(self, msg: str):
        self.errors.append(msg)

    def print_manifest(self):
        print()
        print('=' * 72)
        print(f"  MANIFEST — {'APPLYING CHANGES' if self.apply else 'DRY RUN (use --apply to execute)'}")
        print('=' * 72)

        by_kind: Dict[str, List[Operation]] = {}
        for op in self.ops:
            by_kind.setdefault(op.kind, []).append(op)

        for kind in sorted(by_kind):
            print(f"\n-- {kind.upper()} ({len(by_kind[kind])}) --")
            for op in by_kind[kind]:
                if op.old_path and op.new_path:
                    print(f"  {op.old_path}")
                    print(f"    -> {op.new_path}")
                    if op.detail:
                        print(f"    ({op.detail})")
                else:
                    print(f"  {op.detail or op.old_path or op.new_path}")

        if self.warnings:
            print(f"\n-- WARNINGS ({len(self.warnings)}) --")
            for w in self.warnings:
                print(f"  ! {w}")

        if self.errors:
            print(f"\n-- ERRORS ({len(self.errors)}) --")
            for e in self.errors:
                print(f"  X {e}")

        print()
        print('-' * 72)
        print('  Summary:')
        for kind in sorted(self.counts):
            print(f"    {kind}: {self.counts[kind]}")
        print(f"    warnings: {len(self.warnings)}")
        print(f"    errors:   {len(self.errors)}")
        print('-' * 72)
        if not self.apply:
            print('  This was a dry run. Re-run with --apply to execute.')
        print()


def _escape(sheet_name: str) -> str:
    """Quote a sheet tab name for A1-notation ranges."""
    if "'" in sheet_name:
        sheet_name = sheet_name.replace("'", "''")
    return f"'{sheet_name}'"
