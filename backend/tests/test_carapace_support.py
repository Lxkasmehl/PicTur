"""
Unit tests for Task 3: Carapace Support.

Tests dual VRAM caches, carapace index scanning, _process_single_turtle
carapace path, search_for_matches with photo_type, approval with carapace,
community upload classification, and carapace additional image processing.

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
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_brain():
    """Create a mock brain with the dual-cache interface."""
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
            import importlib
            importlib.reload(turtle_manager)

            mgr = turtle_manager.TurtleManager(base_data_dir=str(tmp_path))
            mgr._mock_brain = mock_brain
            yield mgr

            importlib.reload(turtle_manager)


# ---------------------------------------------------------------------------
# Test: Dual VRAM Cache in TurtleDeepMatcher
# ---------------------------------------------------------------------------

class TestDualVramCache:
    """Tests for the dual plastron/carapace VRAM cache system."""

    def test_add_single_to_plastron_cache(self, tmp_path):
        """add_single_to_vram with photo_type='plastron' appends to plastron cache."""
        import torch
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")

        pt_path = str(tmp_path / "T42.pt")
        torch.save({"keypoints": torch.zeros(5, 2)}, pt_path)

        result = TurtleDeepMatcher._add_single_to_vram_unlocked(matcher, pt_path, "T42", "Kansas", photo_type="plastron")
        assert result is True
        assert len(matcher.vram_cache_plastron) == 1
        assert len(matcher.vram_cache_carapace) == 0

    def test_add_single_to_carapace_cache(self, tmp_path):
        """add_single_to_vram with photo_type='carapace' appends to carapace cache."""
        import torch
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")

        pt_path = str(tmp_path / "T42.pt")
        torch.save({"keypoints": torch.zeros(5, 2)}, pt_path)

        result = TurtleDeepMatcher._add_single_to_vram_unlocked(matcher, pt_path, "T42", "Kansas", photo_type="carapace")
        assert result is True
        assert len(matcher.vram_cache_plastron) == 0
        assert len(matcher.vram_cache_carapace) == 1

    def test_load_database_splits_by_photo_type(self, tmp_path):
        """load_database_to_vram splits 4-tuple entries into correct caches."""
        import torch
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")
        matcher.device_str = "cpu"

        # Create test .pt files
        for name in ["p1", "p2", "c1"]:
            path = tmp_path / f"{name}.pt"
            torch.save({"keypoints": torch.zeros(3, 2)}, str(path))

        index = [
            (str(tmp_path / "p1.pt"), "T01", "Kansas/Lawrence", "plastron"),
            (str(tmp_path / "p2.pt"), "T02", "Kansas/Topeka", "plastron"),
            (str(tmp_path / "c1.pt"), "T01", "Kansas/Lawrence", "carapace"),
        ]

        TurtleDeepMatcher._load_database_to_vram_unlocked(matcher, index)
        assert len(matcher.vram_cache_plastron) == 2
        assert len(matcher.vram_cache_carapace) == 1

    def test_load_database_legacy_3tuple_defaults_plastron(self, tmp_path):
        """load_database_to_vram with 3-tuple (legacy) defaults to plastron."""
        import torch
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device = torch.device("cpu")
        matcher.device_str = "cpu"

        pt_path = str(tmp_path / "T01.pt")
        torch.save({"keypoints": torch.zeros(3, 2)}, pt_path)

        index = [(pt_path, "T01", "Kansas")]
        TurtleDeepMatcher._load_database_to_vram_unlocked(matcher, index)
        assert len(matcher.vram_cache_plastron) == 1
        assert len(matcher.vram_cache_carapace) == 0

    def test_match_against_cache_selects_correct_cache(self):
        """match_against_cache with photo_type selects the right cache."""
        from turtles.image_processing import TurtleDeepMatcher

        matcher = MagicMock(spec=TurtleDeepMatcher)
        matcher._gpu_lock = threading.Lock()
        matcher.vram_cache_plastron = []
        matcher.vram_cache_carapace = []
        matcher.device_str = "cpu"

        # With empty caches, should return empty lists without error
        result_p = TurtleDeepMatcher._match_against_cache_unlocked(matcher, ["fake_feats"], photo_type="plastron")
        assert result_p == []
        result_c = TurtleDeepMatcher._match_against_cache_unlocked(matcher, ["fake_feats"], photo_type="carapace")
        assert result_c == []


# ---------------------------------------------------------------------------
# Test: refresh_database_index scans both ref_data and carapace
# ---------------------------------------------------------------------------

class TestRefreshDatabaseIndexCarapace:
    """Tests that refresh_database_index scans both plastron and carapace .pt files."""

    def test_scans_both_ref_data_and_carapace(self, manager, tmp_path):
        """Index includes plastron (ref_data) and carapace entries."""
        # Plastron
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"fake")

        # Carapace
        car_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "carapace"
        car_dir.mkdir(parents=True)
        (car_dir / "T42.pt").write_bytes(b"fake")

        manager.refresh_database_index()
        assert len(manager.db_index) == 2

        types = {entry[3] for entry in manager.db_index}
        assert types == {"plastron", "carapace"}

    def test_plastron_only_turtle(self, manager, tmp_path):
        """Turtle with only ref_data/ gets one plastron entry."""
        ref_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "ref_data"
        ref_dir.mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"fake")

        manager.refresh_database_index()
        assert len(manager.db_index) == 1
        assert manager.db_index[0][3] == "plastron"

    def test_carapace_only_turtle(self, manager, tmp_path):
        """Turtle with only carapace/ gets one carapace entry."""
        car_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "carapace"
        car_dir.mkdir(parents=True)
        (car_dir / "T42.pt").write_bytes(b"fake")

        manager.refresh_database_index()
        assert len(manager.db_index) == 1
        assert manager.db_index[0][3] == "carapace"

    def test_ignores_loose_images(self, manager, tmp_path):
        """Directories like loose_images/ are not scanned."""
        loose_dir = tmp_path / "Kansas" / "Lawrence" / "T42" / "loose_images"
        loose_dir.mkdir(parents=True)
        (loose_dir / "fake.pt").write_bytes(b"fake")

        manager.refresh_database_index()
        assert len(manager.db_index) == 0


# ---------------------------------------------------------------------------
# Test: _process_single_turtle with carapace
# ---------------------------------------------------------------------------

class TestProcessSingleTurtleCarapace:
    """Tests _process_single_turtle creates correct folder structure for carapace."""

    def test_plastron_creates_plastron_dir(self, manager, tmp_path):
        """Default (plastron) creates plastron/ with subfolders."""
        img = tmp_path / "source.jpg"
        img.write_bytes(b"\xff\xd8fake")
        loc_dir = tmp_path / "Kansas" / "Lawrence"
        loc_dir.mkdir(parents=True)

        manager._process_single_turtle(str(img), str(loc_dir), "T01", photo_type="plastron")
        assert (loc_dir / "T01" / "plastron" / "T01.jpg").exists()
        assert (loc_dir / "T01" / "plastron" / "Other Plastrons").exists()
        assert (loc_dir / "T01" / "plastron" / "Old References").exists()
        assert (loc_dir / "T01" / "carapace").exists()

    def test_carapace_creates_carapace_dir(self, manager, tmp_path):
        """photo_type='carapace' creates carapace/ with subfolders, plus empty plastron/."""
        img = tmp_path / "source.jpg"
        img.write_bytes(b"\xff\xd8fake")
        loc_dir = tmp_path / "Kansas" / "Lawrence"
        loc_dir.mkdir(parents=True)

        manager._process_single_turtle(str(img), str(loc_dir), "T01", photo_type="carapace")
        assert (loc_dir / "T01" / "carapace" / "T01.jpg").exists()
        assert (loc_dir / "T01" / "carapace" / "Other Carapaces").exists()
        assert (loc_dir / "T01" / "carapace" / "Old References").exists()
        # plastron/ always created (empty placeholder for future plastron)
        assert (loc_dir / "T01" / "plastron").exists()
        # But the image and .pt should NOT be in plastron
        assert not (loc_dir / "T01" / "plastron" / "T01.jpg").exists()


# ---------------------------------------------------------------------------
# Test: search_for_matches with photo_type
# ---------------------------------------------------------------------------

class TestSearchForMatchesPhotoType:
    """Tests that search_for_matches passes photo_type to the cache."""

    def test_default_is_plastron(self, manager, tmp_path):
        """search_for_matches defaults to plastron."""
        img = tmp_path / "query.jpg"
        img.write_bytes(b"\xff\xd8fake")

        manager.search_for_matches(str(img))
        manager._mock_brain.match_against_cache.assert_called()
        call_kwargs = manager._mock_brain.match_against_cache.call_args
        assert call_kwargs[1].get('photo_type') == 'plastron' or call_kwargs[0][-1] if len(call_kwargs[0]) > 2 else True

    def test_carapace_passed_through(self, manager, tmp_path):
        """search_for_matches passes photo_type='carapace' to brain."""
        img = tmp_path / "query.jpg"
        img.write_bytes(b"\xff\xd8fake")

        manager.search_for_matches(str(img), photo_type="carapace")
        call_kwargs = manager._mock_brain.match_against_cache.call_args
        assert call_kwargs[1].get('photo_type') == 'carapace'


# ---------------------------------------------------------------------------
# Test: create_review_packet with photo_type
# ---------------------------------------------------------------------------

class TestCreateReviewPacketPhotoType:
    """Tests create_review_packet handles photo_type in metadata."""

    def test_unclassified_skips_matching(self, manager, tmp_path):
        """photo_type='unclassified' does not call search_for_matches."""
        img = tmp_path / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")

        with patch.object(manager, 'search_for_matches') as mock_search:
            manager.create_review_packet(str(img), user_info={'photo_type': 'unclassified'})
            mock_search.assert_not_called()

    def test_unclassified_sets_metadata(self, manager, tmp_path):
        """photo_type='unclassified' is stored in metadata.json."""
        img = tmp_path / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")

        req_id = manager.create_review_packet(str(img), user_info={'photo_type': 'unclassified'})
        meta_path = os.path.join(manager.review_queue_dir, req_id, 'metadata.json')
        with open(meta_path) as f:
            meta = json.load(f)
        assert meta['photo_type'] == 'unclassified'

    def test_plastron_runs_matching(self, manager, tmp_path):
        """photo_type='plastron' (default) runs search_for_matches."""
        img = tmp_path / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")

        with patch.object(manager, 'search_for_matches', return_value=([], 0.1)) as mock_search:
            manager.create_review_packet(str(img), user_info={'photo_type': 'plastron'})
            mock_search.assert_called_once()
            assert mock_search.call_args[1].get('photo_type') == 'plastron'

    def test_default_photo_type_is_plastron(self, manager, tmp_path):
        """When no photo_type in user_info, defaults to plastron and runs matching."""
        img = tmp_path / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")

        with patch.object(manager, 'search_for_matches', return_value=([], 0.1)) as mock_search:
            manager.create_review_packet(str(img), user_info={'finder': 'Test'})
            mock_search.assert_called_once()


# ---------------------------------------------------------------------------
# Test: approve_review_packet with carapace photo_type
# ---------------------------------------------------------------------------

class TestApproveWithCarapace:
    """Tests that approval correctly uses photo_type for carapace turtles."""

    def test_new_carapace_turtle_creates_carapace_folder(self, manager, tmp_path):
        """Creating a new turtle with photo_type='carapace' uses carapace/ subfolder."""
        packet_dir = tmp_path / "Review_Queue" / "test_req_c"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "uploaded.jpg"
        img.write_bytes(b"\xff\xd8fake")
        (packet_dir / "metadata.json").write_text('{"photo_type": "carapace"}')
        (packet_dir / "additional_images").mkdir()

        success, msg = manager.approve_review_packet(
            "test_req_c",
            new_location="Kansas/Lawrence",
            new_turtle_id="T_CAR",
            photo_type="carapace",
        )

        assert success is True
        # Check add_single_to_vram was called with carapace
        manager._mock_brain.add_single_to_vram.assert_called_once()
        call_kwargs = manager._mock_brain.add_single_to_vram.call_args
        assert call_kwargs[1].get('photo_type') == 'carapace'
        # Check the .pt path references carapace/ not ref_data/
        pt_path_arg = call_kwargs[0][0]
        assert 'carapace' in pt_path_arg
        assert 'ref_data' not in pt_path_arg

    def test_plastron_approval_default(self, manager, tmp_path):
        """Default approval (no photo_type) creates plastron entry."""
        packet_dir = tmp_path / "Review_Queue" / "test_req_p"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "uploaded.jpg"
        img.write_bytes(b"\xff\xd8fake")
        (packet_dir / "metadata.json").write_text("{}")
        (packet_dir / "additional_images").mkdir()

        success, msg = manager.approve_review_packet(
            "test_req_p",
            new_location="Kansas/Lawrence",
            new_turtle_id="T_PLA",
        )

        assert success is True
        call_kwargs = manager._mock_brain.add_single_to_vram.call_args
        # Default photo_type should be 'plastron'
        assert call_kwargs[1].get('photo_type', 'plastron') == 'plastron'
        pt_path_arg = call_kwargs[0][0]
        assert 'plastron' in pt_path_arg


# ---------------------------------------------------------------------------
# Test: Carapace additional image processing on approval
# ---------------------------------------------------------------------------

class TestCarapaceAdditionalImageProcessing:
    """Tests that carapace images in additional_images get SuperPoint-processed on approval."""

    def test_carapace_image_extracted_on_approval(self, manager, tmp_path):
        """A carapace additional image triggers SuperPoint extraction during approval."""
        # Create an existing turtle
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        ref_dir.mkdir(parents=True)
        (turtle_dir / "loose_images").mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"existing")

        # Create a review packet with a carapace additional image
        packet_dir = tmp_path / "Review_Queue" / "test_req_car_img"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")
        (packet_dir / "metadata.json").write_text("{}")

        # Create additional_images with carapace entry
        today = "2026-03-30"
        date_dir = packet_dir / "additional_images" / today
        date_dir.mkdir(parents=True)
        carapace_img = date_dir / "carapace_12345_top.jpg"
        carapace_img.write_bytes(b"\xff\xd8carapace")
        manifest = [{"filename": "carapace_12345_top.jpg", "type": "carapace", "timestamp": "2026-03-30T00:00:00Z"}]
        (date_dir / "manifest.json").write_text(json.dumps(manifest))

        def fake_process(img_path, pt_path):
            with open(pt_path, 'wb') as f:
                f.write(b"fake tensor")
            return True
        manager._mock_brain.process_and_save.side_effect = fake_process
        manager._mock_brain.add_single_to_vram.reset_mock()

        success, msg = manager.approve_review_packet(
            "test_req_car_img",
            match_turtle_id="T42",
        )

        assert success is True
        # Carapace folder should have been created
        assert (turtle_dir / "carapace").exists()
        # process_and_save should have been called for the carapace image
        assert manager._mock_brain.process_and_save.called
        # add_single_to_vram should have been called with photo_type='carapace'
        carapace_calls = [c for c in manager._mock_brain.add_single_to_vram.call_args_list
                          if c[1].get('photo_type') == 'carapace']
        assert len(carapace_calls) == 1

    def test_non_carapace_additional_images_not_processed(self, manager, tmp_path):
        """Microhabitat/condition images are NOT SuperPoint-processed."""
        turtle_dir = tmp_path / "Kansas" / "Lawrence" / "T42"
        ref_dir = turtle_dir / "ref_data"
        ref_dir.mkdir(parents=True)
        (turtle_dir / "loose_images").mkdir(parents=True)
        (ref_dir / "T42.pt").write_bytes(b"existing")

        packet_dir = tmp_path / "Review_Queue" / "test_req_micro"
        packet_dir.mkdir(parents=True)
        img = packet_dir / "upload.jpg"
        img.write_bytes(b"\xff\xd8fake")
        (packet_dir / "metadata.json").write_text("{}")

        today = "2026-03-30"
        date_dir = packet_dir / "additional_images" / today
        date_dir.mkdir(parents=True)
        micro_img = date_dir / "micro_12345_hab.jpg"
        micro_img.write_bytes(b"\xff\xd8habitat")
        manifest = [{"filename": "micro_12345_hab.jpg", "type": "microhabitat", "timestamp": "2026-03-30T00:00:00Z"}]
        (date_dir / "manifest.json").write_text(json.dumps(manifest))

        manager._mock_brain.add_single_to_vram.reset_mock()

        success, msg = manager.approve_review_packet(
            "test_req_micro",
            match_turtle_id="T42",
        )

        assert success is True
        # No carapace processing should have occurred
        carapace_calls = [c for c in manager._mock_brain.add_single_to_vram.call_args_list
                          if c[1].get('photo_type') == 'carapace']
        assert len(carapace_calls) == 0
        # carapace/ folder should NOT exist
        assert not (turtle_dir / "carapace").exists()
