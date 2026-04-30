"""
Unit tests for Task 1: Live VRAM Cache Updates.

Tests the incremental cache update logic and the wiring that ensures
ingest and approval flows keep the VRAM cache in sync without restart.

All tests mock the 'brain' (TurtleDeepMatcher) so they run without
torch, GPU, or Docker — suitable for lightweight CI.
"""

import json
import os
import shutil
import threading
from unittest.mock import MagicMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# Helpers to build a mock brain and import turtle_manager with it
# ---------------------------------------------------------------------------

def _make_mock_brain():
    """Create a mock brain with the interface TurtleManager expects."""
    mock = MagicMock()
    mock.vram_cache_plastron = []
    mock.vram_cache_carapace = []
    mock.process_and_save = MagicMock(return_value=True)
    mock.add_single_to_vram = MagicMock(return_value=True)
    mock.load_database_to_vram = MagicMock()
    mock.extract_query_features = MagicMock(return_value=["fake_feats"])
    mock.match_against_cache = MagicMock(return_value=[])
    return mock


@pytest.fixture()
def mock_brain():
    return _make_mock_brain()


@pytest.fixture()
def manager(tmp_path, mock_brain):
    """Create a TurtleManager using a temp data dir and mocked brain."""
    with patch.dict("sys.modules", {
        "turtles.image_processing": MagicMock(brain=mock_brain),
        "turtles": MagicMock(),
    }):
        with patch("turtle_manager.brain", mock_brain):
            import turtle_manager
            # Reload so the patched brain takes effect
            import importlib
            importlib.reload(turtle_manager)

            mgr = turtle_manager.TurtleManager(base_data_dir=str(tmp_path))
            mgr._mock_brain = mock_brain
            yield mgr

            # Reload again to not pollute other tests
            importlib.reload(turtle_manager)


# ---------------------------------------------------------------------------
# Test: add_single_to_vram on TurtleDeepMatcher
# ---------------------------------------------------------------------------

class TestAddSingleToVram:
    """Tests for TurtleDeepMatcher.add_single_to_vram (mocked torch)."""

    def test_missing_file_returns_false(self, tmp_path):
        """add_single_to_vram returns False for nonexistent .pt file."""
        with patch("turtles.image_processing.torch") as mock_torch:
            from turtles.image_processing import TurtleDeepMatcher
            matcher = MagicMock(spec=TurtleDeepMatcher)
            matcher._gpu_lock = threading.Lock()
            matcher.vram_cache = []
            matcher.device = "cpu"

            # Call the real unlocked method with a fake self
            missing_path = str(tmp_path / "nonexistent.pt")
            result = TurtleDeepMatcher._add_single_to_vram_unlocked(matcher, missing_path, "T999", "Kansas/Lawrence")
            assert result is False
            assert len(matcher.vram_cache) == 0

    def test_successful_add_appends_to_cache(self, tmp_path):
        """add_single_to_vram appends to plastron cache by default."""
        import torch
        pt_path = str(tmp_path / "T42.pt")
        fake_data = {"keypoints": torch.zeros(10, 2), "descriptors": torch.zeros(10, 256)}
        torch.save(fake_data, pt_path)

        from turtles.image_processing import TurtleDeepMatcher
        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")

        result = TurtleDeepMatcher._add_single_to_vram_unlocked(matcher, pt_path, "T42", "Kansas/Lawrence")
        assert result is True
        assert len(matcher.vram_cache_plastron) == 1
        entry = matcher.vram_cache_plastron[0]
        assert entry["site_id"] == "T42"
        assert entry["location"] == "Kansas/Lawrence"
        assert entry["file_path"] == pt_path

    def test_add_multiple_entries(self, tmp_path):
        """Multiple calls accumulate entries in plastron cache."""
        import torch
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")

        for i in range(3):
            pt_path = str(tmp_path / f"T{i}.pt")
            torch.save({"keypoints": torch.zeros(5, 2)}, pt_path)
            TurtleDeepMatcher._add_single_to_vram_unlocked(matcher, pt_path, f"T{i}", "Kansas")

        assert len(matcher.vram_cache_plastron) == 3
        assert [e["site_id"] for e in matcher.vram_cache_plastron] == ["T0", "T1", "T2"]


