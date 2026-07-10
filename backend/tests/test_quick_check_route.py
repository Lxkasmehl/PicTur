"""
Unit tests for POST /api/match/quick-check — the staff/admin, strictly
read-only carapace quick check. Pins: staff-or-admin auth (community and
anonymous rejected), carapace photo_type forwarding, cross-check-style
response shape, case-insensitive .pt→image resolution, zero review-queue
writes, and temp-file cleanup on success and error paths.
"""

import io
from unittest.mock import MagicMock, patch

import jwt
import pytest

import config
from image_utils import UploadImageError


def _bearer(role):
    token = jwt.encode(
        {"role": role, "sub": f"pytest-quick-check-{role}"},
        config.JWT_SECRET,
        algorithm="HS256",
    )
    return token if isinstance(token, str) else token.decode("ascii")


def _auth(role):
    return {"Authorization": f"Bearer {_bearer(role)}"}


def _file_payload(name="query.jpg", extra=None):
    payload = {"file": (io.BytesIO(b"\xff\xd8\xff\xe0 fake jpeg bytes"), name)}
    if extra:
        payload.update(extra)
    return payload


@pytest.fixture
def app_client():
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def quick_check_env(tmp_path):
    """Patched upload folder, identity ingest, revocation OK, ready mock manager."""
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    review_dir = tmp_path / "review_queue"
    review_dir.mkdir()

    mock_manager = MagicMock()
    mock_manager.review_queue_dir = str(review_dir)
    mock_manager.search_for_matches.return_value = ([], 0.42)

    with patch("auth.check_auth_revocation", return_value=(True, None)), \
            patch("routes.upload.UPLOAD_FOLDER", str(upload_dir)), \
            patch("routes.upload.ingest_saved_upload", side_effect=lambda p, **kw: p), \
            patch("routes.upload.manager_service.manager", mock_manager), \
            patch("routes.upload.manager_service.manager_ready") as ready:
        ready.wait.return_value = True
        yield {
            "manager": mock_manager,
            "upload_dir": upload_dir,
            "review_dir": review_dir,
        }


def test_requires_token(app_client, quick_check_env):
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
    )
    assert r.status_code == 401


def test_community_forbidden(app_client, quick_check_env):
    """Community users must be rejected — the quick check is staff/admin only."""
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
        headers=_auth("community"),
    )
    assert r.status_code == 403
    assert quick_check_env["manager"].search_for_matches.call_count == 0


@pytest.mark.parametrize("role", ["admin", "staff"])
def test_admin_ok_and_forwards_carapace_scope(app_client, quick_check_env, role):
    """Both admin and staff can run the quick check (everyone but community)."""
    manager = quick_check_env["manager"]
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(extra={"match_sheet": "Kansas"}),
        content_type="multipart/form-data",
        headers=_auth(role),
    )
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["success"] is True
    assert body["photo_type"] == "carapace"
    assert body["matches"] == []
    assert "elapsed" in body

    manager.search_for_matches.assert_called_once()
    kwargs = manager.search_for_matches.call_args.kwargs
    assert kwargs["location_filter"] == "Kansas"
    assert kwargs["photo_type"] == "carapace"
    assert kwargs["expand_to_all_when_short"] is True


def test_empty_match_sheet_means_all_locations(app_client, quick_check_env):
    manager = quick_check_env["manager"]
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(extra={"match_sheet": ""}),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 200
    assert manager.search_for_matches.call_args.kwargs["location_filter"] is None


def test_response_shape_and_uppercase_jpg_resolution(
    app_client, quick_check_env, tmp_path
):
    """image_path must resolve .pt → sibling image case-insensitively (real helper)."""
    ref_dir = tmp_path / "Kansas" / "North Topeka" / "F128_T123" / "carapace"
    ref_dir.mkdir(parents=True)
    pt_path = ref_dir / "F128.pt"
    pt_path.write_bytes(b"pt")
    (ref_dir / "F128.JPG").write_bytes(b"jpg")

    quick_check_env["manager"].search_for_matches.return_value = (
        [
            {
                "site_id": "F128",
                "location": "Kansas/North Topeka",
                "confidence": 0.87,
                "score": 412,
                "file_path": str(pt_path),
            }
        ],
        1.234,
    )
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 200
    match = r.get_json()["matches"][0]
    assert match["turtle_id"] == "F128"
    assert match["location"] == "Kansas/North Topeka"
    assert match["confidence"] == pytest.approx(0.87)
    assert match["score"] == 412
    assert match["image_path"].endswith("F128.JPG")


def test_no_review_queue_writes(app_client, quick_check_env):
    manager = quick_check_env["manager"]
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(extra={"match_sheet": "Kansas"}),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 200
    assert list(quick_check_env["review_dir"].iterdir()) == []
    manager.create_review_packet.assert_not_called()
    manager.add_additional_images_to_packet.assert_not_called()
    manager.approve_review_packet.assert_not_called()


