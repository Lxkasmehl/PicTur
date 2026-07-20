"""
Unit tests: ``TurtleManager.search_for_matches`` accepts a list location filter
(scoped-group areas) without crashing, appends the shared pools, dedupes, and
keeps the single-string behavior byte-identical. ``brain`` is mocked so no
SuperPoint/LightGlue runs.
"""

from unittest.mock import MagicMock

import pytest

import turtle_manager as tm


@pytest.fixture
def mgr(tmp_path, monkeypatch):
    # Mock the heavy brain calls; capture the location filter passed to the cache.
    monkeypatch.setattr(tm.brain, "extract_query_features", lambda p: {"q": 1})
    if hasattr(tm.brain, "load_database_to_vram"):
        monkeypatch.setattr(tm.brain, "load_database_to_vram", MagicMock())
    match_mock = MagicMock(return_value=[])
    monkeypatch.setattr(tm.brain, "match_against_cache", match_mock)
    manager = tm.TurtleManager(base_data_dir=str(tmp_path))
    manager._match_mock = match_mock
    return manager


def _first_filter(mgr):
    """The loc_filter passed to the first match_against_cache call."""
    args, kwargs = mgr._match_mock.call_args_list[0]
    return args[1] if len(args) > 1 else kwargs.get("location_filter")


def test_list_filter_appends_pools_and_dedupes(mgr):
    mgr.search_for_matches("q.jpg", location_filter=["Kansas/Topeka", "Kansas/Lawrence"])
    assert _first_filter(mgr) == [
        "Kansas/Topeka", "Kansas/Lawrence", "Community_Uploads", "Incidental Places",
    ]


def test_list_filter_dedupes_when_pool_already_present(mgr):
    mgr.search_for_matches("q.jpg", location_filter=["Community_Uploads", "Kansas/Topeka"])
    assert _first_filter(mgr) == ["Community_Uploads", "Kansas/Topeka", "Incidental Places"]


def test_empty_list_filter_treated_as_all(mgr):
    mgr.search_for_matches("q.jpg", location_filter=[])
    assert _first_filter(mgr) is None


def test_list_filter_drops_blank_entries(mgr):
    mgr.search_for_matches("q.jpg", location_filter=["", "  ", "Kansas/Topeka"])
    assert _first_filter(mgr) == ["Kansas/Topeka", "Community_Uploads", "Incidental Places"]


def test_string_filter_behavior_unchanged(mgr):
    mgr.search_for_matches("q.jpg", location_filter="Kansas")
    assert _first_filter(mgr) == ["Kansas", "Community_Uploads", "Incidental Places"]


def test_string_community_uploads_unchanged(mgr):
    mgr.search_for_matches("q.jpg", location_filter="Community_Uploads")
    assert _first_filter(mgr) == ["Community_Uploads"]


def test_none_and_all_locations_unchanged(mgr):
    mgr.search_for_matches("q.jpg", location_filter=None)
    assert _first_filter(mgr) is None
    mgr._match_mock.reset_mock()
    mgr.search_for_matches("q.jpg", location_filter="All Locations")
    assert _first_filter(mgr) is None
