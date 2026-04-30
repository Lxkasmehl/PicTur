"""
Ingest the "Rebuild Ingest" folder tree into the backend data directory.

Input layout (typically a host-mounted folder like /ingest):
    /<location>/
        F017 Plastron.jpg
        F017 Plastron 2.jpg
        F017 Carapace.jpg
        F999 Carapace.jpg
        ...

Every turtle this script touches receives the full dual-reference layout:
    plastron/
    plastron/Old References/
    plastron/Other Plastrons/
    carapace/
    carapace/Old References/
    carapace/Other Carapaces/

Unused subdirs stay empty until a manual upload fills them — keeps every
turtle's folder shape symmetric so a plastron-only or carapace-only ingest
ends up looking the same as a combined one.

For each (location, bio_id) pair:
  - Existing turtle + plastron file -> keep existing reference; migrate
    legacy ref_data/ to plastron/ if needed; new files go to
    plastron/Other Plastrons/.
  - Existing turtle + carapace file -> first file becomes the carapace
    reference (if there isn't one yet), extras go to
    carapace/Other Carapaces/.
  - No turtle on server -> create a bio-id-named folder with the full
    subdir tree; place whatever references the ingest provides.
  - Empty loose_images/ subfolders on migrated turtles are removed.

Feature extraction (.pt files) runs INLINE by default — every newly-placed
reference image gets its sibling .pt before the script exits. Use
--no-extract to skip (filesystem-only smoke tests, fast reruns when you
already have the tensors). Backend startup's refresh_database_index() only
INDEXES existing .pt files; it does not generate them. So if you skip
extraction here, those references stay invisible to matching until you
re-run with extraction or upload them via the admin UI.

Turtles not yet in the sheets end up bio-id-only named (e.g. F999/). When
someone later matches against them through the normal upload flow, the
sheet row gets created and a primary_id is assigned. Running
backfill_folder_names.py afterwards renames the folder to F999_T177...

Usage (from inside the backend container):
    python ingest_rebuild_folder.py --ingest-path /ingest                          # dry run
    python ingest_rebuild_folder.py --ingest-path /ingest --apply                  # execute + extract
    python ingest_rebuild_folder.py --ingest-path /ingest --apply --no-extract     # files only

From the host (Windows example; mount the ingest folder read-only into the
container on startup):
    docker compose run --rm \
        -v "C:/Users/gking/Desktop/Rebuild Ingest:/ingest:ro" \
        backend python ingest_rebuild_folder.py --ingest-path /ingest --apply

IMPORTANT: stop the backend before running --apply with extraction, unless
you have plenty of GPU memory — both processes load SuperPoint, doubling
VRAM use. After running, start the backend so refresh_database_index()
indexes the new .pt files into both VRAM caches:
    docker compose stop backend          # before
    docker compose run --rm ...          # ingest + extract
    docker compose start backend         # after
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from ingest_common import (
    BIO_ID_RE,
    DryRunReporter,
    IMAGE_EXTS,
    SKIP_FILES,
    find_turtle_folder,
    parse_combined_folder_name,
    resolve_backend_path,
)
from turtle_manager import BASE_DATA_DIR, DRIVE_LOCATION_TO_BACKEND_PATH

# Filename parser: "F017 Plastron.jpg", "F017 Plastron 2.JPG",
# "F017 Carapace.jpg", "F017 Carapace 3.jpg"
INGEST_FILENAME_RE = re.compile(
    r'^([A-Za-z])(\d+)\s+(Plastron|Carapace)(?:\s+(\d+))?$',
    re.IGNORECASE,
)

# Standard turtle folder layout. Every turtle the script touches gets all of
# these so plastron-only and carapace-only ingests produce the same shape as
# combined ones — future manual uploads can rely on the structure existing.
TURTLE_REFERENCE_SUBDIRS = (
    'plastron',
    'plastron/Old References',
    'plastron/Other Plastrons',
    'carapace',
    'carapace/Old References',
    'carapace/Other Carapaces',
)


def _parse_ingest_filename(filename: str) -> Optional[Dict]:
    """Parse an ingest filename into {bio_id, photo_type, suffix, ext} or None."""
    stem, ext = os.path.splitext(filename)
    if ext.lower() not in IMAGE_EXTS:
        return None
    m = INGEST_FILENAME_RE.match(stem)
    if not m:
        return None
    prefix = m.group(1).upper()
    digits = m.group(2).zfill(3)  # align with bio-id padding convention
    photo_type = m.group(3).lower()
    suffix = int(m.group(4)) if m.group(4) else 0
    return {
        'bio_id': f"{prefix}{digits}",
        'photo_type': photo_type,
        'suffix': suffix,
        'ext': ext,
    }


def _group_ingest_files(location_dir: str) -> Dict[Tuple[str, str], List[Dict]]:
    """Group files by (bio_id, photo_type). Returns { (bio_id, 'plastron'|'carapace'): [entry, ...] }."""
    groups: Dict[Tuple[str, str], List[Dict]] = defaultdict(list)
    try:
        entries = os.listdir(location_dir)
    except OSError:
        return groups
    for fname in entries:
        if fname in SKIP_FILES:
            continue
        full = os.path.join(location_dir, fname)
        if not os.path.isfile(full):
            continue
        parsed = _parse_ingest_filename(fname)
        if parsed is None:
            continue
        parsed['original_name'] = fname
        parsed['source_path'] = full
        groups[(parsed['bio_id'], parsed['photo_type'])].append(parsed)
    # Sort each group: smallest suffix first (unnumbered wins).
    for key in groups:
        groups[key].sort(key=lambda e: e['suffix'])
    return groups


def _migrate_ref_data_to_plastron(turtle_dir: str, ref_stem: str,
                                  reporter: DryRunReporter, apply: bool):
    """If ref_data/ exists with files named {ref_stem}.*, move them into plastron/.

    ref_stem is typically the folder basename (bio_id for bio-id-only turtles or
    the combined name for already-renamed turtles).

    Also removes empty loose_images/ as part of the same migration pass.
    """
    ref_data = os.path.join(turtle_dir, 'ref_data')
    plastron = os.path.join(turtle_dir, 'plastron')

    if os.path.isdir(ref_data):
        try:
            ref_files = os.listdir(ref_data)
        except OSError as e:
            reporter.error(f"Could not list {ref_data}: {e}")
            ref_files = []

        if ref_files:
            # Need plastron/ to hold them.
            if not os.path.isdir(plastron):
                reporter.plan('mkdir', detail=f"create {plastron}")
                if apply:
                    os.makedirs(plastron, exist_ok=True)
            for fname in ref_files:
                src = os.path.join(ref_data, fname)
                dst = os.path.join(plastron, fname)
                if os.path.exists(dst):
                    reporter.warn(f"Skipping migration of {src}: {dst} already exists")
                    continue
                reporter.plan('migrate-ref_data', old_path=src, new_path=dst)
                if apply:
                    try:
                        shutil.move(src, dst)
                    except OSError as e:
                        reporter.error(f"Failed to migrate {src}: {e}")

        # Remove ref_data/ once empty.
        reporter.plan('rmdir', detail=f"remove ref_data dir {ref_data}")
        if apply:
            try:
                # Remove whatever stragglers might be left (desktop.ini etc.)
                for leftover in os.listdir(ref_data):
                    if leftover in SKIP_FILES:
                        os.remove(os.path.join(ref_data, leftover))
                os.rmdir(ref_data)
            except OSError as e:
                reporter.warn(f"Could not remove {ref_data}: {e}")

    # Always sweep empty loose_images/
    loose = os.path.join(turtle_dir, 'loose_images')
    if os.path.isdir(loose):
        try:
            contents = [c for c in os.listdir(loose) if c not in SKIP_FILES]
        except OSError:
            contents = []
        if contents:
            reporter.warn(f"{loose} is non-empty; leaving in place (manual triage needed)")
        else:
            reporter.plan('rmdir', detail=f"remove empty loose_images {loose}")
            if apply:
                try:
                    for leftover in os.listdir(loose):
                        os.remove(os.path.join(loose, leftover))
                    os.rmdir(loose)
                except OSError as e:
                    reporter.warn(f"Could not remove {loose}: {e}")


def _ensure_full_subdirs(turtle_dir: str, reporter: DryRunReporter, apply: bool):
    """Create the full plastron/ + carapace/ subdir tree under turtle_dir.

    Idempotent — only logs and creates dirs that don't already exist. Run once
    per turtle so a carapace-only or plastron-only ingest still produces the
    same folder shape as a combined one.
    """
    for sub in TURTLE_REFERENCE_SUBDIRS:
        path = os.path.join(turtle_dir, sub)
        if os.path.isdir(path):
            continue
        reporter.plan('mkdir', detail=f"create {path}")
        if apply:
            os.makedirs(path, exist_ok=True)


def _ensure_reference_image(ref_dir: str, ref_stem: str, source_entry: Dict,
                            reporter: DryRunReporter, apply: bool) -> bool:
    """Copy source file to ref_dir as {ref_stem}{ext}. Skip if a reference already exists.

    Returns True if a reference is present (or was placed), False on collision/error.
    """
    # If any {ref_stem}.* image already exists, don't clobber.
    if os.path.isdir(ref_dir):
        for existing in os.listdir(ref_dir):
            stem, ext = os.path.splitext(existing)
            if stem == ref_stem and ext.lower() in IMAGE_EXTS:
                return True  # reference already present
    dest = os.path.join(ref_dir, f"{ref_stem}{source_entry['ext']}")
    if not os.path.isdir(ref_dir):
        reporter.plan('mkdir', detail=f"create {ref_dir}")
        if apply:
            os.makedirs(ref_dir, exist_ok=True)
    reporter.plan('copy-ref',
                  old_path=source_entry['source_path'],
                  new_path=dest,
                  detail=f"{source_entry['photo_type']} reference for {ref_stem}")
    if apply:
        try:
            shutil.copy2(source_entry['source_path'], dest)
        except OSError as e:
            reporter.error(f"Failed to copy reference {source_entry['source_path']}: {e}")
            return False
    return True


def _copy_extra(extras_dir: str, source_entry: Dict,
                reporter: DryRunReporter, apply: bool):
    """Copy a non-reference photo into the Other Plastrons / Other Carapaces dir."""
    if not os.path.isdir(extras_dir):
        reporter.plan('mkdir', detail=f"create {extras_dir}")
        if apply:
            os.makedirs(extras_dir, exist_ok=True)
    dest = os.path.join(extras_dir, source_entry['original_name'])
    if os.path.exists(dest):
        reporter.warn(f"Skipping extra copy, target exists: {dest}")
        return
    reporter.plan('copy-extra',
                  old_path=source_entry['source_path'],
                  new_path=dest)
    if apply:
        try:
            shutil.copy2(source_entry['source_path'], dest)
        except OSError as e:
            reporter.error(f"Failed to copy extra {source_entry['source_path']}: {e}")


def _extract_reference_pt(image_path: str, brain, reporter: DryRunReporter, apply: bool):
    """Generate the sibling .pt for a reference image.

    Skips silently when ``brain`` is None (extraction disabled) or when the .pt
    already exists. Failures are downgraded to warnings so one bad image
    doesn't abort the whole run.
    """
    pt_path = os.path.splitext(image_path)[0] + '.pt'
    if os.path.exists(pt_path):
        return
    reporter.plan('extract-pt',
                  new_path=pt_path,
                  detail=f"SuperPoint features for {os.path.basename(image_path)}")
    if not apply or brain is None:
        return
    try:
        ok = brain.process_and_save(image_path, pt_path)
    except Exception as e:
        reporter.warn(f"SuperPoint crashed for {image_path}: {e}")
        return
    if not ok:
        reporter.warn(f"SuperPoint extraction returned False for {image_path}")


def _extract_missing_for_turtle(turtle_dir: str, ref_stem: str, brain,
                                 reporter: DryRunReporter, apply: bool):
    """Ensure plastron/{ref_stem}.pt and carapace/{ref_stem}.pt exist when their
    sibling reference images do.

    Single pass at the end of _handle_turtle covers both fresh placements (the
    image was just copied in) and migrated ref_data/ images that arrived
    without a .pt. No-op when ``brain`` is None.
    """
    for sub in ('plastron', 'carapace'):
        ref_dir = os.path.join(turtle_dir, sub)
        if not os.path.isdir(ref_dir):
            continue
        try:
            entries = os.listdir(ref_dir)
        except OSError:
            continue
        for fname in entries:
            stem, ext = os.path.splitext(fname)
            if stem != ref_stem or ext.lower() not in IMAGE_EXTS:
                continue
            _extract_reference_pt(os.path.join(ref_dir, fname), brain, reporter, apply)
            break  # only one reference image per ref dir


def _handle_turtle(turtle_dir: Optional[str], state: str, location: str,
                   bio_id: str, plastrons: List[Dict], carapaces: List[Dict],
                   data_root: str, reporter: DryRunReporter, apply: bool,
                   *, brain=None):
    """Process a single (bio_id, location) group of ingest files."""
    location_dir = os.path.join(data_root, state, location)
    is_new = turtle_dir is None

    if is_new:
        turtle_dir = os.path.join(location_dir, bio_id)
        reporter.plan('create-turtle',
                      detail=f"new turtle {bio_id} at {state}/{location} "
                             f"(plastrons={len(plastrons)}, carapaces={len(carapaces)})",
                      new_path=turtle_dir)
        if apply:
            if not os.path.isdir(location_dir):
                os.makedirs(location_dir, exist_ok=True)
            os.makedirs(turtle_dir, exist_ok=True)
        ref_stem = bio_id
    else:
        # Existing turtle — ref stem matches the folder basename so file names
        # stay consistent with refresh_database_index's expectations.
        ref_stem = os.path.basename(turtle_dir)
        _migrate_ref_data_to_plastron(turtle_dir, ref_stem, reporter, apply)

    # Symmetric layout: every turtle gets both plastron/ and carapace/ trees,
    # whether or not this ingest fills both sides.
    _ensure_full_subdirs(turtle_dir, reporter, apply)

    # Plastron handling
    if plastrons:
        plastron_dir = os.path.join(turtle_dir, 'plastron')
        winner, *extras = plastrons
        if is_new:
            # New turtle: first plastron becomes the reference.
            _ensure_reference_image(plastron_dir, ref_stem, winner, reporter, apply)
            for extra in extras:
                _copy_extra(os.path.join(plastron_dir, 'Other Plastrons'),
                            extra, reporter, apply)
        else:
            # Existing turtle already has a plastron reference (or just had it
            # migrated from ref_data/). Don't touch the reference; file EVERY
            # ingest plastron into Other Plastrons for historical completeness.
            for entry in plastrons:
                _copy_extra(os.path.join(plastron_dir, 'Other Plastrons'),
                            entry, reporter, apply)

    # Carapace handling
    if carapaces:
        carapace_dir = os.path.join(turtle_dir, 'carapace')
        ref_already_exists = False
        if os.path.isdir(carapace_dir):
            for f in os.listdir(carapace_dir):
                stem, ext = os.path.splitext(f)
                if stem == ref_stem and ext.lower() in IMAGE_EXTS:
                    ref_already_exists = True
                    break

        winner, *extras = carapaces
        if ref_already_exists:
            # A carapace ref already exists — every ingest file goes to Other Carapaces.
            for entry in carapaces:
                _copy_extra(os.path.join(carapace_dir, 'Other Carapaces'),
                            entry, reporter, apply)
        else:
            _ensure_reference_image(carapace_dir, ref_stem, winner, reporter, apply)
            for extra in extras:
                _copy_extra(os.path.join(carapace_dir, 'Other Carapaces'),
                            extra, reporter, apply)

    # After all placement and migration, generate any missing reference .pt
    # files. No-op when extraction is disabled.
    _extract_missing_for_turtle(turtle_dir, ref_stem, brain, reporter, apply)


def _process_location_folder(ingest_location_dir: str, data_root: str,
                             reporter: DryRunReporter, apply: bool, *, brain=None):
    """Process one top-level location folder from the ingest tree."""
    location_name = os.path.basename(ingest_location_dir)
    mapped = resolve_backend_path(location_name)
    if mapped is None:
        reporter.warn(
            f"Ingest folder '{location_name}' not in DRIVE_LOCATION_TO_BACKEND_PATH "
            f"— skipping. Known keys: {sorted(DRIVE_LOCATION_TO_BACKEND_PATH.keys())}"
        )
        return
    state, location = mapped

    print(f"\n--- {location_name} -> {state}/{location} ---")
    groups = _group_ingest_files(ingest_location_dir)

    # Re-key by bio_id: { bio_id: {'plastron': [...], 'carapace': [...] } }
    by_bio: Dict[str, Dict[str, List[Dict]]] = defaultdict(lambda: {'plastron': [], 'carapace': []})
    for (bio_id, photo_type), entries in groups.items():
        by_bio[bio_id][photo_type].extend(entries)

    for bio_id in sorted(by_bio):
        plastrons = by_bio[bio_id]['plastron']
        carapaces = by_bio[bio_id]['carapace']
        turtle_dir = find_turtle_folder(data_root, state, location, bio_id=bio_id)
        _handle_turtle(turtle_dir, state, location, bio_id,
                       plastrons, carapaces, data_root, reporter, apply, brain=brain)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().split('\n')[0])
    parser.add_argument('--ingest-path', required=True,
                        help="Path to the Rebuild Ingest root (e.g. /ingest when mounted).")
    parser.add_argument('--apply', action='store_true',
                        help='Execute the planned changes (default is dry run).')
    parser.add_argument('--data-root', default=None,
                        help='Override the backend data directory (defaults to BASE_DATA_DIR).')
    parser.add_argument('--no-extract', action='store_true',
                        help='Skip SuperPoint .pt extraction for newly-placed references. '
                             'Default behavior extracts inline; use this for filesystem-only '
                             'smoke tests when you already have the tensors or just need '
                             'to see file moves quickly.')
    args = parser.parse_args(argv)

    data_root = args.data_root or os.path.join(os.path.dirname(os.path.abspath(__file__)), BASE_DATA_DIR)
    if not os.path.isdir(data_root):
        print(f"ERROR: data root not found: {data_root}", file=sys.stderr)
        return 2
    if not os.path.isdir(args.ingest_path):
        print(f"ERROR: ingest path not found: {args.ingest_path}", file=sys.stderr)
        return 2

    # SuperPoint is already loaded by turtle_manager's import chain — getting
    # ``brain`` here is essentially a free reference grab. We gate it behind
    # --apply + not --no-extract so we don't run process_and_save during dry
    # runs or filesystem-only ingest.
    brain = None
    if args.apply and not args.no_extract:
        try:
            from turtles.image_processing import brain as _brain
            brain = _brain
        except Exception as e:
            print(f"ERROR: could not access SuperPoint brain: {e}", file=sys.stderr)
            print("       Re-run with --no-extract for filesystem-only ingest, or fix the brain import.",
                  file=sys.stderr)
            return 2

    print(f"Ingest path: {args.ingest_path}")
    print(f"Data root:   {data_root}")
    print(f"Mode:        {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Extract .pt: {'YES (inline)' if brain is not None else 'NO (filesystem only)'}")

    reporter = DryRunReporter(apply=args.apply)

    for entry in sorted(os.listdir(args.ingest_path)):
        full = os.path.join(args.ingest_path, entry)
        if not os.path.isdir(full):
            continue
        _process_location_folder(full, data_root, reporter, args.apply, brain=brain)

    reporter.print_manifest()
    if brain is not None:
        print(
            "\nReminder: start the backend (`docker compose start backend`) so\n"
            "refresh_database_index() picks the new .pt files up into both VRAM caches.\n"
        )
    else:
        print(
            "\nReminder: extraction was skipped. Newly-placed references have no .pt yet,\n"
            "so they are invisible to matching. Re-run without --no-extract or upload them\n"
            "via the admin UI to generate features.\n"
        )
    return 0 if not reporter.errors else 1


if __name__ == '__main__':
    sys.exit(main())
