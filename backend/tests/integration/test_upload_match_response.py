"""
Integration test: admin upload returns SuperPoint match fields.

Requires BACKEND_URL and AUTH_URL (see tests/conftest.py).
"""

from io import BytesIO


def _dummy_png_bytes() -> bytes:
    # Minimal PNG header + payload; sufficient for upload-path validation.
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 512


def test_admin_upload_response_uses_score_confidence(client):
    response = client.post(
        "/api/upload",
        data={
            "file": ("match-api-test.png", BytesIO(_dummy_png_bytes())),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("success") is True
    assert isinstance(payload.get("matches"), list)

    # If the environment has indexed turtles and returns candidates,
    # validate the match payload shape used by the frontend.
    if payload["matches"]:
        top = payload["matches"][0]
        assert "score" in top
        assert "confidence" in top
        assert "distance" not in top
