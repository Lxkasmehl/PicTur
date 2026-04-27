"""
Review queue endpoints
"""

import os
import json
import time
import traceback
from flask import request, jsonify
from werkzeug.utils import secure_filename
from auth import require_admin
from services import manager_service
from services.manager_service import get_sheets_service, get_community_sheets_service
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from image_utils import normalize_to_jpeg
from general_locations_catalog import resolve_general_location_from_sheet_and_value
from additional_image_labels import normalize_label_list, parse_labels_from_form

def format_review_packet_item(packet_dir, request_id):
    """Build one queue item dict from packet_dir (used by get_review_queue and get_review_packet)."""
    metadata_path = os.path.join(packet_dir, 'metadata.json')
    metadata = {}
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)

    additional_images = []
    additional_dir = os.path.join(packet_dir, 'additional_images')

    def parse_manifest_or_folder(target_dir):
        results = []
        manifest_path = os.path.join(target_dir, 'manifest.json')
        processed_files = set()

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
                            row = {
                                'filename': fn,
                                'type': kind,
                                'timestamp': entry.get('timestamp'),
                                'image_path': p,
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
                    results.append({
                        'filename': f,
                        'type': 'other',
                        'labels': [],
                        'timestamp': None,
                        'image_path': os.path.join(target_dir, f),
                    })
        return results

    if os.path.isdir(additional_dir):
        additional_images.extend(parse_manifest_or_folder(additional_dir))
        for item in sorted(os.listdir(additional_dir)):
            item_path = os.path.join(additional_dir, item)
            if os.path.isdir(item_path):
                additional_images.extend(parse_manifest_or_folder(item_path))

    uploaded_image = None
    for f in os.listdir(packet_dir):
        if f.lower().endswith(('.jpg', '.png', '.jpeg')) and f != 'metadata.json' and not f.startswith('.'):
            uploaded_image = os.path.join(packet_dir, f)
            break

    candidates_dir = os.path.join(packet_dir, 'candidate_matches')
    failed_path = os.path.join(packet_dir, 'match_search_failed.json')
    match_search_failed = os.path.isfile(failed_path)
    match_search_error = None
    if match_search_failed:
        try:
            with open(failed_path, 'r', encoding='utf-8') as f:
                fail_data = json.load(f)
            if isinstance(fail_data, dict):
                err = (fail_data.get('error') or '').strip()
                match_search_error = err or None
        except (json.JSONDecodeError, OSError, TypeError):
            pass
        if match_search_error is None:
            match_search_error = 'Match search failed.'

    # Staff/admin /api/upload builds the packet synchronously before search. If search errors,
    # candidate_matches is never created; without a failure file (older uploads), the folder
    # is not "still matching" — classify as failed so the queue shows recovery actions.
    if (
        request_id.startswith('admin_')
        and not os.path.isdir(candidates_dir)
        and not match_search_failed
    ):
        match_search_failed = True
        match_search_error = (
            'Match search did not complete for this staff/admin upload. '
            'Try uploading again, or create a new turtle from this find.'
        )

    # candidate_matches is created after SuperPoint search succeeds in create_review_packet;
    # missing dir + no failure marker => matching still running (or legacy stuck community packet).
    match_search_pending = not os.path.isdir(candidates_dir) and not match_search_failed
    candidates = []
    if os.path.isdir(candidates_dir):
        for candidate_file in sorted(os.listdir(candidates_dir)):
            if candidate_file.lower().endswith(('.jpg', '.png', '.jpeg')):
                # Strip extension case-insensitively (.JPG was left on parts, breaking int() for Rank/Conf).
                root, ext = os.path.splitext(candidate_file)
                base_name = root if ext.lower() in ('.jpg', '.jpeg', '.png') else candidate_file
                parts = base_name.split('_')
                rank, turtle_id, confidence = 0, 'Unknown', 0
                for part in parts:
                    if part.startswith('Rank'):
                        rank = int(part.replace('Rank', ''))
                    elif part.startswith('ID'):
                        turtle_id = part.replace('ID', '')
                    elif part.startswith('Conf'):
                        confidence = int(part.replace('Conf', ''))
                    elif part.startswith('Score'):
                        confidence = 0
                candidates.append({'rank': rank, 'turtle_id': turtle_id, 'confidence': confidence, 'image_path': os.path.join(candidates_dir, candidate_file)})

    return {
        'request_id': request_id,
        'uploaded_image': uploaded_image,
        'metadata': metadata,
        'additional_images': additional_images,
        'candidates': sorted(candidates, key=lambda x: x['rank']),
        'match_search_pending': match_search_pending,
        'match_search_failed': match_search_failed,
        'match_search_error': match_search_error,
        'status': 'pending',
        'photo_type': metadata.get('photo_type', 'plastron'),
    }


def register_review_routes(app):
    """Register review queue routes"""
    
    @app.route('/api/review-queue', methods=['GET'])
    @require_admin
    def get_review_queue():
        """
        Get all pending review queue items (Admin only)
        Returns list of community uploads waiting for review
        """
        # Wait for manager to be ready (use module ref so we see current value after background init)
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        
        try:
            queue_items = manager_service.manager.get_review_queue()
            formatted_items = [format_review_packet_item(item['path'], item['request_id']) for item in queue_items]
            return jsonify({'success': True, 'items': formatted_items})
        
        except Exception as e:
            return jsonify({'error': f'Failed to load review queue: {str(e)}'}), 500

    @app.route('/api/review-queue/<request_id>/additional-images', methods=['POST'])
    @require_admin
    def add_review_packet_additional_images(request_id):
        """Add microhabitat/condition images to an existing review packet (Admin only)."""
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        files_with_types = []
        try:
            for key in list(request.files.keys()):
                if not key.startswith('file_'):
                    continue
                f = request.files[key]
                if not f or not f.filename:
                    continue
                idx = key.replace('file_', '')
                typ = request.form.get(f'type_{idx}', 'other').strip().lower()
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
                temp_path = os.path.join(UPLOAD_FOLDER, f"review_extra_{request_id}_{idx}_{int(time.time())}{ext}")
                f.save(temp_path)
                # HEIC/HEIF → JPEG (no-op for other formats)
                temp_path = normalize_to_jpeg(temp_path)
                item = {
                    'path': temp_path,
                    'type': typ,
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    'original_filename': os.path.basename(orig_safe) if orig_safe else f'upload{ext}',
                }
                if lbs:
                    item['labels'] = lbs
                files_with_types.append(item)
            if not files_with_types:
                return jsonify({'error': 'No valid image files provided'}), 400
            success, msg = manager_service.manager.add_additional_images_to_packet(request_id, files_with_types)
            for item in files_with_types:
                p = item.get('path')
                if p and os.path.isfile(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass
            if not success:
                return jsonify({'error': msg}), 400
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

    @app.route('/api/review-queue/<request_id>/additional-images', methods=['DELETE'])
    @require_admin
    def remove_review_packet_additional_image(request_id):
        """Remove one microhabitat/condition image from a packet (Admin only). Body: { "filename": "..." }."""
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        data = request.get_json(silent=True) or {}
        filename = (data.get('filename') or '').strip()
        if not filename:
            return jsonify({'error': 'filename required'}), 400
        success, err = manager_service.manager.remove_additional_image_from_packet(request_id, filename)
        if not success:
            return jsonify({'error': err or 'Failed to remove image'}), 400
        return jsonify({'success': True})

    @app.route('/api/review-queue/<request_id>', methods=['GET'])
    @require_admin
    def get_review_packet(request_id):
        """Get a single review packet by request_id (Admin only)."""
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        packet_dir = manager_service.manager._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir):
            return jsonify({'error': 'Request not found'}), 404
        item = format_review_packet_item(packet_dir, request_id)
        return jsonify({'success': True, 'item': item})

    @app.route('/api/review-queue/<request_id>/cross-check', methods=['POST'])
    @require_admin
    def cross_check_review_packet(request_id):
        """Run matching against a different photo_type cache as a cross-check (Admin only).

        Body: { "photo_type": "carapace", "image_path": "/path/to/carapace.jpg" (optional) }
        If image_path is provided, uses that image for matching (e.g. a carapace additional image).
        Otherwise uses the packet's main uploaded image.
        Does NOT update the packet's photo_type or candidates — purely diagnostic.
        Returns match results for comparison.
        """
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500

        data = request.get_json(silent=True) or {}
        photo_type = (data.get('photo_type') or '').strip().lower()
        if photo_type not in ('plastron', 'carapace'):
            return jsonify({'error': 'photo_type must be "plastron" or "carapace"'}), 400

        packet_dir = manager_service.manager._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir):
            return jsonify({'error': 'Request not found'}), 404

        # Use specified image_path if provided, otherwise fall back to packet's main image
        query_image = None
        specified_path = (data.get('image_path') or '').strip()
        if specified_path and os.path.isfile(specified_path):
            query_image = specified_path
        else:
            for fname in os.listdir(packet_dir):
                if fname.lower().endswith(('.jpg', '.png', '.jpeg')) and fname != 'metadata.json' and not fname.startswith('.'):
                    query_image = os.path.join(packet_dir, fname)
                    break
        if not query_image:
            return jsonify({'error': 'No image found for cross-check'}), 400

        try:
            results, elapsed = manager_service.manager.search_for_matches(query_image, photo_type=photo_type)
        except Exception as e:
            return jsonify({'error': f'Cross-check failed: {str(e)}'}), 500

        formatted = []
        for match in results:
            pt_path = match.get('file_path', '') or ''
            image_path = pt_path
            if pt_path.endswith('.pt'):
                base = pt_path[:-3]
                for ext in ['.jpg', '.jpeg', '.png']:
                    if os.path.exists(base + ext):
                        image_path = base + ext
                        break
            formatted.append({
                'turtle_id': match.get('site_id', 'Unknown'),
                'location': match.get('location', 'Unknown'),
                'confidence': float(match.get('confidence', 0.0)),
                'score': int(match.get('score', 0)),
                'image_path': image_path,
            })

        return jsonify({
            'success': True,
            'photo_type': photo_type,
            'matches': formatted,
            'elapsed': round(elapsed, 2),
        })

    @app.route('/api/review-queue/<request_id>/classify', methods=['POST'])
    @require_admin
    def classify_review_packet(request_id):
        """Set photo_type on a review packet and trigger AI matching (Admin only).

        Body: { "photo_type": "plastron" | "carapace" }
        Updates metadata.json, clears old candidates, runs matching against the chosen cache.
        """
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500

        data = request.get_json(silent=True) or {}
        photo_type = (data.get('photo_type') or '').strip().lower()
        if photo_type not in ('plastron', 'carapace'):
            return jsonify({'error': 'photo_type must be "plastron" or "carapace"'}), 400

        packet_dir = manager_service.manager._resolve_packet_dir(request_id)
        if not packet_dir or not os.path.isdir(packet_dir):
            return jsonify({'error': 'Request not found'}), 404

        # Update metadata with photo_type
        metadata_path = os.path.join(packet_dir, 'metadata.json')
        metadata = {}
        if os.path.isfile(metadata_path):
            try:
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
        metadata['photo_type'] = photo_type
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f)

        # Find the uploaded image in the packet
        query_image = None
        for fname in os.listdir(packet_dir):
            if fname.lower().endswith(('.jpg', '.png', '.jpeg')) and fname != 'metadata.json' and not fname.startswith('.'):
                query_image = os.path.join(packet_dir, fname)
                break

        if not query_image:
            return jsonify({'error': 'No uploaded image found in packet'}), 400

        # Clear old candidates
        import shutil
        candidates_dir = os.path.join(packet_dir, 'candidate_matches')
        if os.path.isdir(candidates_dir):
            shutil.rmtree(candidates_dir)
        os.makedirs(candidates_dir, exist_ok=True)

        # Run matching with the chosen photo_type
        try:
            results, _ = manager_service.manager.search_for_matches(query_image, photo_type=photo_type)
        except Exception as e:
            return jsonify({'error': f'Matching failed: {str(e)}'}), 500

        # Save candidate images to disk
        for rank, match in enumerate(results, start=1):
            pt_path = match.get('file_path', '') or ''
            if pt_path and pt_path.endswith('.pt'):
                base_path = pt_path[:-3]
                for ext in ['.jpg', '.jpeg', '.png']:
                    if os.path.exists(base_path + ext):
                        turtle_id = match.get('site_id', 'Unknown')
                        conf_int = int(round(match.get('confidence', 0.0) * 100))
                        cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                        shutil.copy2(base_path + ext, os.path.join(candidates_dir, cand_filename))
                        break

        # Return the updated packet
        item = format_review_packet_item(packet_dir, request_id)
        return jsonify({'success': True, 'item': item, 'matches_found': len(results)})

    @app.route('/api/flags', methods=['GET'])
    @require_admin
    def get_turtles_with_flags():
        """List turtles that have find_metadata (e.g. digital flag / collected to lab) for release page."""
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        try:
            items = manager_service.manager.get_turtles_with_flags()
            return jsonify({'success': True, 'items': items})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/flags/release', methods=['POST'])
    @require_admin
    def clear_release_flag():
        """Mark turtle as released back to nature: clear digital flag, set released_at (Admin only)."""
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500
        data = request.json or {}
        turtle_id = (data.get('turtle_id') or '').strip()
        location = (data.get('location') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400
        success, err = manager_service.manager.clear_release_flag(turtle_id, location)
        if not success:
            return jsonify({'error': err or 'Failed to clear release flag'}), 400
        return jsonify({'success': True})

    @app.route('/api/review/<request_id>', methods=['DELETE'])
    @require_admin
    def delete_review(request_id):
        """
        Delete a review queue item without processing (Admin only).
        Use for junk/spam. Requires confirmation in the frontend.
        """
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        try:
            success, message = manager_service.manager.reject_review_packet(request_id)
            if success:
                return jsonify({'success': True, 'message': message})
            return jsonify({'error': message}), 400
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/review/<request_id>/approve', methods=['POST'])
    @require_admin
    def approve_review(request_id):
        """
        Approve a review queue item (Admin only)
        Admin selects which of the 5 matches is the correct one, OR creates a new turtle
        """
        # Wait for manager to be ready
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500

        data = request.json or {}
        match_turtle_id = data.get('match_turtle_id')  # The turtle ID that was selected
        new_location = data.get('new_location')  # Optional: if creating new turtle (format: "State/Location")
        new_turtle_id = data.get('new_turtle_id')  # Optional: Turtle ID for new turtle (e.g., "T101")
        uploaded_image_path = data.get('uploaded_image_path')  # Optional: direct path for admin uploads
        sheets_data = data.get('sheets_data')  # Optional: Google Sheets data to create/update
        find_metadata = data.get('find_metadata')  # Optional: microhabitat_uploaded, physical_flag, digital_flag_*, etc.
        match_from_community = data.get('match_from_community') is True  # Admin re-found a community turtle
        community_sheet_name = (data.get('community_sheet_name') or '').strip() or None  # Community tab to remove from
        is_community_upload = not (request_id.startswith('admin_') if request_id else False)
        photo_type = (data.get('photo_type') or 'plastron').strip().lower()
        if photo_type not in ('plastron', 'carapace'):
            photo_type = 'plastron'
        replace_reference = data.get('replace_reference') is True
        replace_carapace_reference = data.get('replace_carapace_reference') is True

        # When moving turtle from community to admin, new admin path = sheet_name/general_location (e.g. Kansas/NT)
        new_admin_location = None
        if match_from_community and isinstance(sheets_data, dict) and sheets_data.get('sheet_name'):
            sheet_part = (sheets_data.get('sheet_name') or '').strip()
            provided_general_loc = (sheets_data.get('general_location') or '').strip()
            try:
                resolved_general_loc = resolve_general_location_from_sheet_and_value(
                    sheet_part,
                    provided_general_loc,
                    state=sheet_part,
                    allow_blank=False,
                )
            except ValueError as exc:
                return jsonify({'error': str(exc)}), 400
            if sheet_part and resolved_general_loc:
                new_admin_location = f"{sheet_part}/{resolved_general_loc}"
                sheets_data['general_location'] = resolved_general_loc
            if new_admin_location:
                print(f"📋 Community→Admin move: new_admin_location={new_admin_location!r}, community_sheet_name={community_sheet_name!r}")

        if new_location and new_turtle_id:
            parts = [p.strip() for p in str(new_location).split('/') if p.strip()]
            sheet_part = parts[0] if parts else ''
            if sheet_part:
                if is_community_upload and len(parts) == 1:
                    new_location = sheet_part
                else:
                    provided_general_loc = ''
                    if len(parts) > 1:
                        provided_general_loc = '/'.join(parts[1:]).strip()
                    elif isinstance(sheets_data, dict):
                        provided_general_loc = (sheets_data.get('general_location') or '').strip()
                    try:
                        resolved_general_loc = resolve_general_location_from_sheet_and_value(
                            sheet_part,
                            provided_general_loc,
                            state=sheet_part,
                            allow_blank=is_community_upload,
                        )
                    except ValueError as exc:
                        return jsonify({'error': str(exc)}), 400
                    new_location = f"{sheet_part}/{resolved_general_loc}" if resolved_general_loc else sheet_part
                    if isinstance(sheets_data, dict):
                        sheets_data['general_location'] = resolved_general_loc

        # For new turtle creation, defer packet deletion until Sheets sync succeeds.
        # This ensures the packet survives as a retry point if Sheets fails.
        is_new_turtle = bool(new_location and new_turtle_id and not match_turtle_id)

        # Prepend biology ID to folder name: Biology_ID_PrimaryKey (e.g. F001_K14)
        if is_new_turtle and isinstance(sheets_data, dict):
            bio_id = (sheets_data.get('id') or '').strip()
            if bio_id and new_turtle_id and not new_turtle_id.startswith(f"{bio_id}_"):
                new_turtle_id = f"{bio_id}_{new_turtle_id}"

        try:
            success, message = manager_service.manager.approve_review_packet(
                request_id,
                match_turtle_id=match_turtle_id,
                replace_reference=replace_reference,
                replace_carapace_reference=replace_carapace_reference,
                new_location=new_location,
                new_turtle_id=new_turtle_id,
                uploaded_image_path=uploaded_image_path,
                find_metadata=find_metadata,
                is_community_upload=is_community_upload,
                match_from_community=match_from_community,
                community_sheet_name=community_sheet_name,
                new_admin_location=new_admin_location,
                photo_type=photo_type,
                delete_packet=not is_new_turtle,
            )

            if success:
                # New turtle: create row in the correct spreadsheet (research vs community).
                # For new turtles, Sheets sync must succeed — otherwise roll back disk and keep packet.
                sheets_sync_error = None
                if is_new_turtle:
                    sheet_name = (isinstance(sheets_data, dict) and sheets_data.get('sheet_name')) or new_location
                    state = (isinstance(sheets_data, dict) and sheets_data.get('general_location')) or ''
                    location = (isinstance(sheets_data, dict) and sheets_data.get('location')) or ''

                    if is_community_upload:
                        comm = get_community_sheets_service()
                        if not comm:
                            sheets_sync_error = "Community spreadsheet not configured"
                        else:
                            try:
                                if isinstance(sheets_data, dict) and sheets_data.get('primary_id') and sheets_data.get('sheet_name'):
                                    primary_id = sheets_data.get('primary_id')
                                    print(f"✅ Community spreadsheet entry already created by frontend for new turtle {new_turtle_id} with Primary ID {primary_id}")
                                else:
                                    if isinstance(sheets_data, dict) and sheets_data.get('primary_id'):
                                        primary_id = sheets_data.get('primary_id')
                                    else:
                                        primary_id = comm.generate_primary_id(state, location)
                                    turtle_data = sheets_data.copy() if isinstance(sheets_data, dict) else {}
                                    turtle_data.pop('sheet_name', None)
                                    turtle_data['primary_id'] = primary_id
                                    if not turtle_data.get('id'):
                                        sex = (turtle_data.get('sex') or '').strip().upper()
                                        gender = sex if sex in ('M', 'F', 'J') else 'U'
                                        turtle_data['id'] = comm.generate_biology_id(gender, sheet_name)
                                    comm.create_sheet_with_headers(sheet_name)
                                    comm.create_turtle_data(turtle_data, sheet_name, state, location)
                                    print(f"✅ Created community spreadsheet entry for new turtle {new_turtle_id} with Primary ID {primary_id}")
                            except Exception as comm_err:
                                sheets_sync_error = f"Community Google Sheets sync failed: {comm_err}"
                    else:
                        service = get_sheets_service()
                        if not service:
                            sheets_sync_error = "Google Sheets not configured"
                        else:
                            try:
                                if isinstance(sheets_data, dict) and sheets_data.get('primary_id') and sheets_data.get('sheet_name'):
                                    primary_id = sheets_data.get('primary_id')
                                    print(f"✅ Google Sheets entry already created by frontend for new turtle {new_turtle_id} with Primary ID {primary_id}")
                                elif isinstance(sheets_data, dict) and sheets_data.get('sheet_name') and not sheets_data.get('primary_id'):
                                    print(f"⚠️ Frontend createTurtleSheetsData failed (no primary_id in sheets_data), creating in fallback mode")
                                    primary_id = service.generate_primary_id(state, location)
                                    turtle_data = sheets_data.copy()
                                    turtle_data.pop('sheet_name', None)
                                    turtle_data['primary_id'] = primary_id
                                    sheet_name = sheets_data.get('sheet_name', 'Location A')
                                    if not turtle_data.get('id'):
                                        sex = (turtle_data.get('sex') or '').strip().upper()
                                        gender = sex if sex in ('M', 'F', 'J') else 'U'
                                        turtle_data['id'] = service.generate_biology_id(gender, sheet_name)
                                    service.create_turtle_data(turtle_data, sheet_name, state, location)
                                    print(f"✅ Created Google Sheets entry for new turtle {new_turtle_id} with Primary ID {primary_id} (fallback)")
                                else:
                                    primary_id = service.generate_primary_id(state, location) if not (isinstance(sheets_data, dict) and sheets_data.get('primary_id')) else sheets_data.get('primary_id')
                                    turtle_data = sheets_data.copy() if isinstance(sheets_data, dict) else {}
                                    turtle_data.pop('sheet_name', None)
                                    turtle_data['primary_id'] = primary_id
                                    sheet_name = sheets_data.get('sheet_name', 'Location A') if isinstance(sheets_data, dict) else 'Location A'
                                    if not turtle_data.get('id'):
                                        sex = (turtle_data.get('sex') or '').strip().upper()
                                        gender = sex if sex in ('M', 'F', 'J') else 'U'
                                        turtle_data['id'] = service.generate_biology_id(gender, sheet_name)
                                    service.create_turtle_data(turtle_data, sheet_name, state, location)
                                    print(f"✅ Created Google Sheets entry for new turtle {new_turtle_id} with Primary ID {primary_id} (fallback)")
                            except Exception as sheets_error:
                                sheets_sync_error = f"Google Sheets sync failed: {sheets_error}"

                    # If Sheets sync failed, roll back the turtle from disk/VRAM and keep the packet
                    if sheets_sync_error:
                        print(f"❌ {sheets_sync_error} — rolling back new turtle {new_turtle_id}")
                        manager_service.manager.rollback_new_turtle(
                            new_turtle_id, new_location, photo_type=photo_type,
                        )
                        return jsonify({
                            'error': f'Upload could not be fully completed. {sheets_sync_error}. Please re-upload.'
                        }), 500

                    # Sheets sync succeeded — now safe to delete the packet
                    packet_dir = manager_service.manager._resolve_packet_dir(request_id)
                    if packet_dir:
                        manager_service.manager._delete_packet(packet_dir, request_id=request_id)

                # When admin matched a community turtle: remove that row from the community sheet (turtle moves to research only).
                # Admin/research matches do not write to the community spreadsheet — the two books stay separate.
                if match_turtle_id and match_from_community and community_sheet_name:
                    primary_id = (isinstance(sheets_data, dict) and sheets_data.get('primary_id')) or match_turtle_id
                    comm = get_community_sheets_service()
                    if comm:
                        try:
                            deleted = comm.delete_turtle_data(primary_id, community_sheet_name)
                            if deleted:
                                print(f"✅ Removed turtle {primary_id} from community sheet '{community_sheet_name}' (moved to admin).")
                            else:
                                print(f"⚠️ Could not remove turtle {primary_id} from community sheet '{community_sheet_name}' (row may not exist).")
                        except Exception as del_err:
                            print(f"⚠️ Warning: Failed to remove turtle from community sheet: {del_err}")

                return jsonify({
                    'success': True,
                    'message': message
                })
            else:
                return jsonify({'error': message}), 400

        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error approving review: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error approving review: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to approve review: {str(e)}'}), 500