"""
merge_turtle.py — merge SOURCE turtle folder into TARGET turtle folder.

Usage (inside the container, from /app):
    python merge_turtle.py <source_id> <target_id> [--execute]

Default is dry-run. Pass --execute to actually move/archive files.

What it does:
  - Moves plastron/carapace reference images to target's Other Plastrons/
  - Moves Old References/ and Other Plastrons/ contents to target's Other Plastrons/
  - Merges additional_images/ date-folders into target
  - Merges find_metadata.json (target wins on conflicts)
  - Deletes source .pt tensors (stale after merge)
  - Archives the source folder (moved under data/_Archive/, recoverable — never deleted)

After running with --execute, restart the backend so the VRAM cache is rebuilt:
    docker restart turtleproject-backend-1
"""

import argparse
import json
import os
import shutil
import sys

# Import the shared archive primitive without pulling in turtle_manager's
# package __init__ (which loads SuperPoint/torch). safe_fs is pure; putting the
# turtle_manager/ dir on sys.path lets us import it standalone.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'turtle_manager'))
from safe_fs import archive_turtle_folder


IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'}
PHOTO_TYPES = ('plastron', 'carapace')
REF_SUBDIRS = ('Old References', 'Other Plastrons')


def find_turtle_folder(base_dir: str, turtle_id: str) -> str | None:
    """Walk base_dir to find a folder whose name matches turtle_id exactly,
    or whose name starts with '<turtle_id>_T' (combined bio+primary form)."""
    for state in os.scandir(base_dir):
        if not state.is_dir():
            continue
        for location in os.scandir(state.path):
            if not location.is_dir():
                continue
            for entry in os.scandir(location.path):
                if not entry.is_dir():
                    continue
                name = entry.name
                if name == turtle_id or name.startswith(f'{turtle_id}_T'):
                    return entry.path
    return None


def unique_dest(dest_dir: str, filename: str) -> str:
    """Return a path in dest_dir that doesn't collide with existing files."""
    dest = os.path.join(dest_dir, filename)
    if not os.path.exists(dest):
        return dest
    stem, ext = os.path.splitext(filename)
    counter = 1
    while True:
        candidate = os.path.join(dest_dir, f'{stem}__{counter}{ext}')
        if not os.path.exists(candidate):
            return candidate
        counter += 1


def move_file(src: str, dest: str, dry_run: bool) -> None:
    print(f'  MOVE  {src}')
    print(f'     →  {dest}')
    if not dry_run:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.move(src, dest)


def delete_file(path: str, dry_run: bool) -> None:
    print(f'  DEL   {path}')
    if not dry_run:
        os.remove(path)


def archive_tree(path: str, dry_run: bool, base_dir: str) -> None:
    print(f'  ARCHIVE {path}')
    if not dry_run:
        dest = archive_turtle_folder(path, base_dir)
        print(f'       ->  {dest}')


# ---------------------------------------------------------------------------

def merge_ref_dir(src_ref_dir: str, target_other_plastrons: str, dry_run: bool) -> None:
    """Move all image files from src_ref_dir to target_other_plastrons/."""
    if not os.path.isdir(src_ref_dir):
        return
    for entry in os.scandir(src_ref_dir):
        if not entry.is_file():
            continue
        _, ext = os.path.splitext(entry.name)
        if ext.lower() not in IMAGE_EXTS:
            continue
        dest = unique_dest(target_other_plastrons, entry.name)
        move_file(entry.path, dest, dry_run)


def merge_photo_type(src_turtle_dir: str, target_turtle_dir: str,
                     photo_type: str, dry_run: bool) -> None:
    src_dir = os.path.join(src_turtle_dir, photo_type)
    target_other = os.path.join(target_turtle_dir, photo_type, 'Other Plastrons')

    if not os.path.isdir(src_dir):
        print(f'  (no {photo_type}/ in source, skipping)')
        return

    if not dry_run:
        os.makedirs(target_other, exist_ok=True)

    # Active reference image (top-level .jpg/.jpeg/etc in plastron/ or carapace/)
    for entry in os.scandir(src_dir):
        if not entry.is_file():
            continue
        _, ext = os.path.splitext(entry.name)
        if ext.lower() == '.pt':
            delete_file(entry.path, dry_run)
        elif ext.lower() in IMAGE_EXTS:
            dest = unique_dest(target_other, entry.name)
            move_file(entry.path, dest, dry_run)

    # Old References/ and Other Plastrons/ subfolders
    for subdir_name in REF_SUBDIRS:
        merge_ref_dir(
            os.path.join(src_dir, subdir_name),
            target_other,
            dry_run,
        )


