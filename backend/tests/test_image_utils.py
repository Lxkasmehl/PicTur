"""Tests for HEIC/HEIF → JPEG normalization.

Covers the ``image_utils.normalize_to_jpeg`` helper used at every upload
save boundary. Test HEIC fixtures are generated programmatically via
``pillow-heif``'s encoder (bundled with the pip package) rather than
committed binary files, so the tests exercise a real end-to-end encode
→ decode round-trip.

Critical coverage:
- Non-HEIC inputs pass through untouched (no wasted re-encode).
- HEIC files are converted to a sibling .jpg and the original deleted.
- EXIF DateTimeOriginal survives the conversion — the history-date
  aggregation in routes/turtles.py depends on this.
- Uppercase ``.HEIC`` is handled case-insensitively.
"""

import os

import pytest
from PIL import Image

from image_utils import HEIC_EXTENSIONS, normalize_to_jpeg


# ---------- Passthrough cases (no re-encoding) ----------


def test_none_passthrough():
    assert normalize_to_jpeg(None) is None


def test_empty_string_passthrough():
    assert normalize_to_jpeg('') == ''


def test_jpg_passthrough(tmp_path):
    path = tmp_path / 'already.jpg'
    Image.new('RGB', (8, 8)).save(str(path), 'JPEG')
    result = normalize_to_jpeg(str(path))
    assert result == str(path)
    assert os.path.exists(str(path))  # untouched


def test_png_passthrough(tmp_path):
    path = tmp_path / 'other.png'
    Image.new('RGB', (8, 8)).save(str(path), 'PNG')
    result = normalize_to_jpeg(str(path))
    assert result == str(path)
    assert os.path.exists(str(path))


def test_unknown_extension_passthrough(tmp_path):
    path = tmp_path / 'data.bin'
    path.write_bytes(b'not an image')
    result = normalize_to_jpeg(str(path))
    assert result == str(path)
    assert os.path.exists(str(path))  # untouched


def test_nonexistent_non_heic_path_passthrough():
    # Non-HEIC inputs return unchanged even if the file doesn't exist,
    # because callers may pass paths that were cleaned up upstream.
    assert normalize_to_jpeg('/tmp/does-not-exist.jpg') == '/tmp/does-not-exist.jpg'


# ---------- HEIC → JPEG conversion ----------


def _make_heic(path, color='red', exif=None):
    """Helper: create a small HEIC file at ``path``, returning the saved path as str."""
    img = Image.new('RGB', (16, 16), color=color)
    save_kwargs = {}
    if exif is not None:
        save_kwargs['exif'] = exif
    img.save(str(path), 'HEIF', **save_kwargs)
    return str(path)


def test_heic_converts_to_sibling_jpg(tmp_path):
    heic = _make_heic(tmp_path / 'photo.heic')

    result = normalize_to_jpeg(heic)

    assert result == str(tmp_path / 'photo.jpg')
    assert os.path.exists(result)
    # Original HEIC has been deleted
    assert not os.path.exists(heic)


def test_heic_uppercase_extension_handled(tmp_path):
    heic = _make_heic(tmp_path / 'photo.HEIC')

    result = normalize_to_jpeg(heic)

    # Destination preserves the original stem but switches the extension
    assert result == str(tmp_path / 'photo.jpg')
    assert os.path.exists(result)
    assert not os.path.exists(heic)


def test_heif_extension_handled(tmp_path):
    heic = _make_heic(tmp_path / 'photo.heif')

    result = normalize_to_jpeg(heic)

    assert result == str(tmp_path / 'photo.jpg')
    assert os.path.exists(result)
    assert not os.path.exists(heic)


def test_converted_jpeg_is_a_valid_image(tmp_path):
    heic = _make_heic(tmp_path / 'photo.heic', color='blue')

    result = normalize_to_jpeg(heic)

    # Pillow can reopen the converted file and it matches the source dimensions
    with Image.open(result) as img:
        assert img.format == 'JPEG'
        assert img.mode in ('RGB', 'RGBA', 'L')
        assert img.size == (16, 16)


# ---------- EXIF preservation (critical for history-date aggregation) ----------


def test_exif_datetime_original_survives_conversion(tmp_path):
    # Build EXIF with DateTimeOriginal set
    img = Image.new('RGB', (16, 16), color='green')
    exif = img.getexif()
    exif[36867] = '2024:07:12 14:30:00'  # ExifTag.DateTimeOriginal
    heic_path = str(tmp_path / 'iphone.heic')
    img.save(heic_path, 'HEIF', exif=exif.tobytes())

    result = normalize_to_jpeg(heic_path)

    # Re-read the JPEG and confirm the DateTimeOriginal is still there
    with Image.open(result) as jpg:
        jpg_exif = dict(jpg.getexif())
        assert 36867 in jpg_exif, 'DateTimeOriginal must survive HEIC → JPEG conversion'
        assert jpg_exif[36867] == '2024:07:12 14:30:00'


def test_multiple_exif_tags_preserved(tmp_path):
    img = Image.new('RGB', (16, 16), color='yellow')
    exif = img.getexif()
    exif[36867] = '2024:07:12 14:30:00'  # DateTimeOriginal
    exif[272] = 'TestCamera'              # Model
    exif[271] = 'TestMake'                # Make
    heic_path = str(tmp_path / 'shot.heic')
    img.save(heic_path, 'HEIF', exif=exif.tobytes())

    result = normalize_to_jpeg(heic_path)

    with Image.open(result) as jpg:
        out = dict(jpg.getexif())
        assert out.get(36867) == '2024:07:12 14:30:00'
        assert out.get(272) == 'TestCamera'
        assert out.get(271) == 'TestMake'


# ---------- Module exports ----------


def test_heic_extensions_constant():
    # Contract that callers rely on — including the frontend error message
    assert '.heic' in HEIC_EXTENSIONS
    assert '.heif' in HEIC_EXTENSIONS