# ---------------------------------------------------------------------------
# Test: refresh_database_index scans .pt files correctly
# ---------------------------------------------------------------------------

class TestRefreshDatabaseIndex:
    """Tests for TurtleManager.refresh_database_index directory scanning."""

    def test_scans_ref_data_pt_files(self, manager, tmp_path):
        """refresh_database_index finds .pt files in ref_data/ directories."""
        # Create: State/Location/TurtleID/ref_data/TurtleID.pt
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        turtle_dir.mkdir(parents=True)
        pt_file = turtle_dir / "T42.pt"
        pt_file.write_bytes(b"fake")

        manager.refresh_database_index()

        assert len(manager.db_index) == 1
        path, turtle_id, location, photo_type = manager.db_index[0]
        assert turtle_id == "T42"
        assert "Kansas" in location and "Lawrence" in location
        assert path.endswith("T42.pt")
        assert photo_type == "plastron"

    def test_ignores_non_pt_files(self, manager, tmp_path):
        """refresh_database_index ignores .jpg and other files in ref_data/."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        turtle_dir.mkdir(parents=True)
        (turtle_dir / "T42.jpg").write_bytes(b"fake image")
        (turtle_dir / "T42.txt").write_bytes(b"notes")

        manager.refresh_database_index()
        assert len(manager.db_index) == 0

    def test_pushes_to_vram_after_scan(self, manager, tmp_path):
        """refresh_database_index calls brain.load_database_to_vram with the index."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        turtle_dir.mkdir(parents=True)
        (turtle_dir / "T42.pt").write_bytes(b"fake")

        # Reset mock (TurtleManager.__init__ already called it once)
        manager._mock_brain.load_database_to_vram.reset_mock()
        manager.refresh_database_index()
        manager._mock_brain.load_database_to_vram.assert_called_once()
        args = manager._mock_brain.load_database_to_vram.call_args[0][0]
        assert len(args) == 1

    def test_multiple_turtles_multiple_locations(self, manager, tmp_path):
        """Index includes turtles from different locations."""
        for state, loc, tid in [("Kansas", "Lawrence", "T42"), ("Kansas", "Topeka", "T99"),
                                ("Nebraska", "CPBS", "F01")]:
            d = tmp_path / state / loc / tid / "ref_data"
            d.mkdir(parents=True)
            (d / f"{tid}.pt").write_bytes(b"fake")

        manager.refresh_database_index()
        assert len(manager.db_index) == 3
        ids = {entry[1] for entry in manager.db_index}
        assert ids == {"T42", "T99", "F01"}


# ---------------------------------------------------------------------------
# Test: ingest_flash_drive calls refresh when new turtles are created
# ---------------------------------------------------------------------------

class TestIngestRefresh:
    """Tests that ingest_flash_drive rebuilds the search index after ingesting new turtles."""

    def test_ingest_calls_refresh_when_new_turtles(self, manager, tmp_path):
        """After ingesting new turtles, refresh_database_index is called."""
        # Create a fake drive with one location folder
        drive = tmp_path / "fake_drive"
        loc_dir = drive / "Lawrence"
        loc_dir.mkdir(parents=True)

        # Create a fake turtle image
        img_path = loc_dir / "F001 Plastron.jpg"
        img_path.write_bytes(b"\xff\xd8fake jpg")

        with patch.object(manager, 'refresh_database_index') as mock_refresh:
            manager.ingest_flash_drive(str(drive))
            mock_refresh.assert_called_once()

    def test_ingest_skips_refresh_when_no_new_turtles(self, manager, tmp_path):
        """If all turtles are skipped (already exist), refresh is NOT called."""
        drive = tmp_path / "fake_drive"
        loc_dir = drive / "Lawrence"
        loc_dir.mkdir(parents=True)

        img_path = loc_dir / "F001 Plastron.jpg"
        img_path.write_bytes(b"\xff\xd8fake jpg")

        # Pre-create the turtle so it gets skipped
        dest_dir = tmp_path / "Kansas" / "Lawrence" / "F001" / "ref_data"
        dest_dir.mkdir(parents=True)
        (dest_dir / "F001.pt").write_bytes(b"existing")

        with patch.object(manager, 'refresh_database_index') as mock_refresh:
            manager.ingest_flash_drive(str(drive))
            mock_refresh.assert_not_called()

    def test_ingest_nonexistent_drive_no_crash(self, manager, tmp_path):
        """Ingesting from a nonexistent path does not crash or call refresh."""
        with patch.object(manager, 'refresh_database_index') as mock_refresh:
            manager.ingest_flash_drive(str(tmp_path / "no_such_drive"))
            mock_refresh.assert_not_called()


