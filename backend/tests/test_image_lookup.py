"""Tests for case-insensitive .pt → image file lookup.

Regression coverage for the production bug where reference images saved with
uppercase extensions (``F128.JPG``) were not resolving on Linux. The broken
code used a hard-coded ``['.jpg', '.jpeg', '.png']`` list combined with
``os.path.exists(base + ext)``, which only finds lowercase files on a
case-sensitive filesystem.

Exercises three helpers that share the same contract:

- ``routes.upload.find_image_for_pt``  (also aliased as ``convert_pt_to_image_path``)
- ``turtle_manager._find_image_next_to_pt``
- ``turtle_manager._find_image_in_dir``
"""

import os

import pytest

from routes.upload import find_image_for_pt, convert_pt_to_image_path
from turtle_manager import _find_image_next_to_pt, _find_image_in_dir


# ---- find_image_for_pt (upload.py) + _find_image_next_to_pt (turtle_manager) ----
#
# These two helpers take a .pt path and return either the sibling image
# or a no-image signal. upload.py returns the original pt_path when no
# image exists; turtle_manager returns None. Both are tested under the
# same parametrisation so the coverage stays symmetric.


def _write_empty_file(path):
    with open(path, 'wb') as f:
        f.write(b'')


@pytest.mark.parametrize('case_ext', ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.Jpg', '.JPg'])
def test_upload_find_image_for_pt_matches_any_case(tmp_path, case_ext):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)
    img = tmp_path / f'F128{case_ext}'
    _write_empty_file(img)

    result = find_image_for_pt(str(pt))
    assert result == str(img)


@pytest.mark.parametrize('case_ext', ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.Jpg', '.JPg'])
def test_turtle_manager_find_image_next_to_pt_matches_any_case(tmp_path, case_ext):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)
    img = tmp_path / f'F128{case_ext}'
    _write_empty_file(img)

    result = _find_image_next_to_pt(str(pt))
    assert result == str(img)


def test_upload_find_image_for_pt_returns_original_when_no_sibling(tmp_path):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)

    # Callers in upload.py treat "path unchanged" as "no image found"
    assert find_image_for_pt(str(pt)) == str(pt)


def test_turtle_manager_find_image_next_to_pt_returns_none_when_no_sibling(tmp_path):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)

    # Callers in turtle_manager.py treat None as "no image found"
    assert _find_image_next_to_pt(str(pt)) is None


def test_upload_find_image_for_pt_non_pt_input_passthrough():
    assert find_image_for_pt('/tmp/foo.jpg') == '/tmp/foo.jpg'
    assert find_image_for_pt('') == ''
    assert find_image_for_pt(None) is None


def test_turtle_manager_find_image_next_to_pt_non_pt_input_returns_none():
    assert _find_image_next_to_pt('/tmp/foo.jpg') is None
    assert _find_image_next_to_pt('') is None
    assert _find_image_next_to_pt(None) is None


def test_find_image_ignores_unrelated_files_in_dir(tmp_path):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)
    # Sibling PT and unrelated files should not be returned.
    _write_empty_file(tmp_path / 'F200.jpg')
    _write_empty_file(tmp_path / 'notes.txt')
    _write_empty_file(tmp_path / 'F128.pt.bak')

    # No matching stem → returns original (upload) or None (turtle_manager)
    assert find_image_for_pt(str(pt)) == str(pt)
    assert _find_image_next_to_pt(str(pt)) is None

    # Add the matching image and re-check
    match = tmp_path / 'F128.JPG'
    _write_empty_file(match)
    assert find_image_for_pt(str(pt)) == str(match)
    assert _find_image_next_to_pt(str(pt)) == str(match)


def test_find_image_handles_missing_parent_directory():
    # Directory doesn't exist → should not raise
    assert find_image_for_pt('/nonexistent/directory/F128.pt') == '/nonexistent/directory/F128.pt'
    assert _find_image_next_to_pt('/nonexistent/directory/F128.pt') is None


def test_convert_pt_to_image_path_is_alias_of_find_image_for_pt(tmp_path):
    pt = tmp_path / 'F128.pt'
    _write_empty_file(pt)
    img = tmp_path / 'F128.JPG'
    _write_empty_file(img)

    assert convert_pt_to_image_path(str(pt)) == find_image_for_pt(str(pt)) == str(img)


# ---- _find_image_in_dir (turtle_manager) ----
#
# Different contract: given a directory and a stem, return the image path
# (case-insensitive extension match). Used by approve_review_packet's
# replace-reference old-image lookup.


@pytest.mark.parametrize('case_ext', ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'])
def test_find_image_in_dir_matches_any_case(tmp_path, case_ext):
    img = tmp_path / f'F128{case_ext}'
    _write_empty_file(img)

    assert _find_image_in_dir(str(tmp_path), 'F128') == str(img)


def test_find_image_in_dir_returns_none_when_stem_missing(tmp_path):
    _write_empty_file(tmp_path / 'F200.jpg')  # different stem
    _write_empty_file(tmp_path / 'notes.txt')  # different type

    assert _find_image_in_dir(str(tmp_path), 'F128') is None


def test_find_image_in_dir_handles_missing_directory():
    assert _find_image_in_dir('/nonexistent/directory', 'F128') is None


def test_find_image_in_dir_ignores_pt_and_other_extensions(tmp_path):
    # Shouldn't match .pt, .txt, etc.
    _write_empty_file(tmp_path / 'F128.pt')
    _write_empty_file(tmp_path / 'F128.txt')
    _write_empty_file(tmp_path / 'F128.bak')

    assert _find_image_in_dir(str(tmp_path), 'F128') is None

    # Add an actual image and confirm it's now found
    img = tmp_path / 'F128.JPG'
    _write_empty_file(img)
    assert _find_image_in_dir(str(tmp_path), 'F128') == str(img)
