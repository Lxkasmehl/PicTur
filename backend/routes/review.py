"""
Review queue endpoints
"""

import json
import os
import time
import traceback
from typing import Optional, Tuple

from flask import request, jsonify
from werkzeug.utils import secure_filename
from auth import require_admin
from services import manager_service
from services.manager_service import get_sheets_service, get_community_sheets_service
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from image_utils import UploadImageError
from upload_rate_limit import upload_rate_limit_ok, upload_rate_limit_response
from upload_validation import ingest_saved_upload
from turtle_manager import canonical_new_turtle_folder_id  # re-exported for callers/tests
from routes.upload import find_image_for_pt  # case-insensitive .pt→image sibling lookup
from general_locations_catalog import (
    get_sheet_default,
    resolve_general_location_from_sheet_and_value,
)
from additional_image_upload import (
    additional_upload_success_json,
    cleanup_temp_upload_paths,
    collect_indexed_additional_uploads,
    no_valid_files_json,
)
from review_packet_format import format_review_packet_item

__all__ = ['format_review_packet_item', 'normalize_new_turtle_location_for_disk', 'canonical_new_turtle_folder_id']


def normalize_new_turtle_location_for_disk(
    new_location: str,
    sheets_data,
    *,
    is_community_upload: bool,
) -> Tuple[str, Optional[str]]:
    """Return ``(normalized_new_location, resolved_general_location)``.

    For research turtles, when ``sheets_data['sheet_name']`` is present it is
    authoritative for resolving disk paths. This prevents the first segment of
    ``new_location`` (often a *General Location* value like ``CPBS``) from being
    mistaken for the spreadsheet tab name, which used to create ``data/CPBS/…``
    instead of ``data/NebraskaCPBS/CPBS/…``.
    """
    parts = [p.strip() for p in str(new_location or '').split('/') if p.strip()]
    if not parts:
        return (str(new_location or ''), '')

    if is_community_upload and len(parts) == 1:
        # Single-segment community path stays ``Community_Uploads/<tab>``; do not
        # rewrite ``sheets_data['general_location']`` from this tuple.
        return (parts[0], None)

    sheet_part = parts[0]
    if not sheet_part:
        return (str(new_location or ''), '')

    auth_sheet = (isinstance(sheets_data, dict) and (sheets_data.get('sheet_name') or '').strip()) or ''
    if auth_sheet and not is_community_upload:
        provided_general_loc = (sheets_data.get('general_location') or '').strip() if isinstance(sheets_data, dict) else ''
        sheet_default = get_sheet_default(auth_sheet)
        if sheet_default:
            gl = sheet_default['general_location']
            if parts and parts[0].lower() == gl.lower() and parts[0].lower() != auth_sheet.lower():
                # Client sent ``CPBS/<extra>`` but the real tab is e.g. NebraskaCPBS — never
                # treat trap-site names under a mistaken top-level ``CPBS`` folder.
                provided_general_loc = gl
        if not provided_general_loc and parts:
            if len(parts) > 1 and parts[0].lower() == auth_sheet.lower():
                provided_general_loc = '/'.join(parts[1:]).strip()
        try:
            resolved_general_loc = resolve_general_location_from_sheet_and_value(
                auth_sheet,
                provided_general_loc,
                state=auth_sheet,
                allow_blank=is_community_upload,
            )
        except ValueError:
            raise
        out = f"{auth_sheet}/{resolved_general_loc}" if resolved_general_loc else auth_sheet
        return (out, resolved_general_loc)

    provided_general_loc = ''
    if len(parts) > 1:
        provided_general_loc = '/'.join(parts[1:]).strip()
    elif isinstance(sheets_data, dict):
        provided_general_loc = (sheets_data.get('general_location') or '').strip()
    resolved_general_loc = resolve_general_location_from_sheet_and_value(
        sheet_part,
        provided_general_loc,
        state=sheet_part,
        allow_blank=is_community_upload,
    )
    out = f"{sheet_part}/{resolved_general_loc}" if resolved_general_loc else sheet_part
    return (out, resolved_general_loc)


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
        """Add additional images to an existing review packet (Admin only)."""
        if not upload_rate_limit_ok(request, 'admin'):
            return upload_rate_limit_response()
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing.'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        files_with_types = []
        try:
            files_with_types, rejections = collect_indexed_additional_uploads(
                request,
                context='review/additional',
                temp_path_for_index=lambda idx, ext: os.path.join(
                    UPLOAD_FOLDER, f"review_extra_{request_id}_{idx}_{int(time.time())}{ext}",
                ),
            )
            if not files_with_types:
                return jsonify(no_valid_files_json(rejections)), 400
            success, msg = manager_service.manager.add_additional_images_to_packet(request_id, files_with_types)
            cleanup_temp_upload_paths(files_with_types)
            if not success:
                return jsonify({'error': msg}), 400
            return jsonify(additional_upload_success_json(files_with_types, rejections))
        except Exception as e:
            cleanup_temp_upload_paths(files_with_types)
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

        # Re-use the location scope the admin chose at upload time so the cross-check
        # searches the same set of turtles as the original plastron match instead of
        # the entire VRAM cache. Falls back to no filter for legacy packets that
        # predate persisting match_sheet in metadata.json.
        location_filter = None
        metadata_path = os.path.join(packet_dir, 'metadata.json')
        if os.path.isfile(metadata_path):
            try:
                with open(metadata_path, 'r') as mf:
                    packet_metadata = json.load(mf)
                location_filter = (packet_metadata.get('match_sheet') or '').strip() or None
            except (json.JSONDecodeError, OSError):
                pass

        try:
            # Cross-check disables the "expand to all locations when < 5 matches"
            # fallback that the regular match flow uses. Cross-check is diagnostic
            # — if the carapace finds nothing in the plastron's scope, that's the
            # answer (plastron and carapace disagree on location). Padding the
            # result list with distant turtles would mislead the admin, and
            # running the full-cache fallback against ~700+ candidates was the
            # source of the minute-long cross-check turnaround when a small
            # location had few above-threshold carapaces.
            results, elapsed = manager_service.manager.search_for_matches(
                query_image,
                location_filter=location_filter,
                photo_type=photo_type,
                expand_to_all_when_short=False,
            )
        except Exception as e:
            return jsonify({'error': f'Cross-check failed: {str(e)}'}), 500

        formatted = []
        for match in results:
            pt_path = match.get('file_path', '') or ''
            # Resolve .pt → sibling image case-insensitively (Linux prod is
            # case-sensitive; carapace refs are often .JPG). Returns pt_path
            # unchanged when no sibling image is found.
            image_path = find_image_for_pt(pt_path)
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
            # Case-insensitive sibling lookup (handles .JPG/.JPEG/.PNG on Linux).
            src_img = find_image_for_pt(pt_path)
            if src_img != pt_path and os.path.exists(src_img):
                ext = os.path.splitext(src_img)[1]
                turtle_id = match.get('site_id', 'Unknown')
                conf_int = int(round(match.get('confidence', 0.0) * 100))
                cand_filename = f"Rank{rank}_ID{turtle_id}_Conf{conf_int}{ext}"
                shutil.copy2(src_img, os.path.join(candidates_dir, cand_filename))

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
            try:
                new_location, resolved_for_sheet = normalize_new_turtle_location_for_disk(
                    new_location,
                    sheets_data,
                    is_community_upload=is_community_upload,
                )
            except ValueError as exc:
                return jsonify({'error': str(exc)}), 400
            if isinstance(sheets_data, dict) and resolved_for_sheet is not None:
                sheets_data['general_location'] = resolved_for_sheet

        # For new turtle creation, defer packet deletion until Sheets sync succeeds.
        # This ensures the packet survives as a retry point if Sheets fails.
        is_new_turtle = bool(new_location and new_turtle_id and not match_turtle_id)

        # Resolve BOTH the biology id and the primary id up front so the on-disk
        # folder is born canonical (<bio_id>_<primary_id>). The Sheets sync below
        # would otherwise finalize primary_id AFTER the folder is created, leaving
        # it bare -- and bare <bio_id> folders collide across sheets. generate_*
        # are read-only next-id lookups; the actual Sheets write still happens
        # after disk success. canonical_primary_id is reused by the Sheets-sync
        # block so the folder name and the sheet row carry the same primary id.
        canonical_primary_id = None
        if is_new_turtle:
            sd = sheets_data if isinstance(sheets_data, dict) else {}
            bio_id = (sd.get('id') or '').strip()
            canonical_primary_id = (sd.get('primary_id') or '').strip() or None
            id_sheet = (sd.get('sheet_name') or '').strip() or (new_location or '')
            id_state = (sd.get('general_location') or '').strip()
            id_location = (sd.get('location') or '').strip()
            try:
                id_service = (
                    get_community_sheets_service() if is_community_upload
                    else get_sheets_service()
                )
            except Exception as svc_err:
                print(f"⚠️ Could not load Sheets service for id pre-resolution: {svc_err}")
                id_service = None
            if id_service:
                if not canonical_primary_id:
                    try:
                        canonical_primary_id = id_service.generate_primary_id(id_state, id_location)
                    except Exception as id_err:
                        print(f"⚠️ Could not pre-generate primary_id for new turtle: {id_err}")
                if not bio_id and id_sheet:
                    try:
                        sex = (sd.get('sex') or '').strip().upper()
                        gender = sex if sex in ('M', 'F', 'J') else 'U'
                        bio_id = id_service.generate_biology_id(gender, id_sheet)
                        if isinstance(sheets_data, dict):
                            sheets_data['id'] = bio_id
                    except Exception as id_err:
                        print(f"⚠️ Could not pre-generate biology id for new turtle: {id_err}")
            new_turtle_id = canonical_new_turtle_folder_id(bio_id, canonical_primary_id, new_turtle_id)

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
                                        primary_id = canonical_primary_id or comm.generate_primary_id(state, location)
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
                                    primary_id = canonical_primary_id or service.generate_primary_id(state, location)
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
                                    primary_id = canonical_primary_id or service.generate_primary_id(state, location)
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