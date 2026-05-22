"""HEIC/HEIF → JPEG normalization and ingest resizing for uploaded images.

iPhone photos arrive as HEIC by default. We normalize to JPEG at every
upload boundary so downstream code (SuperPoint, frontend <img>) only sees
formats it can handle. EXIF is preserved so the history-date aggregation
keeps working on iPhone uploads.

``process_uploaded_image`` also downscales oversized files server-side when
clients bypass browser optimization (attack or old clients).
"""

import os

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from config import INGEST_MAX_DIMENSION, INGEST_MAX_FILE_BYTES

register_heif_opener()

HEIC_EXTENSIONS = ('.heic', '.heif')


def normalize_to_jpeg(src_path):
    """If ``src_path`` is HEIC/HEIF, convert to a sibling .jpg and delete the original.

    Returns the path downstream code should use — unchanged for non-HEIC inputs.
    Applies EXIF rotation and preserves EXIF metadata (including DateTimeOriginal).
    """
    if not src_path or os.path.splitext(src_path)[1].lower() not in HEIC_EXTENSIONS:
        return src_path
    dest = os.path.splitext(src_path)[0] + '.jpg'
    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        save_kwargs = {'quality': 95, 'optimize': True}
        # Only attach EXIF when present — Pillow's JPEG encoder chokes on None.
        exif_bytes = img.info.get('exif') or b''
        if exif_bytes:
            save_kwargs['exif'] = exif_bytes
        img.convert('RGB').save(dest, 'JPEG', **save_kwargs)
    os.remove(src_path)
    return dest


def _resize_ingest_if_needed(path):
    """Downscale or recompress when dimensions or bytes exceed ingest budgets."""
    if not path or not os.path.isfile(path):
        return path

    try:
        size_bytes = os.path.getsize(path)
    except OSError:
        return path

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        w, h = im.size
        needs_dim = max(w, h) > INGEST_MAX_DIMENSION
        needs_bytes = size_bytes > INGEST_MAX_FILE_BYTES
        if not needs_dim and not needs_bytes:
            return path

        if im.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', im.size, (255, 255, 255))
            if im.mode == 'RGBA':
                background.paste(im, mask=im.split()[3])
            else:
                background.paste(im, mask=im.split()[1])
            im = background
        elif im.mode != 'RGB':
            im = im.convert('RGB')

        if needs_dim:
            im.thumbnail((INGEST_MAX_DIMENSION, INGEST_MAX_DIMENSION), Image.Resampling.LANCZOS)

        dest = os.path.splitext(path)[0] + '.jpg'
        save_kwargs = {'quality': 88, 'optimize': True}
        exif_bytes = im.info.get('exif') or b''
        if exif_bytes:
            save_kwargs['exif'] = exif_bytes
        im.save(dest, 'JPEG', **save_kwargs)

    if dest != path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass
    return dest


def process_uploaded_image(src_path):
    """Normalize HEIC and enforce server-side size/dimension limits."""
    return _resize_ingest_if_needed(normalize_to_jpeg(src_path))
