"""
Unit tests: sheets column mapping for optional mass and morphometrics.
Ensures COLUMN_MAPPING and FIELD_TO_COLUMN include the new fields so that
GET/POST/PUT turtle data can read/write them when the sheet has those columns.
"""

from sheets.columns import (
    CANONICAL_COLUMN_ORDER,
    COLUMN_MAPPING,
    FIELD_TO_COLUMN,
    collect_missing_headers_for_turtle_data,
    compute_insert_index_for_missing_column,
)

# Current sheet morphometrics (short headers) + mass
CANONICAL_MORPH_HEADERS = {
    'Mass (g)': 'mass_g',
    'CCL': 'curved_carapace_length_mm',
    'Cflat': 'straight_carapace_length_mm',
    'Cwidth': 'carapace_width_mm',
    'PlasCL': 'curved_plastron_length_mm',
    'Pflat': 'straight_plastron_length_mm',
    'P1': 'plastron_p1_mm',
    'P2': 'plastron_p2_mm',
    'Pwidth': 'plastron_width_mm',
    'DomeHeight': 'dome_height_mm',
}


def test_column_mapping_matches_canonical_header_order():
    assert tuple(COLUMN_MAPPING.keys()) == CANONICAL_COLUMN_ORDER


def test_column_mapping_includes_canonical_morphometrics():
    for header, field_name in CANONICAL_MORPH_HEADERS.items():
        assert header in COLUMN_MAPPING, f"Missing header {header!r}"
        assert COLUMN_MAPPING[header] == field_name


def test_field_to_column_prefers_short_morph_headers_for_writes():
    for header, field_name in CANONICAL_MORPH_HEADERS.items():
        assert FIELD_TO_COLUMN[field_name] == header


def test_column_mapping_includes_deceased():
    assert 'Deceased?' in COLUMN_MAPPING
    assert COLUMN_MAPPING['Deceased?'] == 'deceased'
    assert FIELD_TO_COLUMN['deceased'] == 'Deceased?'


def test_transmitter_type_write_header_prefers_canonical_casing():
    assert FIELD_TO_COLUMN['transmitter_type'] == 'Transmitter Type'


def test_frequency_and_dna_headers_for_writes():
    assert FIELD_TO_COLUMN['freq'] == 'Frequency'
    assert FIELD_TO_COLUMN['dna_extracted'] == 'Date DNA Extracted?'


def test_compute_insert_index_inserts_specific_property_before_general():
    headers = [
        'Primary ID',
        'Frequency',
        'ID',
        'Dates refound',
        'General Location',
        'Location',
    ]
    idx = compute_insert_index_for_missing_column(headers, 'Specific Property')
    assert headers[idx] == 'General Location'


def test_collect_missing_headers_skips_empty_values():
    existing = {'Primary ID': 0, 'Name': 1}
    td = {'primary_id': 'P1', 'name': '', 'species': 'Chrysemys'}
    miss = collect_missing_headers_for_turtle_data(td, existing)
    assert 'Species' in miss
    assert 'Name' not in miss
