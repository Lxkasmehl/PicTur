"""
Soft-delete, restore, and list deleted images.
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


class TurtleDeletionMixin:
    """Soft-delete, restore, and list deleted images.

    Mixin for TurtleManager.
    """
    def _path_is_inside(self, child, parent):
        """True if `child` resolves to a path under `parent`."""
        try:
            child_abs = os.path.realpath(child)
            parent_abs = os.path.realpath(parent)
            return os.path.commonpath([child_abs, parent_abs]) == parent_abs
        except (ValueError, OSError):
            return False

    def _classify_active_ref(self, turtle_dir, abs_src):
        """Return 'plastron' / 'carapace' if abs_src is the active ref file, else None."""
        basename = os.path.basename(abs_src)
        stem, ext = os.path.splitext(basename)
        if ext.lower() not in ('.jpg', '.jpeg', '.png'):
            return None
        turtle_id = os.path.basename(turtle_dir)
        if stem != turtle_id:
            return None
        parent = os.path.dirname(abs_src)
        parent_name = os.path.basename(parent)
        if parent_name == 'plastron' and os.path.dirname(parent) == turtle_dir:
            return 'plastron'
        if parent_name == 'carapace' and os.path.dirname(parent) == turtle_dir:
            return 'carapace'
        # Legacy ref_data also counts as active plastron slot.
        if parent_name == 'ref_data' and os.path.dirname(parent) == turtle_dir:
            return 'plastron'
        return None

    def _find_most_recent_old_reference(self, ref_subdir):
        """Return the absolute path of the most recent image in `{...}/Old References/`, or None."""
        old_refs_dir = os.path.join(ref_subdir, 'Old References')
        if not os.path.isdir(old_refs_dir):
            return None
        candidates = []
        for fname in os.listdir(old_refs_dir):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            full = os.path.join(old_refs_dir, fname)
            # Prefer embedded ms timestamp (Archived_Master_{ms} / Archived_Carapace_{ms}),
            # fall back to mtime.
            score = None
            m = re.search(r'_(\d{10,})', fname)
            if m:
                try:
                    score = int(m.group(1))
                except ValueError:
                    pass
            if score is None:
                try:
                    score = int(os.path.getmtime(full) * 1000)
                except OSError:
                    continue
            candidates.append((score, full))
        if not candidates:
            return None
        candidates.sort(reverse=True)
        return candidates[0][1]

    def _evict_from_vram(self, pt_path, photo_type):
        cache_attr = 'vram_cache_carapace' if photo_type == 'carapace' else 'vram_cache_plastron'
        cache = getattr(brain, cache_attr, [])
        setattr(brain, cache_attr, [c for c in cache if c.get('file_path') != pt_path])

    def _location_name_for_ref_dir(self, ref_dir):
        rel_path = os.path.relpath(ref_dir, self.base_dir)
        loc_parts = rel_path.split(os.sep)[:-2]
        return "/".join(loc_parts)

    def soft_delete_turtle_image(self, turtle_id, src_path, sheet_name=None):
        """Move an image into `{turtle_dir}/Deleted/{original_rel_path}`.

        Hard-deletes the companion .pt (if any) since the design keeps Deleted/
        images-only. If the source was the active plastron or carapace
        reference, automatically reverts to the most recent Old Reference:
        moves that image into the active slot, regenerates its .pt, and
        updates the VRAM cache.

        Returns (success: bool, info: dict). Info contains:
            - 'moved_to': absolute path of the Deleted/ destination
            - 'was_reference': 'plastron' | 'carapace' | None
            - 'reverted': bool — whether an Old Reference was promoted
            - 'new_reference_path': absolute path of the newly-active ref, or None
            - 'error': error message when success is False
        """
        with self._approval_lock:
            turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
            if not turtle_dir:
                return False, {'error': f"Could not find folder for {turtle_id}"}
            abs_src = os.path.realpath(src_path)
            if not os.path.isfile(abs_src):
                return False, {'error': f"Image not found: {src_path}"}
            if not self._path_is_inside(abs_src, turtle_dir):
                return False, {'error': "Refusing to delete: path is outside the turtle folder"}
            # Never let Deleted/ be used as a source to Deleted/ (double-delete).
            rel = os.path.relpath(abs_src, turtle_dir)
            if rel.split(os.sep)[0] == 'Deleted':
                return False, {'error': "File is already in the Deleted folder"}

            was_reference = self._classify_active_ref(turtle_dir, abs_src)

            # Compute destination under Deleted/ preserving the original relative path.
            dest = os.path.join(turtle_dir, 'Deleted', rel)
            if os.path.exists(dest):
                # Collision in Deleted/ — suffix with a ms stamp to preserve history.
                stem, ext = os.path.splitext(dest)
                dest = f"{stem}_{int(time.time() * 1000)}{ext}"
            os.makedirs(os.path.dirname(dest), exist_ok=True)

            # Hard-delete the companion .pt (same basename stem, .pt extension)
            # before moving so we never leave a stale .pt pointing at a missing image.
            companion_pt = os.path.splitext(abs_src)[0] + '.pt'
            if os.path.isfile(companion_pt):
                try:
                    os.remove(companion_pt)
                except OSError as e:
                    print(f"   ⚠️ Could not remove companion .pt {companion_pt}: {e}")

            try:
                shutil.move(abs_src, dest)
            except OSError as e:
                return False, {'error': f"Failed to move image to Deleted/: {e}"}
            # Migrate the file's tags so they follow it into Deleted/ instead
            # of orphaning in the source manifest (where a future file at the
            # same path would silently inherit them).
            migrate_labels_to_archive(
                os.path.dirname(abs_src), os.path.basename(abs_src),
                os.path.dirname(dest), os.path.basename(dest),
            )
            print(f"🗑️ Soft-deleted {rel} for {turtle_id} → Deleted/")

            info = {
                'moved_to': dest,
                'was_reference': was_reference,
                'reverted': False,
                'new_reference_path': None,
            }

            if was_reference:
                # Evict the deleted ref from VRAM using the path its .pt had.
                old_pt_path = os.path.splitext(abs_src)[0] + '.pt'
                self._evict_from_vram(old_pt_path, was_reference)

                # ref_stem must match the FOLDER basename so the promoted file
                # keeps the canonical naming convention (refresh_database_index
                # derives turtle_id from path_parts[-2]). A bare turtle_id
                # passed in via the URL would mismatch a combined-name folder.
                ref_stem = os.path.basename(turtle_dir)
                ref_dir = os.path.dirname(abs_src)
                prev = self._find_most_recent_old_reference(ref_dir)
                if prev:
                    prev_ext = os.path.splitext(prev)[1] or '.jpg'
                    new_master_path = os.path.join(ref_dir, f"{ref_stem}{prev_ext}")
                    new_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")
                    try:
                        shutil.move(prev, new_master_path)
                    except OSError as e:
                        return True, {**info, 'error_promoting': f"Moved deleted ref but failed to promote previous: {e}"}
                    try:
                        ok = brain.process_and_save(new_master_path, new_pt_path)
                    except Exception as e:
                        print(f"   ⚠️ SuperPoint crashed during auto-revert for {turtle_id}: {e}")
                        ok = False
                    if ok:
                        loc_name = self._location_name_for_ref_dir(ref_dir)
                        brain.add_single_to_vram(new_pt_path, ref_stem, loc_name, photo_type=was_reference)
                        info['reverted'] = True
                        info['new_reference_path'] = new_master_path
                        print(f"   ✅ Auto-reverted {turtle_id} {was_reference} to most recent Old Reference.")
                    else:
                        info['error_promoting'] = "Previous reference promoted but .pt extraction failed"
                else:
                    print(f"   ⚠️ No Old References available for {turtle_id} {was_reference}; turtle now has no active ref.")

            return True, info

    def restore_turtle_image(self, turtle_id, deleted_rel_path, sheet_name=None):
        """Restore a previously soft-deleted image back to its original location.

        Fails if the destination already exists (user must soft-delete the occupant
        first). If the destination is an active-ref slot (plastron/{id}.ext or
        carapace/{id}.ext), regenerates the .pt and updates the VRAM cache.

        Returns (success: bool, info: dict). Info contains:
            - 'restored_to': absolute path the image was restored to
            - 'is_reference': 'plastron' | 'carapace' | None
            - 'error': message when success is False
            - 'collision': True when failure is due to target already existing
        """
        with self._approval_lock:
            turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
            if not turtle_dir:
                return False, {'error': f"Could not find folder for {turtle_id}"}

            # Accept either an absolute path or a relative-to-turtle-dir path.
            if os.path.isabs(deleted_rel_path):
                abs_src = os.path.realpath(deleted_rel_path)
                if not self._path_is_inside(abs_src, turtle_dir):
                    return False, {'error': "Path is outside the turtle folder"}
                rel = os.path.relpath(abs_src, turtle_dir)
            else:
                rel = deleted_rel_path
                abs_src = os.path.realpath(os.path.join(turtle_dir, rel))

            parts = rel.split(os.sep)
            if not parts or parts[0] != 'Deleted':
                return False, {'error': "Path is not inside Deleted/"}
            if not os.path.isfile(abs_src):
                return False, {'error': "Deleted image not found"}

            target_rel = os.sep.join(parts[1:])
            target_abs = os.path.join(turtle_dir, target_rel)
            if os.path.exists(target_abs):
                return False, {'error': "A file already exists at the restore location. Delete it first, then retry restore.", 'collision': True}

            os.makedirs(os.path.dirname(target_abs), exist_ok=True)
            try:
                shutil.move(abs_src, target_abs)
            except OSError as e:
                return False, {'error': f"Failed to move file: {e}"}
            # Carry the file's tags back from Deleted/ to its restored location.
            migrate_labels_to_archive(
                os.path.dirname(abs_src), os.path.basename(abs_src),
                os.path.dirname(target_abs), os.path.basename(target_abs),
            )

            is_reference = self._classify_active_ref(turtle_dir, target_abs)
            info = {'restored_to': target_abs, 'is_reference': is_reference}

            if is_reference:
                # ref_stem = folder basename, not the URL turtle_id (see
                # soft_delete_turtle_image / replace_turtle_reference for
                # the full rationale).
                ref_stem = os.path.basename(turtle_dir)
                ref_dir = os.path.dirname(target_abs)
                new_pt_path = os.path.join(ref_dir, f"{ref_stem}.pt")
                # Defensive: evict any stale VRAM entry pointing at this turtle+type.
                self._evict_from_vram(new_pt_path, is_reference)
                try:
                    ok = brain.process_and_save(target_abs, new_pt_path)
                except Exception as e:
                    print(f"   ⚠️ SuperPoint crashed during restore for {turtle_id}: {e}")
                    ok = False
                if not ok:
                    info['warning'] = "Image restored but .pt extraction failed; try again or restart backend"
                else:
                    loc_name = self._location_name_for_ref_dir(ref_dir)
                    brain.add_single_to_vram(new_pt_path, ref_stem, loc_name, photo_type=is_reference)
                    print(f"   ✅ Restored {turtle_id} {is_reference} reference and refreshed VRAM.")

            # Clean up now-empty parent dirs inside Deleted/ (purely cosmetic).
            try:
                deleted_parent = os.path.dirname(abs_src)
                while deleted_parent and deleted_parent != turtle_dir:
                    if not os.listdir(deleted_parent):
                        os.rmdir(deleted_parent)
                        deleted_parent = os.path.dirname(deleted_parent)
                    else:
                        break
            except OSError:
                pass

            return True, info

    def list_deleted_turtle_images(self, turtle_id, sheet_name=None):
        """Enumerate every image under `{turtle_dir}/Deleted/` with its original path and category."""
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir:
            return []
        deleted_root = os.path.join(turtle_dir, 'Deleted')
        if not os.path.isdir(deleted_root):
            return []

        def _category_for(original_rel):
            parts = original_rel.split(os.sep)
            if len(parts) == 2 and parts[0] in ('plastron', 'carapace', 'ref_data'):
                return 'reference'
            if len(parts) >= 3 and parts[0] == 'plastron' and parts[1] == 'Old References':
                return 'plastron_old_ref'
            if len(parts) >= 3 and parts[0] == 'plastron' and parts[1] == 'Other Plastrons':
                return 'plastron_other'
            if len(parts) >= 3 and parts[0] == 'carapace' and parts[1] == 'Old References':
                return 'carapace_old_ref'
            if len(parts) >= 3 and parts[0] == 'carapace' and parts[1] == 'Other Carapaces':
                return 'carapace_other'
            if parts[0] == 'additional_images':
                return 'additional'
            if parts[0] == 'loose_images':
                return 'loose_legacy'
            return 'unknown'

        out = []
        for root, dirs, files in os.walk(deleted_root):
            for fname in files:
                if not fname.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    continue
                abs_path = os.path.join(root, fname)
                # Path relative to turtle_dir — always starts with 'Deleted/...'
                deleted_rel = os.path.relpath(abs_path, turtle_dir)
                original_rel = os.sep.join(deleted_rel.split(os.sep)[1:])
                original_abs = os.path.join(turtle_dir, original_rel)
                category = _category_for(original_rel)

                exif = _extract_exif_date(abs_path)
                try:
                    # Re-use the route-level helper if available; keep local fallback to mtime.
                    from routes.turtles import _extract_upload_date_from_filename as _eu
                    upload = _eu(fname, fallback_path=abs_path)
                except Exception:
                    try:
                        upload = time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(abs_path)))
                    except OSError:
                        upload = None

                out.append({
                    'path': abs_path,
                    'original_path': original_abs,
                    'deleted_rel_path': deleted_rel,
                    'category': category,
                    'timestamp': exif or upload,
                    'exif_date': exif,
                    'upload_date': upload,
                })
        return out

