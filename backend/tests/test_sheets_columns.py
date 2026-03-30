"""
Unit tests: sheets column mapping for optional mass and morphometrics.
Ensures COLUMN_MAPPING and FIELD_TO_COLUMN include the new fields so that
GET/POST/PUT turtle data can read/write them when the sheet has those columns.
"""

from sheets.columns import COLUMN_MAPPING, FIELD_TO_COLUMN

MORPHOMETRICS_HEADERS = {
    'Mass (g)': 'mass_g',
    'Curved carapace length (mm)': 'curved_carapace_length_mm',
    'Straight carapace length (mm)': 'straight_carapace_length_mm',
    'Carapace width (mm)': 'carapace_width_mm',
    'Curved plastron length (mm)': 'curved_plastron_length_mm',
    'Straight plastron length (mm)': 'straight_plastron_length_mm',
    'Plastron width (mm)': 'plastron_width_mm',
    'Dome height (mm)': 'dome_height_mm',
}


def test_column_mapping_includes_morphometrics():
    """COLUMN_MAPPING contains all optional mass and morphometrics headers."""
    for header, field_name in MORPHOMETRICS_HEADERS.items():
        assert header in COLUMN_MAPPING, f"Missing header {header!r}"
        assert COLUMN_MAPPING[header] == field_name


def test_field_to_column_includes_morphometrics():
    """FIELD_TO_COLUMN (reverse mapping) contains all morphometrics field names."""
    for header, field_name in MORPHOMETRICS_HEADERS.items():
        assert field_name in FIELD_TO_COLUMN, f"Missing field {field_name!r}"
        assert FIELD_TO_COLUMN[field_name] == header
