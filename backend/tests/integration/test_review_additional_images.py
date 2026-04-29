"""
Integration tests: Review queue additional images (microhabitat/condition) and single packet GET.
Run against backend in Docker: BACKEND_URL and AUTH_URL must be set; fixture data includes test_req_001.
"""

import json
import os
import pytest
from io import BytesIO


def _make_dummy_image(path, size=100):
    """Write a minimal binary file that can be sent as image (e.g. JPEG)."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\xff\xd8\xff" + b"\x00" * (size - 3))
    return path


# Request ID from fixture data (backend/tests/fixture-data/Review_Queue/test_req_001)
REVIEW_PACKET_REQUEST_ID = "test_req_001"


@pytest.fixture
def review_packet_dir(tmp_path):
    """Return request_id and packet_dir path hint for tests. Data lives in Docker-mounted fixture."""
    return REVIEW_PACKET_REQUEST_ID, None


def test_get_review_queue_empty(client):
    """GET /api/review-queue returns success; items is a list (empty or fixture packet only)."""
    r = client.get("/api/review-queue")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert isinstance(data["items"], list)
    # Fixture may have test_req_001 or be empty
    if len(data["items"]) == 1:
        assert data["items"][0].get("request_id") == REVIEW_PACKET_REQUEST_ID


def test_get_review_queue_with_packet(client, review_packet_dir):
    """GET /api/review-queue returns the packet with additional_images and structure."""
    request_id, _ = review_packet_dir
    r = client.get("/api/review-queue")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert len(data["items"]) >= 1
    item = next((i for i in data["items"] if i["request_id"] == request_id), None)
    assert item is not None
    assert "uploaded_image" in item
    assert item.get("additional_images") == []
    assert item.get("candidates") == []
    assert item.get("match_search_pending") is False
    assert item.get("match_search_failed") is False
    assert item.get("match_search_error") is None
    assert item.get("status") == "pending"


def test_get_review_packet_not_found(client):
    """GET /api/review-queue/<id> returns 404 for unknown request_id."""
    r = client.get("/api/review-queue/nonexistent_id_123")
    assert r.status_code == 404
    data = r.json()
    assert "error" in data or "Request not found" in str(data)


def test_get_review_packet_success(client, review_packet_dir):
    """GET /api/review-queue/<id> returns single packet with same shape as queue item."""
    request_id, _ = review_packet_dir
    r = client.get(f"/api/review-queue/{request_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    item = data["item"]
    assert item["request_id"] == request_id
    assert "uploaded_image" in item
    assert "additional_images" in item
    assert "candidates" in item
    assert "metadata" in item
    assert item.get("match_search_pending") is False
    assert item.get("match_search_failed") is False


def test_add_additional_images_no_files(client, review_packet_dir):
    """POST additional-images with no valid files returns 400."""
    request_id, _ = review_packet_dir
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={},
    )
    assert r.status_code == 400
    data = r.json()
    assert "error" in data


def test_add_additional_images_success(client, review_packet_dir, tmp_path):
    """POST additional-images with file_0 and type_0 adds image to packet."""
    request_id, _ = review_packet_dir
    img_path = str(tmp_path / "micro.jpg")
    _make_dummy_image(img_path)
    with open(img_path, "rb") as f:
        file_data = f.read()
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("micro.jpg", BytesIO(file_data)),
            "type_0": "microhabitat",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "Added" in data.get("message", "")

    r2 = client.get(f"/api/review-queue/{request_id}")
    assert r2.status_code == 200
    item = r2.json()["item"]
    assert len(item["additional_images"]) >= 1
    added = item["additional_images"][0]
    assert added.get("type") == "microhabitat"
    assert "filename" in added


def test_add_additional_images_carapace_with_labels(client, review_packet_dir, tmp_path):
    """POST with type carapace and labels_0; GET packet lists normalized labels."""
    request_id, _ = review_packet_dir
    img_path = str(tmp_path / "cap_labeled.jpg")
    _make_dummy_image(img_path)
    with open(img_path, "rb") as f:
        file_data = f.read()
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("cap_labeled.jpg", BytesIO(file_data)),
            "type_0": "carapace",
            "labels_0": "shell crack, e2e_review_label",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True

    r2 = client.get(f"/api/review-queue/{request_id}")
    assert r2.status_code == 200
    item = r2.json()["item"]
    cap = next((a for a in item["additional_images"] if a.get("type") == "carapace"), None)
    assert cap is not None
    labels = cap.get("labels") or []
    assert any("crack" in str(x).lower() for x in labels)
    assert any("e2e_review_label" in str(x) for x in labels)


def test_add_additional_images_right_side_type(client, review_packet_dir, tmp_path):
    """POST with new category (right-side) is accepted and persisted in packet manifest output."""
    request_id, _ = review_packet_dir
    img_path = str(tmp_path / "right_side.jpg")
    _make_dummy_image(img_path)
    with open(img_path, "rb") as f:
        file_data = f.read()
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("right_side.jpg", BytesIO(file_data)),
            "type_0": "right-side",
            "labels_0": "burned, right_side_e2e",
        },
    )
    assert r.status_code == 200
    assert r.json().get("success") is True

    r2 = client.get(f"/api/review-queue/{request_id}")
    assert r2.status_code == 200
    item = r2.json()["item"]
    right_side = next((a for a in item["additional_images"] if a.get("type") == "right-side"), None)
    assert right_side is not None
    labels = right_side.get("labels") or []
    assert any("right_side_e2e" in str(x) for x in labels)


def test_remove_additional_image_no_filename(client, review_packet_dir):
    """DELETE additional-images with no filename in body returns 400."""
    request_id, _ = review_packet_dir
    r = client.delete(
        f"/api/review-queue/{request_id}/additional-images",
        json={},
        content_type="application/json",
    )
    assert r.status_code == 400


def test_remove_additional_image_success(client, review_packet_dir, tmp_path):
    """Add one image then DELETE by filename; packet then has no additional images."""
    request_id, _ = review_packet_dir
    img_path = str(tmp_path / "cond.jpg")
    _make_dummy_image(img_path)
    with open(img_path, "rb") as f:
        data = f.read()
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("cond.jpg", BytesIO(data)),
            "type_0": "condition",
        },
    )
    assert r.status_code == 200
    r2 = client.get(f"/api/review-queue/{request_id}")
    item = r2.json()["item"]
    assert len(item["additional_images"]) >= 1
    filename = item["additional_images"][0]["filename"]

    r3 = client.delete(
        f"/api/review-queue/{request_id}/additional-images",
        json={"filename": filename},
        content_type="application/json",
    )
    assert r3.status_code == 200
    r4 = client.get(f"/api/review-queue/{request_id}")
    remaining = r4.json()["item"]["additional_images"]
    assert not any(a.get("filename") == filename for a in remaining)


def test_add_two_images_then_remove_both(client, review_packet_dir, tmp_path):
    """Add microhabitat and condition image, verify both appear; remove one, verify; remove other, verify empty."""
    request_id, _ = review_packet_dir
    micro_path = str(tmp_path / "micro.jpg")
    cond_path = str(tmp_path / "cond.jpg")
    _make_dummy_image(micro_path)
    _make_dummy_image(cond_path)
    with open(micro_path, "rb") as f:
        micro_data = f.read()
    with open(cond_path, "rb") as f:
        cond_data = f.read()

    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("micro.jpg", BytesIO(micro_data)),
            "type_0": "microhabitat",
            "file_1": ("cond.jpg", BytesIO(cond_data)),
            "type_1": "condition",
        },
    )
    assert r.status_code == 200
    r2 = client.get(f"/api/review-queue/{request_id}")
    item = r2.json()["item"]
    additional = item["additional_images"]
    assert len(additional) >= 2
    types = {a.get("type") for a in additional}
    assert "microhabitat" in types
    assert "condition" in types

    # Remove first (microhabitat)
    micro_entry = next((a for a in additional if a.get("type") == "microhabitat"), None)
    assert micro_entry is not None
    r3 = client.delete(
        f"/api/review-queue/{request_id}/additional-images",
        json={"filename": micro_entry["filename"]},
        content_type="application/json",
    )
    assert r3.status_code == 200
    r4 = client.get(f"/api/review-queue/{request_id}")
    remaining = r4.json()["item"]["additional_images"]
    assert not any(a.get("filename") == micro_entry["filename"] for a in remaining)
    assert len(remaining) >= 1

    # Remove second (condition)
    cond_entry = next((a for a in remaining if a.get("type") == "condition"), None)
    assert cond_entry is not None
    r5 = client.delete(
        f"/api/review-queue/{request_id}/additional-images",
        json={"filename": cond_entry["filename"]},
        content_type="application/json",
    )
    assert r5.status_code == 200
    r6 = client.get(f"/api/review-queue/{request_id}")
    final = r6.json()["item"]["additional_images"]
    assert not any(a.get("filename") == cond_entry["filename"] for a in final)


def test_z_approve_merges_packet_additional_into_turtle(client, review_packet_dir, tmp_path):
    """
    Add additional image to packet, approve to existing turtle T42; turtle's additional_images
    must contain the merged image. Runs last (z_) so packet test_req_001 is still present.
    After this test the packet is deleted by the approve flow.
    """
    request_id, _ = review_packet_dir
    # Add one additional image to the packet
    img_path = str(tmp_path / "merge_test.jpg")
    _make_dummy_image(img_path)
    with open(img_path, "rb") as f:
        img_data = f.read()
    r = client.post(
        f"/api/review-queue/{request_id}/additional-images",
        data={
            "file_0": ("merge_test.jpg", BytesIO(img_data)),
            "type_0": "microhabitat",
        },
    )
    assert r.status_code == 200
    r2 = client.get(f"/api/review-queue/{request_id}")
    packet_additional = r2.json()["item"]["additional_images"]
    assert len(packet_additional) >= 1
    merged_filename = packet_additional[0]["filename"]

    # Resolve query image path (fixture has query.jpg in packet dir); backend finds it
    # Approve to T42 (fixture Kansas/Topeka/T42)
    approve_payload = {
        "match_turtle_id": "T42",
        "uploaded_image_path": None,  # backend will find query.jpg in packet_dir
    }
    r3 = client.post(
        f"/api/review/{request_id}/approve",
        json=approve_payload,
    )
    assert r3.status_code == 200, r3.json()

    # Turtle T42 should have the packet's additional image merged in (plus any existing)
    r4 = client.get("/api/turtles/images?turtle_id=T42&sheet_name=Kansas/Topeka")
    assert r4.status_code == 200
    turtle_additional = r4.json()["additional"]
    # API returns path, not filename; derive filename from path
    filenames = [os.path.basename(a.get("path", "")) for a in turtle_additional]
    assert merged_filename in filenames, f"Expected {merged_filename} in turtle additional_images: {filenames}"
