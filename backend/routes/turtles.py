"""
Turtle data endpoints (e.g. list images for a turtle folder)
"""

import os
import time
from flask import request, jsonify
from werkzeug.utils import secure_filename
from auth import require_admin
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from image_utils import UploadImageError
from upload_rate_limit import upload_rate_limit_ok, upload_rate_limit_response
from upload_validation import ingest_saved_upload, upload_error_response
from services import manager_service
from additional_image_labels import (
    normalize_label_list,
    parse_additional_type_filter,
)
from additional_image_upload import (
    additional_upload_success_json,
    cleanup_temp_upload_paths,
    collect_indexed_additional_uploads,
    no_valid_files_json,
)
from turtle_manager.folder_images import (
    IMAGE_EXTENSIONS,
    build_turtle_images_payload,
    dir_has_image,
    extract_upload_ts_from_filename,
)


def _ensure_primary_for_new_sheet_turtle(turtle_id, bio_id, sheet_name):
    """Return a real primary_id so a Sheets-browser upload that CREATES a new
    folder makes it canonical (``<bio_id>_<primary_id>``) -- never bio-only.

    Reads the turtle's sheet row by biology id (scoped to the tab = first
    segment of the folder hint, since biology ids repeat across sheets); if the
    row already has a Primary ID, returns it; otherwise mints one and writes it
    into that row. Runs under bounded Sheets retry, so a transient outage raises
    ``SheetsServiceUnavailableError`` (-> 503) instead of letting a bio-only
    folder be created. Returns None when it can't resolve without Sheets config
    (the caller then fails loud via the canonical-folder gate). Call this ONLY
    when no folder exists yet and no primary_id was supplied -- minting a primary
    for a turtle that already has a folder would diverge the sheet from disk.
    """
    tab = (sheet_name or '').split('/')[0].strip()
    bio = (bio_id or turtle_id or '').strip()
    if not tab or not bio:
        return None

    def _work(service):
        if service is None:
            return None
        row = service.get_turtle_data(bio, tab)
        if row is None:
            # The CRUD layer swallows a transient read HttpError to None, so a
            # None here means "couldn't read the row" (transient outage) or "row
            # absent". Either way we must NOT mint a primary + create a folder the
            # sheet doesn't know about -- raise so call_sheets_with_retry retries
            # a blip and ultimately surfaces a 503, never a sheet-divergent folder.
            raise manager_service.SheetsServiceUnavailableError(
                "Could not read the turtle's sheet row to assign a Primary ID. Please try again."
            )
        existing = (row or {}).get('primary_id')
        if existing and str(existing).strip():
            return str(existing).strip()
        new_pid = service.generate_primary_id()
        # update_turtle_data returns False (it swallows a transient HttpError)
        # rather than raising -> we MUST check it. Returning new_pid after a
        # failed write would create a folder whose name carries a primary the
        # sheet row never received (silent disk/sheet divergence). Raise instead
        # so the write is retried and, if Sheets stays down, the caller gets 503.
        if not service.update_turtle_data(new_pid, {'primary_id': new_pid}, tab, bio_id=bio):
            raise manager_service.SheetsServiceUnavailableError(
                "Could not write the new Primary ID to the turtle's sheet row. Please try again."
            )
        return new_pid

    return manager_service.call_sheets_with_retry(_work)


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
        # Look up by primary_id FIRST when available — primary IDs are globally
        # unique, while biology IDs (F003, M201, …) are reused across US state
        # sheets. Trying the primary first avoids cross-state collisions where
        # a bare-bio_id walk could land on the wrong turtle. Falls through to
        # the bio_id (sent as turtle_id by the frontend) when no primary is
        # known or when the primary lookup misses.
        turtle_dir = None
        if primary_id_fallback:
            turtle_dir = manager._get_turtle_folder(primary_id_fallback, location_hint)
        if (not turtle_dir or not os.path.isdir(turtle_dir)) and turtle_id and turtle_id != primary_id_fallback:
            turtle_dir = manager._get_turtle_folder(turtle_id, location_hint)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return jsonify({
                'primary': None,
                'primary_carapace': None,
                'additional': [],
                'loose': [],
                'history_dates': [],
            })

        return jsonify(build_turtle_images_payload(turtle_dir, manager, turtle_id, sheet_name))

    @app.route('/api/turtles/images/search-labels', methods=['GET'])
    @require_admin
    def search_turtle_images_by_label():
        """
        Find additional images by label substring and/or additional-image category.
        Query: q (optional), type (optional). At least one is required.
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        q = (request.args.get('q') or '').strip()
        try:
            image_type = parse_additional_type_filter(request.args.get('type'))
        except ValueError:
            return jsonify({'error': 'Invalid type filter'}), 400
        if not q and not image_type:
            return jsonify({'error': 'q or type required'}), 400
        matches = manager_service.manager.search_additional_images(
            query=q,
            photo_type=image_type,
        )
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

    @app.route('/api/turtles/images/labels', methods=['PATCH'])
    @require_admin
    def patch_turtle_image_labels():
        """
        Update labels on ANY image under a turtle's folder. Admin only.
        Generic counterpart to ``/additional-labels`` — works for active
        plastron/carapace references, Old References, Other Plastrons /
        Other Carapaces, legacy loose_images, and additional_images.

        JSON: { turtle_id, path, labels: string[], sheet_name?, primary_id? }
        ``path`` is the absolute filesystem path returned in
        ``/api/turtles/images`` responses. The handler validates the path
        lives under the resolved turtle folder before writing.
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.get_json(silent=True) or {}
        turtle_id = (data.get('turtle_id') or '').strip()
        primary_id_fallback = (data.get('primary_id') or '').strip() or None
        sheet_name = (data.get('sheet_name') or '').strip() or None
        image_path = (data.get('path') or '').strip()
        labels = data.get('labels')
        if not turtle_id and not primary_id_fallback:
            return jsonify({'error': 'turtle_id or primary_id required'}), 400
        if not image_path:
            return jsonify({'error': 'path required'}), 400
        if labels is not None and not isinstance(labels, list):
            return jsonify({'error': 'labels must be an array of strings'}), 400
        lbs = normalize_label_list(labels if isinstance(labels, list) else [])

        # Same primary-first lookup order as the image endpoints — biology IDs
        # collide across US state sheets, primaries don't.
        manager = manager_service.manager
        ok = False
        err = None
        if primary_id_fallback:
            ok, err = manager.update_image_labels(primary_id_fallback, image_path, lbs, sheet_name)
        if not ok and turtle_id and turtle_id != primary_id_fallback:
            ok, err = manager.update_image_labels(turtle_id, image_path, lbs, sheet_name)
        if not ok:
            return jsonify({'error': err or 'Failed to update labels'}), 400
        return jsonify({'success': True, 'labels': lbs})

    @app.route('/api/turtles/images/primaries', methods=['POST'])
    @require_admin
    def get_turtle_primaries_batch():
        """
        Get primary (plastron) image path for multiple turtles in one request.
        Body: { "turtles": [ { "turtle_id": "...", "sheet_name": "..." | null }, ... ] }
        Returns: { "images": [ { "turtle_id", "sheet_name", "primary": path | null,
                                 "primary_ts", "has_carapace": bool,
                                 "folder_status": "has_images"|"empty_folder"|"no_folder" }, ... ] }
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
                results.append({'turtle_id': tid, 'sheet_name': sheet, 'primary': None,
                                'has_carapace': False, 'folder_status': 'no_folder'})
                continue
            # Same primary-first lookup order as the single-image endpoint:
            # globally-unique primary_id avoids cross-state bio_id collisions.
            turtle_dir = None
            if pid:
                turtle_dir = manager._get_turtle_folder(pid, sheet)
            if (not turtle_dir or not os.path.isdir(turtle_dir)) and tid and tid != pid:
                turtle_dir = manager._get_turtle_folder(tid, sheet)
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
            primary_ts = (
                extract_upload_ts_from_filename(
                    os.path.basename(primary_path), fallback_path=primary_path
                )
                if primary_path else None
            )
            # Carapace-reference presence + folder status, so the frontend can
            # tell apart "no plastron ref" / "no references at all" / "no folder".
            folder_status = 'no_folder'
            has_carapace = False
            if turtle_dir and os.path.isdir(turtle_dir):
                car_dir = os.path.join(turtle_dir, 'carapace')
                if os.path.isdir(car_dir):
                    try:
                        has_carapace = any(
                            f.lower().endswith(IMAGE_EXTENSIONS) for f in os.listdir(car_dir)
                        )
                    except OSError:
                        has_carapace = False
                if primary_path or has_carapace:
                    folder_status = 'has_images'
                else:
                    # No plastron + no carapace reference -- only now pay for a
                    # (cheap, single-turtle) scan to tell empty from has-other-photos.
                    folder_status = 'has_images' if dir_has_image(turtle_dir) else 'empty_folder'
            results.append({
                'turtle_id': tid,
                'sheet_name': sheet,
                'primary': primary_path,
                'primary_ts': primary_ts,
                'has_carapace': has_carapace,
                'folder_status': folder_status,
            })
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
        Add additional images to an existing turtle folder (Admin only).
        Form: file_0, type_0, labels_0, ... (type normalized server-side),
        optional sheet_name. When the folder is missing, sheet_name creates data/<location>/<turtle_id>/ .
        """
        if not upload_rate_limit_ok(request, 'admin'):
            return upload_rate_limit_response()
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        turtle_id = (request.form.get('turtle_id') or request.args.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or request.args.get('sheet_name') or '').strip() or None
        # Optional primary_id is tried first when resolving the folder so a
        # bare bio_id like F004 doesn't accidentally find a same-bio_id turtle
        # in a different US state.
        primary_id = (request.form.get('primary_id') or request.args.get('primary_id') or '').strip() or None
        # Bio ID is used only for canonical <bio_id>_<primary_id> naming when this
        # upload creates the folder for a sheet-only turtle.
        bio_id = (request.form.get('bio_id') or request.args.get('bio_id') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        files_with_types = []
        try:
            files_with_types, rejections = collect_indexed_additional_uploads(
                request,
                context='turtles/additional',
                temp_path_for_index=lambda idx, ext: os.path.join(
                    UPLOAD_FOLDER,
                    f"turtle_extra_{turtle_id}_{idx}_{int(time.time())}{ext}".replace(os.sep, '_'),
                ),
            )
            if not files_with_types:
                return jsonify(no_valid_files_json(rejections)), 400
            success, msg = manager_service.manager.add_additional_images_to_turtle(
                turtle_id, files_with_types, sheet_name, primary_id=primary_id, bio_id=bio_id,
            )
            cleanup_temp_upload_paths(files_with_types)
            if not success:
                return jsonify({'error': msg or 'Failed to add images'}), 400
            return jsonify(additional_upload_success_json(files_with_types, rejections))
        except Exception as e:
            cleanup_temp_upload_paths(files_with_types)
            return jsonify({'error': str(e)}), 500

    @app.route('/api/turtles/replace-reference', methods=['POST'])
    @require_admin
    def replace_turtle_reference_endpoint():
        """
        Directly replace a turtle's plastron or carapace reference image (Admin only).
        Form: turtle_id (required), photo_type ('plastron'|'carapace'), file, sheet_name (optional).
        Archives the old reference to {photo_type}/Old References/ and updates VRAM cache.
        """
        if not upload_rate_limit_ok(request, 'admin'):
            return upload_rate_limit_response()
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        turtle_id = (request.form.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or '').strip() or None
        # Optional primary_id is tried first to avoid cross-state biology-id
        # collisions (see resolve_turtle_dir_for_sheet_upload for details).
        primary_id = (request.form.get('primary_id') or '').strip() or None
        # Bio ID + create_if_missing let a sheet-only ("Null") turtle's first
        # reference photo create its canonical <bio_id>_<primary_id> folder.
        bio_id = (request.form.get('bio_id') or '').strip() or None
        create_if_missing = (request.form.get('create_if_missing') or '').strip().lower() in ('1', 'true', 'yes')
        photo_type = (request.form.get('photo_type') or 'plastron').strip().lower()
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if photo_type not in ('plastron', 'carapace'):
            return jsonify({'error': "photo_type must be 'plastron' or 'carapace'"}), 400
        f = request.files.get('file')
        if not f or not f.filename or not allowed_file(f.filename):
            return jsonify({
                'error': 'Valid image file required (JPEG, PNG, GIF, WEBP, HEIC).',
                'code': 'invalid_extension',
            }), 400
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({
                'error': 'File too large (max 8MB after optimization).',
                'code': 'file_too_large',
            }), 400
        ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
        temp_path = os.path.join(
            UPLOAD_FOLDER,
            f"replace_{turtle_id}_{photo_type}_{int(time.time() * 1000)}{ext}".replace(os.sep, '_'),
        )
        f.save(temp_path)
        try:
            temp_path = ingest_saved_upload(
                temp_path, context='turtles/replace-reference', filename=f.filename,
            )
        except UploadImageError as img_err:
            if os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            return upload_error_response(img_err)
        try:
            # Null-turtle first reference photo (no folder, no primary yet):
            # ensure a real primary so the new folder is born canonical, never
            # bio-only. Only when no folder exists -- minting for an existing
            # folder would diverge the sheet from disk. 503 if Sheets is down.
            if create_if_missing and not primary_id and sheet_name:
                mgr = manager_service.manager
                existing = mgr._get_turtle_folder(turtle_id, sheet_name)
                if not (existing and os.path.isdir(existing)) and bio_id and bio_id != turtle_id:
                    existing = mgr._get_turtle_folder(bio_id, sheet_name)
                if not (existing and os.path.isdir(existing)):
                    primary_id = _ensure_primary_for_new_sheet_turtle(turtle_id, bio_id, sheet_name)
            success, msg = manager_service.manager.replace_turtle_reference(
                turtle_id, temp_path, photo_type=photo_type, sheet_name=sheet_name,
                primary_id=primary_id, create_if_missing=create_if_missing, bio_id=bio_id,
            )
            if not success:
                return jsonify({'error': msg or 'Failed to replace reference'}), 400
            return jsonify({'success': True, 'message': msg})
        except manager_service.SheetsServiceUnavailableError as e:
            return jsonify({'error': e.message}), e.status_code
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
        if not upload_rate_limit_ok(request, 'admin'):
            return upload_rate_limit_response()
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500

        turtle_id = (request.form.get('turtle_id') or request.args.get('turtle_id') or '').strip()
        sheet_name = (request.form.get('sheet_name') or request.args.get('sheet_name') or '').strip() or None
        # Optional primary_id tried first during folder resolution.
        primary_id = (request.form.get('primary_id') or request.args.get('primary_id') or '').strip() or None
        bio_id = (request.form.get('bio_id') or request.args.get('bio_id') or '').strip() or None
        mode = (request.form.get('mode') or request.args.get('mode') or '').strip().lower()
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        if mode not in ('set_if_missing', 'replace'):
            return jsonify({'error': 'mode must be set_if_missing or replace'}), 400
        # Defensive: this endpoint is not the Null-turtle first-photo path
        # (that's /replace-reference, which auto-assigns a primary). If it would
        # CREATE a brand-new folder, require a primary_id so the folder is born
        # canonical (<bio_id>_<primary_id>) rather than bio-only.
        if not primary_id:
            existing_dir = manager_service.manager._get_turtle_folder(turtle_id, sheet_name)
            if not (existing_dir and os.path.isdir(existing_dir)):
                return jsonify({
                    'error': 'primary_id is required to create a new turtle folder.',
                    'code': 'primary_id_required',
                }), 400

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        f = request.files['file']
        if not f or not f.filename:
            return jsonify({'error': 'No file provided'}), 400
        if not allowed_file(f.filename):
            return jsonify({
                'error': 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP, HEIC.',
                'code': 'invalid_extension',
            }), 400
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({
                'error': 'File too large (max 8MB after optimization).',
                'code': 'file_too_large',
            }), 400

        orig_safe = secure_filename(f.filename) or ''
        ext = os.path.splitext(orig_safe)[1] or '.jpg'
        temp_path = os.path.join(
            UPLOAD_FOLDER,
            f"turtle_idplastron_{turtle_id}_{int(time.time())}{ext}".replace(os.sep, '_'),
        )
        try:
            f.save(temp_path)
            try:
                temp_path = ingest_saved_upload(
                    temp_path, context='turtles/identifier-plastron', filename=f.filename,
                )
            except UploadImageError as img_err:
                return upload_error_response(img_err)
            ok, msg = manager_service.manager.set_identifier_plastron_from_path(
                turtle_id, temp_path, sheet_name, mode, primary_id=primary_id,
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

    @app.route('/api/turtles/merge', methods=['POST'])
    @require_admin
    def merge_turtles():
        """Merge a secondary turtle record into a primary turtle record.

        JSON body:
          primary_id              — Primary ID of the turtle to keep
          secondary_id            — Primary ID of the turtle to merge in and delete
          primary_sheet           — Sheet name for primary (optional; used for folder resolution)
          secondary_sheet         — Sheet name for secondary (optional)
          plastron_source         — 'primary' or 'secondary' (default 'primary')
          carapace_source         — 'primary' or 'secondary' (default 'primary')
          keep_secondary_additional — list of absolute paths from secondary's additional_images
                                      to migrate; [] → migrate none
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500

        body = request.get_json(silent=True) or {}
        primary_id = (body.get('primary_id') or '').strip()
        secondary_id = (body.get('secondary_id') or '').strip()
        primary_sheet = (body.get('primary_sheet') or '').strip() or None
        secondary_sheet = (body.get('secondary_sheet') or '').strip() or None
        plastron_source = (body.get('plastron_source') or 'primary').strip()
        carapace_source = (body.get('carapace_source') or 'primary').strip()
        keep_secondary_additional = body.get('keep_secondary_additional')

        if not primary_id:
            return jsonify({'error': 'primary_id is required'}), 400
        if not secondary_id:
            return jsonify({'error': 'secondary_id is required'}), 400
        if primary_id == secondary_id:
            return jsonify({'error': 'Cannot merge a turtle with itself'}), 400
        if plastron_source not in ('primary', 'secondary'):
            return jsonify({'error': 'plastron_source must be "primary" or "secondary"'}), 400
        if carapace_source not in ('primary', 'secondary'):
            return jsonify({'error': 'carapace_source must be "primary" or "secondary"'}), 400
        if keep_secondary_additional is not None and not isinstance(keep_secondary_additional, list):
            return jsonify({'error': 'keep_secondary_additional must be an array'}), 400

        manager = manager_service.manager
        ok, msg = manager.merge_turtles(
            primary_id, secondary_id,
            primary_sheet=primary_sheet,
            secondary_sheet=secondary_sheet,
            plastron_source=plastron_source,
            carapace_source=carapace_source,
            keep_secondary_additional=keep_secondary_additional if keep_secondary_additional is not None else [],
        )
        return jsonify({'success': ok, 'message': msg}), (200 if ok else 500)