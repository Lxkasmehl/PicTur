"""Regression: sync_general_location_validations must unwrap GoogleSheetsService."""

from unittest.mock import MagicMock

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


def test_clear_general_location_validation_omits_rule():
    """Sheets API clears validation when setDataValidation has no rule."""
    batch_update = MagicMock()
    service = MagicMock()
    service.spreadsheets.return_value.batchUpdate = batch_update

    sm.clear_general_location_validation(
        service,
        'ss-id',
        'Kansas',
        sheet_id=99,
        column_index=5,
    )

    batch_update.assert_called_once()
    kwargs = batch_update.call_args.kwargs
    req = kwargs['body']['requests'][0]['setDataValidation']
    assert 'rule' not in req
    assert req['range']['sheetId'] == 99
    assert req['range']['startColumnIndex'] == 5
