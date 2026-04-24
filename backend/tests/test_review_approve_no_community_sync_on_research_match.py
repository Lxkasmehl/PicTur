"""
Unit tests: approving a match to an admin/research turtle must not call the community
Google Sheets service (#150 — no duplicate community rows / no cross-book sync).
"""

from unittest.mock import MagicMock, patch

import jwt
import pytest

import config


def _admin_bearer():
    token = jwt.encode(
        {"role": "admin", "sub": "pytest-review-approve"},
        config.JWT_SECRET,
        algorithm="HS256",
    )
    return token if isinstance(token, str) else token.decode("ascii")


@pytest.fixture
def app_client():
    """Flask test client; import app after patches are applied per-test."""
    from app import app

    app.config["TESTING"] = True
    return app.test_client()


def test_approve_research_match_does_not_call_community_sheets_service(app_client):
    """POST approve with match_turtle_id only: community sheets API must not be used."""
    mock_manager = MagicMock()
    mock_manager.approve_review_packet.return_value = (True, "approved")

    with patch("auth.check_auth_revocation", return_value=(True, None)):
        with patch("routes.review.get_community_sheets_service") as get_comm:
            with patch("routes.review.manager_service.manager", mock_manager):
                with patch("routes.review.manager_service.manager_ready") as ready:
                    ready.wait.return_value = True
                    r = app_client.post(
                        "/api/review/admin_unit_match/approve",
                        json={"match_turtle_id": "T99"},
                        headers={"Authorization": f"Bearer {_admin_bearer()}"},
                    )

    assert r.status_code == 200, r.get_json()
    assert r.get_json().get("success") is True
    get_comm.assert_not_called()
    mock_manager.approve_review_packet.assert_called_once()


def test_approve_community_to_admin_still_deletes_community_row(app_client):
    """When moving a community turtle to admin, community service must be used for delete only."""
    comm = MagicMock()
    comm.delete_turtle_data.return_value = True

    mock_manager = MagicMock()
    mock_manager.approve_review_packet.return_value = (True, "moved")

    with patch("auth.check_auth_revocation", return_value=(True, None)):
        with patch(
            "routes.review.resolve_general_location_from_sheet_and_value",
            return_value="NT",
        ):
            with patch("routes.review.get_community_sheets_service", return_value=comm):
                with patch("routes.review.manager_service.manager", mock_manager):
                    with patch("routes.review.manager_service.manager_ready") as ready:
                        ready.wait.return_value = True
                        r = app_client.post(
                            "/api/review/admin_unit_comm_move/approve",
                            json={
                                "match_turtle_id": "T55",
                                "match_from_community": True,
                                "community_sheet_name": "UploadsTab",
                                "sheets_data": {
                                    "primary_id": "T55",
                                    "sheet_name": "Kansas",
                                    "general_location": "NT",
                                },
                            },
                            headers={"Authorization": f"Bearer {_admin_bearer()}"},
                        )

    assert r.status_code == 200, r.get_json()
    comm.delete_turtle_data.assert_called_once_with("T55", "UploadsTab")
    comm.create_turtle_data.assert_not_called()
    comm.update_turtle_data.assert_not_called()
