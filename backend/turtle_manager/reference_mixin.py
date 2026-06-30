"""
Atomic plastron/carapace reference replacement.
"""
import json
import os
import re
import shutil
import time
import uuid

import sys
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    import sys; sys.path.insert(0, _backend_dir)

from .path_utils import (
    _extract_exif_date, _date_suffix, _find_image_next_to_pt, _find_image_in_dir,
    _ref_data_folder_score, _is_turtle_data_folder, _basename_matches_turtle_id,
    _safe_folder_name, _BIO_ID_RE, _CARAPACE_RE, _looks_like_primary_id,
    canonical_new_turtle_folder_id, _parse_bio_id, _detect_photo_type,
    _location_dir_from_sheet_name, _resolved_path_under_base,
    _MAX_TURTLE_DIR_DEPTH, _turtle_dir_depth, _clamp_turtle_dir_depth,
    _expand_flat_drive_folder_prefix, _IMAGE_EXTENSIONS,
    DRIVE_LOCATION_TO_BACKEND_PATH, DRIVE_STATE_LEVEL_FOLDERS,
    DRIVE_STATE_NAME_MAP, LOCATION_NAME_MAP,
    _resolve_drive_state_name, _resolve_drive_location_name,
)

try:
    from turtles.image_processing import brain
except ImportError:
    from image_processing import brain  # type: ignore

from additional_image_labels import (
    label_query_matches, migrate_labels_to_archive, normalize_additional_type,
    normalize_label_list, read_labels_for_file, set_labels_for_file,
)


