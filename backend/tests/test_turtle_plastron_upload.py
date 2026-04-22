"""Unit tests: identifier plastron upload + sheet-based folder resolution (brain mocked)."""

import os
from unittest.mock import MagicMock

import pytest

import turtle_manager as tm


def _fake_process_and_save(image_path, pt_path):
    """Real brain writes the tensor file; the mock must create it for file moves to succeed."""
    with open(pt_path, "wb") as f:
        f.write(b"fakept")
    return True


@pytest.fixture
def mgr(tmp_path, monkeypatch):
    monkeypatch.setattr(tm.brain, "process_and_save", _fake_process_and_save)
    if hasattr(tm.brain, "load_database_to_vram"):
        monkeypatch.setattr(tm.brain, "load_database_to_vram", MagicMock())
    return tm.TurtleManager(base_data_dir=str(tmp_path))


def test_resolve_creates_folder_with_sheet(mgr):
    d = mgr.resolve_turtle_dir_for_sheet_upload("TNEW", "Kansas/Topeka")
    expected = os.path.join(mgr.base_dir, "Kansas", "Topeka", "TNEW")
    assert os.path.normpath(d) == os.path.normpath(expected)
    assert os.path.isdir(os.path.join(d, "ref_data"))
    assert os.path.isdir(os.path.join(d, "loose_images"))


def test_set_identifier_first_plastron(mgr, tmp_path):
    src = tmp_path / "in.jpg"
    src.write_bytes(b"\xff\xd8\xff fakejpeg")
    ok, msg = mgr.set_identifier_plastron_from_path("T1", str(src), "SiteA", "set_if_missing")
    assert ok is True
    ref = os.path.join(mgr.base_dir, "SiteA", "T1", "ref_data")
    assert os.path.isfile(os.path.join(ref, "T1.jpg"))
    assert os.path.isfile(os.path.join(ref, "T1.pt"))


def test_set_if_missing_rejects_when_identifier_exists(mgr, tmp_path):
    src = tmp_path / "in.jpg"
    src.write_bytes(b"\xff\xd8\xff fakejpeg")
    mgr.set_identifier_plastron_from_path("T2", str(src), "LocB", "set_if_missing")
    ok, msg = mgr.set_identifier_plastron_from_path("T2", str(src), "LocB", "set_if_missing")
    assert ok is False
    assert "already has" in (msg or "").lower()


def test_replace_archives_old_master(mgr, tmp_path):
    turtle_dir = os.path.join(mgr.base_dir, "LocC", "T3")
    ref_dir = os.path.join(turtle_dir, "ref_data")
    loose_dir = os.path.join(turtle_dir, "loose_images")
    os.makedirs(ref_dir, exist_ok=True)
    os.makedirs(loose_dir, exist_ok=True)
    old_img = os.path.join(ref_dir, "T3.jpg")
    old_pt = os.path.join(ref_dir, "T3.pt")
    with open(old_img, "wb") as f:
        f.write(b"\xff\xd8\xff old")
    with open(old_pt, "wb") as f:
        f.write(b"pt")

    src = tmp_path / "new.jpg"
    src.write_bytes(b"\xff\xd8\xff new")
    ok, _msg = mgr.set_identifier_plastron_from_path("T3", str(src), "LocC", "replace")
    assert ok is True
    loose_files = os.listdir(loose_dir)
    assert any(n.startswith("Archived_Master_") for n in loose_files)
    assert os.path.isfile(os.path.join(ref_dir, "T3.jpg"))


def test_add_additional_creates_folder_when_only_sheet(mgr, tmp_path):
    src = tmp_path / "x.jpg"
    src.write_bytes(b"\xff\xd8\xff x")
    ok, _ = mgr.add_additional_images_to_turtle(
        "T4",
        [
            {
                "path": str(src),
                "type": "microhabitat",
                "timestamp": "2026-01-01T00:00:00Z",
                "original_filename": "x.jpg",
            }
        ],
        "StateX/PlaceY",
    )
    assert ok is True
    add_dir = os.path.join(mgr.base_dir, "StateX", "PlaceY", "T4", "additional_images")
    assert os.path.isdir(add_dir)
