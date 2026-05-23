"""HEIC/HEIF → JPEG normalization and ingest resizing for uploaded images.

iPhone photos arrive as HEIC by default. We normalize to JPEG at every
upload boundary so downstream code (SuperPoint, frontend <img>) only sees
formats it can handle. EXIF is preserved when safe so history-date
aggregation keeps working on iPhone uploads.

``process_uploaded_image`` also downscales oversized files server-side when
clients bypass browser optimization (attack or old clients), and attempts
repair for Word/email exports with broken metadata or truncated chunks.
"""

import logging
import os

from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from config import INGEST_MAX_DIMENSION, INGEST_MAX_FILE_BYTES

register_heif_opener()

logger = logging.getLogger(__name__)

# Allow Pillow to recover slightly truncated PNG/JPEG from email clients.
ImageFile.LOAD_TRUNCATED_IMAGES = True

HEIC_EXTENSIONS = ('.heic', '.heif')

_MAGIC = {
    'jpeg': (b'\xff\xd8\xff',),
    'png': (b'\x89PNG\r\n\x1a\n',),
    'gif': (b'GIF87a', b'GIF89a'),
    'webp': (b'RIFF',),  # followed by WEBP at offset 8
    'heic': (b'\x00\x00\x00',),  # ftyp box — checked separately
}


class UploadImageError(Exception):
    """Raised when an upload cannot be normalized for ingest."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def detect_image_format(path: str) -> str | None:
    """Best-effort format from magic bytes (not extension)."""
    try:
        with open(path, 'rb') as f:
            head = f.read(32)
    except OSError:
        return None
    if not head:
        return None
    if head.startswith(_MAGIC['jpeg']):
        return 'jpeg'
    if head.startswith(_MAGIC['png']):
        return 'png'
    if head[:6] in _MAGIC['gif']:
        return 'gif'
    if len(head) >= 12 and head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    if b'ftyp' in head[:32]:
        lower = head.lower()
        if b'heic' in lower or b'heif' in lower or b'mif1' in lower:
            return 'heic'
    return None


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
        exif_bytes = img.info.get('exif') or b''
        if exif_bytes:
            save_kwargs['exif'] = exif_bytes
        img.convert('RGB').save(dest, 'JPEG', **save_kwargs)
    os.remove(src_path)
    return dest


def _to_rgb(im: Image.Image) -> Image.Image:
    if im.mode in ('RGBA', 'LA'):
        background = Image.new('RGB', im.size, (255, 255, 255))
        if im.mode == 'RGBA':
            background.paste(im, mask=im.split()[3])
        else:
            background.paste(im, mask=im.split()[1])
        return background
    if im.mode != 'RGB':
        return im.convert('RGB')
    return im


def _save_ingest_jpeg(im: Image.Image, path: str, *, quality: int = 88) -> str:
    """Write RGB image to ``path`` (or sibling .jpg), optionally keeping safe EXIF."""
    dest = path
    base, ext = os.path.splitext(path)
    if ext.lower() not in ('.jpg', '.jpeg'):
        dest = base + '.jpg'
    save_kwargs = {'quality': quality, 'optimize': True}
    exif_bytes = im.info.get('exif') or b''
    if exif_bytes:
        try:
            save_kwargs['exif'] = exif_bytes
            im.save(dest, 'JPEG', **save_kwargs)
            return dest
        except Exception as exc:
            logger.info('upload ingest: dropping EXIF on save path=%s (%s)', path, exc)
    im.save(dest, 'JPEG', quality=quality, optimize=True)
    return dest


def _open_image_tolerant(path: str) -> Image.Image:
    """Open with EXIF transpose; retry without transpose or with truncated load."""
    last_exc: Exception | None = None
    for attempt in ('transpose', 'raw', 'truncated'):
        try:
            if attempt == 'truncated':
                ImageFile.LOAD_TRUNCATED_IMAGES = True
            with Image.open(path) as im:
                im.load()
                if attempt == 'transpose':
                    return ImageOps.exif_transpose(im.copy())
                return im.copy()
        except Exception as exc:
            last_exc = exc
    raise last_exc or UnidentifiedImageError(f'cannot identify image file {path!r}')


def _repair_to_jpeg(path: str, original_exc: Exception | None = None) -> str:
    """Re-encode a problematic upload to JPEG; strip metadata when needed."""
    detected = detect_image_format(path)
    if detected is None:
        raise UploadImageError(
            'invalid_image',
            'This file does not look like a valid photo. Try re-saving as JPEG or PNG, '
            'or take a new screenshot of the image.',
        ) from original_exc

    try:
        im = _open_image_tolerant(path)
    except Exception as exc:
        logger.warning('upload repair open failed path=%s detected=%s: %s', path, detected, exc)
        raise UploadImageError(
            'decode_failed',
            'The photo could not be opened (it may be corrupted or from a Word/email paste). '
            'Re-save as JPEG or PNG, or take a screenshot and upload that.',
        ) from exc

    try:
        rgb = _to_rgb(im)
        dest = _save_ingest_jpeg(rgb, path, quality=90)
        if dest != path and os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
        return dest
    finally:
        im.close()


def _resize_ingest_if_needed(path):
    """Downscale or recompress when dimensions or bytes exceed ingest budgets."""
    if not path or not os.path.isfile(path):
        return path

    try:
        size_bytes = os.path.getsize(path)
    except OSError:
        return path

    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            w, h = im.size
            needs_dim = max(w, h) > INGEST_MAX_DIMENSION
            needs_bytes = size_bytes > INGEST_MAX_FILE_BYTES
            if not needs_dim and not needs_bytes:
                return path

            im = _to_rgb(im)
            if needs_dim:
                im.thumbnail((INGEST_MAX_DIMENSION, INGEST_MAX_DIMENSION), Image.Resampling.LANCZOS)

            dest = os.path.splitext(path)[0] + '.jpg'
            _save_ingest_jpeg(im, dest, quality=88)

        if dest != path and os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
        return dest
    except Exception as exc:
        logger.warning('upload resize failed path=%s: %s', path, exc)
        return _repair_to_jpeg(path, exc)


def process_uploaded_image(src_path):
    """Normalize HEIC, enforce size/dimension limits, repair when possible."""
    if not src_path or not os.path.isfile(src_path):
        raise UploadImageError('file_missing', 'Uploaded file could not be read.')

    try:
        src_path = normalize_to_jpeg(src_path)
        return _resize_ingest_if_needed(src_path)
    except UploadImageError:
        raise
    except Exception as exc:
        logger.warning('upload ingest primary failed path=%s: %s', src_path, exc)
        repaired = _repair_to_jpeg(src_path, exc)
        return _resize_ingest_if_needed(repaired)
