"""
Photo upload endpoint
"""

import os
import re
import shutil
import json
import sys
import time
import traceback
import threading
import uuid
from flask import request, jsonify
from werkzeug.utils import secure_filename
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from auth import optional_auth, check_auth_revocation
from image_utils import normalize_to_jpeg
from services import manager_service
from additional_image_labels import normalize_additional_type, parse_labels_from_form

_EXTRA_UPLOAD_KEY = re.compile(
    r'^extra_(microhabitat|condition|carapace|plastron|other)_(\d+)$', re.IGNORECASE
)


def _collect_extra_upload_files(request, request_id):
    """
    Parse extra_microhabitat_0, extra_labels_0, etc. from multipart form.
    Returns list of dicts suitable for add_additional_images_to_packet.
    """
    files_with_types = []
    entries = []
    for key in request.files.keys():
        m = _EXTRA_UPLOAD_KEY.match(key)
        if not m:
            continue
        f = request.files[key]
        if not f or not f.filename:
            continue
        if not allowed_file(f.filename):
            continue
        idx = int(m.group(2))
        typ_raw = m.group(1)
        entries.append((idx, typ_raw, key, f))
    entries.sort(key=lambda e: e[0])
    for idx, typ_raw, key, f in entries:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            continue
        typ = normalize_additional_type(typ_raw)
        lbs = parse_labels_from_form(request.form, str(idx), key_prefix='extra_labels')
        ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
        extra_temp = os.path.join(UPLOAD_FOLDER, f"extra_{request_id}_{typ}_{int(time.time())}{ext}")
        f.save(extra_temp)
        extra_temp = normalize_to_jpeg(extra_temp)
        item = {
            'path': extra_temp,
            'type': typ,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        if lbs:
            item['labels'] = lbs
        files_with_types.append(item)
    return files_with_types

_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


def find_image_for_pt(pt_path):
    """Find the image file next to a .pt file, matching the extension case-insensitively.

    The filesystem on Linux is case-sensitive, so a hard-coded lowercase extension
    list would miss files named e.g. ``F128.JPG`` (uppercase). This helper scans
    the containing directory for any file with the same stem and a supported
    image extension regardless of case.

    Returns the discovered image path, or ``pt_path`` unchanged when no image is
    found (callers already treat that as "no image").
    """
    if not pt_path or not pt_path.endswith('.pt'):
        return pt_path
    base = pt_path[:-3]
    dir_path = os.path.dirname(base) or '.'
    base_name = os.path.basename(base)
    if not os.path.isdir(dir_path):
        return pt_path
    try:
        entries = os.listdir(dir_path)
    except OSError:
        return pt_path
    for fname in entries:
        stem, ext = os.path.splitext(fname)
        if stem == base_name and ext.lower() in _IMAGE_EXTENSIONS:
            return os.path.join(dir_path, fname)
    return pt_path


# ARCHITECT NOTE: Kept .pt conversion for SuperPoint integration
def convert_pt_to_image_path(pt_path):
    """Backwards-compatible wrapper — delegates to case-insensitive lookup."""
    return find_image_for_pt(pt_path)

def register_upload_routes(app):
    """Register upload routes"""

    @app.route('/api/upload', methods=['POST'])
    @optional_auth
    def upload_photo():
        # Wait for manager to be ready
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503

        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager is not ready. Please try again in a moment.'}), 503

        try:
            if 'file' not in request.files:
                return jsonify({'error': 'No file provided'}), 400

            # Get user data from verified JWT token (if provided)
            user_data = getattr(request, 'user', None)
            if user_data and isinstance(user_data, dict):
                user_role = user_data.get('role', 'community')
                user_email = user_data.get('email', 'anonymous')
            else:
                user_role = 'community'
                user_email = 'anonymous'

            file = request.files['file']
            state = request.form.get('state', '')
            location = request.form.get('location', '')

            # Form metadata logic kept intact for partner's frontend
            location_hint_lat = request.form.get('location_hint_lat', type=float)
            location_hint_lon = request.form.get('location_hint_lon', type=float)
            location_hint_source = request.form.get('location_hint_source', '')
            collected_to_lab = request.form.get('collected_to_lab', '').strip().lower()
            physical_flag = request.form.get('physical_flag', '').strip().lower()
            digital_flag_lat = request.form.get('digital_flag_lat', type=float)
            digital_flag_lon = request.form.get('digital_flag_lon', type=float)
            digital_flag_source = request.form.get('digital_flag_source', '').strip().lower()

            if file.filename == '':
                return jsonify({'error': 'No file selected'}), 400

            if not allowed_file(file.filename):
                return jsonify({'error': 'Invalid file type'}), 400

            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)

            if file_size > MAX_FILE_SIZE:
                return jsonify({'error': 'File too large (max 5MB)'}), 400

            filename = secure_filename(file.filename)
            temp_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(temp_path)
            # HEIC/HEIF → JPEG so SuperPoint + frontend can handle it
            temp_path = normalize_to_jpeg(temp_path)
            filename = os.path.basename(temp_path)

            if not os.path.exists(temp_path):
                return jsonify({'error': 'Failed to save file'}), 500

            if user_role in ('staff', 'admin'):
                # Enforce revocation before privileged path (demotion must revoke immediately)
                auth_header = request.headers.get('Authorization')
                if not auth_header:
                    if os.path.exists(temp_path):
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass
                    return jsonify({'error': 'Staff or admin access requires a valid token'}), 403
                allowed, revoke_error = check_auth_revocation(auth_header)
                if not allowed:
                    if os.path.exists(temp_path):
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass
                    return jsonify({'error': revoke_error or 'Token has been revoked'}), 403
                # Admin/Staff: create a packet (so we can add additional images on match page) then run search
                request_id = f"admin_{int(time.time())}_{filename}"
                packet_dir = os.path.join(manager_service.manager.review_queue_dir, request_id)
                os.makedirs(packet_dir, exist_ok=True)
                query_save_path = os.path.join(packet_dir, filename)
                shutil.copy2(temp_path, query_save_path)
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

                additional_dir = os.path.join(packet_dir, 'additional_images')
                os.makedirs(additional_dir, exist_ok=True)
                with open(os.path.join(additional_dir, 'manifest.json'), 'w') as f:
                    json.dump([], f)

                # Process additional partner frontend files (microhabitat / condition / carapace / plastron + optional labels)
                files_with_types = _collect_extra_upload_files(request, request_id)

                if files_with_types:
                    manager_service.manager.add_additional_images_to_packet(request_id, files_with_types)
                    for item in files_with_types:
                        path = item.get('path')
                        if path and os.path.isfile(path):
                            try:
                                os.remove(path)
                            except OSError: pass

                match_sheet = (request.form.get('match_sheet') or '').strip() or None
                candidates_dir = os.path.join(packet_dir, 'candidate_matches')

                try:
                    # Admin uploads are always plastron — photo_type is fixed
                    results = manager_service.manager.search_for_matches(
                        query_save_path, location_filter=match_sheet, photo_type='plastron'
                    )

                    # Safely unpack the tuple (matches, elapsed_time)
                    if isinstance(results, tuple) and len(results) == 2:
                        matches, _ = results
                    else:
                        matches = results if results else []

                    # Write candidate images to disk so the Review Queue can
                    # display them if the admin backs out of the match page.
                    # Uses case-insensitive lookup so .JPG files are handled.
                    os.makedirs(candidates_dir, exist_ok=True)
                    for rank, match in enumerate(matches, start=1):
                        pt_path = match.get('file_path', '') or ''
                        img_src = find_image_for_pt(pt_path)
                        if img_src and img_src != pt_path and os.path.isfile(img_src):
                            ext = os.path.splitext(img_src)[1]
                            turtle_id = match.get('site_id', 'Unknown')
                            conf_int = int(round(match.get('confidence', 0.0) * 100))
                            cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                            shutil.copy2(img_src, os.path.join(candidates_dir, cand_filename))

                    formatted_matches = []
                    for match in matches:
                        pt_path = match.get('file_path', '') or ''
                        image_path = convert_pt_to_image_path(pt_path)
                        loc = (match.get('location') or 'Unknown').strip() or 'Unknown'
                        formatted_matches.append({
                            'turtle_id': match.get('site_id', 'Unknown') or 'Unknown',
                            'location': loc,
                            'confidence': float(match.get('confidence', 0.0)),
                            'file_path': image_path,
                            'filename': os.path.basename(image_path) if image_path else ''
                        })

                    message = (
                        f'Photo processed successfully. {len(formatted_matches)} matches found.'
                        if len(formatted_matches) > 0
                        else 'Photo processed successfully. No matches found. You can create a new turtle.'
                    )

                    # Save metadata with photo_type so review queue can display it
                    with open(os.path.join(packet_dir, 'metadata.json'), 'w') as mf:
                        json.dump({'photo_type': 'plastron'}, mf)

                    return jsonify({
                        'success': True,
                        'request_id': request_id,
                        'matches': formatted_matches,
                        'uploaded_image_path': query_save_path,
                        'photo_type': 'plastron',
                        'message': message
                    })
                except Exception as search_exc:
                    # Same as create_review_packet: without this, GET /review-queue treats the
                    # packet as match_search_pending forever (no candidate_matches dir).
                    if os.path.isdir(packet_dir) and not os.path.isdir(candidates_dir):
                        fail_path = os.path.join(packet_dir, 'match_search_failed.json')
                        try:
                            with open(fail_path, 'w', encoding='utf-8') as f:
                                json.dump({'error': str(search_exc)}, f)
                        except OSError:
                            pass
                    raise

            else:
                # Community or Anonymous Upload Process
                finder_name = user_email.split('@')[0] if user_email != 'anonymous' and '@' in user_email else 'Anonymous User'

                user_info = {
                    'finder': finder_name,
                    'email': user_email,
                    'uploaded_at': time.time(),
                    'photo_type': 'unclassified',
                }

                if state and location:
                    user_info['state'] = state
                    user_info['location'] = location

                # Partner metadata injection
                if location_hint_lat is not None and location_hint_lon is not None:
                    user_info['location_hint_lat'] = location_hint_lat
                    user_info['location_hint_lon'] = location_hint_lon
                    if location_hint_source in ('gps', 'manual'):
                        user_info['location_hint_source'] = location_hint_source
                if collected_to_lab in ('yes', 'no'):
                    user_info['collected_to_lab'] = collected_to_lab
                if physical_flag in ('yes', 'no', 'no_flag'):
                    user_info['physical_flag'] = physical_flag
                if digital_flag_lat is not None and digital_flag_lon is not None:
                    user_info['digital_flag_lat'] = digital_flag_lat
                    user_info['digital_flag_lon'] = digital_flag_lon
                    if digital_flag_source in ('gps', 'manual'):
                        user_info['digital_flag_source'] = digital_flag_source

                # Pre-generate request_id so it can be returned immediately
                safe_name = os.path.basename(temp_path).replace(" ", "_")
                request_id = f"Req_{int(time.time() * 1000)}_{safe_name}_{uuid.uuid4().hex[:6]}"

                # Save extra files to disk now (must happen inside request context)
                files_with_types = _collect_extra_upload_files(request, request_id)

                # Run matching and packet creation in the background so the
                # community member is not blocked waiting for AI processing
                def _build_packet(img_path, u_info, req_id, fwt):
                    try:
                        manager_service.manager.create_review_packet(
                            img_path,
                            user_info=u_info,
                            req_id=req_id
                        )
                        if fwt:
                            manager_service.manager.add_additional_images_to_packet(req_id, fwt)
                            for item in fwt:
                                path = item.get('path')
                                if path and os.path.isfile(path):
                                    try:
                                        os.remove(path)
                                    except OSError:
                                        pass
                    except Exception as e:
                        err_trace = traceback.format_exc()
                        sys.stderr.write(f"[PACKET BUILD ERROR] req_id={req_id} {str(e)}\n{err_trace}")
                        sys.stderr.flush()
                    finally:
                        if os.path.isfile(img_path):
                            try:
                                os.remove(img_path)
                            except OSError:
                                pass

                threading.Thread(
                    target=_build_packet,
                    args=(temp_path, user_info, request_id, files_with_types),
                    daemon=True
                ).start()

                return jsonify({
                    'success': True,
                    'request_id': request_id,
                    'message': 'Photo uploaded successfully. Waiting for admin review.'
                })

        except Exception as e:
            error_trace = traceback.format_exc()
            sys.stderr.write(f"[UPLOAD 500] {str(e)}\n{error_trace}")
            sys.stderr.flush()
            return jsonify({
                'error': f'Processing failed: {str(e)}',
                'details': error_trace if app.debug else None
            }), 500