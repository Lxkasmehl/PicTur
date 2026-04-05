"""
Column mappings for Google Sheets
"""

from typing import Any, Dict, List, Sequence, Tuple

# Canonical header order (research spreadsheet). Used for new tabs and inserting missing columns.
CANONICAL_COLUMN_ORDER: Tuple[str, ...] = (
    'Primary ID',
    'Frequency',
    'ID',
    'Pit?',
    'Plastron Picture in Archive?',
    'Carapace Picture in Archive?',
    'Adopted?',
    'iButton?',
    'Date DNA Extracted?',
    'Date 1st found',
    'Species',
    'Name',
    'Sex',
    'iButton Last set',
    'Last Assay Date',
    'Dates refound',
    'Specific Location',
    'General Location',
    'Location',
    'Cow Interactions?',
    'Health Status',
    'Deceased?',
    'Notes',
    'Transmitter put on by',
    'Transmitter On Date',
    'Transmitter Type',
    'Transmitter lifespan',
    'Radio Replace Date',
    'OLD Frequencies',
    'Flesh Flies?',
    'Mass (g)',
    'CCL',
    'Cflat',
    'Cwidth',
    'PlasCL',
    'Pflat',
    'P1',
    'P2',
    'Pwidth',
    'DomeHeight',
)

# Keys on turtle payloads that are not sheet columns
TURTLE_METADATA_KEYS = frozenset({'sheet_name', 'row_index'})


def _column_mapping_entries() -> List[Tuple[str, str]]:
    """Row 1 headers must match these strings exactly (see CANONICAL_COLUMN_ORDER)."""
    return [
        ('Primary ID', 'primary_id'),
        ('Frequency', 'freq'),
        ('ID', 'id'),
        ('Pit?', 'pit'),
        ('Plastron Picture in Archive?', 'plastron_picture_in_archive'),
        ('Carapace Picture in Archive?', 'carapace_picture_in_archive'),
        ('Adopted?', 'adopted'),
        ('iButton?', 'ibutton'),
        ('Date DNA Extracted?', 'dna_extracted'),
        ('Date 1st found', 'date_1st_found'),
        ('Species', 'species'),
        ('Name', 'name'),
        ('Sex', 'sex'),
        ('iButton Last set', 'ibutton_last_set'),
        ('Last Assay Date', 'last_assay_date'),
        ('Dates refound', 'dates_refound'),
        ('Specific Location', 'specific_location'),
        ('General Location', 'general_location'),
        ('Location', 'location'),
        ('Cow Interactions?', 'cow_interactions'),
        ('Health Status', 'health_status'),
        ('Deceased?', 'deceased'),
        ('Notes', 'notes'),
        ('Transmitter put on by', 'transmitter_put_on_by'),
        ('Transmitter On Date', 'transmitter_on_date'),
        ('Transmitter Type', 'transmitter_type'),
        ('Transmitter lifespan', 'transmitter_lifespan'),
        ('Radio Replace Date', 'radio_replace_date'),
        ('OLD Frequencies', 'old_frequencies'),
        ('Flesh Flies?', 'flesh_flies'),
        ('Mass (g)', 'mass_g'),
        ('CCL', 'curved_carapace_length_mm'),
        ('Cflat', 'straight_carapace_length_mm'),
        ('Cwidth', 'carapace_width_mm'),
        ('PlasCL', 'curved_plastron_length_mm'),
        ('Pflat', 'straight_plastron_length_mm'),
        ('P1', 'plastron_p1_mm'),
        ('P2', 'plastron_p2_mm'),
        ('Pwidth', 'plastron_width_mm'),
        ('DomeHeight', 'dome_height_mm'),
    ]


COLUMN_MAPPING: Dict[str, str] = dict(_column_mapping_entries())


def _build_field_to_column(column_mapping: Dict[str, str]) -> Dict[str, str]:
    """One preferred sheet header per internal field (first canonical header wins)."""
    out: Dict[str, str] = {}
    for header, field in column_mapping.items():
        if field not in out:
            out[field] = header
    # Explicit write targets when multiple headers share a field or we rename columns
    out['transmitter_type'] = 'Transmitter Type'
    out['plastron_picture_in_archive'] = 'Plastron Picture in Archive?'
    out['carapace_picture_in_archive'] = 'Carapace Picture in Archive?'
    out['freq'] = 'Frequency'
    out['dna_extracted'] = 'Date DNA Extracted?'
    out['cow_interactions'] = 'Cow Interactions?'
    out['curved_carapace_length_mm'] = 'CCL'
    out['straight_carapace_length_mm'] = 'Cflat'
    out['carapace_width_mm'] = 'Cwidth'
    out['curved_plastron_length_mm'] = 'PlasCL'
    out['straight_plastron_length_mm'] = 'Pflat'
    out['plastron_p1_mm'] = 'P1'
    out['plastron_p2_mm'] = 'P2'
    out['plastron_width_mm'] = 'Pwidth'
    out['dome_height_mm'] = 'DomeHeight'
    return out


# Reverse mapping: internal field names to Google Sheets column headers (for inserts / writes)
FIELD_TO_COLUMN: Dict[str, str] = _build_field_to_column(COLUMN_MAPPING)

_CANONICAL_INDEX = {h: i for i, h in enumerate(CANONICAL_COLUMN_ORDER)}


def compute_insert_index_for_missing_column(
    headers_ordered: Sequence[str],
    missing_header: str,
    canonical_order: Sequence[str] = CANONICAL_COLUMN_ORDER,
) -> int:
    """
    0-based index where a new column with ``missing_header`` should be inserted
    so it stays consistent with canonical_order relative to existing headers.
    """
    normalized = [((h or '').strip()) for h in headers_ordered]
    header_set = set(normalized)
    try:
        pos = canonical_order.index(missing_header)
    except ValueError:
        return len(normalized)

    anchor_before_idx = -1
    for j in range(pos - 1, -1, -1):
        h = canonical_order[j]
        if h in header_set:
            anchor_before_idx = normalized.index(h)
            break

    anchor_after_idx = None
    for j in range(pos + 1, len(canonical_order)):
        h = canonical_order[j]
        if h in header_set:
            anchor_after_idx = normalized.index(h)
            break

    if anchor_before_idx >= 0:
        return anchor_before_idx + 1
    if anchor_after_idx is not None:
        return anchor_after_idx
    return len(normalized)


def collect_missing_headers_for_turtle_data(
    turtle_data: Dict[str, Any],
    existing_headers: Dict[str, int],
    field_to_column: Dict[str, str] = FIELD_TO_COLUMN,
    metadata_keys: frozenset = TURTLE_METADATA_KEYS,
) -> List[str]:
    """
    Sheet headers that are required to persist non-empty turtle_data fields but are
    absent from existing_headers (exact header text).
    """
    present = set(existing_headers.keys())
    targets: List[str] = []
    seen = set()

    def _has_value(v: Any) -> bool:
        if v is None:
            return False
        if isinstance(v, str):
            return bool(v.strip())
        return True

    for key, value in turtle_data.items():
        if key in metadata_keys:
            continue
        if key not in field_to_column:
            continue
        if not _has_value(value):
            continue
        header = field_to_column[key]
        if header in present or header in seen:
            continue
        targets.append(header)
        seen.add(header)

    targets.sort(key=lambda h: _CANONICAL_INDEX.get(h, 10_000))
    return targets
