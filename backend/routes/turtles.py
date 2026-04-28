"""
Turtle data endpoints (e.g. list images for a turtle folder)
"""

import os
import re
import json
import time
from flask import request, jsonify
from werkzeug.utils import secure_filename
from auth import require_admin
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from image_utils import normalize_to_jpeg
from services import manager_service
from turtle_manager import _extract_exif_date
from additional_image_labels import (
    normalize_label_list,
    parse_labels_from_form,
)


# Matches a millisecond-epoch timestamp at the start of a loose-photo filename,
# e.g. "plastron_1712345678901_source.jpg" or "carapace_1712345678901_foo.jpg".
_LOOSE_TS_RE = re.compile(r'^(?:plastron|carapace)_(\d{10,13})_')
# Archived_Master_<ms>.jpg or Archived_Carapace_<ms>.jpg (with optional _YYYY-MM-DD suffix)
_ARCHIVED_TS_RE = re.compile(r'^Archived_(?:Master|Carapace)_(\d{10,13})')
# Obs_<unix_seconds>_original.jpg
_OBS_TS_RE = re.compile(r'^Obs_(\d{10,13})_')
# Embedded YYYY-MM-DD anywhere in filename (the upload-date stamp added by the manager)
_FILENAME_DATE_RE = re.compile(r'(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)')


def _extract_upload_date_from_filename(filename, fallback_path=None):
    """Parse the system's upload date (YYYY-MM-DD) from a loose-photo filename.

    Order: explicit YYYY-MM-DD stamp → ms timestamp prefix → file mtime fallback.
    """
    m = _FILENAME_DATE_RE.search(filename)
    if m:
        return m.group(1)
    for rx in (_LOOSE_TS_RE, _ARCHIVED_TS_RE, _OBS_TS_RE):
        m = rx.search(filename)
        if m:
            raw = m.group(1)
            try:
                ts = int(raw)
                if ts > 1_000_000_000_000:
                    ts = ts / 1000
                return time.strftime('%Y-%m-%d', time.localtime(ts))
            except (ValueError, OSError):
                pass
    if fallback_path and os.path.exists(fallback_path):
        try:
            # Local time — the scratchpad's "today" is built from the admin's
            # wall clock (frontend uses new Date()), so UTC would slip a day
            # for anyone west of Greenwich during evening hours.
            return time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(fallback_path)))
        except OSError:
            pass
    return None


