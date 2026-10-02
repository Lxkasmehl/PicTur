"""
Additional images: packet/turtle upload, labels, search, remove.
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


class TurtleAdditionalImagesMixin:
    """Additional images: packet/turtle upload, labels, search, remove.

    Mixin for TurtleManager.
    """
    def add_additional_images_to_packet(self, request_id, files_with_types):
        packet_dir = self._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir): return False, "Request not found"
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(packet_dir, 'additional_images', today_str)
        os.makedirs(date_dir, exist_ok=True)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f: manifest = json.load(f)

        for item in files_with_types:
            src = item.get('path')
            typ = normalize_additional_type(item.get('type'))
            lbs = normalize_label_list(item.get('labels'))
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            exif_date = _extract_exif_date(src)
            # Filename date stamp is today's LOCAL date (when uploaded), not
            # the photo's EXIF "when taken" date. The frontend's
            # _extract_upload_date_from_filename reads this stamp as the
            # upload_date; using EXIF here meant a years-old photo uploaded
            # today fell out of the "today" scratchpad. EXIF is still kept
            # separately on the manifest entry and via _extract_exif_date for
            # display, so no information is lost.
            stamp_date = time.strftime('%Y-%m-%d', time.localtime())
            raw_name = item.get('original_filename')
            name_suffix = os.path.basename(raw_name) if raw_name else os.path.basename(src)
            safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{name_suffix}"
            safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
            dest = os.path.join(date_dir, safe_name)
            shutil.copy2(src, dest)
            entry = {
                'filename': safe_name,
                'type': typ,
                'timestamp': ts,
                'exif_date': exif_date,
                'original_source': os.path.basename(src),
            }
            if lbs:
                entry['labels'] = lbs
            manifest.append(entry)

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)
        return True, "OK"

    def remove_additional_image_from_packet(self, request_id, filename):
        packet_dir = self._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir): return False, "Request not found"
        additional_dir = os.path.join(packet_dir, 'additional_images')
        if not os.path.isdir(additional_dir): return False, "No additional images"
        if not filename or os.path.basename(filename) != filename: return False, "Invalid filename"

        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f: manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f: json.dump(new_manifest, f, indent=4)
                try:
                    os.remove(file_path)
                    return True
                except OSError:
                    return False
            return False

        if try_delete(additional_dir): return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir): return True, None
        return False, "Image not found"

    def add_observation_to_turtle(self, source_image_path, turtle_id, location_hint=None):
        """
        Moves an uploaded image to the turtle's plastron/Other Plastrons folder as an observation copy.
        """
        target_dir = None
        if location_hint and location_hint != 'Unknown':
            possible_path = os.path.join(self.base_dir, location_hint, turtle_id)
            if os.path.exists(possible_path):
                target_dir = possible_path

        if not target_dir:
            print(f"Scanning for home of {turtle_id}...")
            for root, dirs, files in os.walk(self.base_dir):
                if os.path.basename(root) == turtle_id:
                    target_dir = root
                    break

        if not target_dir:
            return False, f"Could not find folder for {turtle_id}"

        loose_dir = os.path.join(target_dir, 'plastron', 'Other Plastrons')
        os.makedirs(loose_dir, exist_ok=True)

        filename = os.path.basename(source_image_path)
        # Filename date stamp = today (local), not EXIF. See add_additional_images_to_turtle
        # for the rationale (scratchpad's upload_date filter would otherwise drop old photos).
        obs_date = time.strftime('%Y-%m-%d', time.localtime())
        save_name = f"Obs_{int(time.time())}_{obs_date}_{filename}"
        dest_path = os.path.join(loose_dir, save_name)

        try:
            shutil.copy2(source_image_path, dest_path)
            print(f"📸 Observation added to {turtle_id}: {save_name}")
            return True, dest_path
        except Exception as e:
            return False, str(e)

    def add_additional_images_to_turtle(self, turtle_id, files_with_types, sheet_name=None, primary_id=None, bio_id=None):
        # Canonically create the folder if it doesn't exist yet, so a sheet-only
        # ("Null") turtle whose first upload is a non-reference photo still gets a
        # correctly-named <bio_id>_<primary_id> dir. No reindex here -- additional
        # images produce no .pt; the index updates when a reference photo is later
        # added via replace_turtle_reference.
        turtle_dir, _created, _create_reason = self.resolve_or_create_canonical_turtle_dir(
            turtle_id, sheet_name, primary_id=primary_id, bio_id=bio_id,
        )
        if not turtle_dir or not os.path.isdir(turtle_dir):
            if _create_reason:
                return False, f"Couldn't create a folder for {turtle_id}: {_create_reason}"
            return (
                False,
                "Turtle folder not found. For multi-site states pass State/Site as sheet_name "
                "(same as General location + Location); the backend will not create turtles directly under "
                "data/<State>/ when site folders already exist.",
            )
        today_str = time.strftime('%Y-%m-%d')
        date_dir = os.path.join(turtle_dir, 'additional_images', today_str)
        manifest_path = os.path.join(date_dir, 'manifest.json')
        manifest = []
        date_dir_created = False

        # Routes for carapace/plastron images — go to proper subfolders, not additional_images/
        _other_dir = {'plastron': 'plastron/Other Plastrons', 'carapace': 'carapace/Other Carapaces'}

        for item in files_with_types:
            src = item.get('path')
            typ = normalize_additional_type(item.get('type'))
            lbs = normalize_label_list(item.get('labels'))
            ts = item.get('timestamp') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if not src or not os.path.isfile(src): continue
            exif_date = _extract_exif_date(src)
            # Filename date stamp is today's LOCAL date (when uploaded), not
            # the photo's EXIF "when taken" date. The frontend's
            # _extract_upload_date_from_filename reads this stamp as the
            # upload_date; using EXIF here meant a years-old photo uploaded
            # today fell out of the "today" scratchpad. EXIF is still kept
            # separately on the manifest entry and via _extract_exif_date for
            # display, so no information is lost.
            stamp_date = time.strftime('%Y-%m-%d', time.localtime())
            # Prefer the user's original filename when the upload route preserved it;
            # the temp path basename is opaque (turtle_extra_<tid>_<idx>_<ts>.jpg) and
            # makes labels/searches harder.
            raw_name = item.get('original_filename')
            name_suffix = os.path.basename(raw_name) if raw_name else os.path.basename(src)

            if typ in _other_dir:
                # Route carapace/plastron to their proper folders
                dest_dir = os.path.join(turtle_dir, _other_dir[typ])
                os.makedirs(dest_dir, exist_ok=True)
                safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{name_suffix}"
                safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
                shutil.copy2(src, os.path.join(dest_dir, safe_name))
                print(f"📸 {typ.capitalize()} added to {turtle_id}/{_other_dir[typ]}: {safe_name}")
            else:
                # Microhabitat, condition, additional, other → additional_images/
                if not date_dir_created:
                    os.makedirs(date_dir, exist_ok=True)
                    if os.path.exists(manifest_path):
                        with open(manifest_path, 'r') as f: manifest = json.load(f)
                    date_dir_created = True
                safe_name = f"{typ}_{int(time.time() * 1000)}_{stamp_date}_{name_suffix}"
                safe_name = "".join(c for c in safe_name if c.isalnum() or c in '._-')
                dest = os.path.join(date_dir, safe_name)
                shutil.copy2(src, dest)
                entry = {
                    "filename": safe_name, "type": typ, "timestamp": ts, "exif_date": exif_date,
                }
                if lbs:
                    entry["labels"] = lbs
                manifest.append(entry)

        if date_dir_created:
            with open(manifest_path, 'w') as f:
                json.dump(manifest, f, indent=4)
        return True, "OK"

    def update_image_labels(self, turtle_id, image_path, labels, sheet_name=None):
        """Set labels on any image under the turtle's folder.

        Generic counterpart to update_turtle_additional_image_labels: works for
        active references (plastron/<stem>.jpg, carapace/<stem>.jpg), Old
        References, Other Plastrons / Other Carapaces, legacy loose_images, and
        additional_images. Storage is always a manifest.json living next to
        the file in question.

        Path safety: validates that ``image_path`` resolves to a real file
        under ``turtle_dir``. Anything else is rejected so a malformed
        request can't write a manifest outside the turtle's directory.
        """
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"
        if not image_path:
            return False, "Image path required"
        try:
            real_turtle_dir = os.path.realpath(turtle_dir)
            real_image = os.path.realpath(image_path)
        except OSError:
            return False, "Invalid path"
        if not os.path.isfile(real_image):
            return False, "Image not found"
        try:
            if os.path.commonpath([real_image, real_turtle_dir]) != real_turtle_dir:
                return False, "Image is not inside the turtle folder"
        except ValueError:
            return False, "Image is not inside the turtle folder"
        parent_dir = os.path.dirname(real_image)
        filename = os.path.basename(real_image)
        set_labels_for_file(parent_dir, filename, labels)
        return True, None

    def update_turtle_additional_image_labels(self, turtle_id, filename, sheet_name, labels):
        """Set labels on one manifest entry (additional_images)."""
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return False, "Turtle folder not found"
        if not filename or os.path.basename(filename) != filename:
            return False, "Invalid filename"
        lbs = normalize_label_list(labels)
        additional_dir = os.path.join(turtle_dir, 'additional_images')
        if not os.path.isdir(additional_dir):
            return False, "No additional images folder"

        def try_update(target_dir):
            manifest_path = os.path.join(target_dir, 'manifest.json')
            if not os.path.isfile(manifest_path):
                return False
            file_path = os.path.join(target_dir, filename)
            if not os.path.isfile(file_path):
                return False
            try:
                with open(manifest_path, 'r') as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                return False
            changed = False
            for entry in manifest:
                if entry.get('filename') == filename:
                    entry['labels'] = lbs
                    changed = True
                    break
            if not changed:
                return False
            try:
                with open(manifest_path, 'w') as f:
                    json.dump(manifest, f, indent=4)
            except OSError:
                return False
            return True

        if try_update(additional_dir):
            return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir) and try_update(date_dir):
                return True, None
        return False, "Image not found in manifest"

    def search_additional_images(self, query=None, photo_type=None):
        """
        Scan every per-directory manifest under each turtle for entries whose
        labels match ``query`` (substring, case-insensitive) and/or whose
        ``type`` matches ``photo_type`` (canonical kind). Returns hits from
        active plastron / carapace, their Old References and Other archives,
        legacy ``loose_images`` / ``ref_data``, AND ``additional_images``.
        Excludes ``Review_Queue/``, ``benchmarks/``, and any ``Deleted/``
        subtree. Pre-fix this only walked ``additional_images`` so plastron
        and carapace tags were silently invisible to the Sheets browser tag
        search.

        At least one of ``query`` or ``photo_type`` must be non-empty;
        otherwise returns an empty list (the Sheets browser's photo-tag
        panel won't issue a query without one of them).

        Each match: ``{ turtle_id, sheet_name, path, filename, type, labels,
        timestamp }``. ``sheet_name`` is the relative path from base_dir to
        the turtle dir with forward slashes (e.g. ``Kansas/North Topeka/F004``)
        — the frontend's first segment is the location filter, the trailing
        turtle id matches the row's biology / primary id. ``type`` is derived
        from where the manifest lives (``plastron`` / ``plastron_old_ref`` /
        ``plastron_other`` / ``carapace`` / ``carapace_old_ref`` /
        ``carapace_other`` / ``loose_legacy``); for ``additional_images``
        manifests it falls back to the entry's own ``type`` field
        (``microhabitat`` / ``condition`` / etc.).
        """
        q = (query or '').strip()
        kind_filter = normalize_additional_type(photo_type) if photo_type else None
        if not q and not kind_filter:
            return []

        # Skip system areas AND _Archive: an archived (merged-away / rolled-back)
        # turtle's additional_images must not resurface in the curated-image search.
        skip_top = {'Review_Queue', 'benchmarks', '_Archive'}
        # Names that mark "this manifest is inside a turtle's data area".
        # The turtle dir is one path component above the first such name we
        # encounter walking down from base_dir.
        turtle_area_names = {
            'plastron', 'carapace', 'ref_data',
            'additional_images', 'loose_images',
        }

        def derive_type(rel_dir_parts):
            """Photo-type label inferred from manifest location.
            Returns ``None`` for additional_images so the entry's own ``type``
            wins (preserves microhabitat / condition / etc. distinctions)."""
            if not rel_dir_parts:
                return 'other'
            head = rel_dir_parts[0]
            sub = rel_dir_parts[1] if len(rel_dir_parts) > 1 else None
            if head == 'plastron':
                if sub == 'Old References':
                    return 'plastron_old_ref'
                if sub == 'Other Plastrons':
                    return 'plastron_other'
                return 'plastron'
            if head == 'carapace':
                if sub == 'Old References':
                    return 'carapace_old_ref'
                if sub == 'Other Carapaces':
                    return 'carapace_other'
                return 'carapace'
            if head == 'ref_data':
                return 'plastron'  # legacy active reference layout
            if head == 'loose_images':
                return 'loose_legacy'
            if head == 'additional_images':
                return None
            return 'other'

        matches = []
        for root, dirs, files in os.walk(self.base_dir):
            rel = '' if root == self.base_dir else os.path.relpath(root, self.base_dir)
            parts = rel.split(os.sep) if rel else []

            # Prune top-level Review_Queue / benchmarks and any Deleted/ subtree.
            if parts and parts[0] in skip_top:
                dirs[:] = []
                continue
            if 'Deleted' in parts:
                dirs[:] = []
                continue

            if 'manifest.json' not in files:
                continue

            # Locate the first turtle-area marker; the turtle dir is its parent.
            area_idx = None
            for i, part in enumerate(parts):
                if part in turtle_area_names:
                    area_idx = i
                    break
            if area_idx is None or area_idx == 0:
                continue

            turtle_id = parts[area_idx - 1]
            sheet_name = os.sep.join(parts[:area_idx]).replace(os.sep, '/')
            derived = derive_type(parts[area_idx:])

            manifest_path = os.path.join(root, 'manifest.json')
            try:
                with open(manifest_path, 'r', encoding='utf-8') as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(manifest, list):
                continue

            for entry in manifest:
                if not isinstance(entry, dict):
                    continue
                fn = entry.get('filename')
                if not fn:
                    continue
                labels = entry.get('labels')
                # Label substring filter is only applied when the query is
                # non-empty; type-only searches (kind_filter without q) must
                # not be discarded here.
                if q and not label_query_matches(labels, q):
                    continue
                p = os.path.join(root, fn)
                if not os.path.isfile(p):
                    continue
                kind = derived if derived is not None else normalize_additional_type(entry.get('type'))
                if kind_filter and kind != kind_filter:
                    continue
                matches.append({
                    'turtle_id': turtle_id,
                    'sheet_name': sheet_name,
                    'path': p,
                    'filename': fn,
                    'type': kind,
                    'labels': normalize_label_list(labels),
                    'timestamp': entry.get('timestamp'),
                })

        matches.sort(key=lambda m: (m.get('sheet_name') or '', m.get('turtle_id') or '', m.get('filename') or ''))
        return matches

    def search_additional_images_by_label(self, query):
        """Backward-compatible wrapper for label-only search."""
        return self.search_additional_images(query=query, photo_type=None)

    def remove_additional_image_from_turtle(self, turtle_id, filename, sheet_name=None):
        turtle_dir = self._get_turtle_folder(turtle_id, sheet_name)
        if not turtle_dir or not os.path.isdir(turtle_dir): return False, "Turtle folder not found"
        additional_dir = os.path.join(turtle_dir, 'additional_images')
        if not os.path.isdir(additional_dir): return False, "No additional images folder"
        if not filename or os.path.basename(filename) != filename: return False, "Invalid filename"

        def try_delete(target_dir):
            file_path = os.path.join(target_dir, filename)
            if os.path.isfile(file_path):
                # Soft-delete: move the curated research image into
                # {turtle_dir}/Deleted/<original_rel_path> (mirrors
                # deletion_mixin.soft_delete_turtle_image) so it stays recoverable
                # via list_deleted_turtle_images, instead of an irreversible remove.
                rel = os.path.relpath(file_path, turtle_dir)
                dest = os.path.join(turtle_dir, 'Deleted', rel)
                if os.path.exists(dest):
                    # Collision in Deleted/ — suffix a ms stamp to preserve history.
                    stem, ext = os.path.splitext(dest)
                    dest = f"{stem}_{int(time.time() * 1000)}{ext}"
                # Hard-remove only a companion .pt (additional images normally have
                # none, but mirror soft_delete so a stale .pt never dangles).
                companion_pt = os.path.splitext(file_path)[0] + '.pt'
                if os.path.isfile(companion_pt):
                    try:
                        os.remove(companion_pt)
                    except OSError:
                        pass
                try:
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.move(file_path, dest)
                except OSError:
                    return False
                # Tags follow the image into Deleted/ BEFORE the source manifest
                # entry is pruned — migrate reads the label from the source manifest,
                # so pruning the entry first would drop the labels instead of moving
                # them (it also clears the source entry's labels itself).
                migrate_labels_to_archive(
                    os.path.dirname(file_path), os.path.basename(file_path),
                    os.path.dirname(dest), os.path.basename(dest),
                )
                # Now drop the moved file's entry from the source manifest.
                manifest_path = os.path.join(target_dir, 'manifest.json')
                if os.path.isfile(manifest_path):
                    with open(manifest_path, 'r') as f: manifest = json.load(f)
                    new_manifest = [e for e in manifest if e.get('filename') != filename]
                    with open(manifest_path, 'w') as f: json.dump(new_manifest, f, indent=4)
                return True
            return False

        if try_delete(additional_dir): return True, None
        for date_folder in os.listdir(additional_dir):
            date_dir = os.path.join(additional_dir, date_folder)
            if os.path.isdir(date_dir):
                if try_delete(date_dir): return True, None
        return False, "Image not found"
