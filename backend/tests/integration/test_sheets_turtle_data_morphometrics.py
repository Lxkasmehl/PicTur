"""
Integration tests: API accepts optional mass and morphometrics in turtle data.
GET /api/sheets/turtle/<primary_id> can return morphometrics when present in the sheet.
POST /api/sheets/turtle accepts turtle_data including mass_g, curved_carapace_length_mm, etc.
Run against backend in Docker; requires admin auth.
"""

import pytest


def test_post_turtle_data_accepts_morphometrics(client):
    """POST /api/sheets/turtle with turtle_data including optional morphometrics is accepted (no 400)."""
    payload = {
        'sheet_name': 'Kansas',
        'state': '',
        'location': '',
        'turtle_data': {
            'primary_id': 'E2E-MORPH-001',
            'name': 'E2E Morphometrics Turtle',
            'sex': 'F',
            'mass_g': '250',
            'curved_carapace_length_mm': '320',
            'straight_carapace_length_mm': '310',
            'dome_height_mm': '95',
        },
    }
    r = client.post(
        '/api/sheets/turtle',
        json=payload,
        content_type='application/json',
    )
    # Backend must not reject the payload (no 400 for unknown/optional fields)
    assert r.status_code != 400, f"API should accept morphometrics; got 400: {r.get_json()}"
    if r.status_code == 503:
        pytest.skip("Google Sheets service not configured")
    if r.status_code == 200:
        data = r.get_json()
        assert data.get('success') is True
        assert 'primary_id' in data
