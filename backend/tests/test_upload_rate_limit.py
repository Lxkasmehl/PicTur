"""Tests for per-IP upload rate limiting."""

import time
from unittest.mock import MagicMock

from upload_rate_limit import upload_rate_limit_ok, _buckets, _lock


def _mock_request(ip='203.0.113.1', forwarded=None):
    req = MagicMock()
    req.remote_addr = ip
    req.headers = {'X-Forwarded-For': forwarded} if forwarded else {}
    return req


def setup_function():
    with _lock:
        _buckets.clear()


def test_allows_under_limit():
    req = _mock_request()
    for _ in range(5):
        assert upload_rate_limit_ok(req, 'community') is True


def test_blocks_over_community_limit(monkeypatch):
    monkeypatch.setattr('upload_rate_limit._MAX_COMMUNITY', 3)
    req = _mock_request()
    assert upload_rate_limit_ok(req, 'community') is True
    assert upload_rate_limit_ok(req, 'community') is True
    assert upload_rate_limit_ok(req, 'community') is True
    assert upload_rate_limit_ok(req, 'community') is False


def test_admin_has_higher_cap(monkeypatch):
    monkeypatch.setattr('upload_rate_limit._MAX_COMMUNITY', 2)
    monkeypatch.setattr('upload_rate_limit._MAX_PRIVILEGED', 5)
    req = _mock_request()
    for _ in range(4):
        assert upload_rate_limit_ok(req, 'admin') is True
    assert upload_rate_limit_ok(req, 'admin') is True
    assert upload_rate_limit_ok(req, 'admin') is False


def test_uses_forwarded_for_first_hop():
    req = _mock_request(forwarded='198.51.100.2, 10.0.0.1')
    assert upload_rate_limit_ok(req, 'community') is True
    with _lock:
        assert '198.51.100.2' in _buckets
