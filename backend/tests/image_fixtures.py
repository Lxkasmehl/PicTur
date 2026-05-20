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