def merge_additional_images(src_turtle_dir: str, target_turtle_dir: str,
                            dry_run: bool) -> None:
    src_ai = os.path.join(src_turtle_dir, 'additional_images')
    if not os.path.isdir(src_ai):
        print('  (no additional_images/ in source, skipping)')
        return

    target_ai = os.path.join(target_turtle_dir, 'additional_images')

    for date_entry in os.scandir(src_ai):
        if not date_entry.is_dir():
            continue
        target_date_dir = os.path.join(target_ai, date_entry.name)
        if not dry_run:
            os.makedirs(target_date_dir, exist_ok=True)
        for img_entry in os.scandir(date_entry.path):
            if not img_entry.is_file():
                continue
            dest = unique_dest(target_date_dir, img_entry.name)
            move_file(img_entry.path, dest, dry_run)


def merge_find_metadata(src_turtle_dir: str, target_turtle_dir: str,
                        dry_run: bool) -> None:
    src_meta = os.path.join(src_turtle_dir, 'find_metadata.json')
    if not os.path.isfile(src_meta):
        print('  (no find_metadata.json in source, skipping)')
        return

    try:
        with open(src_meta) as f:
            src_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f'  WARNING: could not read source find_metadata.json: {e}')
        return

    target_meta = os.path.join(target_turtle_dir, 'find_metadata.json')

    if os.path.isfile(target_meta):
        try:
            with open(target_meta) as f:
                target_data = json.load(f)
        except (json.JSONDecodeError, OSError):
            target_data = {}
        # Source fills in keys that target is missing; target wins on conflicts
        merged = {**src_data, **target_data}
        print(f'  MERGE find_metadata.json (target wins on conflicts)')
        print(f'        source had: {list(src_data.keys())}')
        print(f'        target had: {list(target_data.keys())}')
        print(f'        merged:     {list(merged.keys())}')
    else:
        merged = src_data
        print(f'  COPY  find_metadata.json (target had none)')

    if not dry_run:
        with open(target_meta, 'w') as f:
            json.dump(merged, f, indent=2)


# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source_id', help='Biology ID of the turtle to absorb, e.g. U521')
    parser.add_argument('target_id', help='Biology ID of the turtle to merge into, e.g. M521')
    parser.add_argument('--execute', action='store_true',
                        help='Actually migrate images and archive the source folder (default is dry-run)')
    args = parser.parse_args()

    dry_run = not args.execute
    base_dir = os.path.join(os.path.dirname(__file__), 'data')

    if not os.path.isdir(base_dir):
        sys.exit(f'ERROR: data/ directory not found at {base_dir}')

    print(f'\n{"DRY RUN — " if dry_run else ""}Merging {args.source_id} → {args.target_id}')
    print('=' * 60)

    src_dir = find_turtle_folder(base_dir, args.source_id)
    if not src_dir:
        sys.exit(f'ERROR: source turtle "{args.source_id}" not found under {base_dir}')

    target_dir = find_turtle_folder(base_dir, args.target_id)
    if not target_dir:
        sys.exit(f'ERROR: target turtle "{args.target_id}" not found under {base_dir}')

    print(f'Source : {src_dir}')
    print(f'Target : {target_dir}')
    print()

    for photo_type in PHOTO_TYPES:
        print(f'--- {photo_type} ---')
        merge_photo_type(src_dir, target_dir, photo_type, dry_run)
        print()

    print('--- additional_images ---')
    merge_additional_images(src_dir, target_dir, dry_run)
    print()

    print('--- find_metadata.json ---')
    merge_find_metadata(src_dir, target_dir, dry_run)
    print()

    print(f'--- archive source folder ---')
    archive_tree(src_dir, dry_run, base_dir)
    print()

    if dry_run:
        print('DRY RUN complete — no files were changed.')
        print(f'Re-run with --execute to apply:')
        print(f'  python merge_turtle.py {args.source_id} {args.target_id} --execute')
    else:
        print('Merge complete.')
        print()
        print('IMPORTANT: restart the backend to rebuild the VRAM cache:')
        print('  docker restart turtleproject-backend-1')


if __name__ == '__main__':
    main()
