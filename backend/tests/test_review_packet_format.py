"""
Unit tests: review queue packet JSON shape and match_search_pending semantics.
"""

import json
import os

import pytest

from routes.review import format_review_packet_item


def _write_minimal_jpeg(path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\xff\xd8\xff" + b"\x00" * 97)


@pytest.fixture
def packet_dir(tmp_path):
    return tmp_path / "Req_unit_test_packet"


def test_match_search_pending_true_when_candidate_matches_missing(packet_dir):
    """Before SuperPoint finishes, candidate_matches dir does not exist."""
    packet_dir.mkdir()
    _write_minimal_jpeg(str(packet_dir / "query.jpg"))
    item = format_review_packet_item(str(packet_dir), "Req_unit_test_packet")
    assert item["match_search_pending"] is True
    assert item["match_search_failed"] is False
    assert item["match_search_error"] is None
    assert item["candidates"] == []
    assert item["request_id"] == "Req_unit_test_packet"


def test_match_search_failed_marker_not_pending(packet_dir):
    """After create_review_packet errors before candidate_matches, API must not stay pending."""
    packet_dir.mkdir()
    _write_minimal_jpeg(str(packet_dir / "query.jpg"))
    with open(packet_dir / "match_search_failed.json", "w") as f:
        json.dump({"error": "GPU oops"}, f)
    item = format_review_packet_item(str(packet_dir), "Req_unit_test_packet")
    assert item["match_search_pending"] is False
    assert item["match_search_failed"] is True
    assert item["match_search_error"] == "GPU oops"
    assert item["candidates"] == []


def test_match_search_pending_false_when_candidate_matches_empty_dir(packet_dir):
    """After search with zero matches, candidate_matches exists but has no images."""
    packet_dir.mkdir()
    (packet_dir / "candidate_matches").mkdir()
    _write_minimal_jpeg(str(packet_dir / "query.jpg"))
    with open(packet_dir / "metadata.json", "w") as f:
        json.dump({"finder": "test"}, f)
    item = format_review_packet_item(str(packet_dir), "Req_unit_test_packet")
    assert item["match_search_pending"] is False
    assert item["match_search_failed"] is False
    assert item["candidates"] == []
    assert item["metadata"].get("finder") == "test"


def test_admin_prefix_missing_candidates_is_failed_not_pending(packet_dir):
    """Legacy staff/admin /api/upload failures leave no candidate_matches and no marker file."""
    packet_dir.mkdir()
    _write_minimal_jpeg(str(packet_dir / "query.jpg"))
    item = format_review_packet_item(str(packet_dir), "admin_123_photo.jpg")
    assert item["match_search_pending"] is False
    assert item["match_search_failed"] is True
    assert item["match_search_error"]
    assert item["candidates"] == []


def test_match_search_pending_false_with_ranked_candidate(packet_dir):
    """Non-empty candidate_matches yields candidates and not pending."""
    packet_dir.mkdir()
    cm = packet_dir / "candidate_matches"
    cm.mkdir()
    _write_minimal_jpeg(str(packet_dir / "query.jpg"))
    _write_minimal_jpeg(str(cm / "Rank1_IDT42_Conf85.jpg"))
    item = format_review_packet_item(str(packet_dir), "Req_unit_test_packet")
    assert item["match_search_pending"] is False
    assert item["match_search_failed"] is False
    assert len(item["candidates"]) == 1
    assert item["candidates"][0]["turtle_id"] == "T42"
    assert item["candidates"][0]["rank"] == 1
    assert item["candidates"][0]["confidence"] == 85
