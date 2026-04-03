"""
Normalize sheet cell values for API consistency (biology ID display).
Flag-style columns (Pit?, Adopted?, etc.) are free text in Sheets and are not normalized.
"""

from __future__ import annotations

from typing import Any, Dict


def normalize_turtle_row_after_read(data: Dict[str, Any]) -> None:
    """Mutate turtle payload from Sheets: canonical biology ID for the ID column."""
    from sheets import migration

    if data.get('id'):
        data['id'] = migration.normalize_biology_id_display(str(data['id']))


def format_field_value_for_sheet(field_name: str, value: Any) -> str:
    """String to store in a sheet cell for a mapped field."""
    from sheets import migration

    if value is None:
        return ''
    s = str(value).strip()
    if not s:
        return ''
    if field_name == 'id':
        return migration.normalize_biology_id_display(s)
    return str(value)
