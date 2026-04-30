"""
Normalize filenames in the Rebuild Ingest folder.

For each location folder:
  1. Parse each image filename to extract: bio ID, photo type (plastron/carapace), number suffix
  2. Zero-pad bio IDs to 3 digits (F65 -> F065)
  3. Keep one file per (bio ID, photo type) — prefer the unnumbered "primary"
  4. Rename survivors to: {BioID} {Plastron|Carapace}.{ext}
  5. Delete duplicates

Run with --dry-run (default) to preview, --apply to execute.
"""

import os
import re
import sys
from collections import defaultdict

INGEST_ROOT = os.path.expanduser("~/Desktop/Rebuild Ingest")
SKIP_FILES = {"desktop.ini", "Thumbs.db"}
SKIP_DIRS = {"Archived Turtles"}

# Regex: capture bio ID prefix (letter(s) + digits), then everything else
# Examples:
#   "F002 Plastron.jpg"                        -> F002, rest=" Plastron"
#   "F006 Plastron 2.JPG"                      -> F006, rest=" Plastron 2"
#   "F039 4-28-2023 KW Lab carapace 3.JPG"     -> F039, rest=" 4-28-2023 KW Lab carapace 3"
#   "F65 9-28-21 KW Lab Carapace 2.jpg"        -> F65,  rest=" 9-28-21 KW Lab Carapace 2"
BIO_ID_RE = re.compile(r'^([A-Za-z]+)(\d+)\s+(.+)$')


def parse_filename(filename):
    """Parse a filename into (bio_id, photo_type, number_suffix, ext) or None."""
    name, ext = os.path.splitext(filename)
    if ext.lower() not in ('.jpg', '.jpeg', '.png'):
        return None

    m = BIO_ID_RE.match(name)
    if not m:
        return None

    prefix = m.group(1).upper()  # F, M, J
    digits = m.group(2)
    rest = m.group(3)  # everything after the bio ID and first space

    # Zero-pad to 3 digits
    padded = digits.zfill(3)
    bio_id = f"{prefix}{padded}"

    # Determine photo type from the rest of the filename (case-insensitive)
    rest_lower = rest.lower()
    if 'plastron' in rest_lower:
        photo_type = 'Plastron'
    elif 'carapace' in rest_lower:
        photo_type = 'Carapace'
    else:
        return None  # Unknown type — skip

    # Extract trailing number suffix (e.g., "2" from "Plastron 2" or "carapace 3")
    # Look for a trailing number at the very end of the name
    suffix_match = re.search(r'\s+(\d+)\s*$', rest)
    number_suffix = int(suffix_match.group(1)) if suffix_match else 0

    return bio_id, photo_type, number_suffix, ext


def process_location(location_dir, apply=False):
    """Process one location folder. Returns (kept, deleted, renamed, errors) counts."""
    kept = 0
    deleted = 0
    renamed = 0
    errors = []
    location_name = os.path.basename(location_dir)

    files = []
    try:
        files = os.listdir(location_dir)
    except OSError as e:
        errors.append(str(e))
        return kept, deleted, renamed, errors

    # Group files by (bio_id, photo_type)
    groups = defaultdict(list)
    skipped = []
    for f in files:
        if f in SKIP_FILES:
            continue
        full_path = os.path.join(location_dir, f)
        if os.path.isdir(full_path):
            continue
        parsed = parse_filename(f)
        if parsed is None:
            skipped.append(f)
            continue
        bio_id, photo_type, number_suffix, ext = parsed
        groups[(bio_id, photo_type)].append({
            'original': f,
            'path': full_path,
            'bio_id': bio_id,
            'photo_type': photo_type,
            'number_suffix': number_suffix,
            'ext': ext,
        })

    if skipped:
        print(f"  Skipped (unparseable): {skipped}")

    # For each group, pick the best file
    for (bio_id, photo_type), entries in sorted(groups.items()):
        # Sort: unnumbered first (suffix=0), then by lowest number
        entries.sort(key=lambda e: e['number_suffix'])
        winner = entries[0]
        losers = entries[1:]

        target_name = f"{bio_id} {photo_type}{winner['ext']}"
        target_path = os.path.join(location_dir, target_name)

        # Check for ext collision: winner might be .JPG but a .jpg target already exists
        # from a different group — shouldn't happen since we group by (bio_id, photo_type)

        # Report
        if losers:
            loser_names = [e['original'] for e in losers]
            print(f"  {bio_id} {photo_type}: KEEP '{winner['original']}' -> '{target_name}'  |  DELETE {loser_names}")
        elif winner['original'] != target_name:
            print(f"  {bio_id} {photo_type}: RENAME '{winner['original']}' -> '{target_name}'")
        # else: already correct name, no action needed

        if apply:
            # Delete losers first
            for loser in losers:
                try:
                    os.remove(loser['path'])
                    deleted += 1
                except OSError as e:
                    errors.append(f"Failed to delete {loser['original']}: {e}")

            # Rename winner if needed
            if winner['original'] != target_name:
                # Handle case where target already exists (shouldn't happen after deleting losers)
                if os.path.exists(target_path) and winner['path'] != target_path:
                    # Case-insensitive rename on Windows: check if it's just a case change
                    if winner['path'].lower() == target_path.lower():
                        # Two-step rename via temp file for case-only changes on Windows
                        tmp = target_path + ".tmp_rename"
                        os.rename(winner['path'], tmp)
                        os.rename(tmp, target_path)
                        renamed += 1
                    else:
                        errors.append(f"Target already exists: {target_name} (from {winner['original']})")
                else:
                    try:
                        os.rename(winner['path'], target_path)
                        renamed += 1
                    except OSError as e:
                        errors.append(f"Failed to rename {winner['original']}: {e}")
            else:
                kept += 1
        else:
            if losers:
                deleted += len(losers)
            if winner['original'] != target_name:
                renamed += 1
            else:
                kept += 1

    return kept, deleted, renamed, errors


def main():
    apply = '--apply' in sys.argv

    if not os.path.isdir(INGEST_ROOT):
        print(f"ERROR: Ingest folder not found: {INGEST_ROOT}")
        sys.exit(1)

    mode = "APPLYING CHANGES" if apply else "DRY RUN (use --apply to execute)"
    print(f"\n{'='*60}")
    print(f"  Normalize Ingest — {mode}")
    print(f"  Root: {INGEST_ROOT}")
    print(f"{'='*60}\n")

    total_kept = 0
    total_deleted = 0
    total_renamed = 0
    all_errors = []

    for entry in sorted(os.listdir(INGEST_ROOT)):
        entry_path = os.path.join(INGEST_ROOT, entry)
        if not os.path.isdir(entry_path) or entry in SKIP_DIRS or entry in SKIP_FILES:
            continue
        print(f"\n--- {entry} ---")
        k, d, r, errs = process_location(entry_path, apply=apply)
        total_kept += k
        total_deleted += d
        total_renamed += r
        all_errors.extend(errs)

    print(f"\n{'='*60}")
    print(f"  Summary: {total_kept} already correct, {total_renamed} to rename, {total_deleted} to delete")
    if all_errors:
        print(f"  ERRORS ({len(all_errors)}):")
        for e in all_errors:
            print(f"    - {e}")
    if not apply:
        print(f"\n  This was a dry run. Run with --apply to execute.")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
