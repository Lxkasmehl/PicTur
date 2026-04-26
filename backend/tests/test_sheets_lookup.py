"""Unit tests: biology ID normalization for sheet lookup."""

from sheets.lookup import (
    biology_ids_match,
    column_index_for_header,
    normalize_biology_id,
    unique_non_empty_column_values,
)


def test_column_index_for_header_strips_cells():
    headers = [' Primary ID ', 'ID', '  Name  ']
    assert column_index_for_header(headers, 'Primary ID') == 0
    assert column_index_for_header(headers, 'ID') == 1
    assert column_index_for_header(headers, 'Name') == 2


def test_unique_non_empty_column_values_dedupes_and_sorts():
    grid = [
        ['Primary ID', 'ID', 'Name'],
        ['100', 'F1', 'Alpha'],
        ['101', 'M2', 'beta'],
        ['102', '', 'Alpha'],
        ['103', 'F1', 'Gamma'],
    ]
    assert unique_non_empty_column_values(grid, 'ID') == ['F1', 'M2']
    assert unique_non_empty_column_values(grid, 'Name') == ['Alpha', 'beta', 'Gamma']
    assert unique_non_empty_column_values(grid, 'Primary ID') == ['100', '101', '102', '103']


def test_normalize_biology_id_strips_zeros():
    assert normalize_biology_id('F01') == 'F1'
    assert normalize_biology_id('f 1') == 'F1'
    assert normalize_biology_id('M12') == 'M12'


def test_biology_ids_match_equivalent_forms():
    assert biology_ids_match('F1', 'F01')
    assert biology_ids_match('F001', 'F1')
    assert not biology_ids_match('F1', 'M1')
