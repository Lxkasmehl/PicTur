"""
Tests for the undeletable-turtle-dataset guard (turtle_manager/safe_fs.py) and
the archive-instead-of-delete flows wired through it.

The pure guard tests import ``safe_fs`` standalone (turtle_manager/ appended to
sys.path) so they never load SuperPoint/torch. The flow tests reuse the
mocked-brain TurtleManager fixture pattern from the rest of the suite.
"""
import importlib
import json
import os
import sys
import threading
import time
import types
from unittest.mock import MagicMock, patch

import pytest

# --- import safe_fs standalone (pure; no brain) --------------------------------
_TM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "turtle_manager")
if _TM_DIR not in sys.path:
    sys.path.append(_TM_DIR)
import safe_fs  # noqa: E402

# Import the real turtle_manager once at module level so numpy/cv2/torch become
# resident in the base sys.modules BEFORE the flow fixtures run. The flow fixture
# reloads turtle_manager inside a patch.dict(sys.modules, ...); if numpy were
# first imported inside that block it would be evicted on teardown and re-init
# on the next test, which numpy forbids ("cannot load module more than once").
import turtle_manager  # noqa: E402,F401


def _make_turtle_folder(base, *parts, marker="plastron"):
    """Create ``base/parts.../<marker>/`` and return the turtle-folder path."""
    d = os.path.join(base, *parts)
    os.makedirs(os.path.join(d, marker), exist_ok=True)
    return d


# ==============================================================================
# Guard unit matrix — assert_not_turtle_data / guarded_rmtree / guarded_rmdir
# ==============================================================================

