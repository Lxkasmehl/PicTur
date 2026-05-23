"""Ingest tests for Word/email exports and other problematic uploads."""

import os
from unittest import mock

import pytest
from PIL import Image

from image_utils import UploadImageError, detect_image_format, process_uploaded_image
from tests.image_fixtures import (
    jpeg_with_extra_garbage_app_segment,
    truncated_valid_png_bytes,
    valid_png_bytes,
    word_paste_fake_png_bytes,
    write_valid_jpeg,
)


def test_detect_format_jpeg_and_png(tmp_path):
    jpg = tmp_path / 'a.jpg'
    png = tmp_path / 'b.png'
    write_valid_jpeg(str(jpg))
    png.write_bytes(valid_png_bytes())
    assert detect_image_format(str(jpg)) == 'jpeg'
    assert detect_image_format(str(png)) == 'png'


def test_process_valid_png_stays_openable(tmp_path):
    path = tmp_path / 'ok.png'
    path.write_bytes(valid_png_bytes())
    result = process_uploaded_image(str(path))
    assert os.path.isfile(result)
    with Image.open(result) as im:
        assert im.size[0] > 0


def test_process_interlaced_png(tmp_path):
    path = tmp_path / 'interlaced.png'
    Image.new('RGB', (48, 32)).save(str(path), 'PNG', interlace=1)
    result = process_uploaded_image(str(path))
    with Image.open(result) as im:
        assert im.format in ('JPEG', 'PNG')


def test_process_jpeg_with_garbage_app_segment(tmp_path):
    path = tmp_path / 'exif_garbage.jpg'
    jpeg_with_extra_garbage_app_segment(str(path))
    result = process_uploaded_image(str(path))
    with Image.open(result) as im:
        assert im.size == (16, 16)


def test_process_truncated_png_repairs_or_rejects(tmp_path):
    path = tmp_path / 'trunc.png'
    path.write_bytes(truncated_valid_png_bytes())
    try:
        result = process_uploaded_image(str(path))
        with Image.open(result) as im:
            assert max(im.size) >= 1
    except UploadImageError as e:
        assert e.code in ('decode_failed', 'invalid_image')


def test_word_paste_fake_png_rejected(tmp_path):
    path = tmp_path / 'word.png'
    path.write_bytes(word_paste_fake_png_bytes())
    assert detect_image_format(str(path)) == 'png'
    with pytest.raises(UploadImageError) as exc:
        process_uploaded_image(str(path))
    assert exc.value.code in ('decode_failed', 'invalid_image')


def test_non_image_bytes_rejected(tmp_path):
    path = tmp_path / 'notes.txt'
    path.write_text('This is not an image', encoding='utf-8')
    assert detect_image_format(str(path)) is None
    with pytest.raises(UploadImageError) as exc:
        process_uploaded_image(str(path))
    assert exc.value.code == 'invalid_image'


def test_filesystem_open_error_propagates(tmp_path):
    path = tmp_path / 'ok.jpg'
    write_valid_jpeg(str(path))
    with mock.patch('image_utils.Image.open', side_effect=OSError(5, 'Input/output error')):
        with pytest.raises(OSError) as exc:
            process_uploaded_image(str(path))
    assert exc.value.errno == 5


def test_filesystem_save_error_propagates(tmp_path):
    path = tmp_path / 'big.jpg'
    Image.new('RGB', (4000, 3000)).save(str(path), 'JPEG', quality=95)
    with mock.patch('image_utils.Image.Image.save', side_effect=OSError(28, 'No space left on device')):
        with pytest.raises(OSError) as exc:
            process_uploaded_image(str(path))
    assert exc.value.errno == 28
