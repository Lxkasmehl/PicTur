"""
Integration tests: GET /api/turtles/images, POST /api/turtles/images/primaries,
POST/DELETE /api/turtles/images/additional.
Run against backend in Docker; fixture data includes Kansas/Topeka/T42 with ref_data, additional, loose.
"""

import os
import pytest
from io import BytesIO

# From fixture data: backend/tests/fixture-data/Kansas/Topeka/T42
TURTLE_WITH_IMAGES = {
    "turtle_id": "T42",
    "location": "Kansas/Topeka",
    "additional_filename": "microhabitat_123_extra.jpg",
}


@pytest.fixture
def turtle_with_images():
    """Turtle folder with ref_data, additional_images, loose_images. From fixture data."""
    return TURTLE_WITH_IMAGES


def test_get_turtle_images_no_turtle_id(client):
    """GET /api/turtles/images without turtle_id returns 400."""
    r = client.get("/api/turtles/images")
    assert r.status_code == 400


def test_get_turtle_images_not_found(client):
    """GET /api/turtles/images for unknown turtle_id returns 200 with empty primary/additional/loose."""
    r = client.get("/api/turtles/images?turtle_id=NonExistent99")
    assert r.status_code == 200
    data = r.json()
    assert data["primary"] is None
    assert data["additional"] == []
    assert data["loose"] == []


def test_get_turtle_images_success(client, turtle_with_images):
    """GET /api/turtles/images returns primary, additional, loose for existing turtle."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    r = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r.status_code == 200
    data = r.json()
    assert data["primary"] is not None
    assert "ref_data" in data["primary"] and "ref.jpg" in data["primary"]
    # At least one additional (fixture); may have more if review approve test ran first
    assert len(data["additional"]) >= 1
    additional_filenames = [os.path.basename(a.get("path", "")) for a in data["additional"]]
    assert turtle_with_images["additional_filename"] in additional_filenames
    assert any(a["type"] == "microhabitat" for a in data["additional"])
    # At least one loose (fixture has obs1.jpg); may have more if review approve test ran first
    assert len(data["loose"]) >= 1
    # `loose` entries are now dicts: {path, source, timestamp, exif_date, upload_date}
    loose_basenames = [os.path.basename(item["path"]) for item in data["loose"]]
    assert "obs1.jpg" in loose_basenames


def test_delete_turtle_additional_no_turtle_id(client):
    """DELETE /api/turtles/images/additional without turtle_id returns 400."""
    r = client.delete("/api/turtles/images/additional?filename=any.jpg")
    assert r.status_code == 400


def test_delete_turtle_additional_no_filename(client, turtle_with_images):
    """DELETE /api/turtles/images/additional without filename returns 400."""
    r = client.delete(
        f"/api/turtles/images/additional?turtle_id={turtle_with_images['turtle_id']}"
    )
    assert r.status_code == 400


def test_delete_turtle_additional_success(client, turtle_with_images):
    """DELETE /api/turtles/images/additional removes the image and updates manifest."""
    tid = turtle_with_images["turtle_id"]
    fn = turtle_with_images["additional_filename"]
    loc = turtle_with_images["location"]
    r = client.delete(
        f"/api/turtles/images/additional?turtle_id={tid}&filename={fn}&sheet_name={loc}"
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    r2 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r2.status_code == 200
    remaining = r2.json()["additional"]
    remaining_filenames = [os.path.basename(a.get("path", "")) for a in remaining]
    assert fn not in remaining_filenames, f"Deleted file {fn} should not be in {remaining_filenames}"


# --- POST /api/turtles/images/primaries (batch) ---


def test_post_primaries_batch_not_array(client):
    """POST /api/turtles/images/primaries with turtles not an array returns 400."""
    r = client.post("/api/turtles/images/primaries", json={"turtles": "not-a-list"})
    assert r.status_code == 400
    data = r.json()
    assert "error" in data


def test_post_primaries_batch_empty(client):
    """POST /api/turtles/images/primaries with empty turtles returns 200 and empty images."""
    r = client.post("/api/turtles/images/primaries", json={"turtles": []})
    assert r.status_code == 200
    data = r.json()
    assert data["images"] == []


def test_post_primaries_batch_success(client, turtle_with_images):
    """POST /api/turtles/images/primaries returns primary path for known turtle."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    r = client.post(
        "/api/turtles/images/primaries",
        json={"turtles": [{"turtle_id": tid, "sheet_name": loc}]},
    )
    assert r.status_code == 200
    data = r.json()
    assert "images" in data
    assert len(data["images"]) == 1
    assert data["images"][0]["turtle_id"] == tid
    assert data["images"][0]["primary"] is not None
    assert "ref_data" in data["images"][0]["primary"] and "ref.jpg" in data["images"][0]["primary"]