class TestGuardMatrix:
    def _refuse(self, path, base):
        with pytest.raises(safe_fs.UndeletableTurtleDataError):
            safe_fs.assert_not_turtle_data(path, base)

    def _allow(self, path, base):
        safe_fs.assert_not_turtle_data(path, base)  # must not raise

    # (a) a turtle folder itself
    def test_refuse_turtle_folder(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        self._refuse(t, base)
        with pytest.raises(safe_fs.UndeletableTurtleDataError):
            safe_fs.guarded_rmtree(t, base)
        assert os.path.isdir(t)  # untouched by the refused rmtree

    # (b) the location ancestor
    def test_refuse_location_ancestor(self, tmp_path):
        base = str(tmp_path)
        _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        self._refuse(os.path.join(base, "Kansas", "Lawrence"), base)

    # (c) the state ancestor
    def test_refuse_state_ancestor(self, tmp_path):
        base = str(tmp_path)
        _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        self._refuse(os.path.join(base, "Kansas"), base)

    # (d) a combo-sheet turtle (carapace marker)
    def test_refuse_combo_sheet_turtle(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "NebraskaCPBS", "CPBS", "F233", marker="carapace")
        self._refuse(t, base)
        # and its combo-sheet ancestor
        self._refuse(os.path.join(base, "NebraskaCPBS"), base)

    # (e) a community turtle folder (Community_Uploads is NOT exempt)
    def test_refuse_community_turtle(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "Community_Uploads", "SheetA", "F900")
        self._refuse(t, base)

    # legacy ref_data/ marker is protected too
    def test_refuse_legacy_ref_data_turtle(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "Kansas", "Topeka", "M010", marker="ref_data")
        self._refuse(t, base)

    # (f) an empty dir
    def test_allow_empty_dir(self, tmp_path):
        base = str(tmp_path)
        d = os.path.join(base, "EmptyLoc")
        os.makedirs(d)
        self._allow(d, base)
        safe_fs.guarded_rmtree(d, base)
        assert not os.path.exists(d)

    # (g) a Review_Queue packet (candidate_matches, but no ref marker)
    def test_allow_review_queue_packet(self, tmp_path):
        base = str(tmp_path)
        pkt = os.path.join(base, "Review_Queue", "Req_1")
        os.makedirs(os.path.join(pkt, "candidate_matches"))
        self._allow(pkt, base)
        safe_fs.guarded_rmtree(pkt, base)
        assert not os.path.exists(pkt)

    # (h) a system-tempdir path (turtle-shaped but outside base) is exempt
    def test_allow_system_tempdir(self, tmp_path, monkeypatch):
        base = str(tmp_path / "data")
        os.makedirs(base)
        fake_tmp = str(tmp_path / "systmp")
        turtle_in_tmp = _make_turtle_folder(fake_tmp, "staging_turtle")
        monkeypatch.setattr(safe_fs.tempfile, "gettempdir", lambda: fake_tmp)
        # It IS turtle-shaped, but living under the system tempdir and outside the
        # data root makes it exempt (upload staging).
        assert safe_fs.is_or_contains_turtle_data(turtle_in_tmp) is True
        self._allow(turtle_in_tmp, base)

    # (i) an archived turtle folder under _Archive is PROTECTED (it holds real
    # photos — a rolled-back new turtle can be the sole copy). Only the explicit
    # --force-destroy-dataset path (which bypasses the guard) may purge _Archive.
    def test_refuse_archived_turtle(self, tmp_path):
        base = str(tmp_path)
        arch_turtle = _make_turtle_folder(base, "_Archive", "20260722_old", "F1")
        self._refuse(arch_turtle, base)

    # guarded_rmdir: empty allowed, non-empty turtle refused
    def test_guarded_rmdir_semantics(self, tmp_path):
        base = str(tmp_path)
        empty = os.path.join(base, "e")
        os.makedirs(empty)
        safe_fs.guarded_rmdir(empty, base)
        assert not os.path.exists(empty)
        t = _make_turtle_folder(base, "Kansas", "L", "F004")
        with pytest.raises(safe_fs.UndeletableTurtleDataError):
            safe_fs.guarded_rmdir(t, base)
        assert os.path.isdir(t)

    # fail-closed: an OSError while probing → treated as protected (True)
    def test_fail_closed_on_oserror(self, tmp_path, monkeypatch):
        d = tmp_path / "someloc"
        d.mkdir()  # empty → would normally be False

        def boom(*a, **k):
            raise OSError("boom")

        monkeypatch.setattr(safe_fs.os, "walk", boom)
        assert safe_fs.is_or_contains_turtle_data(str(d)) is True

    def test_is_or_contains_variants(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        assert safe_fs.is_or_contains_turtle_data(t) is True
        assert safe_fs.is_or_contains_turtle_data(os.path.dirname(t)) is True
        assert safe_fs.is_or_contains_turtle_data(os.path.join(base, "Kansas")) is True
        assert safe_fs.is_or_contains_turtle_data(str(tmp_path / "nope")) is False  # missing


# ==============================================================================
# archive_turtle_folder
# ==============================================================================

class TestArchive:
    def test_archive_moves_and_returns_existing_path(self, tmp_path):
        base = str(tmp_path)
        t = _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        with open(os.path.join(t, "plastron", "F004.pt"), "wb") as f:
            f.write(b"tensor")

        dest = safe_fs.archive_turtle_folder(t, base)

        assert os.path.isdir(dest)
        assert os.path.commonpath([dest, os.path.join(base, "_Archive")]) == os.path.join(base, "_Archive")
        assert not os.path.exists(t)  # original no longer at source
        assert os.path.isfile(os.path.join(dest, "plastron", "F004.pt"))  # content preserved

    def test_archive_collision_gets_counter_suffix(self, tmp_path, monkeypatch):
        base = str(tmp_path)
        # Freeze the timestamp so two archives of the same relpath collide.
        monkeypatch.setattr(safe_fs.time, "strftime", lambda fmt, *a: "FIXEDTS")

        t1 = _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        d1 = safe_fs.archive_turtle_folder(t1, base)
        t2 = _make_turtle_folder(base, "Kansas", "Lawrence", "F004")
        d2 = safe_fs.archive_turtle_folder(t2, base)

        assert d1 != d2
        assert os.path.basename(d2).endswith("__1")
        assert os.path.isdir(d1) and os.path.isdir(d2)

    def test_archive_rejects_missing_source(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            safe_fs.archive_turtle_folder(str(tmp_path / "does_not_exist"), str(tmp_path))


# ==============================================================================
# Flow tests — merge / rollback / additional-image delete run against tmp folders
# ==============================================================================

def _make_mock_brain():
    mock = MagicMock()
    mock.vram_cache_plastron = []
    mock.vram_cache_carapace = []
    mock.process_and_save = MagicMock(return_value=True)
    mock.add_single_to_vram = MagicMock(return_value=True)
    mock.load_database_to_vram = MagicMock()
    mock.extract_query_features = MagicMock(return_value=["fake_feats"])
    mock.match_against_cache = MagicMock(return_value=[])

    def _filter_vram_cache(keep_fn, photo_type="plastron"):
        attr = "vram_cache_carapace" if photo_type == "carapace" else "vram_cache_plastron"
        cache = getattr(mock, attr)
        kept = [c for c in cache if keep_fn(c)]
        removed = len(cache) - len(kept)
        setattr(mock, attr, kept)
        return removed

    def _evict_from_vram(pt_path, photo_type="plastron"):
        return _filter_vram_cache(lambda c: c.get("file_path") != pt_path, photo_type)

    mock.filter_vram_cache = MagicMock(side_effect=_filter_vram_cache)
    mock.evict_from_vram = MagicMock(side_effect=_evict_from_vram)
    return mock


@pytest.fixture()
def manager(tmp_path):
    mock_brain = _make_mock_brain()
    with patch.dict("sys.modules", {
        "turtles.image_processing": MagicMock(brain=mock_brain),
        "turtles": MagicMock(),
    }):
        with patch("turtle_manager.brain", mock_brain):
            import turtle_manager
            importlib.reload(turtle_manager)
            mgr = turtle_manager.TurtleManager(base_data_dir=str(tmp_path))
            mgr._mock_brain = mock_brain
            yield mgr
            importlib.reload(turtle_manager)


def test_merge_archives_secondary_not_deleted(manager, tmp_path):
    """merge_turtles archives the secondary folder under _Archive/ (not rmtree)."""
    pri = tmp_path / "Kansas" / "Lawrence" / "T_PRI"
    (pri / "plastron").mkdir(parents=True)
    sec = tmp_path / "Kansas" / "Lawrence" / "T_SEC"
    (sec / "plastron").mkdir(parents=True)
    (sec / "plastron" / "keep_me.txt").write_text("secondary payload")

    # Neutralize Google Sheets: no service → merge skips all Sheets steps.
    fake_services = types.ModuleType("services")
    fake_ms = types.ModuleType("services.manager_service")
    fake_ms.get_sheets_service = lambda: None
    with patch.dict(sys.modules, {"services": fake_services, "services.manager_service": fake_ms}):
        ok, msg = manager.merge_turtles(
            "T_PRI", "T_SEC",
            primary_sheet="Kansas/Lawrence", secondary_sheet="Kansas/Lawrence",
        )

    assert ok, msg
    assert not sec.exists(), "secondary must be moved out of its original location"
    archive_root = tmp_path / "_Archive"
    assert archive_root.is_dir()
    survivors = list(archive_root.rglob("keep_me.txt"))
    assert survivors, "secondary folder must be archived (recoverable), not destroyed"


def test_rollback_archives_new_turtle(manager, tmp_path):
    """rollback_new_turtle archives the folder instead of rmtree-ing it."""
    t = tmp_path / "Kansas" / "Lawrence" / "F050"
    (t / "plastron").mkdir(parents=True)
    (t / "plastron" / "F050.pt").write_bytes(b"tensor")

    manager.rollback_new_turtle("F050", "Kansas/Lawrence", photo_type="plastron")

    assert not t.exists()
    archive_root = tmp_path / "_Archive"
    assert archive_root.is_dir()
    assert list(archive_root.rglob("F050.pt")), "rolled-back folder must be archived, not deleted"


def test_rollback_missing_folder_is_noop(manager, tmp_path):
    """Rollback of a folder that doesn't exist creates nothing and doesn't crash."""
    manager.rollback_new_turtle("F999", "Kansas/Lawrence", photo_type="plastron")
    assert not (tmp_path / "_Archive").exists()


def test_additional_image_delete_is_soft_delete(manager, tmp_path):
    """remove_additional_image_from_turtle moves the image under Deleted/, not os.remove."""
    tdir = tmp_path / "Kansas" / "Lawrence" / "F004"
    (tdir / "plastron").mkdir(parents=True)
    date_dir = tdir / "additional_images" / "2026-07-22"
    date_dir.mkdir(parents=True)
    img = date_dir / "microhabitat_1_2026-07-22_photo.jpg"
    img.write_bytes(b"\xff\xd8image")
    (date_dir / "manifest.json").write_text(
        json.dumps([{"filename": img.name, "type": "microhabitat"}])
    )

    ok, err = manager.remove_additional_image_from_turtle(
        "F004", img.name, sheet_name="Kansas/Lawrence"
    )

    assert ok, err
    assert not img.exists(), "original image must be moved, not left in place"
    moved = tdir / "Deleted" / "additional_images" / "2026-07-22" / img.name
    assert moved.is_file(), "image must be soft-deleted under Deleted/ (recoverable)"
    # manifest entry removed
    assert json.loads((date_dir / "manifest.json").read_text()) == []


def test_additional_image_soft_delete_preserves_labels(manager, tmp_path):
    """Regression: the image's tags must FOLLOW it into Deleted/, not be dropped.

    The label migration reads the source manifest, so it must run BEFORE the
    source entry is pruned — otherwise the labels are gone by the time they'd be
    copied to the Deleted/ manifest.
    """
    from additional_image_labels import read_labels_for_file

    tdir = tmp_path / "Kansas" / "Lawrence" / "F004"
    (tdir / "plastron").mkdir(parents=True)
    date_dir = tdir / "additional_images" / "2026-07-22"
    date_dir.mkdir(parents=True)
    img = date_dir / "microhabitat_1_2026-07-22_photo.jpg"
    img.write_bytes(b"\xff\xd8image")
    (date_dir / "manifest.json").write_text(
        json.dumps([{"filename": img.name, "type": "microhabitat", "labels": ["shell rot", "mud"]}])
    )

    ok, err = manager.remove_additional_image_from_turtle(
        "F004", img.name, sheet_name="Kansas/Lawrence"
    )
    assert ok, err

    deleted_dir = tdir / "Deleted" / "additional_images" / "2026-07-22"
    assert (deleted_dir / img.name).is_file()
    # The tags followed the image into Deleted/ (this fails if the source entry
    # is pruned before migration).
    assert read_labels_for_file(str(deleted_dir), img.name) == ["shell rot", "mud"]
    # And the source manifest no longer references the moved file.
    assert json.loads((date_dir / "manifest.json").read_text()) == []


def test_archived_turtle_not_resolved(manager, tmp_path):
    """A live turtle resolves to its live folder, never to an archived copy.

    An archived folder is named "<ts>_State__Location__F###", whose basename
    endswith "_F###" and would otherwise be matched by the id resolver.
    """
    live = tmp_path / "Kansas" / "Lawrence" / "F077"
    (live / "plastron").mkdir(parents=True)
    archived = tmp_path / "_Archive" / "20260722T000000Z_Kansas__Lawrence__F077" / "plastron"
    archived.mkdir(parents=True)

    resolved = manager._get_turtle_folder("F077", "Kansas/Lawrence")
    assert resolved is not None
    assert "_Archive" not in resolved
    assert os.path.normcase(os.path.abspath(resolved)) == os.path.normcase(str(live))


def test_archive_excluded_from_locations_and_index(manager, tmp_path):
    """_Archive is excluded from get_all_locations() and pruned from the VRAM index."""
    live = tmp_path / "Kansas" / "Lawrence" / "F004" / "plastron"
    live.mkdir(parents=True)
    (live / "F004.pt").write_bytes(b"tensor")
    arch = tmp_path / "_Archive" / "20260722_gone" / "plastron"
    arch.mkdir(parents=True)
    (arch / "F004.pt").write_bytes(b"tensor")

    manager.refresh_database_index()
    indexed_paths = [entry[0] for entry in manager.db_index]
    assert any("F004.pt" in p and "_Archive" not in p for p in indexed_paths)
    assert not any("_Archive" in p for p in indexed_paths), "archived .pt must not match"

    locations = manager.get_all_locations()
    assert "_Archive" not in locations
    assert not any(str(loc).startswith("_Archive") for loc in locations)