def register_turtle_routes(app):
    """Register turtle-related routes"""

    @app.route('/api/turtles/images', methods=['GET'])
    @require_admin
    def get_turtle_images():
        """
        Get image paths for a turtle: primary plastron, primary carapace, additional, loose, history_dates.
        Query: turtle_id (required), sheet_name (optional, for disambiguation).
        Returns: {
          primary: path | null,
          primary_carapace: path | null,
          primary_info: { path, timestamp, exif_date, upload_date } | null,
          primary_carapace_info: { path, timestamp, exif_date, upload_date } | null,
          additional: [ { path, type, labels?, timestamp, exif_date, upload_date, uploaded_by } ],
          loose: [ { path, source, timestamp, exif_date, upload_date } ],
          history_dates: [ 'YYYY-MM-DD', ... ]   # includes primary reference dates
        }
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500

        turtle_id = (request.args.get('turtle_id') or '').strip()
        sheet_name = (request.args.get('sheet_name') or '').strip() or None
        # Fallback id used when the on-disk folder still carries the original
        # Primary ID after the sheet's biology ID has been changed/assigned —
        # the folder-rename chronodrop will eventually reconcile, but until
        # then we still need to find the data.
        primary_id_fallback = (request.args.get('primary_id') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400

        manager = manager_service.manager
        location_hint = sheet_name
        turtle_dir = manager._get_turtle_folder(turtle_id, location_hint)
        if (not turtle_dir or not os.path.isdir(turtle_dir)) and primary_id_fallback and primary_id_fallback != turtle_id:
            turtle_dir = manager._get_turtle_folder(primary_id_fallback, location_hint)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return jsonify({
                'primary': None,
                'primary_carapace': None,
                'additional': [],
                'loose': [],
                'history_dates': [],
            })

        def _build_primary_info(path):
            if not path:
                return None
            exif = _extract_exif_date(path)
            upload = _extract_upload_date_from_filename(
                os.path.basename(path), fallback_path=path
            )
            return {
                'path': path,
                'timestamp': exif or upload,
                'exif_date': exif,
                'upload_date': upload,
            }

        # --- PRIMARY PLASTRON ---
        primary_path = None
        for ref_folder in ('plastron', 'ref_data'):
            ref_dir = os.path.join(turtle_dir, ref_folder)
            if os.path.isdir(ref_dir):
                for f in sorted(os.listdir(ref_dir)):
                    if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                        primary_path = os.path.join(ref_dir, f)
                        break
                if primary_path:
                    break
        primary_info = _build_primary_info(primary_path)

        # --- PRIMARY CARAPACE ---
        primary_carapace_path = None
        carapace_dir = os.path.join(turtle_dir, 'carapace')
        if os.path.isdir(carapace_dir):
            for f in sorted(os.listdir(carapace_dir)):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    primary_carapace_path = os.path.join(carapace_dir, f)
                    break
        primary_carapace_info = _build_primary_info(primary_carapace_path)

        # --- ADDITIONAL IMAGES ---
        additional = []
        additional_dir = os.path.join(turtle_dir, 'additional_images')

        def parse_manifest_or_folder(target_dir):
            results = []
            manifest_path = os.path.join(target_dir, 'manifest.json')
            processed_files = set()
            # Folder-level upload date from "additional_images/YYYY-MM-DD/"
            folder_date_match = _FILENAME_DATE_RE.search(os.path.basename(target_dir))
            folder_upload_date = folder_date_match.group(1) if folder_date_match else None

            if os.path.isfile(manifest_path):
                try:
                    with open(manifest_path, 'r') as f:
                        manifest = json.load(f)
                    for entry in manifest:
                        fn = entry.get('filename')
                        kind = entry.get('type', 'other')
                        if fn:
                            p = os.path.join(target_dir, fn)
                            if os.path.isfile(p):
                                # EXIF first, then manifest timestamp/folder date as the upload fallback
                                exif_date = entry.get('exif_date') or _extract_exif_date(p)
                                manifest_ts = entry.get('timestamp')
                                upload_date = (manifest_ts[:10] if isinstance(manifest_ts, str) and len(manifest_ts) >= 10 else None) or folder_upload_date
                                row = {
                                    'path': p,
                                    'type': kind,
                                    # 'timestamp' is the display-preferred date (EXIF when available)
                                    'timestamp': exif_date or upload_date,
                                    'exif_date': exif_date,
                                    'upload_date': upload_date,
                                    'uploaded_by': entry.get('uploaded_by'),
                                }
                                lbs = entry.get('labels')
                                if lbs:
                                    row['labels'] = normalize_label_list(lbs)
                                results.append(row)
                                processed_files.add(fn)
                except (json.JSONDecodeError, OSError):
                    pass

            if os.path.isdir(target_dir):
                for f in sorted(os.listdir(target_dir)):
                    if f != 'manifest.json' and f not in processed_files and f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                        full = os.path.join(target_dir, f)
                        exif_date = _extract_exif_date(full)
                        upload_date = _extract_upload_date_from_filename(f, fallback_path=full) or folder_upload_date
                        results.append({
                            'path': full,
                            'type': 'other',
                            'labels': [],
                            'timestamp': exif_date or upload_date,
                            'exif_date': exif_date,
                            'upload_date': upload_date,
                            'uploaded_by': None,
                        })
            return results

        if os.path.isdir(additional_dir):
            additional.extend(parse_manifest_or_folder(additional_dir))
            for item in sorted(os.listdir(additional_dir)):
                item_path = os.path.join(additional_dir, item)
                if os.path.isdir(item_path):
                    additional.extend(parse_manifest_or_folder(item_path))

        # --- LOOSE / HISTORICAL IMAGES ---
        # Each loose entry is structured: { path, source, timestamp (YYYY-MM-DD or null) }
        loose = []
        loose_folders = [
            ('plastron/Other Plastrons', 'plastron_other'),
            ('plastron/Old References', 'plastron_old_ref'),
            ('carapace/Other Carapaces', 'carapace_other'),
            ('carapace/Old References', 'carapace_old_ref'),
            ('loose_images', 'loose_legacy'),
        ]
        for folder_rel, source_tag in loose_folders:
            ld = os.path.join(turtle_dir, folder_rel)
            if not os.path.isdir(ld):
                continue
            for f in sorted(os.listdir(ld)):
                if not f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    continue
                full = os.path.join(ld, f)
                exif_date = _extract_exif_date(full)
                upload_date = _extract_upload_date_from_filename(f, fallback_path=full)
                loose.append({
                    'path': full,
                    'source': source_tag,
                    # Display-preferred date: EXIF when available, else upload
                    'timestamp': exif_date or upload_date,
                    'exif_date': exif_date,
                    'upload_date': upload_date,
                })

        # --- HISTORY DATES: unique sorted dates across additional + loose ---
        # Prefers EXIF date (when the photo was taken) over upload date. Falls back to
        # the folder-name date for legacy additional_images/YYYY-MM-DD/ uploads.
        date_set = set()
        for a in additional:
            best = a.get('exif_date') or a.get('upload_date') or a.get('timestamp')
            if isinstance(best, str) and len(best) >= 10:
                date_set.add(best[:10])
            else:
                m = re.search(r'additional_images[/\\](\d{4}-\d{2}-\d{2})[/\\]', a.get('path', ''))
                if m:
                    date_set.add(m.group(1))
        for l in loose:
            best = l.get('exif_date') or l.get('upload_date') or l.get('timestamp')
            if isinstance(best, str) and len(best) >= 10:
                date_set.add(best[:10])
        for info in (primary_info, primary_carapace_info):
            if info:
                best = info.get('exif_date') or info.get('upload_date') or info.get('timestamp')
                if isinstance(best, str) and len(best) >= 10:
                    date_set.add(best[:10])
        history_dates = sorted(date_set, reverse=True)

        # Soft-deleted images: scanned from {turtle_dir}/Deleted/ via TurtleManager.
        deleted = []
        try:
            deleted = manager.list_deleted_turtle_images(turtle_id, sheet_name)
        except Exception as e:
            print(f"Warning: could not list deleted images for {turtle_id}: {e}")

        return jsonify({
            'primary': primary_path,
            'primary_carapace': primary_carapace_path,
            'primary_info': primary_info,
            'primary_carapace_info': primary_carapace_info,
            'additional': additional,
            'loose': loose,
            'history_dates': history_dates,
            'deleted': deleted,
        })

    @app.route('/api/turtles/images/search-labels', methods=['GET'])
    @require_admin
    def search_turtle_images_by_label():
        """
        Find additional images whose labels match query (substring, case-insensitive).
        Query: q (required)
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        q = (request.args.get('q') or '').strip()
        if not q:
            return jsonify({'error': 'q required'}), 400
        matches = manager_service.manager.search_additional_images_by_label(q)
        return jsonify({'matches': matches})

    @app.route('/api/turtles/images/additional-labels', methods=['PATCH'])
    @require_admin
    def patch_turtle_additional_image_labels():
        """
        Update labels on one additional image (manifest entry). Admin only.
        JSON: { turtle_id, filename, sheet_name?, labels: string[] }
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.get_json(silent=True) or {}
        turtle_id = (data.get('turtle_id') or '').strip()
        filename = (data.get('filename') or '').strip()
        sheet_name = (data.get('sheet_name') or '').strip() or None
        labels = data.get('labels')
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if not filename:
            return jsonify({'error': 'filename required'}), 400
        if labels is not None and not isinstance(labels, list):
            return jsonify({'error': 'labels must be an array of strings'}), 400
        lbs = normalize_label_list(labels if isinstance(labels, list) else [])
        ok, err = manager_service.manager.update_turtle_additional_image_labels(
            turtle_id, filename, sheet_name, lbs
        )
        if not ok:
            return jsonify({'error': err or 'Failed to update labels'}), 400
        return jsonify({'success': True})

    @app.route('/api/turtles/images/primaries', methods=['POST'])
    @require_admin
    def get_turtle_primaries_batch():
        """
        Get primary (plastron) image path for multiple turtles in one request.
        Body: { "turtles": [ { "turtle_id": "...", "sheet_name": "..." | null }, ... ] }
        Returns: { "images": [ { "turtle_id", "sheet_name", "primary": path | null }, ... ] }
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.get_json(silent=True) or {}
        turtles = data.get('turtles') or []
        if not isinstance(turtles, list):
            return jsonify({'error': 'turtles must be an array'}), 400
        manager = manager_service.manager
        results = []
        for item in turtles[:200]:  # limit to avoid overload
            tid = (item.get('turtle_id') or '').strip()
            sheet = (item.get('sheet_name') or '').strip() or None
            pid = (item.get('primary_id') or '').strip() or None
            if not tid:
                results.append({'turtle_id': tid, 'sheet_name': sheet, 'primary': None})
                continue
            turtle_dir = manager._get_turtle_folder(tid, sheet)
            if (not turtle_dir or not os.path.isdir(turtle_dir)) and pid and pid != tid:
                turtle_dir = manager._get_turtle_folder(pid, sheet)
            primary_path = None
            if turtle_dir and os.path.isdir(turtle_dir):
                for ref_folder in ('plastron', 'ref_data'):
                    ref_dir = os.path.join(turtle_dir, ref_folder)
                    if os.path.isdir(ref_dir):
                        for f in sorted(os.listdir(ref_dir)):
                            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                                primary_path = os.path.join(ref_dir, f)
                                break
                    if primary_path:
                        break
            results.append({'turtle_id': tid, 'sheet_name': sheet, 'primary': primary_path})
        return jsonify({'images': results})

    @app.route('/api/turtles/image', methods=['DELETE'])
    @require_admin
    def soft_delete_turtle_image():
        """
        Soft-delete an image (Admin only).

        Moves the file to {turtle_dir}/Deleted/{original_rel_path}. If it was
        the active plastron or carapace reference, auto-reverts to the most
        recent file in {photo_type}/Old References/ and regenerates its .pt.

        Body (JSON): { turtle_id, path, sheet_name? }.
        Response: { success, was_reference, reverted, new_reference_path }.
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.get_json(silent=True) or {}
        turtle_id = (data.get('turtle_id') or '').strip()
        path = (data.get('path') or '').strip()
        sheet_name = (data.get('sheet_name') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if not path:
            return jsonify({'error': 'path required'}), 400
        success, info = manager_service.manager.soft_delete_turtle_image(
            turtle_id, path, sheet_name
        )
        if not success:
            return jsonify({'error': info.get('error', 'Failed to delete image')}), 400
        return jsonify({'success': True, **info})

    @app.route('/api/turtles/restore-image', methods=['POST'])
    @require_admin
    def restore_turtle_image_endpoint():
        """
        Restore a soft-deleted image (Admin only).

        Target path is derived from the Deleted/ path by stripping the
        'Deleted/' prefix. If the target is an active-ref slot, regenerates
        .pt and updates VRAM. Fails with collision=True if the target
        already exists.

        Body (JSON): { turtle_id, path, sheet_name? } where path is the
        absolute path of the file in the Deleted/ folder (or a turtle-dir
        relative path starting with 'Deleted/').
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.get_json(silent=True) or {}
        turtle_id = (data.get('turtle_id') or '').strip()
        path = (data.get('path') or '').strip()
        sheet_name = (data.get('sheet_name') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if not path:
            return jsonify({'error': 'path required'}), 400
        success, info = manager_service.manager.restore_turtle_image(
            turtle_id, path, sheet_name
        )
        if not success:
            status = 409 if info.get('collision') else 400
            return jsonify({'error': info.get('error', 'Failed to restore image'), **{k: v for k, v in info.items() if k != 'error'}}), status
        return jsonify({'success': True, **info})

    @app.route('/api/turtles/images/additional', methods=['DELETE'])
    @require_admin
    def delete_turtle_additional_image():
        """
        Delete one additional image from a turtle's folder (Admin only).
        Query: turtle_id (required), filename (required), sheet_name (optional).
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        turtle_id = (request.args.get('turtle_id') or '').strip()
        filename = (request.args.get('filename') or '').strip()
        sheet_name = (request.args.get('sheet_name') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if not filename:
            return jsonify({'error': 'filename required'}), 400
        success, err = manager_service.manager.remove_additional_image_from_turtle(
            turtle_id, filename, sheet_name
        )
        if not success:
            return jsonify({'error': err or 'Failed to delete image'}), 400
        return jsonify({'success': True})

    @app.route('/api/turtles/images/additional', methods=['POST'])
    @require_admin
    def add_turtle_additional_images():
        """
        Add microhabitat/condition images to an existing turtle folder (Admin only).
        Form: file_0, type_0, labels_0, ... (type: microhabitat | condition | carapace | plastron | other),
        optional sheet_name. When the folder is missing, sheet_name creates data/<location>/<turtle_id>/ .
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        turtle_id = (request.form.get('turtle_id') or request.args.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or request.args.get('sheet_name') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        files_with_types = []
        try:
            for key in list(request.files.keys()):
                if not key.startswith('file_'):
                    continue
                f = request.files[key]
                if not f or not f.filename:
                    continue
                idx = key.replace('file_', '')
                typ = (request.form.get(f'type_{idx}') or 'other').strip().lower()
                if typ not in ('microhabitat', 'condition', 'carapace', 'plastron', 'other'):
                    typ = 'other'
                lbs = parse_labels_from_form(request.form, idx)
                if not allowed_file(f.filename):
                    continue
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(0)
                if size > MAX_FILE_SIZE:
                    continue
                orig_safe = secure_filename(f.filename) or ''
                ext = os.path.splitext(orig_safe)[1] or '.jpg'
                temp_path = os.path.join(
                    UPLOAD_FOLDER,
                    f"turtle_extra_{turtle_id}_{idx}_{int(time.time())}{ext}".replace(os.sep, '_'),
                )
                f.save(temp_path)
                # HEIC/HEIF → JPEG (no-op for other formats)
                temp_path = normalize_to_jpeg(temp_path)
                orig_base = os.path.basename(orig_safe) if orig_safe else f'upload{ext}'
                item = {
                    'path': temp_path,
                    'type': typ,
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    'original_filename': orig_base,
                }
                if lbs:
                    item['labels'] = lbs
                files_with_types.append(item)
            if not files_with_types:
                return jsonify({'error': 'No valid image files provided'}), 400
            success, msg = manager_service.manager.add_additional_images_to_turtle(
                turtle_id, files_with_types, sheet_name
            )
            for item in files_with_types:
                p = item.get('path')
                if p and os.path.isfile(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
            if not success:
                return jsonify({'error': msg or 'Failed to add images'}), 400
            return jsonify({'success': True, 'message': f'Added {len(files_with_types)} image(s).'})
        except Exception as e:
            for item in files_with_types:
                p = item.get('path')
                if p and os.path.isfile(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
            return jsonify({'error': str(e)}), 500

    @app.route('/api/turtles/replace-reference', methods=['POST'])
    @require_admin
    def replace_turtle_reference_endpoint():
        """
        Directly replace a turtle's plastron or carapace reference image (Admin only).
        Form: turtle_id (required), photo_type ('plastron'|'carapace'), file, sheet_name (optional).
        Archives the old reference to {photo_type}/Old References/ and updates VRAM cache.
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        turtle_id = (request.form.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or '').strip() or None
        photo_type = (request.form.get('photo_type') or 'plastron').strip().lower()
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if photo_type not in ('plastron', 'carapace'):
            return jsonify({'error': "photo_type must be 'plastron' or 'carapace'"}), 400
        f = request.files.get('file')
        if not f or not f.filename or not allowed_file(f.filename):
            return jsonify({'error': 'Valid image file required'}), 400
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({'error': f'File exceeds max size of {MAX_FILE_SIZE} bytes'}), 400
        ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
        temp_path = os.path.join(
            UPLOAD_FOLDER,
            f"replace_{turtle_id}_{photo_type}_{int(time.time() * 1000)}{ext}".replace(os.sep, '_'),
        )
        f.save(temp_path)
        try:
            success, msg = manager_service.manager.replace_turtle_reference(
                turtle_id, temp_path, photo_type=photo_type, sheet_name=sheet_name,
            )
            if not success:
                return jsonify({'error': msg or 'Failed to replace reference'}), 400
            return jsonify({'success': True, 'message': msg})
        finally:
            if os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    @app.route('/api/turtles/images/identifier-plastron', methods=['POST'])
    @require_admin
    def upload_turtle_identifier_plastron():
        """
        Set or replace the identifier (ref_data) plastron image and regenerate the .pt tensor.

        Form: turtle_id (required), file (required), mode = set_if_missing | replace (required),
        sheet_name (required when the turtle folder does not exist yet — e.g. sheet-only row).

        set_if_missing: fails if ref_data already has an identifier for this turtle_id.
        replace: archives the previous master image to loose_images when present, then sets the new one.
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500

        turtle_id = (request.form.get('turtle_id') or request.args.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or request.args.get('sheet_name') or '').strip() or None
        mode = (request.form.get('mode') or request.args.get('mode') or '').strip().lower()
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if mode not in ('set_if_missing', 'replace'):
            return jsonify({'error': 'mode must be set_if_missing or replace'}), 400

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        f = request.files['file']
        if not f or not f.filename:
            return jsonify({'error': 'No file provided'}), 400
        if not allowed_file(f.filename):
            return jsonify({'error': 'Invalid file type'}), 400
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large'}), 400

        orig_safe = secure_filename(f.filename) or ''
        ext = os.path.splitext(orig_safe)[1] or '.jpg'
        temp_path = os.path.join(
            UPLOAD_FOLDER,
            f"turtle_idplastron_{turtle_id}_{int(time.time())}{ext}".replace(os.sep, '_'),
        )
        try:
            f.save(temp_path)
            temp_path = normalize_to_jpeg(temp_path)
            ok, msg = manager_service.manager.set_identifier_plastron_from_path(
                turtle_id, temp_path, sheet_name, mode
            )
            if not ok:
                return jsonify({'error': msg or 'Failed to update identifier plastron'}), 400
            return jsonify({'success': True, 'message': msg or 'Identifier plastron updated'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
        finally:
            if os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass