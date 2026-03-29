"""
Integration tests: Auth backend observer / gamification persistence (GET/PUT /auth/community-game).
Requires Docker auth-backend and seeded users (same as test_auth_api / CI).
"""

import time

import pytest
import requests


def _auth_base(auth_url: str) -> str:
    return auth_url.rstrip("/")


def _game_url(auth_url: str) -> str:
    return f"{_auth_base(auth_url)}/auth/community-game"


def _minimal_valid_state(**overrides):
    """Payload shape must match auth-backend parsePayload (communityGame.ts)."""
    base = {
        "totalXp": 0,
        "lifetimeSightings": 0,
        "questWeekKey": "",
        "weeklySightings": 0,
        "weeklyGpsSightings": 0,
        "weeklyExtraSightings": 0,
        "weeksWithUpload": [],
        "gpsHintTotal": 0,
        "manualHintTotal": 0,
        "sightingsWithExtraPhotos": 0,
        "trainingCompleted": False,
        "badges": [],
        "completedWeeklyQuestIds": [],
    }
    base.update(overrides)
    return base


def test_community_game_get_without_token_returns_401(auth_url, integration_env):
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    r = requests.get(_game_url(auth_url), timeout=10)
    assert r.status_code == 401


def test_community_game_put_without_token_returns_401(auth_url, integration_env):
    if not integration_env:
        pytest.skip("Set BACKEND_URL and AUTH_URL to run integration tests")
    r = requests.put(
        _game_url(auth_url),
        json=_minimal_valid_state(),
        timeout=10,
    )
    assert r.status_code == 401


def test_community_game_put_invalid_payload_returns_400(auth_url, integration_env, admin_token):
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run integration tests")
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = requests.put(_game_url(auth_url), json={}, headers=headers, timeout=10)
    assert r.status_code == 400
    data = r.json() if r.content else {}
    assert data.get("success") is False
    assert "error" in data

    r2 = requests.put(
        _game_url(auth_url),
        json=_minimal_valid_state(totalXp=-1),
        headers=headers,
        timeout=10,
    )
    assert r2.status_code == 400

    r3 = requests.put(
        _game_url(auth_url),
        json=_minimal_valid_state(questWeekKey="not-a-week"),
        headers=headers,
        timeout=10,
    )
    assert r3.status_code == 400


def test_community_game_get_returns_null_when_never_saved(auth_url, integration_env, admin_token):
    """Fresh admin user may already have state from other tests; we only assert shape on 200."""
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run integration tests")
    r = requests.get(
        _game_url(auth_url),
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("success") is True
    assert "state" in data
    assert data["state"] is None or isinstance(data["state"], dict)


def test_community_game_put_get_roundtrip(auth_url, integration_env, admin_token):
    if not integration_env or not admin_token:
        pytest.skip("Set BACKEND_URL and AUTH_URL (and seeded admin) to run integration tests")
    headers = {"Authorization": f"Bearer {admin_token}"}
    marker = int(time.time()) % 1_000_000
    payload = _minimal_valid_state(
        totalXp=marker,
        lifetimeSightings=2,
        questWeekKey="2025-W10",
        weeklySightings=1,
        badges=["test_badge_integration"],
        trainingCompleted=True,
    )
    put_r = requests.put(_game_url(auth_url), json=payload, headers=headers, timeout=10)
    assert put_r.status_code == 200
    assert put_r.json().get("success") is True

    get_r = requests.get(_game_url(auth_url), headers=headers, timeout=10)
    assert get_r.status_code == 200
    body = get_r.json()
    assert body.get("success") is True
    state = body.get("state")
    assert isinstance(state, dict)
    assert state.get("totalXp") == marker
    assert state.get("lifetimeSightings") == 2
    assert state.get("questWeekKey") == "2025-W10"
    assert state.get("badges") == ["test_badge_integration"]
    assert state.get("trainingCompleted") is True


def test_community_game_isolation_between_users(
    auth_url, integration_env, admin_token, community_token
):
    """Admin and community users must not see each other's saved game state."""
    if not integration_env or not admin_token or not community_token:
        pytest.skip(
            "Set BACKEND_URL and AUTH_URL (and seeded admin + community) to run integration tests"
        )
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    community_headers = {"Authorization": f"Bearer {community_token}"}
    admin_xp = 900_000 + (int(time.time()) % 10_000)
    community_xp = 800_000 + (int(time.time()) % 10_000)

    requests.put(
        _game_url(auth_url),
        json=_minimal_valid_state(totalXp=admin_xp, lifetimeSightings=10),
        headers=admin_headers,
        timeout=10,
    ).raise_for_status()
    requests.put(
        _game_url(auth_url),
        json=_minimal_valid_state(totalXp=community_xp, lifetimeSightings=3),
        headers=community_headers,
        timeout=10,
    ).raise_for_status()

    ga = requests.get(_game_url(auth_url), headers=admin_headers, timeout=10).json()
    gc = requests.get(_game_url(auth_url), headers=community_headers, timeout=10).json()

    assert ga["state"]["totalXp"] == admin_xp
    assert ga["state"]["lifetimeSightings"] == 10
    assert gc["state"]["totalXp"] == community_xp
    assert gc["state"]["lifetimeSightings"] == 3
