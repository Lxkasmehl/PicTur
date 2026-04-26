"""HEIC/HEIF → JPEG normalization for uploaded images.

iPhone photos arrive as HEIC by default. We normalize to JPEG at every
upload boundary so downstream code (SuperPoint, frontend <img>) only sees
formats it can handle. EXIF is preserved so the history-date aggregation
keeps working on iPhone uploads.
"""

import os

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

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
