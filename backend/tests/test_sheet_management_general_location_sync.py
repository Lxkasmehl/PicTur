"""Regression: sync_general_location_validations must unwrap GoogleSheetsService."""

from sheets import sheet_management as sm


def test_sheets_v4_client_and_id_unwraps_wrapper():
    class FakeWrapper:
        service = object()
        spreadsheet_id = 'spreadsheet-abc'

    api, sid = sm._sheets_v4_client_and_id(FakeWrapper())
    assert api is FakeWrapper.service
    assert sid == 'spreadsheet-abc'


def test_sheets_v4_client_and_id_returns_none_for_plain_object():
    class Plain:
        pass

    assert sm._sheets_v4_client_and_id(Plain()) == (None, None)