class TurtleReferenceMixin:
    """Atomic plastron/carapace reference replacement.

    Mixin for TurtleManager.
    """
    def _purge_orphan_refs_in_ref_dir(self, ref_dir, canonical_stem):
        """Move stray reference files out of a plastron/ or carapace/ directory
        when a canonical ``{folder_basename}.{ext}`` reference is present.

        Background: an earlier bug wrote new references using the URL-passed
        ``turtle_id`` (often a bare bio_id like ``F004``) as the file stem
        instead of the folder basename (``F004_T1771234567``). Folders that
        went through the buggy flow ended up with parallel pairs — the proper
        canonical files AND a stray ``F004.jpg/.pt`` next to them. This
        function archives the strays into ``Old References/`` with an
        ``Orphan_`` prefix.

        SAFETY: only fires when a canonical ``{canonical_stem}.{ext}`` (.jpg,
        .jpeg, .png, or .pt) is already present in ``ref_dir``. If the only
        reference file in there is non-canonical — e.g. a folder that was
        renamed to its combined form by chronodrop without the files inside
        being renamed yet — we leave it alone. Otherwise this would archive
        the only reference the turtle has and brick matching for it.

        Files MOVED (not deleted) so the operation is recoverable.
        Skipped subdirs (Old References / Other Plastrons / Other Carapaces /
        manifest.json) and ``_staged_*`` interruption artifacts.
        """
        if not ref_dir or not os.path.isdir(ref_dir):
            return 0
        if not canonical_stem:
            return 0
        try:
            entries = os.listdir(ref_dir)
        except OSError:
            return 0
        # Safety gate: require a canonical reference to exist before purging
        # anything. If the only file at this level is non-canonical, treat it
        # as the legitimate active reference (likely a not-yet-renamed legacy
        # file) and leave the directory untouched.
        canonical_present = any(
            os.path.splitext(f)[0] == canonical_stem
            and os.path.splitext(f)[1].lower() in ('.jpg', '.jpeg', '.png', '.pt')
            and os.path.isfile(os.path.join(ref_dir, f))
            for f in entries
        )
        if not canonical_present:
            return 0
        archive_dir = os.path.join(ref_dir, 'Old References')
        moved = 0
        op_ts = int(time.time() * 1000)
        for fname in entries:
            full = os.path.join(ref_dir, fname)
            if os.path.isdir(full):
                continue
            if fname == 'manifest.json':
                continue
            stem, ext = os.path.splitext(fname)
            ext_lower = ext.lower()
            if ext_lower not in ('.jpg', '.jpeg', '.png', '.pt'):
                continue
            if stem == canonical_stem:
                continue
            if '_staged_' in stem:
                continue
            os.makedirs(archive_dir, exist_ok=True)
            archive_name = f"Orphan_{op_ts}_{fname}"
            try:
                shutil.move(full, os.path.join(archive_dir, archive_name))
                migrate_labels_to_archive(
                    ref_dir, fname,
                    archive_dir, archive_name,
                )
                moved += 1
                print(f"   🧹 Purged orphan ref {fname} → Old References/{archive_name}")
            except OSError as e:
                print(f"   ⚠️ Could not purge orphan {full}: {e}")
        return moved

    def replace_turtle_reference(self, turtle_id, new_image_path, photo_type="plastron", sheet_name=None, primary_id=None, create_if_missing=False, bio_id=None):
        """Atomically replace the plastron or carapace reference image for an existing turtle.

        Archives the old .pt+image to {photo_type}/Old References/, stages the new
        .pt+image, promotes atomically, and updates the VRAM cache. Guarded by
        _approval_lock so concurrent admin actions can't race.

        Args:
            turtle_id: Biology or primary key. Folder lookup is permissive — finds
                exact, prefix-with-underscore, and suffix-with-underscore matches.
            new_image_path: Path to the new reference image (must already exist on disk).
            photo_type: 'plastron' (default) or 'carapace'.
            sheet_name: Optional location hint to disambiguate multi-location turtles.
            primary_id: Optional primary key tried FIRST during folder resolution.
                Globally unique, so it sidesteps cross-state biology-ID collisions.
            create_if_missing: When True and no folder is found, create a
                canonically-named ``<bio_id>_<primary_id>`` folder (modern
                structure) instead of failing -- for sheet-only ("Null") turtles
                receiving their first reference photo.
            bio_id: Sheet biology-ID column value, used only for canonical folder
                naming when ``create_if_missing`` creates a new folder.

        Returns:
            (success: bool, message: str)
        """
        if photo_type not in ('plastron', 'carapace'):
            return False, f"Invalid photo_type: {photo_type}"
        if not new_image_path or not os.path.exists(new_image_path):
            return False, "New image file not found"

        with self._approval_lock:
            target_dir = None
            if primary_id and primary_id != turtle_id:
                target_dir = self._get_turtle_folder(primary_id, sheet_name)
            if not target_dir:
                target_dir = self._get_turtle_folder(turtle_id, sheet_name)
            created = False
            create_reason = None
            if not target_dir and create_if_missing:
                # Sheet-only ("Null") turtle getting its first reference photo:
                # create a canonically-named folder with the modern structure.
                target_dir, created, create_reason = self.resolve_or_create_canonical_turtle_dir(
                    turtle_id, sheet_name, primary_id=primary_id, bio_id=bio_id,
                )
            if not target_dir:
                if create_reason:
                    return False, f"Couldn't create a folder for {turtle_id}: {create_reason}"
                return False, f"Could not find folder for {turtle_id}"

            # Reference files must be named after the FOLDER BASENAME, not the
            # URL-passed turtle_id. Folders use the canonical
            # ``{bio_id}_{primary_id}`` form (e.g. ``F004_T1771234567``); when
            # a caller passes the bare bio_id (``F004``) we still find the
            # folder via permissive matching, but writing files as ``F004.jpg``
            # would produce a parallel pair instead of replacing the existing
            # ``F004_T1771234567.jpg/.pt``. ``refresh_database_index`` would
            # then index BOTH and ship duplicate VRAM entries for one turtle.
            ref_stem = os.path.basename(target_dir)

            if photo_type == "carapace":
                ref_dir = os.path.join(target_dir, 'carapace')
                archive_dir = os.path.join(target_dir, 'carapace', 'Old References')
                cache_attr = 'vram_cache_carapace'
                print_prefix = "✨ UPGRADING CARAPACE REFERENCE"
                archive_prefix = "Archived_Carapace"
            else:
                plastron_dir = os.path.join(target_dir, 'plastron')
                ref_data_dir = os.path.join(target_dir, 'ref_data')
                if os.path.isdir(plastron_dir):
                    ref_dir = plastron_dir
                elif os.path.isdir(ref_data_dir):
                    ref_dir = ref_data_dir
                else:
                    ref_dir = plastron_dir
                archive_dir = os.path.join(target_dir, 'plastron', 'Old References')
                cache_attr = 'vram_cache_plastron'
                print_prefix = "✨ UPGRADING REFERENCE"
                archive_prefix = "Archived_Master"
            os.makedirs(ref_dir, exist_ok=True)
            os.makedirs(archive_dir, exist_ok=True)

            print(f"{print_prefix} for {turtle_id}...")
            old_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")
            old_img_path = None
            # Enumerate the directory so old_img_path keeps the file's actual
            # on-disk case. Constructing the path with a hardcoded lowercase
            # extension and relying on Windows' case-insensitive os.path.exists
            # gave us a lowercase ".jpg" string when the real file was ".JPG",
            # which then caused migrate_labels_to_archive's case-sensitive
            # manifest lookup to miss — silently leaving the old reference's
            # tags bound to the new active file at the same path.
            try:
                for fname in os.listdir(ref_dir):
                    stem, ext = os.path.splitext(fname)
                    if stem == ref_stem and ext.lower() in ('.jpg', '.jpeg', '.png'):
                        old_img_path = os.path.join(ref_dir, fname)
                        break
            except OSError:
                pass

            op_ts = int(time.time() * 1000)
            new_ext = os.path.splitext(new_image_path)[1] or '.jpg'
            staged_master_path = os.path.join(ref_dir, f"{ref_stem}_staged_{op_ts}{new_ext}")
            staged_pt_path = os.path.join(ref_dir, f"{ref_stem}_staged_{op_ts}.pt")

            # Stage new master and .pt first; only promote if extraction succeeds.
            shutil.copy2(new_image_path, staged_master_path)
            try:
                staged_ok = brain.process_and_save(staged_master_path, staged_pt_path)
            except Exception as e:
                print(f"   ⚠️ SuperPoint crashed during reference upgrade for {turtle_id}: {e}")
                staged_ok = False
            if not staged_ok:
                for p in [staged_master_path, staged_pt_path]:
                    try:
                        if os.path.exists(p):
                            os.remove(p)
                    except OSError:
                        pass
                return False, f"Failed to extract features for replacement image of {turtle_id}"

            new_master_path = os.path.join(ref_dir, f"{ref_stem}{new_ext}")
            new_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")

            # Step 1: Archive old image to Old References (copy, not move).
            # Date suffix is today's LOCAL date — the archive operation date,
            # which is also the upload_date for this archived copy. EXIF "when
            # taken" is still extractable from the file's metadata via
            # _extract_exif_date, so display can keep both. Using EXIF here
            # broke the "uploaded today" scratchpad because old photos would
            # carry years-old date stamps in their archived filenames.
            if old_img_path:
                archive_date = time.strftime('%Y-%m-%d', time.localtime())
                archive_name = f"{archive_prefix}_{op_ts}_{archive_date}{os.path.splitext(old_img_path)[1]}"
                shutil.copy2(old_img_path, os.path.join(archive_dir, archive_name))
                # Carry the old reference's tags over to the archived copy and
                # clear them from the source manifest, so the NEW reference
                # (which lands at the same path on step 2) starts with a clean
                # label slate instead of inheriting whatever was on the old.
                migrate_labels_to_archive(
                    ref_dir, os.path.basename(old_img_path),
                    archive_dir, archive_name,
                )
                print(f"   📦 Archived old master to {archive_name}")

            # Step 2: Promote staged files atomically
            if os.path.exists(new_master_path) and new_master_path != staged_master_path:
                os.remove(new_master_path)
            shutil.move(staged_master_path, new_master_path)
            shutil.move(staged_pt_path, new_pt_path)
            # Mark the promoted master as uploaded NOW. The filename carries no
            # date stamp, so _extract_upload_date_from_filename falls back to
            # mtime — which shutil.copy2 inherits from the source. Without this
            # touch, the new reference won't appear in today's scratchpad.
            try:
                os.utime(new_master_path, None)
            except OSError:
                pass

            # Step 3: Clean up old image if it was a different extension.
            # Uses os.path.samefile so that case-only differences on Windows
            # (e.g. old_img_path ends in '.jpg' from the lookup loop while the
            # newly placed file is '.JPG' from the user's upload extension)
            # don't cause us to delete the file we just placed. Pre-fix, that
            # exact case removed the new active reference, leaving the .pt
            # without its .jpg.
            if old_img_path and os.path.exists(old_img_path):
                try:
                    same_file = (os.path.exists(new_master_path)
                                 and os.path.samefile(old_img_path, new_master_path))
                except OSError:
                    same_file = False
                if not same_file:
                    try:
                        os.remove(old_img_path)
                    except OSError:
                        pass

            # Incremental VRAM cache update: evict old entry, add new.
            # Use ref_stem (folder basename) as the cached site_id so the
            # incremental insert matches what refresh_database_index would
            # produce on a full reload (which derives turtle_id from
            # ``path_parts[-2]``, i.e. the folder basename).
            cache = getattr(brain, cache_attr, [])
            setattr(brain, cache_attr, [c for c in cache if c['file_path'] != old_pt_path])
            rel_path = os.path.relpath(ref_dir, self.base_dir)
            loc_parts = rel_path.split(os.sep)[:-2]
            location_name = "/".join(loc_parts)
            brain.add_single_to_vram(new_pt_path, ref_stem, location_name, photo_type=photo_type)
            # Defensive sweep — archive any non-canonical reference files that
            # may have been left behind by an earlier buggy code path or a
            # manual copy. Keeps the ref dir self-healing.
            self._purge_orphan_refs_in_ref_dir(ref_dir, ref_stem)
            print(f"   ✅ {turtle_id} {photo_type} reference upgraded successfully.")
            if created:
                # New folder just created for a sheet-only turtle -- full reindex
                # so db_index (not just the incremental VRAM add above) sees it.
                self.refresh_database_index()
            return True, f"{photo_type.capitalize()} reference replaced for {turtle_id}"

    def replace_plastron_reference(self, turtle_id, new_image_path, sheet_name=None, primary_id=None):
        """Convenience wrapper: replace plastron reference. See replace_turtle_reference."""
        return self.replace_turtle_reference(turtle_id, new_image_path, photo_type="plastron", sheet_name=sheet_name, primary_id=primary_id)

    def replace_carapace_reference(self, turtle_id, new_image_path, sheet_name=None, primary_id=None):
        """Convenience wrapper: replace carapace reference. See replace_turtle_reference."""
        return self.replace_turtle_reference(turtle_id, new_image_path, photo_type="carapace", sheet_name=sheet_name, primary_id=primary_id)

    # ------------------------------------------------------------------
    # Soft delete / restore / list deleted
    #
    # .pt files are NEVER moved to Deleted/ — they are hard-deleted on soft
    # delete and regenerated fresh on restore-as-reference. This keeps the
    # Deleted folder images-only and guarantees .pt consistency on revert.
    # ------------------------------------------------------------------