# ---------------------------------------------------------------------------
# Test: approve_review_packet uses incremental cache update
# ---------------------------------------------------------------------------

class TestApprovalIncrementalUpdate:
    """Tests that approve_review_packet uses add_single_to_vram for new turtles."""

    def test_new_turtle_approval_calls_add_single(self, manager, tmp_path):
        """Creating a new turtle via approval uses incremental cache update."""
        # Create a fake uploaded image in a review packet
        packet_dir = tmp_path / "Review_Queue" / "test_req_001"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "uploaded.jpg"
        img.write_bytes(b"\xff\xd8fake jpg data")
        meta = packet_dir / "metadata.json"
        meta.write_text("{}")
        additional = packet_dir / "additional_images"
        additional.mkdir()

        manager._mock_brain.add_single_to_vram.reset_mock()
        manager._mock_brain.process_and_save.return_value = True

        success, msg = manager.approve_review_packet(
            "test_req_001",
            new_location="Kansas/Lawrence",
            new_turtle_id="T_NEW",
        )

        assert success is True
        manager._mock_brain.add_single_to_vram.assert_called_once()
        call_args = manager._mock_brain.add_single_to_vram.call_args
        assert "T_NEW.pt" in call_args[0][0]
        assert call_args[0][1] == "T_NEW"
        assert "Kansas" in call_args[0][2]

    def test_reference_replacement_uses_incremental_update(self, manager, tmp_path):
        """Replacing a reference image uses incremental cache (remove old + add new)."""
        # Create an existing turtle with ref_data
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        ref_dir.mkdir(parents=True)
        (turtle_dir / "loose_images").mkdir(parents=True)
        old_pt = ref_dir / "T42.pt"
        (ref_dir / "T42.jpg").write_bytes(b"\xff\xd8old image")
        old_pt.write_bytes(b"old tensor")

        # Create a review packet with a new image
        packet_dir = tmp_path / "Review_Queue" / "test_req_002"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "better_photo.jpg"
        img.write_bytes(b"\xff\xd8better image")
        (packet_dir / "metadata.json").write_text("{}")
        (packet_dir / "additional_images").mkdir()

        manager._mock_brain.add_single_to_vram.reset_mock()
        manager._mock_brain.vram_cache_plastron = [
            {"site_id": "T42", "file_path": str(old_pt), "feats": {}}
        ]

        # process_and_save must create the staged .pt file on disk
        def fake_process_and_save(image_path, output_pt_path):
            with open(output_pt_path, 'wb') as f:
                f.write(b"new tensor")
            return True
        manager._mock_brain.process_and_save.side_effect = fake_process_and_save

        success, msg = manager.approve_review_packet(
            "test_req_002",
            match_turtle_id="T42",
            replace_reference=True,
        )

        assert success is True
        # Old entry should have been removed from plastron cache
        assert len(manager._mock_brain.vram_cache_plastron) == 0
        # New entry added via incremental update
        manager._mock_brain.add_single_to_vram.assert_called_once()

    def test_observation_only_does_not_update_cache(self, manager, tmp_path):
        """Adding an observation (no replace_reference) does NOT touch the cache."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        ref_dir.mkdir(parents=True)
        (turtle_dir / "loose_images").mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"tensor")

        packet_dir = tmp_path / "Review_Queue" / "test_req_003"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "observation.jpg"
        img.write_bytes(b"\xff\xd8obs image")
        (packet_dir / "metadata.json").write_text("{}")
        (packet_dir / "additional_images").mkdir()

        manager._mock_brain.add_single_to_vram.reset_mock()

        success, msg = manager.approve_review_packet(
            "test_req_003",
            match_turtle_id="T42",
            replace_reference=False,
        )

        assert success is True
        manager._mock_brain.add_single_to_vram.assert_not_called()