def test_post_primaries_batch_mixed(client, turtle_with_images):
    """POST /api/turtles/images/primaries with known and unknown turtles returns mix of primary or null."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    r = client.post(
        "/api/turtles/images/primaries",
        json={
            "turtles": [
                {"turtle_id": tid, "sheet_name": loc},
                {"turtle_id": "NonExistent99"},
            ]
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["images"]) == 2
    assert data["images"][0]["primary"] is not None
    assert data["images"][1]["primary"] is None


# --- POST /api/turtles/images/additional (add to turtle) ---


def _dummy_image_bytes(size=100):
    """Minimal bytes that can be sent as image (e.g. JPEG-like)."""
    return b"\xff\xd8\xff" + b"\x00" * (size - 3)


def test_post_turtle_additional_no_turtle_id(client):
    """POST /api/turtles/images/additional without turtle_id returns 400."""
    r = client.post(
        "/api/turtles/images/additional",
        data={"file_0": ("x.jpg", BytesIO(_dummy_image_bytes())), "type_0": "microhabitat"},
    )
    assert r.status_code == 400
    data = r.json()
    assert "error" in data


def test_post_turtle_additional_no_valid_files(client, turtle_with_images):
    """POST /api/turtles/images/additional with turtle_id but no file_0 returns 400."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    r = client.post(
        "/api/turtles/images/additional",
        data={"turtle_id": tid, "sheet_name": loc},
    )
    assert r.status_code == 400
    data = r.json()
    assert "error" in data


def test_post_turtle_additional_success(client, turtle_with_images):
    """POST /api/turtles/images/additional adds image to turtle folder; GET images shows it."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    img_bytes = _dummy_image_bytes()
    r = client.post(
        "/api/turtles/images/additional",
        data={
            "turtle_id": tid,
            "sheet_name": loc,
            "file_0": ("condition_e2e.jpg", BytesIO(img_bytes)),
            "type_0": "condition",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert "Added" in data.get("message", "")

    r2 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r2.status_code == 200
    additional = r2.json()["additional"]
    assert len(additional) >= 1
    types = [a["type"] for a in additional]
    assert "condition" in types


def test_post_turtle_additional_then_delete_roundtrip(client, turtle_with_images):
    """Add additional image to turtle, verify it appears, delete it by filename, verify it is gone."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    r0 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r0.status_code == 200
    before_paths = {os.path.basename(a.get("path", "")) for a in r0.json()["additional"]}

    img_bytes = _dummy_image_bytes()
    r = client.post(
        "/api/turtles/images/additional",
        data={
            "turtle_id": tid,
            "sheet_name": loc,
            "file_0": ("roundtrip_micro.jpg", BytesIO(img_bytes)),
            "type_0": "microhabitat",
        },
    )
    assert r.status_code == 200
    r2 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r2.status_code == 200
    additional = r2.json()["additional"]
    after_paths = {os.path.basename(a.get("path", "")) for a in additional}
    new_paths = after_paths - before_paths
    assert len(new_paths) == 1
    filename = new_paths.pop()

    r3 = client.delete(
        f"/api/turtles/images/additional?turtle_id={tid}&filename={filename}&sheet_name={loc}"
    )
    assert r3.status_code == 200
    r4 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r4.status_code == 200
    final_paths = {os.path.basename(a.get("path", "")) for a in r4.json()["additional"]}
    assert final_paths == before_paths
    assert filename not in final_paths


# --- Label search & PATCH ---


def test_search_labels_no_q(client):
    """GET /api/turtles/images/search-labels without q returns 400."""
    r = client.get("/api/turtles/images/search-labels")
    assert r.status_code == 400


