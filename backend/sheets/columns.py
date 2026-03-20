"""
Column mappings for Google Sheets
"""

# Column mapping: Google Sheets column headers to internal field names
COLUMN_MAPPING = {
    'Primary ID': 'primary_id',  # New unique primary key column
    'Transmitter ID': 'transmitter_id',
    'ID': 'id',
    'ID2 (random sequence)': 'id2',
    'Pit?': 'pit',
    'Pic in 2024 Archive?': 'pic_in_2024_archive',
    'Adopted?': 'adopted',
    'iButton?': 'ibutton',
    'DNA Extracted?': 'dna_extracted',
    'Date 1st found': 'date_1st_found',
    'Species': 'species',
    'Name': 'name',
    'Sex': 'sex',
    'iButton Last set': 'ibutton_last_set',
    'Last Assay Date': 'last_assay_date',
    'Dates refound': 'dates_refound',
    'General Location': 'general_location',
    'Location': 'location',
    'Health Status': 'health_status',
    'Notes': 'notes',
    'Transmitter put on by': 'transmitter_put_on_by',
    'Transmitter On Date': 'transmitter_on_date',
    'Transmitter type': 'transmitter_type',
    'Transmitter lifespan': 'transmitter_lifespan',
    'Radio Replace Date': 'radio_replace_date',
    'OLD Frequencies': 'old_frequencies',
    # Optional mass and morphometrics
    'Mass (g)': 'mass_g',
    'Curved carapace length (mm)': 'curved_carapace_length_mm',
    'Straight carapace length (mm)': 'straight_carapace_length_mm',
    'Carapace width (mm)': 'carapace_width_mm',
    'Curved plastron length (mm)': 'curved_plastron_length_mm',
    'Straight plastron length (mm)': 'straight_plastron_length_mm',
    'Plastron width (mm)': 'plastron_width_mm',
    'Dome height (mm)': 'dome_height_mm',
}

# Reverse mapping: internal field names to Google Sheets column headers
FIELD_TO_COLUMN = {v: k for k, v in COLUMN_MAPPING.items()}
