import json

import pytest

import general_locations_catalog as glc


@pytest.fixture()
def isolated_catalog(tmp_path, monkeypatch):
    catalog_file = tmp_path / 'general_locations.json'
    monkeypatch.setattr(glc, '_CATALOG_FILE', str(catalog_file))
    return catalog_file


def test_default_catalog_includes_seed_values(isolated_catalog):
    catalog = glc.get_general_location_catalog()

    assert catalog['states']['Kansas'] == [
        'Karlyle Woods',
        'Lawrence',
        'North Topeka',
        'Valencia',
        'Wichita',
    ]
    assert catalog['sheet_defaults']['NebraskaCPBS']['general_location'] == 'CPBS'
    assert isolated_catalog.exists()


def test_save_after_add_does_not_write_placeholder_states(isolated_catalog):
    """Regression: merged-in code defaults must not be persisted when JSON already has real data."""
    isolated_catalog.write_text(
        json.dumps({'states': {'Kansas': ['Lawrence']}, 'sheet_defaults': {}}),
        encoding='utf-8',
    )
    glc.add_general_location('Kansas', 'Wichita')
    data = json.loads(isolated_catalog.read_text(encoding='utf-8'))
    assert 'Example State A' not in data.get('states', {})
    assert 'Wichita' in data['states']['Kansas']


def test_add_general_location_is_case_insensitive(isolated_catalog):
    glc.add_general_location('Kansas', 'Wichita')
    glc.add_general_location('kansas', 'wichita')

    catalog = glc.get_general_location_catalog()
    assert 'Wichita' in catalog['states']['Kansas']
    assert catalog['states']['Kansas'].count('Wichita') == 1


def test_resolve_general_location_from_sheet_and_value(isolated_catalog):
    glc.add_general_location('Kansas', 'Wichita')

    assert glc.get_general_location_options_for_sheet('NebraskaCPBS')['locations'] == ['CPBS']
    assert glc.get_general_location_options_for_sheet('Kansas')['locations'] == [
        'Karlyle Woods',
        'Lawrence',
        'North Topeka',
        'Valencia',
        'Wichita',
    ]
    assert glc.resolve_general_location_from_sheet_and_value('NebraskaCPBS', 'Anything') == 'CPBS'
    assert glc.resolve_general_location_from_sheet_and_value('Kansas', 'wichita') == 'Wichita'

    with pytest.raises(ValueError):
        glc.resolve_general_location_from_sheet_and_value('Kansas', 'Not A Real Location')