def test_post_additional_with_labels_and_search(client, turtle_with_images):
    """POST with labels_0; GET search-labels finds the image by tag substring."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    img_bytes = _dummy_image_bytes()
    # Note: type=carapace/plastron route to Other Carapaces / Other Plastrons (no manifest),
    # so labels on those types are not currently searchable. Architectural follow-up tracked
    # in benchmarks. Use 'condition' here so labels land in additional_images/manifest.json.
    r = client.post(
        "/api/turtles/images/additional",
        data={
            "turtle_id": tid,
            "sheet_name": loc,
            "file_0": ("condition_labeled_e2e.jpg", BytesIO(img_bytes)),
            "type_0": "condition",
            "labels_0": "burned, e2e_label_smoke",
        },
    )
    assert r.status_code == 200
    r2 = client.get("/api/turtles/images/search-labels?q=burned")
    assert r2.status_code == 200
    matches = r2.json().get("matches") or []
    hit = next(
        (m for m in matches if m.get("turtle_id") == tid and m.get("filename")),
        None,
    )
    assert hit is not None
    assert any("burn" in str(x).lower() for x in (hit.get("labels") or []))


def test_patch_additional_labels(client, turtle_with_images):
    """PATCH additional-labels updates manifest; GET images reflects new labels."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    img_bytes = _dummy_image_bytes()
    r_add = client.post(
        "/api/turtles/images/additional",
        data={
            "turtle_id": tid,
            "sheet_name": loc,
            "file_0": ("patch_label_target.jpg", BytesIO(img_bytes)),
            "type_0": "condition",
        },
    )
    assert r_add.status_code == 200
    r0 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r0.status_code == 200
    additional = r0.json()["additional"]
    fn = next(
        (os.path.basename(a.get("path", "")) for a in additional if "patch_label_target" in (a.get("path") or "")),
        None,
    )
    assert fn, "uploaded file should appear in additional list"

    r = client.patch(
        "/api/turtles/images/additional-labels",
        json={"turtle_id": tid, "sheet_name": loc, "filename": fn, "labels": ["patch_test_tag"]},
    )
    assert r.status_code == 200
    assert r.json().get("success") is True

    r2 = client.get(f"/api/turtles/images?turtle_id={tid}&sheet_name={loc}")
    assert r2.status_code == 200
    rows = r2.json()["additional"]
    row = next((a for a in rows if os.path.basename(a.get("path", "")) == fn), None)
    assert row is not None
    assert "patch_test_tag" in (row.get("labels") or [])


def test_search_labels_with_type_filter_and_combo(client, turtle_with_images):
    """Search endpoint supports category-only and combined category+label filtering."""
    tid = turtle_with_images["turtle_id"]
    loc = turtle_with_images["location"]
    img_bytes = _dummy_image_bytes()

    r_add = client.post(
        "/api/turtles/images/additional",
        data={
            "turtle_id": tid,
            "sheet_name": loc,
            "file_0": ("combo_right.jpg", BytesIO(img_bytes)),
            "type_0": "right-side",
            "labels_0": "burned, combo_filter_smoke",
            "file_1": ("combo_left.jpg", BytesIO(img_bytes)),
            "type_1": "left-side",
            "labels_1": "burned, combo_filter_smoke",
        },
    )
    assert r_add.status_code == 200

    r_type = client.get("/api/turtles/images/search-labels?type=right-side")
    assert r_type.status_code == 200
    type_matches = r_type.json().get("matches") or []
    assert any(m.get("type") == "right-side" for m in type_matches)
    assert not any(
        m.get("filename", "").find("combo_left") >= 0 and m.get("type") == "left-side"
        for m in type_matches
    )

    r_combo = client.get("/api/turtles/images/search-labels?q=burned&type=right-side")
    assert r_combo.status_code == 200
    combo_matches = r_combo.json().get("matches") or []
    combo_hit = next((m for m in combo_matches if "combo_right" in (m.get("filename") or "")), None)
    assert combo_hit is not None
    assert combo_hit.get("type") == "right-side"
    assert any("burn" in str(x).lower() for x in (combo_hit.get("labels") or []))
