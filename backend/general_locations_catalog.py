"""
Shared catalog for state-specific general locations.

The catalog is used by:
- the frontend dropdown source
- backend validation for sheet writes and review flows
- Google Sheets validation rules when creating/syncing tabs
"""

from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from typing import Any, Dict, List, Optional

_CATALOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'general_locations.json')
_CATALOG_LOCK = threading.RLock()

# Seed used only when general_locations.json is missing or has no states/sheet_defaults yet.
# Keep aligned with the committed general_locations.json so first-run writes match repo defaults.
_DEFAULT_CATALOG: Dict[str, Any] = {
    'states': {
        'Kansas': [
            'Karlyle Woods',
            'Lawrence',
            'North Topeka',
            'Valencia',
            'Wichita',
        ],
        'Nebraska': [
            'CPBS',
            'Crescent Lake',
        ],
        'Iowa': [
            'Hawkeye',
        ],
    },
    'sheet_defaults': {
        'NebraskaCPBS': {
            'state': 'Nebraska',
            'general_location': 'CPBS',
        },
        'NebraskaCL': {
            'state': 'Nebraska',
            'general_location': 'Crescent Lake',
        },
        'IowaHawkeye': {
            'state': 'Iowa',
            'general_location': 'Hawkeye',
        },
    },
}


def _normalize_text(value: str) -> str:
    return ' '.join((value or '').strip().split())


