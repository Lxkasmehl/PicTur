"""Unit tests for shared additional-image batch upload parsing."""

from io import BytesIO

import pytest

from additional_image_upload import (
    additional_upload_success_json,
    collect_indexed_additional_uploads,
    no_valid_files_json,
)
from tests.image_fixtures import valid_jpeg_bytes, word_paste_fake_png_bytes


class _FakeFile:
    def __init__(self, filename, data):
        self.filename = filename
        self._data = data
        self._pos = 0

    def seek(self, pos, whence=0):
        if whence == 2:  # SEEK_END
            self._pos = len(self._data)
        else:
            self._pos = pos

    def tell(self):
        return self._pos

    def save(self, path):
        with open(path, 'wb') as f:
            f.write(self._data)


class _FakeRequest:
    def __init__(self, files, form=None):
        self.files = files
        self.form = form or {}


def test_no_valid_files_json_empty():
    body = no_valid_files_json([])
    assert body['code'] == 'no_valid_files'
    assert 'No valid image files provided' in body['error']


def test_success_json_includes_rejections():
    body = additional_upload_success_json([{'path': '/tmp/a.jpg'}], [
        {'filename': 'bad.png', 'code': 'decode_failed', 'error': 'nope'},
    ])
    assert body['success'] is True
    assert len(body['rejections']) == 1


def test_collect_mixed_batch(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_FOLDER', str(tmp_path))
    import config
    monkeypatch.setattr(config, 'UPLOAD_FOLDER', str(tmp_path))

    good = _FakeFile('ok.jpg', valid_jpeg_bytes())
    bad = _FakeFile('word.png', word_paste_fake_png_bytes())
    req = _FakeRequest(
        {'file_0': bad, 'file_1': good},
        {'type_0': 'condition', 'type_1': 'microhabitat'},
    )
    accepted, rejected = collect_indexed_additional_uploads(
        req,
        context='test/additional',
        temp_path_for_index=lambda idx, ext: str(tmp_path / f"up_{idx}{ext}"),
    )
    assert len(accepted) == 1
    assert accepted[0]['type'] == 'microhabitat'
    assert len(rejected) == 1
    assert rejected[0]['filename'] == 'word.png'
