"""Shared parsing for admin multipart additional-image uploads (file_N / type_N / labels_N)."""

import os
import time
from typing import Callable

from werkzeug.utils import secure_filename

from additional_image_labels import normalize_additional_type, parse_labels_from_form
from config import MAX_FILE_SIZE, allowed_file
from image_utils import UploadImageError
from upload_validation import ingest_saved_upload, log_upload_rejection

INVALID_EXTENSION_MSG = 'Invalid file type. Allowed: JPEG, PNG, GIF, WEBP, HEIC.'
FILE_TOO_LARGE_MSG = 'File too large (max 8MB after optimization).'


def _append_rejection(rejections, *, context, filename, code, message):
    rejections.append({'filename': filename, 'code': code, 'error': message})
    log_upload_rejection(
        context=context, path=None, code=code, message=message, filename=filename,
    )


def collect_indexed_additional_uploads(
    request,
    *,
    context: str,
    temp_path_for_index: Callable[[str, str], str],
):
    """Parse ``file_N`` / ``type_N`` / ``labels_N`` from a multipart form.

    ``temp_path_for_index(idx, ext)`` returns the path where the raw upload is saved.
    Returns ``(files_with_types, rejections)``.
    """
    files_with_types = []
    rejections = []
    for key in list(request.files.keys()):
        if not key.startswith('file_'):
            continue
        f = request.files[key]
        if not f or not f.filename:
            continue
        idx = key.replace('file_', '')
        typ = normalize_additional_type(request.form.get(f'type_{idx}'))
        lbs = parse_labels_from_form(request.form, idx)
        if not allowed_file(f.filename):
            _append_rejection(
                rejections,
                context=context,
                filename=f.filename,
                code='invalid_extension',
                message=INVALID_EXTENSION_MSG,
            )
            continue
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
        if size > MAX_FILE_SIZE:
            _append_rejection(
                rejections,
                context=context,
                filename=f.filename,
                code='file_too_large',
                message=FILE_TOO_LARGE_MSG,
            )
            continue
        orig_safe = secure_filename(f.filename) or ''
        ext = os.path.splitext(orig_safe)[1] or '.jpg'
        temp_path = temp_path_for_index(idx, ext)
        f.save(temp_path)
        try:
            temp_path = ingest_saved_upload(
                temp_path, context=context, filename=f.filename,
            )
        except UploadImageError as img_err:
            rejections.append({
                'filename': f.filename,
                'code': img_err.code,
                'error': img_err.message,
            })
            if os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            continue
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
    return files_with_types, rejections


def cleanup_temp_upload_paths(items):
    """Remove temp ingest paths after manager has copied files into place."""
    for item in items:
        p = item.get('path')
        if p and os.path.isfile(p):
            try:
                os.remove(p)
            except OSError:
                pass


def no_valid_files_json(rejections):
    """JSON body for a batch where every file was rejected."""
    primary = rejections[0] if rejections else None
    return {
        'error': primary['error'] if primary else 'No valid image files provided',
        'code': primary['code'] if primary else 'no_valid_files',
        'rejections': rejections,
    }


def additional_upload_success_json(files_with_types, rejections):
    """JSON body for a batch where at least one file was accepted."""
    body = {'success': True, 'message': f'Added {len(files_with_types)} image(s).'}
    if rejections:
        body['rejections'] = rejections
    return body
