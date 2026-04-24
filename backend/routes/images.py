"""
Image serving endpoint
"""

import os
from flask import request, jsonify, send_file
from services import manager_service
from config import UPLOAD_FOLDER


def register_image_routes(app):
    """Register image serving routes"""
    
    @app.route('/api/images', methods=['GET'])
    def serve_image():
        """
        Serve images from the file system
        Used to display uploaded images and matches in the frontend
        Query parameter: path=<encoded_image_path>
        """
        image_path = request.args.get('path')
        if not image_path:
            return jsonify({'error': 'No path provided'}), 400
        
        # Decode the path
        try:
            from urllib.parse import unquote
            decoded_path = unquote(image_path)
        except:
            decoded_path = image_path
        
        # Security: Only serve images from allowed directories
        safe_path = os.path.normpath(decoded_path)
        
        # Check if path is within data directory or temp directory
        # Wait for manager to be ready (use module ref so we see current value after background init)
        if not manager_service.manager_ready.wait(timeout=5):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        
        data_dir = os.path.abspath(os.path.normpath(manager_service.manager.base_dir))
        temp_dir = os.path.abspath(os.path.normpath(UPLOAD_FOLDER))
        
        def is_path_within_base(file_path, base_dir):
            """
            Safely check if file_path is within base_dir using os.path.commonpath.
            This prevents path traversal attacks that startswith() would allow.
            """
            try:
                file_abs = os.path.abspath(os.path.normpath(file_path))
                base_abs = os.path.abspath(os.path.normpath(base_dir))
                # Get the common path and verify it equals the base directory
                common = os.path.commonpath([file_abs, base_abs])
                return common == base_abs
            except (ValueError, OSError):
                # ValueError can occur if paths are on different drives (Windows)
                # OSError can occur for invalid paths
                return False
        
        full_path = None
        # Check if path is absolute and within allowed directories
        if os.path.isabs(safe_path):
            if is_path_within_base(safe_path, data_dir) or is_path_within_base(safe_path, temp_dir):
                if os.path.exists(safe_path) and os.path.isfile(safe_path):
                    full_path = safe_path
        else:
            # Relative path - try to resolve it
            for base_dir in [data_dir, temp_dir]:
                potential_path = os.path.normpath(os.path.join(base_dir, safe_path))
                if os.path.exists(potential_path) and os.path.isfile(potential_path):
                    # Verify it's still within the base directory using safe check
                    if is_path_within_base(potential_path, base_dir):
                        full_path = potential_path
                        break
        
        if not full_path or not os.path.exists(full_path):
            return jsonify({'error': 'Image not found'}), 404

        # ?download=1 forces the browser to save rather than render inline.
        # Filename in Content-Disposition is the file's basename on disk.
        download_flag = (request.args.get('download') or '').strip().lower()
        as_attachment = download_flag in ('1', 'true', 'yes')
        if as_attachment:
            return send_file(full_path, as_attachment=True, download_name=os.path.basename(full_path))
        return send_file(full_path)
