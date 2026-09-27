"""
The database-backed Google Sheets emulation used by research groups (orgs.sheets_store).

These tests drive the real GoogleSheetsService code paths (sheets/crud.py, sheet_management,
migration, lookup) against DbSheetsApi — no mocks — so a research group behaves exactly like the
main group's spreadsheets: same 40 columns, same IDs, same row semantics.
Runs on SQLite; set ORGS_TEST_DATABASE_URL to run against PostgreSQL.
"""

import os

import pytest
from googleapiclient.errors import HttpError

from sheets.columns import CANONICAL_COLUMN_ORDER


@pytest.fixture
def store(tmp_path):
    from orgs import db as org_db
    from orgs.models import Base

    org_db.reset_for_tests()
    url = os.environ.get('ORGS_TEST_DATABASE_URL') or f"sqlite:///{(tmp_path / 's.sqlite').as_posix()}"
    engine = org_db.init_engine(url)
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    yield
    org_db.reset_for_tests()


def _svc(org_id=10, book='research'):
    from orgs.sheets_store import make_sheets_service

    return make_sheets_service(org_id, book)


def test_new_tab_has_exactly_the_main_group_columns(store):
    svc = _svc()
    assert svc.list_sheets() == []
    assert svc.create_sheet_with_headers('Ohio') is True
    assert svc.list_sheets() == ['Ohio']
    header = svc.get_sheet_values('Ohio!1:1')['values'][0]
    assert tuple(header) == CANONICAL_COLUMN_ORDER


def test_turtle_crud_roundtrip_with_all_fields(store):
    svc = _svc()
    svc.create_sheet_with_headers('Ohio')
    bio = svc.generate_biology_id('F', 'Ohio')
    assert bio == 'F001'  # same ID format as the main group
    pid = svc.generate_primary_id()
    data = {
        'primary_id': pid,
        'id': bio,
        'name': 'Alice',
        'sex': 'F',
        'species': 'Terrapene ornata',
        'general_location': 'North Site',
        'location': 'Creek bend',
        'mass_g': '412',
        'curved_carapace_length_mm': '118',
        'notes': 'first capture',
        'date_1st_found': '2026-06-01',
    }
    assert svc.create_turtle_data(data, 'Ohio') == pid
    got = svc.get_turtle_data(pid, 'Ohio')
    for key, value in data.items():
        assert got[key] == value, key
    assert svc.find_turtle_sheet(pid) == 'Ohio'

    # next biology ID sees the stored one
    assert svc.generate_biology_id('F', 'Ohio') == 'F002'

    assert svc.update_turtle_data(pid, {'name': 'Alice B.', 'dates_refound': '2026-07-01'}, 'Ohio')
    got = svc.get_turtle_data(pid, 'Ohio')
    assert (got['name'], got['dates_refound'], got['mass_g']) == ('Alice B.', '2026-07-01', '412')


def test_rows_append_and_delete_shifts_like_google(store):
    svc = _svc()
    svc.create_sheet_with_headers('Ohio')
    ids = []
    for i in range(3):
        pid = svc.generate_primary_id()
        svc.create_turtle_data({'primary_id': pid, 'id': f'U{i + 1}', 'name': f't{i}'}, 'Ohio')
        ids.append(pid)
    rows = svc.get_sheet_rows('Ohio')
    assert [r[CANONICAL_COLUMN_ORDER.index('Name')] for r in rows[1:]] == ['t0', 't1', 't2']

    assert svc.delete_turtle_data(ids[1], 'Ohio') is True
    rows = svc.get_sheet_rows('Ohio')
    assert [r[CANONICAL_COLUMN_ORDER.index('Name')] for r in rows[1:]] == ['t0', 't2']
    assert svc.get_turtle_data(ids[2], 'Ohio')['name'] == 't2'
    assert svc.get_turtle_data(ids[1], 'Ohio') is None


def test_groups_and_books_are_isolated(store):
    a, b, a_comm = _svc(10), _svc(11), _svc(10, 'community')
    a.create_sheet_with_headers('Ohio')
    pid = a.generate_primary_id()
    a.create_turtle_data({'primary_id': pid, 'id': 'M1', 'name': 'only-in-a'}, 'Ohio')
    assert b.list_sheets() == []
    assert a_comm.list_sheets() == []
    b.create_sheet_with_headers('Ohio')  # same tab name in another group is fine
    assert b.get_turtle_data(pid, 'Ohio') is None
    assert b.generate_biology_id('M', 'Ohio') == 'M001'


def test_value_semantics_match_google():
    from orgs.sheets_store import parse_range

    assert parse_range("'My Sheet'!A1:C9") == ('My Sheet', 0, 0, 8, 2)
    assert parse_range("'It''s'!1:1") == ("It's", 0, 0, 0, None)
    assert parse_range('Ohio!A:ZZ') == ('Ohio', 0, 0, None, 701)
    assert parse_range('Ohio!A2:X') == ('Ohio', 1, 0, None, 23)
    assert parse_range('Ohio!C5') == ('Ohio', 4, 2, 4, 2)
    assert parse_range('Ohio') == ('Ohio', 0, 0, None, None)


def test_trailing_blanks_trimmed_and_empty_range_has_no_values(store):
    svc = _svc()
    api = svc.service
    api.batchUpdate(spreadsheetId='x', body={'requests': [{'addSheet': {'properties': {'title': 'T'}}}]}).execute()
    api.values().update(spreadsheetId='x', range='T!A1', valueInputOption='RAW',
                        body={'values': [['a', 'b', '', '']]}).execute()
    api.values().update(spreadsheetId='x', range='T!3:3', valueInputOption='RAW',
                        body={'values': [['', 'x', 5, True]]}).execute()
    got = api.values().get(spreadsheetId='x', range='T!A:ZZ').execute()['values']
    assert got == [['a', 'b'], [], ['', 'x', '5', 'TRUE']]
    assert 'values' not in api.values().get(spreadsheetId='x', range='T!A10:C20').execute()
    col = api.values().get(spreadsheetId='x', range='T!B:B').execute()['values']
    assert col == [['b'], [], ['x']]


def test_insert_column_shifts_cells_right(store):
    svc = _svc()
    api = svc.service
    reply = api.batchUpdate(spreadsheetId='x', body={'requests': [{'addSheet': {'properties': {'title': 'T'}}}]}).execute()
    sheet_id = reply['replies'][0]['addSheet']['properties']['sheetId']
    api.values().update(spreadsheetId='x', range='T!1:1', valueInputOption='RAW',
                        body={'values': [['ID', 'Name']]}).execute()
    api.batchUpdate(spreadsheetId='x', body={'requests': [{'insertDimension': {
        'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': 1}}}]}).execute()
    assert api.values().get(spreadsheetId='x', range='T!1:1').execute()['values'] == [['', 'ID', 'Name']]


def test_errors_are_google_http_errors(store):
    api = _svc().service
    with pytest.raises(HttpError) as exc:
        api.values().get(spreadsheetId='x', range='Missing!A:A').execute()
    assert exc.value.resp.status == 400
    api.batchUpdate(spreadsheetId='x', body={'requests': [{'addSheet': {'properties': {'title': 'T'}}}]}).execute()
    with pytest.raises(HttpError):
        api.batchUpdate(spreadsheetId='x', body={'requests': [{'addSheet': {'properties': {'title': 't'}}}]}).execute()
