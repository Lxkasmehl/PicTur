"""
Photo upload endpoint
"""

import os
import shutil
import json
import time
import traceback
from flask import request, jsonify
from werkzeug.utils import secure_filename
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from auth import optional_auth, check_auth_revocation
from services import manager_service


def convert_npz_to_image_path(npz_path):
    """
    Convert a .npz file path to the corresponding image file path.
    Tries common image extensions (.jpg, .jpeg, .png).
    Returns the image path if found, otherwise returns the original npz_path.
    """
    if not npz_path or not npz_path.endswith('.npz'):
        return npz_path
    
    # Try to find the corresponding image file
    base_path = npz_path[:-4]  # Remove .npz extension
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    
    for ext in image_extensions:
        image_path = base_path + ext
        if os.path.exists(image_path) and os.path.isfile(image_path):
            return image_path
    
    # If no image found, return original (might be an error case)
    return npz_path


def register_upload_routes(app):
    """Register upload routes"""
    
    @app.route('/api/upload', methods=['POST'])
    @optional_auth
    def upload_photo():
        """
        Upload photo endpoint
        - Admin: Process immediately and return top 5 matches
        - Community/Anonymous: Save to review queue with top 5 matches
        
        Authentication is optional. If no token is provided, upload is treated as anonymous.
        """
        # Wait for manager to be ready (with timeout); use module ref so we see current value after background init
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing. Please try again in a moment.'}), 503

        if manager_service.manager is None:
            try:
                print("[UPLOAD] 503: TurtleManager failed to initialize (service unavailable)", flush=True)
            except Exception:
                pass
            return jsonify({
                'error': 'TurtleManager is not ready. The server may still be starting or initialization failed. Please try again in a moment.'
            }), 503

        try:
            if app.debug:
                try:
                    print("[UPLOAD] Request received", flush=True)
                except Exception:
                    pass
            if 'file' not in request.files:
                return jsonify({'error': 'No file provided'}), 400
            
            # Get user data from verified JWT token (if provided)
            user_data = getattr(request, 'user', None)
            if user_data and isinstance(user_data, dict):
                user_role = user_data.get('role', 'community')
                user_email = user_data.get('email', 'anonymous')
            else:
                # Anonymous upload
                user_role = 'community'
                user_email = 'anonymous'
            
            file = request.files['file']
            state = request.form.get('state', '')  # Optional: State where turtle was found
            location = request.form.get('location', '')  # Optional: Specific location
            # Optional: GPS/manual coordinates as hint only (never stored in sheets)
            location_hint_lat = request.form.get('location_hint_lat', type=float)
            location_hint_lon = request.form.get('location_hint_lon', type=float)
            location_hint_source = request.form.get('location_hint_source', '')  # 'gps' or 'manual'
            # Optional: collected to lab / physical flag / digital flag (reminder + storage for release)
            collected_to_lab = request.form.get('collected_to_lab', '').strip().lower()  # 'yes' | 'no'
            physical_flag = request.form.get('physical_flag', '').strip().lower()  # 'yes' | 'no' | 'no_flag'
            digital_flag_lat = request.form.get('digital_flag_lat', type=float)
            digital_flag_lon = request.form.get('digital_flag_lon', type=float)
            digital_flag_source = request.form.get('digital_flag_source', '').strip().lower()  # 'gps' | 'manual'
            
            if file.filename == '':
                return jsonify({'error': 'No file selected'}), 400
            
            if not allowed_file(file.filename):
                return jsonify({'error': 'Invalid file type'}), 400
            
            # Check file size
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            
            if file_size > MAX_FILE_SIZE:
                return jsonify({'error': 'File too large (max 5MB)'}), 400
            
            # Save file temporarily
            filename = secure_filename(file.filename)
            temp_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(temp_path)
            
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
                # Admin: create a packet (so we can add additional images on match page) then run search
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
                # Optional: additional images (microhabitat, condition) uploaded with admin photo
                files_with_types = []
                for key in list(request.files.keys()):
                    if key.startswith('extra_') and key != 'file':
                        rest = key.replace('extra_', '', 1).strip().lower()
                        if rest.startswith('microhabitat'):
                            typ = 'microhabitat'
                        elif rest.startswith('condition'):
                            typ = 'condition'
                        else:
                            typ = 'other'
                        f = request.files[key]
                        if f and f.filename and allowed_file(f.filename):
                            f.seek(0, os.SEEK_END)
                            size = f.tell()
                            f.seek(0)
                            if size <= MAX_FILE_SIZE:
                                ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
                                extra_temp = os.path.join(UPLOAD_FOLDER, f"extra_{request_id}_{typ}_{int(time.time())}{ext}")
                                f.save(extra_temp)
                                files_with_types.append({'path': extra_temp, 'type': typ, 'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
                if files_with_types:
                    manager_service.manager.add_additional_images_to_packet(request_id, files_with_types)
                    for item in files_with_types:
                        path = item.get('path')
                        if path and os.path.isfile(path):
                            try:
                                os.remove(path)
                            except OSError:
                                pass
                match_sheet = (request.form.get('match_sheet') or '').strip() or None
                matches = manager_service.manager.search_for_matches(query_save_path, sheet_name=match_sheet)
                if matches is None:
                    matches = []
                formatted_matches = []
                for match in matches:
                    npz_path = match.get('file_path', '') or ''
                    image_path = convert_npz_to_image_path(npz_path)
                    # Coerce distance to float (may be numpy scalar from faiss)
                    try:
                        dist_val = float(match.get('distance', 0))
                    except (TypeError, ValueError):
                        dist_val = 0.0
                    formatted_matches.append({
                        'turtle_id': match.get('site_id', 'Unknown') or 'Unknown',
                        'location': match.get('location', 'Unknown') or 'Unknown',
                        'distance': dist_val,
                        'file_path': image_path,
                        'filename': match.get('filename', '') or ''
                    })
                if len(formatted_matches) > 0:
                    message = f'Photo processed successfully. {len(formatted_matches)} matches found.'
                else:
                    message = 'Photo processed successfully. No matches found. You can create a new turtle.'
                return jsonify({
                    'success': True,
                    'request_id': request_id,
                    'matches': formatted_matches,
                    'uploaded_image_path': query_save_path,
                    'message': message
                })
            
            else:
                # Community or Anonymous: Save to review queue
                if user_email == 'anonymous':
                    finder_name = 'Anonymous User'
                else:
                    finder_name = user_email.split('@')[0] if '@' in user_email else 'anonymous'
                
                user_info = {
                    'finder': finder_name,
                    'email': user_email,
                    'uploaded_at': time.time()
                }
                # Add location data if provided
                if state and location:
                    user_info['state'] = state
                    user_info['location'] = location
                # Add location hint (coords) if provided – hint only, never stored in sheets
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

                request_id = manager_service.manager.create_review_packet(
                    temp_path,
                    user_info=user_info
                )

                # Optional: additional images (microhabitat, condition) uploaded in same request (multiple per type)
                files_with_types = []
                for key in list(request.files.keys()):
                    if key.startswith('extra_') and key != 'file':
                        rest = key.replace('extra_', '', 1).strip().lower()
                        if rest.startswith('microhabitat'):
                            typ = 'microhabitat'
                        elif rest.startswith('condition'):
                            typ = 'condition'
                        else:
                            typ = 'other'
                        f = request.files[key]
                        if f and f.filename:
                            ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
                            extra_temp = os.path.join(UPLOAD_FOLDER, f"extra_{request_id}_{typ}_{int(time.time())}{ext}")
                            f.save(extra_temp)
                            files_with_types.append({'path': extra_temp, 'type': typ, 'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
                if files_with_types:
                    manager_service.manager.add_additional_images_to_packet(request_id, files_with_types)
                    for item in files_with_types:
                        path = item.get('path')
                        if path and os.path.isfile(path):
                            try:
                                os.remove(path)
                            except OSError:
                                pass
                
                return jsonify({
                    'success': True,
                    'request_id': request_id,
                    'message': 'Photo uploaded successfully. Waiting for admin review.'
                })
        
        except Exception as e:
            error_trace = traceback.format_exc()
            err_msg = str(e)
            import sys
            # Log so it's visible in the terminal (stdout and stderr)
            prefix = "[UPLOAD 500]"
            sys.stderr.write(f"{prefix} {err_msg}\n")
            sys.stderr.write(error_trace)
            sys.stderr.flush()
            try:
                print(f"{prefix} {err_msg}", flush=True)
                print(error_trace, flush=True)
            except Exception:
                pass
            return jsonify({
                'error': f'Processing failed: {err_msg}',
                'details': error_trace if app.debug else None
            }), 500
        
        finally:
            # Keep temp file for now (will be cleaned up later)
            pass
