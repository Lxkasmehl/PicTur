"""
Turtle data endpoints (e.g. list images for a turtle folder)
"""

import os
import json
import time
from flask import request, jsonify
from werkzeug.utils import secure_filename
from auth import require_admin
from config import UPLOAD_FOLDER, MAX_FILE_SIZE, allowed_file
from image_utils import normalize_to_jpeg
from services import manager_service


def register_turtle_routes(app):
    """Register turtle-related routes"""

    @app.route('/api/turtles/images', methods=['GET'])
    @require_admin
    def get_turtle_images():
        """
        Get image paths for a turtle: primary (ref_data), additional (microhabitat/condition), loose.
        Query: turtle_id (required), sheet_name (optional, for disambiguation).
        Returns: { primary: path | null, additional: [ { path, type } ], loose: [ path ] }
        """
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager not available'}), 500

        turtle_id = (request.args.get('turtle_id') or '').strip()
        sheet_name = (request.args.get('sheet_name') or '').strip() or None
        if not turtle_id:
            return jsonify({'error': 'turtle_id required'}), 400

        manager = manager_service.manager
        location_hint = sheet_name
        turtle_dir = manager._get_turtle_folder(turtle_id, location_hint)
        if not turtle_dir or not os.path.isdir(turtle_dir):
            return jsonify({
                'primary': None,
                'additional': [],
                'loose': [],
            })

        # --- PRIMARY IMAGE LOGIC ---
        primary_path = None
        ref_dir = os.path.join(turtle_dir, 'ref_data')
        if os.path.isdir(ref_dir):
            for f in sorted(os.listdir(ref_dir)):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    primary_path = os.path.join(ref_dir, f)
                    break

        # --- NEW ADDITIONAL IMAGES LOGIC ---
        additional = []
        additional_dir = os.path.join(turtle_dir, 'additional_images')

        # Helper function to parse a folder containing a manifest.json
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
                                results.append({
                                    'path': p,
                                    'type': kind,
                                    'timestamp': entry.get('timestamp'),
                                    'uploaded_by': entry.get('uploaded_by'),
                                })
                                processed_files.add(fn)
                except (json.JSONDecodeError, OSError):
                    pass

            # Fallback: Catch any images in the folder that aren't in the manifest
            if os.path.isdir(target_dir):
                for f in sorted(os.listdir(target_dir)):
                    if f != 'manifest.json' and f not in processed_files and f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                        results.append({
                            'path': os.path.join(target_dir, f),
                            'type': 'other',
                            'timestamp': None,
                            'uploaded_by': None,
                        })
            return results

        if os.path.isdir(additional_dir):
            # 1. Process root directory (Catches legacy flat-file uploads from before our update)
            additional.extend(parse_manifest_or_folder(additional_dir))

            # 2. Process our new Date-Stamped subfolders
            for item in sorted(os.listdir(additional_dir)):
                item_path = os.path.join(additional_dir, item)
                if os.path.isdir(item_path):
                    additional.extend(parse_manifest_or_folder(item_path))

        # --- LOOSE IMAGES LOGIC ---
        loose = []
        loose_dir = os.path.join(turtle_dir, 'loose_images')
        if os.path.isdir(loose_dir):
            for f in sorted(os.listdir(loose_dir)):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                    loose.append(os.path.join(loose_dir, f))

        return jsonify({
            'primary': primary_path,
            'additional': additional,
            'loose': loose,
        })

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
            if not tid:
                results.append({'turtle_id': tid, 'sheet_name': sheet, 'primary': None})
                continue
            turtle_dir = manager._get_turtle_folder(tid, sheet)
            primary_path = None
            if turtle_dir and os.path.isdir(turtle_dir):
                ref_dir = os.path.join(turtle_dir, 'ref_data')
                if os.path.isdir(ref_dir):
                    for f in sorted(os.listdir(ref_dir)):
                        if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                            primary_path = os.path.join(ref_dir, f)
                            break
            results.append({'turtle_id': tid, 'sheet_name': sheet, 'primary': primary_path})
        return jsonify({'images': results})

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
        Form: file_0, type_0, file_1, type_1, ... (type: microhabitat | condition | other), optional sheet_name.
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
                if typ not in ('microhabitat', 'condition', 'other'):
                    typ = 'other'
                if not allowed_file(f.filename):
                    continue
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(0)
                if size > MAX_FILE_SIZE:
                    continue
                ext = os.path.splitext(secure_filename(f.filename))[1] or '.jpg'
                temp_path = os.path.join(
                    UPLOAD_FOLDER,
                    f"turtle_extra_{turtle_id}_{idx}_{int(time.time())}{ext}".replace(os.sep, '_'),
                )
                f.save(temp_path)
                # HEIC/HEIF → JPEG (no-op for other formats)
                temp_path = normalize_to_jpeg(temp_path)
                files_with_types.append({
                    'path': temp_path,
                    'type': typ,
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                })
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