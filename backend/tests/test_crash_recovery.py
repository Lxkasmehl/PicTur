"""
Unit tests for crash recovery mechanisms.

Tests staged file recovery, temp file cleanup, and atomic reference replacement.
"""

import os
import time
import tempfile
from unittest.mock import MagicMock, patch

import pytest


def _make_mock_brain():
    mock = MagicMock()
    mock.vram_cache_plastron = []
    mock.vram_cache_carapace = []
    mock.process_and_save = MagicMock(return_value=True)
    mock.add_single_to_vram = MagicMock(return_value=True)
    mock.load_database_to_vram = MagicMock()
    mock.extract_query_features = MagicMock(return_value=["fake_feats"])
    mock.match_against_cache = MagicMock(return_value=[])
    return mock


# Import and patch once to avoid numpy reload crashes
_tm_module = None
_original_brain = None

def _get_turtle_manager():
    global _tm_module, _original_brain
    if _tm_module is None:
        import turtle_manager
        _tm_module = turtle_manager
        _original_brain = turtle_manager.brain
    return _tm_module


@pytest.fixture()
def mock_brain():
    return _make_mock_brain()


@pytest.fixture()
def manager(tmp_path, mock_brain):
    tm = _get_turtle_manager()
    tm.brain = mock_brain
    try:
        mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        mgr._mock_brain = mock_brain
        yield mgr
    finally:
        tm.brain = _original_brain


# ---------------------------------------------------------------------------
# Test: Staged file recovery
# ---------------------------------------------------------------------------

class TestStagedFileRecovery:
    """Tests _recover_staged_files on startup."""

    def test_recovers_staged_pt_in_ref_data(self, tmp_path, mock_brain):
        """A staged .pt in ref_data/ is promoted to the canonical name."""
        # Simulate crashed state: staged .pt exists, no canonical .pt
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        staged_pt = ref_dir / "T42_staged_999999.pt"
        staged_pt.write_bytes(b"new features")

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        # Staged file should be gone, canonical should exist
        assert not staged_pt.exists()
        assert (ref_dir / "T42.pt").exists()
        assert (ref_dir / "T42.pt").read_bytes() == b"new features"

    def test_recovers_staged_pt_in_carapace(self, tmp_path, mock_brain):
        """A staged .pt in carapace/ is promoted to canonical."""
        car_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "carapace"
        car_dir.mkdir(parents=True)
        staged_pt = car_dir / "T42_staged_888888.pt"
        staged_pt.write_bytes(b"carapace features")

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert not staged_pt.exists()
        assert (car_dir / "T42.pt").exists()

    def test_staged_overwrites_old_canonical(self, tmp_path, mock_brain):
        """If both staged and canonical exist, staged wins (it's newer)."""
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"old features")
        staged_pt = ref_dir / "T42_staged_777777.pt"
        staged_pt.write_bytes(b"new features")

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert not staged_pt.exists()
        assert (ref_dir / "T42.pt").read_bytes() == b"new features"

    def test_staged_image_cleaned_up(self, tmp_path, mock_brain):
        """Staged image files are also promoted/cleaned."""
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        staged_img = ref_dir / "T42_staged_666666.jpg"
        staged_img.write_bytes(b"new image")
        staged_pt = ref_dir / "T42_staged_666666.pt"
        staged_pt.write_bytes(b"new features")

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert not staged_img.exists()
        assert not staged_pt.exists()
        assert (ref_dir / "T42.pt").exists()
        assert (ref_dir / "T42.jpg").exists()

    def test_no_staged_files_no_error(self, manager, tmp_path):
        """Clean startup with no staged files raises no errors."""
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"normal")

        # _recover_staged_files already ran in the manager fixture — no crash = pass
        assert (ref_dir / "T42.pt").exists()


# ---------------------------------------------------------------------------
# Test: Temp file cleanup
# ---------------------------------------------------------------------------

