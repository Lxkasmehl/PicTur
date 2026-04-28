"""
Backfill turtle folder names to match the current state of Google Sheets.

Idempotent and safe to run daily (wired into the chronodrop —
``scripts/daily-backup.sh`` runs this between the Sheets export and the
data backup). Reads Sheets only — NEVER writes to them.

Three jobs in one pass:
  A. Rename `{bio_id}` folders to `{bio_id}_{primary_id}` once the sheet has
     assigned a primary_id.
  B. Rehome misplaced `{primary_id}`-only folders that ended up in a state root
     instead of the correct state/location directory (production bug), and
     give them their `{bio_id}_{primary_id}` name.
  C. Detect bio-ID changes (juvenile → adult, misgender corrections) on
     already-renamed `{old_bio}_{primary_id}` folders and rename to
     `{new_bio}_{primary_id}`.

Usage (from inside the backend container):
    python backfill_folder_names.py              # dry run (default)
    python backfill_folder_names.py --apply      # execute the planned changes

From the host via docker:
    docker compose exec backend python backfill_folder_names.py
    docker compose exec backend python backfill_folder_names.py --apply

Exit codes (used by the chronodrop wrapper to decide whether to restart):
    0 — dry run, or --apply with no changes needed.
    1 — one or more errors occurred (regardless of mode).
    2 — --apply executed at least one rename/rehome successfully. The
        wrapper restarts the backend so the VRAM cache reloads with the
        new file paths.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional, Tuple

from services.manager_service import get_sheets_service, get_community_sheets_service
from turtle_manager import BASE_DATA_DIR
from ingest_common import (
    DryRunReporter,
    SheetRow,
    find_folder_by_primary_in_state_root,
    find_turtle_folder,
    iter_sheet_rows,
    list_all_states,
    parse_combined_folder_name,
    resolve_backend_path,
)

REFERENCE_SUBDIRS = ('plastron', 'ref_data', 'carapace')


def _rename_reference_files(turtle_dir: str, old_stem: str, new_stem: str,
                            reporter: DryRunReporter, apply: bool):
    """Rename reference files whose basename (without ext) equals old_stem.

    Scans plastron/, ref_data/, carapace/ directly inside turtle_dir.
    Observation photos in Other Plastrons/ etc. are never renamed because
    refresh_database_index doesn't index those.
    """
    for sub in REFERENCE_SUBDIRS:
        ref_dir = os.path.join(turtle_dir, sub)
        if not os.path.isdir(ref_dir):
            continue
        try:
            entries = os.listdir(ref_dir)
        except OSError as e:
            reporter.error(f"Could not list {ref_dir}: {e}")
            continue
        for fname in entries:
            stem, ext = os.path.splitext(fname)
            if stem != old_stem:
                continue
            old_path = os.path.join(ref_dir, fname)
            new_path = os.path.join(ref_dir, f"{new_stem}{ext}")
            reporter.plan('rename-file', old_path=old_path, new_path=new_path)
            if apply:
                try:
                    os.rename(old_path, new_path)
                except OSError as e:
                    reporter.error(f"Failed to rename {old_path}: {e}")


def _rename_folder(old_path: str, new_path: str,
                   reporter: DryRunReporter, apply: bool) -> bool:
    """Rename a turtle folder. Returns True if the rename succeeded (or was no-op)."""
    if old_path == new_path:
        return True
    if os.path.exists(new_path):
        reporter.error(f"Target folder already exists, skipping: {new_path}")
        return False
    reporter.plan('rename-folder', old_path=old_path, new_path=new_path)
    if apply:
        try:
            os.rename(old_path, new_path)
        except OSError as e:
            reporter.error(f"Failed to rename folder {old_path}: {e}")
            return False
    return True


def _process_row(row: SheetRow, data_root: str,
                 reporter: DryRunReporter, apply: bool):
    """Handle one sheet row across all three jobs."""
    if not row.primary_id:
        # Turtle without a primary_id yet — can't do anything for it.
        return
    if not row.bio_id:
        reporter.warn(
            f"[{row.spreadsheet_label}/{row.tab} row {row.row_index}] primary_id "
            f"{row.primary_id} has no bio_id in sheet"
        )
        return

    mapped = resolve_backend_path(row.general_location)
    if mapped is None:
        # Blank or unrecognized general_location (likely unknown/dead turtle).
        reporter.warn(
            f"[{row.spreadsheet_label}/{row.tab} row {row.row_index}] "
            f"{row.bio_id}/{row.primary_id} has blank or unmapped "
            f"General Location ({row.general_location!r}) — skipping"
        )
        return
    state, location = mapped
    expected_name = f"{row.bio_id}_{row.primary_id}"

    # Search for the folder: prefer primary-id match (handles already-renamed
    # and bio-id-changed turtles), then fall back to bio-id match.
    folder = find_turtle_folder(data_root, state, location,
                                bio_id=row.bio_id, primary_id=row.primary_id)

    if folder is None:
        # Job B: maybe it landed in the state root as a primary-only folder.
        misplaced = find_folder_by_primary_in_state_root(data_root, state, row.primary_id)
        if misplaced is not None:
            # Move it to the correct location AND give it the combined name.
            loc_dir = os.path.join(data_root, state, location)
            if not os.path.isdir(loc_dir):
                reporter.plan('mkdir', detail=f"create location dir {loc_dir}")
                if apply:
                    os.makedirs(loc_dir, exist_ok=True)
            new_path = os.path.join(loc_dir, expected_name)
            old_stem = row.primary_id
            if _rename_folder(misplaced, new_path, reporter, apply):
                _rename_reference_files(new_path if apply else misplaced,
                                        old_stem, expected_name, reporter, apply)
        else:
            reporter.warn(
                f"[{row.spreadsheet_label}/{row.tab} row {row.row_index}] "
                f"no folder found for {row.bio_id}/{row.primary_id} "
                f"at {state}/{location}"
            )
        return

    current_name = os.path.basename(folder)

    if current_name == expected_name:
        # Already correct — nothing to do.
        return

    # Determine the OLD filename stem so we can rename internal files.
    parsed = parse_combined_folder_name(current_name)
    if parsed is not None:
        old_stem = f"{parsed[0]}_{parsed[1]}"
    else:
        # Bare bio-id folder, stem is just the bio_id.
        old_stem = current_name

    new_path = os.path.join(os.path.dirname(folder), expected_name)
    if _rename_folder(folder, new_path, reporter, apply):
        _rename_reference_files(new_path if apply else folder,
                                old_stem, expected_name, reporter, apply)


def _process_spreadsheet(service, label: str, data_root: str,
                         reporter: DryRunReporter, apply: bool,
                         seen_primary_ids: Optional[set] = None):
    """Iterate one spreadsheet's rows and process each."""
    if service is None:
        print(f"  (no {label} spreadsheet configured — skipping)")
        return
    print(f"\n--- Processing {label} spreadsheet ---")
    row_count = 0
    for row in iter_sheet_rows(service, label):
        row_count += 1
        if seen_primary_ids is not None and row.primary_id:
            if row.primary_id in seen_primary_ids:
                # Same primary_id appeared in a different spreadsheet — shouldn't
                # normally happen, flag it.
                reporter.warn(
                    f"primary_id {row.primary_id} seen in multiple spreadsheets "
                    f"({label}/{row.tab})"
                )
            else:
                seen_primary_ids.add(row.primary_id)
        _process_row(row, data_root, reporter, apply)
    print(f"  Read {row_count} rows from {label}.")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().split('\n')[0])
    parser.add_argument('--apply', action='store_true',
                        help='Execute the planned changes (default is dry run).')
    parser.add_argument('--data-root', default=None,
                        help='Override the backend data directory (defaults to BASE_DATA_DIR).')
    args = parser.parse_args(argv)

    data_root = args.data_root or os.path.join(os.path.dirname(os.path.abspath(__file__)), BASE_DATA_DIR)
    if not os.path.isdir(data_root):
        print(f"ERROR: data root not found: {data_root}", file=sys.stderr)
        return 2

    print(f"Data root: {data_root}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")

    reporter = DryRunReporter(apply=args.apply)
    seen_primary_ids: set = set()

    research = get_sheets_service()
    community = get_community_sheets_service()

    _process_spreadsheet(research, 'research', data_root, reporter, args.apply, seen_primary_ids)
    _process_spreadsheet(community, 'community', data_root, reporter, args.apply, seen_primary_ids)

    reporter.print_manifest()
    if reporter.errors:
        return 1
    if args.apply and reporter.ops:
        # Signal the wrapper that on-disk changes were made and it should
        # restart the backend so the VRAM cache reloads with new paths.
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
