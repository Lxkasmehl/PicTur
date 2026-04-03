"""Biology ID canonical form and sheet value formatting."""

import pytest

from sheets import migration
from sheets.value_normalize import format_field_value_for_sheet, normalize_turtle_row_after_read


@pytest.mark.parametrize(
    'raw,expected',
    [
        ('F1', 'F001'),
        ('f001', 'F001'),
        ('F026', 'F026'),
        ('M12', 'M012'),
        ('Null.1', 'U001'),
        ('null 5', 'U005'),
        ('F.26', 'F026'),
        ('J.3', 'J003'),
    ],
)
def test_normalize_biology_id_display(raw, expected):
    assert migration.normalize_biology_id_display(raw) == expected


def test_normalize_biology_id_unknown_passthrough():
    assert migration.normalize_biology_id_display('Turtle42') == 'Turtle42'


def test_format_field_value_for_sheet_id_and_free_text_flags():
    assert format_field_value_for_sheet('id', 'f2') == 'F002'
    assert format_field_value_for_sheet('pit', 'y') == 'y'
    assert format_field_value_for_sheet('pit', 'Yes (see notes)') == 'Yes (see notes)'


def test_normalize_turtle_row_after_read_mutates():
    row = {'id': 'm5', 'pit': 'N', 'species': 'X'}
    normalize_turtle_row_after_read(row)
    assert row['id'] == 'M005'
    assert row['pit'] == 'N'
    assert row['species'] == 'X'
