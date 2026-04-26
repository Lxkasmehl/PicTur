"""Unit tests: deceased flag parsing."""

from sheets.row_formatting import is_deceased_yes


def test_is_deceased_yes():
    assert is_deceased_yes('Yes')
    assert is_deceased_yes('yes')
    assert is_deceased_yes('Deceased')
    assert not is_deceased_yes('No')
    assert not is_deceased_yes('')
    assert not is_deceased_yes(None)