def _normalize_catalog(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    raw = raw or {}
    states = raw.get('states') if isinstance(raw.get('states'), dict) else {}
    sheet_defaults_in = raw.get('sheet_defaults') if isinstance(raw.get('sheet_defaults'), dict) else {}
    # If the JSON file already defines any state or sheet rule, build only from that file.
    # Merging into generic/example defaults previously caused placeholder keys to be saved back to disk.
    has_persistent_data = bool(states or sheet_defaults_in)
    catalog: Dict[str, Any] = (
        {'states': {}, 'sheet_defaults': {}} if has_persistent_data else deepcopy(_DEFAULT_CATALOG)
    )

    for state_name, locations in states.items():
        state = _normalize_text(str(state_name))
        if not state:
            continue
        existing_key = next(
            (key for key in catalog['states'].keys() if key.lower() == state.lower()),
            state,
        )
        existing = catalog['states'].setdefault(existing_key, [])
        if isinstance(locations, list):
            for location in locations:
                loc = _normalize_text(str(location))
                if loc and loc not in existing:
                    existing.append(loc)
        existing[:] = sorted(existing, key=lambda item: item.lower())

    for sheet_name, rule in sheet_defaults_in.items():
        sheet = _normalize_text(str(sheet_name))
        if not sheet or not isinstance(rule, dict):
            continue
        state = _normalize_text(str(rule.get('state') or ''))
        location = _normalize_text(str(rule.get('general_location') or ''))
        if not state or not location:
            continue
        catalog['sheet_defaults'][sheet] = {
            'state': state,
            'general_location': location,
        }

    # Ensure every default sheet's state exists in the catalog.
    for rule in catalog['sheet_defaults'].values():
        catalog['states'].setdefault(rule['state'], [])

    # Keep states sorted for stable UI rendering.
    catalog['states'] = {
        state: sorted({*_locations}, key=lambda item: item.lower())
        for state, _locations in sorted(catalog['states'].items(), key=lambda item: item[0].lower())
    }
    catalog['sheet_defaults'] = {
        sheet: catalog['sheet_defaults'][sheet]
        for sheet in sorted(catalog['sheet_defaults'], key=lambda item: item.lower())
    }
    return catalog


def _load_catalog_unlocked() -> Dict[str, Any]:
    if not os.path.exists(_CATALOG_FILE):
        catalog = _normalize_catalog(None)
        _save_catalog_unlocked(catalog)
        return catalog

    try:
        with open(_CATALOG_FILE, 'r', encoding='utf-8') as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        raw = None
    return _normalize_catalog(raw)


def _save_catalog_unlocked(catalog: Dict[str, Any]) -> None:
    with open(_CATALOG_FILE, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False, sort_keys=True)


def get_general_location_catalog() -> Dict[str, Any]:
    with _CATALOG_LOCK:
        return deepcopy(_load_catalog_unlocked())


def get_states() -> List[str]:
    catalog = get_general_location_catalog()
    return list(catalog['states'].keys())


def get_locations_for_state(state: Optional[str]) -> List[str]:
    state_name = _normalize_text(state or '')
    if not state_name:
        return []
    catalog = get_general_location_catalog()
    match = next((key for key in catalog['states'].keys() if key.lower() == state_name.lower()), None)
    return list(catalog['states'].get(match or state_name, []))


def get_sheet_default(sheet_name: Optional[str]) -> Optional[Dict[str, str]]:
    sheet = _normalize_text(sheet_name or '')
    if not sheet:
        return None
    catalog = get_general_location_catalog()
    match = next((key for key in catalog['sheet_defaults'].keys() if key.lower() == sheet.lower()), None)
    return deepcopy(catalog['sheet_defaults'].get(match or sheet))


def get_sheet_state(sheet_name: Optional[str]) -> Optional[str]:
    default = get_sheet_default(sheet_name)
    if default:
        return default['state']
    sheet = _normalize_text(sheet_name or '')
    if not sheet:
        return None
    if '/' in sheet:
        return _normalize_text(sheet.split('/', 1)[0])
    return sheet


def get_effective_general_location(sheet_name: Optional[str], general_location: Optional[str] = None) -> str:
    default = get_sheet_default(sheet_name)
    if default:
        return default['general_location']
    return _normalize_text(general_location or '')


def get_general_location_options_for_sheet(sheet_name: Optional[str]) -> Dict[str, Any]:
    state = get_sheet_state(sheet_name)
    default = get_sheet_default(sheet_name)
    if default:
        locations = [default['general_location']]
    else:
        locations = get_locations_for_state(state)
    return {
        'state': state or '',
        'locations': locations,
        'fixed_general_location': default['general_location'] if default else '',
        'fixed': bool(default),
    }


def _find_location_case_insensitive(existing_locations: List[str], candidate: str) -> Optional[str]:
    candidate_normalized = _normalize_text(candidate).lower()
    for location in existing_locations:
        if _normalize_text(location).lower() == candidate_normalized:
            return location
    return None


def add_general_location(state: str, general_location: str) -> Dict[str, Any]:
    state_name = _normalize_text(state)
    location_name = _normalize_text(general_location)
    if not state_name:
        raise ValueError('state is required')
    if not location_name:
        raise ValueError('general_location is required')

    with _CATALOG_LOCK:
        catalog = _load_catalog_unlocked()
        existing_key = next((key for key in catalog['states'].keys() if key.lower() == state_name.lower()), state_name)
        existing_locations = catalog['states'].setdefault(existing_key, [])
        match = _find_location_case_insensitive(existing_locations, location_name)
        if match is None:
            existing_locations.append(location_name)
            existing_locations[:] = sorted(existing_locations, key=lambda item: item.lower())
            _save_catalog_unlocked(catalog)
        else:
            location_name = match
        return deepcopy(_normalize_catalog(catalog))


def validate_general_location_for_sheet(
    sheet_name: Optional[str],
    general_location: Optional[str],
    *,
    state: Optional[str] = None,
    allow_blank: bool = False,
) -> str:
    """
    Validate and normalize the general location for a specific sheet.

    - Fixed sheet defaults are always returned.
    - For state-based sheets the value must be in that state's catalog.
    - If allow_blank is True and the value is blank, return an empty string.
    """
    effective_sheet = _normalize_text(sheet_name or '')
    if not effective_sheet:
        raise ValueError('sheet_name is required')

    default = get_sheet_default(effective_sheet)
    if default:
        return default['general_location']

    effective_state = _normalize_text(state or get_sheet_state(effective_sheet) or '')
    value = _normalize_text(general_location or '')
    if not value:
        if allow_blank:
            return ''
        raise ValueError('general_location is required')

    if not effective_state:
        return value

    valid_locations = get_locations_for_state(effective_state)
    matched = _find_location_case_insensitive(valid_locations, value)
    if matched:
        return matched

    raise ValueError(f"general_location '{value}' is not configured for state '{effective_state}'")


def resolve_general_location_from_sheet_and_value(
    sheet_name: Optional[str],
    general_location: Optional[str],
    *,
    state: Optional[str] = None,
    allow_blank: bool = False,
) -> str:
    """
    Return the canonical general location for a sheet/value pair.

    Fixed sheet mappings win over any provided value. Otherwise, validate the provided
    value against the state catalog.
    """
    default = get_sheet_default(sheet_name)
    if default:
        return default['general_location']
    return validate_general_location_for_sheet(
        sheet_name,
        general_location,
        state=state,
        allow_blank=allow_blank,
    )

