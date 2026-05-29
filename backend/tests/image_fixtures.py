"""Valid minimal image bytes for tests that hit server ingest (``process_uploaded_image``)."""

import os
from io import BytesIO

from PIL import Image


def valid_jpeg_bytes(width: int = 16, height: int = 16) -> bytes:
    buf = BytesIO()
    Image.new('RGB', (width, height), color=(128, 64, 32)).save(buf, format='JPEG')
    return buf.getvalue()


def valid_png_bytes(width: int = 16, height: int = 16) -> bytes:
    buf = BytesIO()
    Image.new('RGB', (width, height), color=(128, 64, 32)).save(buf, format='PNG')
    return buf.getvalue()


def write_valid_jpeg(path: str, width: int = 16, height: int = 16) -> str:
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    Image.new('RGB', (width, height), color=(128, 64, 32)).save(path, format='JPEG')
    return path


def word_paste_fake_png_bytes() -> bytes:
    """PNG signature with non-image payload (common after Word/email copy)."""
    return b'\x89PNG\r\n\x1a\n' + b'WORD_EMBEDDED_GARBAGE' * 200


def truncated_valid_png_bytes() -> bytes:
    """Valid PNG header and partial IDAT (email clients sometimes truncate)."""
    buf = BytesIO()
    Image.new('RGB', (32, 24), color=(10, 20, 30)).save(buf, format='PNG')
    data = buf.getvalue()
    return data[: max(len(data) // 3, 64)]


def jpeg_with_extra_garbage_app_segment(path: str) -> str:
    """Valid JPEG with a bogus APP1 segment (corrupt EXIF-like metadata)."""
    write_valid_jpeg(path)
    with open(path, 'ab') as f:
        f.write(b'\xff\xe1' + b'\x00\x10' + b'FAKEEXIFDATA' + b'\xff\xd9')
    return path
