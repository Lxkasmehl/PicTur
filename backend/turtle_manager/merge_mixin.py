"""
TurtleMergeMixin — merge two turtle records into one.

Extracted from turtle_manager.py. Mixed into TurtleManager so all
methods are available as ``self.method()`` with the full manager context
(base_dir, _approval_lock, brain, Sheets service, etc.).
"""
import json
import os
import shutil
import time

from .path_utils import _find_image_in_dir, _IMAGE_EXTENSIONS

try:
    from turtles.image_processing import brain
except ImportError:
    from image_processing import brain  # type: ignore

from additional_image_labels import migrate_labels_to_archive


class TurtleMergeMixin:
    """Mixin that adds merge_turtles() and its helpers to TurtleManager."""

    def _merge_reference_photo(self, primary_dir, secondary_dir, primary_stem, secondary_stem,
                               photo_type, source):
        """Move one photo type's reference from secondary into primary during a merge.

        source='primary'   — copy secondary's active reference to primary's Old References.
        source='secondary' — run SuperPoint on secondary's reference, promote it as the new
                             primary reference; old primary reference goes to Old References.
        """
        if photo_type == 'carapace':
            pri_ref_dir = os.path.join(primary_dir, 'carapace')
            pri_archive_dir = os.path.join(primary_dir, 'carapace', 'Old References')
            archive_prefix = 'Archived_Carapace'
            sec_ref_dir = os.path.join(secondary_dir, 'carapace')
        else:
            pri_plastron = os.path.join(primary_dir, 'plastron')
            pri_ref_data = os.path.join(primary_dir, 'ref_data')
            pri_ref_dir = (
                pri_plastron if os.path.isdir(pri_plastron)
                else (pri_ref_data if os.path.isdir(pri_ref_data) else pri_plastron)
            )
            pri_archive_dir = os.path.join(primary_dir, 'plastron', 'Old References')
            archive_prefix = 'Archived_Master'
            sec_plastron = os.path.join(secondary_dir, 'plastron')
            sec_ref_data = os.path.join(secondary_dir, 'ref_data')
            sec_ref_dir = (
                sec_plastron if os.path.isdir(sec_plastron)
                else (sec_ref_data if os.path.isdir(sec_ref_data) else sec_plastron)
            )

        sec_ref_img = (
            _find_image_in_dir(sec_ref_dir, secondary_stem) if os.path.isdir(sec_ref_dir) else None
        )
        if not sec_ref_img:
            return

        os.makedirs(pri_ref_dir, exist_ok=True)
        os.makedirs(pri_archive_dir, exist_ok=True)

        archive_date = time.strftime('%Y-%m-%d', time.localtime())
        op_ts = int(time.time() * 1000)

        if source == 'secondary':
            pri_ref_img = _find_image_in_dir(pri_ref_dir, primary_stem)
            pri_ref_pt = os.path.join(pri_ref_dir, f"{primary_stem}.pt")
            new_ext = os.path.splitext(sec_ref_img)[1] or '.jpg'
            staged_img = os.path.join(pri_ref_dir, f"{primary_stem}_staged_{op_ts}{new_ext}")
            staged_pt = os.path.join(pri_ref_dir, f"{primary_stem}_staged_{op_ts}.pt")
            shutil.copy2(sec_ref_img, staged_img)
            try:
                staged_ok = brain.process_and_save(staged_img, staged_pt)
            except Exception as e:
                print(f"   ⚠️ SuperPoint failed during merge reference swap ({photo_type}): {e}")
                staged_ok = False
            if not staged_ok:
                for p in [staged_img, staged_pt]:
                    try:
                        if os.path.exists(p):
                            os.remove(p)
                    except OSError:
                        pass
                print(f"   ⚠️ Feature extraction failed; keeping primary {photo_type} reference unchanged")
                source = 'primary'
            else:
                if pri_ref_img:
                    archive_name = (
                        f"{archive_prefix}_{op_ts}_{archive_date}"
                        f"{os.path.splitext(pri_ref_img)[1]}"
                    )
                    shutil.copy2(pri_ref_img, os.path.join(pri_archive_dir, archive_name))
                    migrate_labels_to_archive(
                        pri_ref_dir, os.path.basename(pri_ref_img),
                        pri_archive_dir, archive_name,
                    )
                new_master = os.path.join(pri_ref_dir, f"{primary_stem}{new_ext}")
                new_pt = os.path.join(pri_ref_dir, f"{primary_stem}.pt")
                if os.path.exists(new_master) and new_master != staged_img:
                    try:
                        os.remove(new_master)
                    except OSError:
                        pass
                shutil.move(staged_img, new_master)
                shutil.move(staged_pt, new_pt)
                try:
                    os.utime(new_master, None)
                except OSError:
                    pass
                if pri_ref_img and os.path.exists(pri_ref_img):
                    try:
                        same = os.path.samefile(pri_ref_img, new_master)
                    except OSError:
                        same = False
                    if not same:
                        try:
                            os.remove(pri_ref_img)
                        except OSError:
                            pass
                self._evict_from_vram(pri_ref_pt, photo_type)
                rel = os.path.relpath(pri_ref_dir, self.base_dir)
                location_name = "/".join(rel.split(os.sep)[:-2])
                brain.add_single_to_vram(new_pt, primary_stem, location_name, photo_type=photo_type)
                return

        # source == 'primary': archive secondary's reference into primary's Old References
        archive_name = (
            f"Merged_from_{secondary_stem}_{op_ts}_{archive_date}"
            f"{os.path.splitext(sec_ref_img)[1]}"
        )
        try:
            shutil.copy2(sec_ref_img, os.path.join(pri_archive_dir, archive_name))
        except OSError as e:
            print(f"   ⚠️ Could not archive secondary {photo_type} reference: {e}")

    def _copy_dir_images(self, src_dir, dest_dir):
        """Copy all image files from src_dir into dest_dir (skipping existing filenames)."""
        if not os.path.isdir(src_dir):
            return
        image_exts = tuple(_IMAGE_EXTENSIONS)
        os.makedirs(dest_dir, exist_ok=True)
        for fname in os.listdir(src_dir):
            if not fname.lower().endswith(image_exts):
                continue
            src = os.path.join(src_dir, fname)
            if not os.path.isfile(src):
                continue
            dest = os.path.join(dest_dir, fname)
            if not os.path.exists(dest):
                try:
                    shutil.copy2(src, dest)
                except OSError as e:
                    print(f"   ⚠️ Could not copy {fname}: {e}")

    def _merge_additional_images(self, primary_dir, secondary_dir, keep_paths):
        """Merge whitelisted additional_images from secondary into primary.

        keep_paths: set of realpath-resolved paths the admin chose to keep.
                    None → keep all; empty set → keep none.
        """
        sec_additional = os.path.join(secondary_dir, 'additional_images')
        pri_additional = os.path.join(primary_dir, 'additional_images')
        if not os.path.isdir(sec_additional):
            return
        for date_folder in os.listdir(sec_additional):
            sec_date_dir = os.path.join(sec_additional, date_folder)
            if not os.path.isdir(sec_date_dir):
                continue
            pri_date_dir = os.path.join(pri_additional, date_folder)
            src_manifest_path = os.path.join(sec_date_dir, 'manifest.json')
            dest_manifest_path = os.path.join(pri_date_dir, 'manifest.json')

            try:
                with open(src_manifest_path, 'r') as f:
                    src_manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                src_manifest = []

            entries_to_copy = []
            manifest_filenames = set()
            for entry in src_manifest:
                fn = entry.get('filename')
                if not fn:
                    continue
                src_img = os.path.join(sec_date_dir, fn)
                if not os.path.isfile(src_img):
                    continue
                manifest_filenames.add(fn)
                if keep_paths is not None:
                    try:
                        real_img = os.path.realpath(src_img)
                    except OSError:
                        continue
                    if real_img not in keep_paths:
                        continue
                entries_to_copy.append((fn, entry))

            # Also include admin-selected files that exist on disk but are absent
            # from manifest.json (folder_images exposes these as fallback entries).
            if keep_paths is not None:
                for disk_fn in os.listdir(sec_date_dir):
                    if disk_fn in manifest_filenames or disk_fn == 'manifest.json':
                        continue
                    src_img = os.path.join(sec_date_dir, disk_fn)
                    if not os.path.isfile(src_img):
                        continue
                    try:
                        real_img = os.path.realpath(src_img)
                    except OSError:
                        continue
                    if real_img not in keep_paths:
                        continue
                    entries_to_copy.append((disk_fn, {'filename': disk_fn}))

            if not entries_to_copy:
                continue

            os.makedirs(pri_date_dir, exist_ok=True)
            existing_manifest = []
            if os.path.isfile(dest_manifest_path):
                try:
                    with open(dest_manifest_path, 'r') as f:
                        existing_manifest = json.load(f)
                except (json.JSONDecodeError, OSError):
                    pass
            existing_filenames = {e.get('filename') for e in existing_manifest if e.get('filename')}

            for fn, entry in entries_to_copy:
                dest_img = os.path.join(pri_date_dir, fn)
                if not os.path.exists(dest_img):
                    try:
                        shutil.copy2(os.path.join(sec_date_dir, fn), dest_img)
                    except OSError as e:
                        print(f"   ⚠️ Could not copy additional image {fn}: {e}")
                        continue
                if fn not in existing_filenames:
                    existing_manifest.append(entry)
                    existing_filenames.add(fn)

            try:
                with open(dest_manifest_path, 'w') as f:
                    json.dump(existing_manifest, f, indent=4)
            except OSError as e:
                print(f"   ⚠️ Could not write manifest to {pri_date_dir}: {e}")

    def _merge_find_metadata(self, primary_dir, secondary_dir):
        """Merge find_metadata.json from secondary into primary (primary values win)."""
        sec_path = os.path.join(secondary_dir, 'find_metadata.json')
        pri_path = os.path.join(primary_dir, 'find_metadata.json')
        if not os.path.isfile(sec_path):
            return
        try:
            with open(sec_path, 'r') as f:
                sec_meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            return
        pri_meta = {}
        if os.path.isfile(pri_path):
            try:
                with open(pri_path, 'r') as f:
                    pri_meta = json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
        merged = dict(sec_meta)
        for k, v in pri_meta.items():
            if isinstance(v, bool):
                merged[k] = v or sec_meta.get(k, False)
            elif v:
                merged[k] = v
        try:
            with open(pri_path, 'w') as f:
                json.dump(merged, f)
        except OSError as e:
            print(f"   ⚠️ Could not write merged find_metadata.json: {e}")

    def merge_turtles(self, primary_id, secondary_id, primary_sheet=None, secondary_sheet=None,
                      plastron_source='primary', carapace_source='primary',
                      keep_secondary_additional=None):
        """Merge the secondary turtle record into the primary turtle.

        Moves relevant images from the secondary folder into the primary, merges
        Google Sheets data (primary fields win; notes/dates appended), deletes the
        secondary Sheets row, and removes the secondary folder.

        Args:
            primary_id: Primary ID of the turtle to keep.
            secondary_id: Primary ID of the turtle to merge in and delete.
            primary_sheet: Sheet name for primary (folder resolution hint).
            secondary_sheet: Sheet name for secondary (folder resolution hint).
            plastron_source: 'primary' or 'secondary' — which plastron becomes the reference.
            carapace_source: Same for carapace.
            keep_secondary_additional: List of absolute paths from secondary's additional_images
                                       to migrate.  Empty list → migrate none.

        Returns:
            (success: bool, message: str)
        """
        if not primary_id or not secondary_id:
            return False, "primary_id and secondary_id are required"
        if primary_id == secondary_id:
            return False, "Cannot merge a turtle with itself"
        if keep_secondary_additional is None:
            keep_secondary_additional = []

        with self._approval_lock:
            # 1. Resolve folders
            primary_dir = self._get_turtle_folder(primary_id, primary_sheet)
            secondary_dir = self._get_turtle_folder(secondary_id, secondary_sheet)
            if not primary_dir or not os.path.isdir(primary_dir):
                return False, f"Could not find folder for primary turtle {primary_id}"
            if not secondary_dir or not os.path.isdir(secondary_dir):
                return False, f"Could not find folder for secondary turtle {secondary_id}"
            primary_stem = os.path.basename(primary_dir)
            secondary_stem = os.path.basename(secondary_dir)
            print(f"🔀 Merging {secondary_stem} → {primary_stem}")

            # 2. Fetch Sheets records
            sheets_svc = None
            primary_data = {}
            secondary_data = {}
            resolved_primary_sheet = primary_sheet
            resolved_secondary_sheet = secondary_sheet
            try:
                from services.manager_service import get_sheets_service
                sheets_svc = get_sheets_service()
            except Exception as e:
                print(f"   ⚠️ Could not get Sheets service: {e}")
            if sheets_svc:
                try:
                    if not resolved_primary_sheet:
                        resolved_primary_sheet = sheets_svc.find_turtle_sheet(primary_id)
                    if not resolved_secondary_sheet:
                        resolved_secondary_sheet = sheets_svc.find_turtle_sheet(secondary_id)
                    if resolved_primary_sheet:
                        primary_data = sheets_svc.get_turtle_data(primary_id, resolved_primary_sheet) or {}
                    if resolved_secondary_sheet:
                        secondary_data = sheets_svc.get_turtle_data(secondary_id, resolved_secondary_sheet) or {}
                        if not secondary_data:
                            return False, (
                                f"Could not read secondary turtle '{secondary_id}' from Sheets "
                                f"(row not found or transient read error). Aborting to prevent "
                                f"metadata loss — retry or check the sheet manually."
                            )
                except Exception as e:
                    print(f"   ⚠️ Could not fetch Sheets data: {e}")
                    return False, f"Aborting merge: failed to read Sheets data ({e}). No changes were made."

            # 3. Merge Sheets fields (primary wins; notes & dates_refound appended)
            meta_skip = {'sheet_name', 'row_index'}
            identity_skip = {'primary_id', 'id', 'name', 'sex', 'species'}
            merged_data = {}
            for key in set(primary_data.keys()) | set(secondary_data.keys()):
                if key in meta_skip:
                    continue
                if key in identity_skip:
                    merged_data[key] = primary_data.get(key, '')
                else:
                    merged_data[key] = primary_data.get(key) or secondary_data.get(key) or ''
            # Notes: append secondary's note
            p_notes = (primary_data.get('notes') or '').strip()
            s_notes = (secondary_data.get('notes') or '').strip()
            s_id_label = secondary_data.get('id') or secondary_id
            if p_notes and s_notes:
                merged_data['notes'] = f"{p_notes}\n[Merged from {s_id_label}]: {s_notes}"
            elif s_notes:
                merged_data['notes'] = s_notes
            else:
                merged_data['notes'] = p_notes
            # Dates refound: concatenate unique date entries
            p_dates = (primary_data.get('dates_refound') or '').strip()
            s_dates = (secondary_data.get('dates_refound') or '').strip()
            if p_dates or s_dates:
                p_parts = [d.strip() for d in p_dates.replace(';', ',').split(',') if d.strip()]
                seen = set(p_parts)
                for d in (d.strip() for d in s_dates.replace(';', ',').split(',') if d.strip()):
                    if d not in seen:
                        p_parts.append(d)
                        seen.add(d)
                merged_data['dates_refound'] = ', '.join(p_parts)

            # 4. Handle reference photos
            for photo_type, source in [('plastron', plastron_source), ('carapace', carapace_source)]:
                self._merge_reference_photo(
                    primary_dir, secondary_dir, primary_stem, secondary_stem, photo_type, source,
                )

            # 5. Migrate non-reference image folders
            for ref_sub in ('plastron', 'ref_data'):
                self._copy_dir_images(
                    os.path.join(secondary_dir, ref_sub, 'Old References'),
                    os.path.join(primary_dir, 'plastron', 'Old References'),
                )
            self._copy_dir_images(
                os.path.join(secondary_dir, 'carapace', 'Old References'),
                os.path.join(primary_dir, 'carapace', 'Old References'),
            )
            self._copy_dir_images(
                os.path.join(secondary_dir, 'plastron', 'Other Plastrons'),
                os.path.join(primary_dir, 'plastron', 'Other Plastrons'),
            )
            self._copy_dir_images(
                os.path.join(secondary_dir, 'carapace', 'Other Carapaces'),
                os.path.join(primary_dir, 'carapace', 'Other Carapaces'),
            )
            self._copy_dir_images(
                os.path.join(secondary_dir, 'loose_images'),
                os.path.join(primary_dir, 'loose_images'),
            )

            # 6. Migrate additional_images (admin-curated subset)
            keep_real = set()
            for p in keep_secondary_additional:
                try:
                    keep_real.add(os.path.realpath(p))
                except (OSError, TypeError):
                    pass
            self._merge_additional_images(primary_dir, secondary_dir, keep_real)

            # 7. Merge find_metadata.json
            self._merge_find_metadata(primary_dir, secondary_dir)

            # 8. Evict secondary's .pt files from VRAM
            try:
                secondary_real = os.path.realpath(secondary_dir)
            except OSError:
                secondary_real = secondary_dir
            for ptype in ('plastron', 'carapace'):
                brain.filter_vram_cache(
                    lambda c: not os.path.realpath(c.get('file_path', '')).startswith(
                        secondary_real + os.sep
                    ),
                    photo_type=ptype,
                )

            # 9. Update primary Sheets row — abort before any destructive steps if this fails
            if sheets_svc and merged_data and resolved_primary_sheet:
                try:
                    ok = sheets_svc.update_turtle_data(primary_id, merged_data, resolved_primary_sheet)
                    if not ok:
                        return False, (
                            f"Merge aborted: failed to update primary Sheets row for '{primary_id}'. "
                            f"No data has been deleted. Retry or check the sheet manually."
                        )
                except Exception as e:
                    return False, (
                        f"Merge aborted: could not update primary Sheets row ({e}). "
                        f"No data has been deleted."
                    )

            # 10. Delete secondary Sheets row — abort before folder removal if delete fails
            if sheets_svc and resolved_secondary_sheet:
                sheets_delete_ok = False
                try:
                    sheets_delete_ok = sheets_svc.delete_turtle_data(secondary_id, resolved_secondary_sheet)
                    if sheets_delete_ok:
                        print(f"   🗑️ Deleted secondary Sheets row for {secondary_id}")
                    else:
                        print(f"   ⚠️ Could not delete secondary Sheets row for {secondary_id} — aborting folder removal to prevent orphaned row")
                        return False, (
                            f"Merge partially applied: images migrated but secondary Sheets row for "
                            f"'{secondary_id}' could not be deleted (row not found by Primary ID). "
                            f"Delete it manually then remove the secondary folder."
                        )
                except Exception as e:
                    print(f"   ⚠️ Could not delete secondary Sheets row: {e}")
                    return False, f"Merge partially applied: Sheets deletion failed ({e}). Secondary folder was NOT removed."

            # 11. Remove secondary folder
            try:
                shutil.rmtree(secondary_dir)
                print(f"   🗑️ Removed secondary folder: {secondary_dir}")
            except OSError as e:
                print(f"   ⚠️ Could not remove secondary folder: {e}")

            # 12. Refresh database index
            self.refresh_database_index()

            p_bio = primary_data.get('id') or primary_id
            s_bio = secondary_data.get('id') or secondary_id
            print(f"✅ Merge complete: {s_bio} → {p_bio}")
            return True, f"Successfully merged {s_bio} into {p_bio}"