def test_temp_cleaned_after_success(app_client, quick_check_env):
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 200
    assert list(quick_check_env["upload_dir"].iterdir()) == []


def test_temp_sweep_spares_other_uploads(app_client, quick_check_env):
    """The finally-sweep must be scoped to THIS request's unique prefix —
    other in-flight uploads' temps (including other quick checks) survive."""
    foreign_plain = quick_check_env["upload_dir"] / "someone_elses_upload.jpg"
    foreign_plain.write_bytes(b"other request temp")
    foreign_quickcheck = quick_check_env["upload_dir"] / "quickcheck_deadbeef_other.jpg"
    foreign_quickcheck.write_bytes(b"concurrent quick check temp")

    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 200
    survivors = sorted(p.name for p in quick_check_env["upload_dir"].iterdir())
    assert survivors == ["quickcheck_deadbeef_other.jpg", "someone_elses_upload.jpg"]


def test_temp_cleaned_after_matcher_error(app_client, quick_check_env):
    quick_check_env["manager"].search_for_matches.side_effect = RuntimeError("boom")
    r = app_client.post(
        "/api/match/quick-check",
        data=_file_payload(),
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 500
    assert "Quick check failed" in r.get_json()["error"]
    assert list(quick_check_env["upload_dir"].iterdir()) == []


def test_oversized_file_rejected(app_client, quick_check_env):
    with patch("routes.upload.MAX_FILE_SIZE", 10):
        r = app_client.post(
            "/api/match/quick-check",
            data=_file_payload(),
            content_type="multipart/form-data",
            headers=_auth("admin"),
        )
    assert r.status_code == 400
    assert r.get_json()["code"] == "file_too_large"
    assert list(quick_check_env["upload_dir"].iterdir()) == []


def test_full_file_saved_after_size_probe(app_client, quick_check_env):
    """The size check seeks to EOF; without the seek(0) rewind the saved temp
    would be 0 bytes and matching would silently see an empty file."""
    import os

    saved_sizes = []

    def record_size(path, **kwargs):
        saved_sizes.append(os.path.getsize(path))
        return path

    payload = _file_payload()
    expected_size = payload["file"][0].getbuffer().nbytes
    with patch("routes.upload.ingest_saved_upload", side_effect=record_size):
        r = app_client.post(
            "/api/match/quick-check",
            data=payload,
            content_type="multipart/form-data",
            headers=_auth("admin"),
        )
    assert r.status_code == 200
    assert saved_sizes == [expected_size]
    assert expected_size > 0


def test_missing_file_rejected(app_client, quick_check_env):
    r = app_client.post(
        "/api/match/quick-check",
        data={},
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 400


def test_bad_extension_rejected(app_client, quick_check_env):
    r = app_client.post(
        "/api/match/quick-check",
        data={"file": (io.BytesIO(b"not an image"), "notes.txt")},
        content_type="multipart/form-data",
        headers=_auth("admin"),
    )
    assert r.status_code == 400
    assert r.get_json()["code"] == "invalid_extension"
    assert list(quick_check_env["upload_dir"].iterdir()) == []


def test_ingest_error_returns_structured_400_and_cleans_temp(
    app_client, quick_check_env
):
    with patch(
        "routes.upload.ingest_saved_upload",
        side_effect=UploadImageError(
            "image_unreadable", "Uploaded image could not be decoded."
        ),
    ):
        r = app_client.post(
            "/api/match/quick-check",
            data=_file_payload(),
            content_type="multipart/form-data",
            headers=_auth("admin"),
        )
    assert r.status_code == 400
    assert r.get_json()["code"] == "image_unreadable"
    assert list(quick_check_env["upload_dir"].iterdir()) == []


def test_ingest_rename_then_crash_returns_json_500_and_sweeps_temp(
    app_client, quick_check_env
):
    """Ingest can RENAME the temp (HEIC/.JPG → .jpg) and then raise a
    non-UploadImageError (e.g. disk full). The route must still return the
    structured JSON 500 and sweep the renamed sibling, not orphan it."""
    import os

    def rename_then_boom(path, **kwargs):
        renamed = os.path.splitext(path)[0] + ".jpg.partial"
        os.rename(path, renamed)
        raise OSError(28, "No space left on device")

    with patch("routes.upload.ingest_saved_upload", side_effect=rename_then_boom):
        r = app_client.post(
            "/api/match/quick-check",
            data=_file_payload(),
            content_type="multipart/form-data",
            headers=_auth("admin"),
        )
    assert r.status_code == 500
    assert "Quick check failed" in r.get_json()["error"]
    assert list(quick_check_env["upload_dir"].iterdir()) == []
