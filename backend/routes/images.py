"""
Image serving endpoint
"""

import os
from io import BytesIO

import image_utils  # noqa: F401 — registers HEIF opener for Pillow
from flask import request, jsonify, send_file
from PIL import Image, ImageOps
from services import manager_service
from config import UPLOAD_FOLDER


def _thumbnail_jpeg_bytes(full_path: str, max_dim: int):
    """Resize so longest edge is at most ``max_dim``; return JPEG bytes or ``None`` if no resize needed."""
    with Image.open(full_path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', im.size, (255, 255, 255))
            if im.mode == 'RGBA':
                background.paste(im, mask=im.split()[3])
            else:
                background.paste(im, mask=im.split()[1])
            im = background
        elif im.mode == 'P':
            if 'transparency' in im.info:
                im = im.convert('RGBA')
                background = Image.new('RGB', im.size, (255, 255, 255))
                background.paste(im, mask=im.split()[3])
                im = background
            else:
                im = im.convert('RGB')
        elif im.mode != 'RGB':
            im = im.convert('RGB')

        w, h = im.size
        if max(w, h) <= max_dim:
            return None

        im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        buf = BytesIO()
        im.save(buf, format='JPEG', quality=85, optimize=True)
        buf.seek(0)
        return buf


def register_image_routes(app):
    """Register image serving routes"""
    
    @app.route('/api/images', methods=['GET'])
    def serve_image():
        """
        Serve images from the file system
        Used to display uploaded images and matches in the frontend
        Query parameter: path=<encoded_image_path>
        Optional: max_dim=<int> (32–2048) — longest edge in pixels; returns a JPEG preview.
        Omits resize when the original is already smaller than max_dim.
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

        max_dim_raw = request.args.get('max_dim', type=int)
        if max_dim_raw is not None:
            max_dim = max(32, min(2048, max_dim_raw))
            lower = full_path.lower()
            if lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif')):
                try:
                    thumb = _thumbnail_jpeg_bytes(full_path, max_dim)
                    if thumb is not None:
                        return send_file(thumb, mimetype='image/jpeg')
                except Exception:
                    pass

        return send_file(full_path)