class TestTempFileCleanup:
    """Tests _cleanup_temp_files on startup."""

    def test_removes_old_extra_files(self, tmp_path, mock_brain):
        """Old extra_ prefixed temp files are removed on startup."""
        temp_dir = tempfile.gettempdir()
        # Create a fake old temp file
        old_temp = os.path.join(temp_dir, "extra_admin_123_microhabitat_999.jpg")
        with open(old_temp, 'w') as f:
            f.write("fake")
        # Set mtime to 2 hours ago
        old_time = time.time() - 7200
        os.utime(old_temp, (old_time, old_time))

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert not os.path.exists(old_temp)

    def test_keeps_recent_extra_files(self, tmp_path, mock_brain):
        """Recent extra_ temp files (< 1 hour old) are kept."""
        temp_dir = tempfile.gettempdir()
        recent_temp = os.path.join(temp_dir, "extra_admin_456_condition_888.jpg")
        with open(recent_temp, 'w') as f:
            f.write("fake")
        # mtime is now (just created) — should NOT be deleted

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert os.path.exists(recent_temp)
        # Clean up
        os.remove(recent_temp)

    def test_ignores_non_matching_files(self, tmp_path, mock_brain):
        """Files without extra_/review_extra_ prefix are never touched."""
        temp_dir = tempfile.gettempdir()
        unrelated = os.path.join(temp_dir, "my_photo_backup.jpg")
        with open(unrelated, 'w') as f:
            f.write("not ours")
        old_time = time.time() - 7200
        os.utime(unrelated, (old_time, old_time))

        tm = _get_turtle_manager()
        tm.brain = mock_brain
        try:
            mgr = tm.TurtleManager(base_data_dir=str(tmp_path))
        finally:
            tm.brain = _original_brain

        assert os.path.exists(unrelated)
        os.remove(unrelated)


# ---------------------------------------------------------------------------
# Test: Atomic reference replacement ordering
# ---------------------------------------------------------------------------

class TestAtomicReferenceReplacement:
    """Tests that reference replacement writes new .pt before removing old."""

    def test_new_pt_exists_after_replacement(self, manager, tmp_path):
        """After replacement, the canonical .pt contains the new data."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        ref_dir.mkdir(parents=True)
        (turtle_dir / "loose_images").mkdir(parents=True)
        (ref_dir / "T42.jpg").write_bytes(b"\xff\xd8old image")
        (ref_dir / "T42.pt").write_bytes(b"old tensor")

        packet_dir = tmp_path / "Review_Queue" / "test_atomic"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "better.jpg"
        img.write_bytes(b"\xff\xd8better image")
        (packet_dir / "metadata.json").write_text("{}")
        (packet_dir / "additional_images").mkdir()

        def fake_process(img_path, pt_path):
            with open(pt_path, 'wb') as f:
                f.write(b"new tensor")
            return True
        manager._mock_brain.process_and_save.side_effect = fake_process

        success, msg = manager.approve_review_packet(
            "test_atomic",
            match_turtle_id="T42",
            replace_reference=True,
        )

        assert success is True
        # Canonical .pt should have new content
        assert (ref_dir / "T42.pt").read_bytes() == b"new tensor"
        # No staged files should remain
        staged = [f for f in os.listdir(str(ref_dir)) if '_staged_' in f]
        assert len(staged) == 0

    def test_old_image_archived(self, manager, tmp_path):
        """Old master image is archived to loose_images."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        loose_dir = turtle_dir / "loose_images"
        ref_dir.mkdir(parents=True)
        loose_dir.mkdir(parents=True)
        (ref_dir / "T42.jpg").write_bytes(b"\xff\xd8old")
        (ref_dir / "T42.pt").write_bytes(b"old")

        packet_dir = tmp_path / "Review_Queue" / "test_archive"
        packet_dir.mkdir(parents=True)
        (packet_dir / "new.jpg").write_bytes(b"\xff\xd8new")
        (packet_dir / "metadata.json").write_text("{}")
        (packet_dir / "additional_images").mkdir()

        def fake_process(img_path, pt_path):
            with open(pt_path, 'wb') as f:
                f.write(b"new")
            return True
        manager._mock_brain.process_and_save.side_effect = fake_process

        manager.approve_review_packet(
            "test_archive",
            match_turtle_id="T42",
            replace_reference=True,
        )

        archived = [f for f in os.listdir(str(loose_dir)) if f.startswith('Archived_Master_')]
        assert len(archived) >= 1
