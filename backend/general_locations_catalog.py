"""
Shared catalog for program-specific general locations.

The catalog is used by:
- the frontend dropdown source
- backend validation for sheet writes and review flows
- Google Sheets validation rules when creating/syncing tabs

Terminology
-----------
``state``
    The key used to look up the location list for a given sheet tab.  It always
    equals the sheet tab name (e.g. "NebraskaCPBS", "IowaHawkeye", "Kansas").
    This matches the top-level folder name used by TurtleManager:
      data/<sheet_name>/<general_location>/<BiologyID_PrimaryKey>/

``sheet_default``
    Marks a program whose General Location is fixed (never chosen per-turtle).
    The ``state`` field inside a sheet_default entry MUST equal the sheet_name
    key.  Geographic parent names ("Iowa", "Nebraska") must NOT be used.
"""

from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from typing import Any, Dict, List, Optional

# Catalog persists in the data volume (``data/``), NOT the code tree, so General
# Locations an admin adds through the app survive redeploys. The code tree is
# rebuilt and ``git reset --hard``-ed on every deploy and ``*.json`` is excluded
# from the backend image, so a catalog kept next to this module was ephemeral and
# reverted to seed defaults on each deploy (admin-added locations were lost).
# ``data/`` is a mounted volume; this mirrors ``TurtleManager.base_dir`` (<backend>/data).
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
_CATALOG_FILE = os.path.join(_DATA_DIR, 'general_locations.json')
_CATALOG_LOCK = threading.RLock()

# Seed used only when the catalog file is missing or has no states/sheet_defaults yet.
# Each state key = sheet tab name.  For fixed programs the state key equals the
# sheet_default key so that folder paths are always data/<sheet_name>/<location>/...
_DEFAULT_CATALOG: Dict[str, Any] = {
    'states': {
        'Kansas': [
            'Dee Hobelman',
            'Karlyle Woods',
            'Lawrence',
            'North Topeka',
            'Other',
            'West Topeka',
        ],
        'NebraskaCPBS': [
            'CPBS',
        ],
        'NebraskaCL': [
            'Crescent Lake',
        ],
        'IowaHawkeye': [
            'Hawkeye',
        ],
    },
    'sheet_defaults': {
        'NebraskaCPBS': {
            'state': 'NebraskaCPBS',
            'general_location': 'CPBS',
        },
        'NebraskaCL': {
            'state': 'NebraskaCL',
            'general_location': 'Crescent Lake',
        },
        'IowaHawkeye': {
            'state': 'IowaHawkeye',
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

    # --- Migration: fix legacy entries where state != sheet_name ---------------
    # Older catalog files used geographic parent names ("Iowa", "Nebraska") as the
    # state key.  The correct model is state == sheet_name so that folder paths
    # match data/<sheet_name>/<general_location>/...
    for sheet_key in list(catalog['sheet_defaults'].keys()):
        rule = catalog['sheet_defaults'][sheet_key]
        old_state = rule['state']
        location = rule['general_location']
        if old_state.lower() == sheet_key.lower():
            continue  # already correct

        # Move location to a state keyed by sheet_name.
        new_state_key = next(
            (k for k in catalog['states'].keys() if k.lower() == sheet_key.lower()),
            sheet_key,
        )
        new_locs = catalog['states'].setdefault(new_state_key, [])
        if not any(loc.lower() == location.lower() for loc in new_locs):
            new_locs.append(location)

        # Remove location from old state if no other default still references it.
        still_used = any(
            r['state'].lower() == old_state.lower() and r['general_location'].lower() == location.lower()
            for sn, r in catalog['sheet_defaults'].items()
            if sn != sheet_key
        )
        if not still_used:
            old_key = next(
                (k for k in catalog['states'].keys() if k.lower() == old_state.lower()),
                None,
            )
            if old_key:
                catalog['states'][old_key] = [
                    loc for loc in catalog['states'][old_key]
                    if loc.lower() != location.lower()
                ]
                if not catalog['states'][old_key]:
                    del catalog['states'][old_key]

        # Update the sheet_default to use the correct state.
        catalog['sheet_defaults'][sheet_key] = {
            'state': new_state_key,
            'general_location': location,
        }
    # ---------------------------------------------------------------------------

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
    os.makedirs(os.path.dirname(_CATALOG_FILE) or '.', exist_ok=True)
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


def delete_general_location(state: str, general_location: str, *, force: bool = False) -> Dict[str, Any]:
    """Remove a location from a state's catalog.

    When *force* is True the locked-default check is skipped and any sheet_defaults
    that reference this state+location are also removed atomically (used when an admin
    deletes an entire fixed program via the management UI).
    """
    state_name = _normalize_text(state)
    location_name = _normalize_text(general_location)
    if not state_name:
        raise ValueError('state is required')
    if not location_name:
        raise ValueError('general_location is required')

    with _CATALOG_LOCK:
        catalog = _load_catalog_unlocked()

        if not force:
            # Refuse if this location is the fixed default for any sheet tab.
            for sheet_name, rule in catalog.get('sheet_defaults', {}).items():
                if (
                    _normalize_text(rule.get('state', '')).lower() == state_name.lower()
                    and _normalize_text(rule.get('general_location', '')).lower() == location_name.lower()
                ):
                    raise ValueError(
                        f"Cannot delete '{location_name}': it is the fixed General Location for sheet '{sheet_name}'. "
                        f"Remove that sheet default first."
                    )
        else:
            # Remove any sheet_defaults that point to this state+location.
            to_remove = [
                sn for sn, rule in catalog.get('sheet_defaults', {}).items()
                if (
                    _normalize_text(rule.get('state', '')).lower() == state_name.lower()
                    and _normalize_text(rule.get('general_location', '')).lower() == location_name.lower()
                )
            ]
            for sn in to_remove:
                del catalog['sheet_defaults'][sn]

        existing_key = next(
            (key for key in catalog['states'].keys() if key.lower() == state_name.lower()),
            None,
        )
        if existing_key is None:
            raise ValueError(f"State '{state_name}' not found in catalog")

        existing_locations = catalog['states'].get(existing_key, [])
        match = _find_location_case_insensitive(existing_locations, location_name)
        if match is None:
            raise ValueError(f"General location '{location_name}' not found in state '{state_name}'")

        existing_locations.remove(match)
        catalog['states'][existing_key] = sorted(existing_locations, key=lambda item: item.lower())

        # Drop the state entry entirely if it became empty.
        if not catalog['states'][existing_key]:
            del catalog['states'][existing_key]

        _save_catalog_unlocked(catalog)
        return deepcopy(_normalize_catalog(catalog))


def add_sheet_default(sheet_name: str, general_location: str) -> Dict[str, Any]:
    """Create or update a fixed-program sheet default.

    The *state* is always set to *sheet_name* (new-style programs where the sheet tab
    name doubles as the state identifier).  The location is added to catalog.states if
    it is not already present.
    """
    sheet = _normalize_text(sheet_name)
    location = _normalize_text(general_location)
    if not sheet:
        raise ValueError('sheet_name is required')
    if not location:
        raise ValueError('general_location is required')

    with _CATALOG_LOCK:
        catalog = _load_catalog_unlocked()

        # Find or create the state keyed by sheet_name.
        existing_key = next(
            (k for k in catalog['states'].keys() if k.lower() == sheet.lower()),
            sheet,
        )
        existing_locations = catalog['states'].setdefault(existing_key, [])
        if _find_location_case_insensitive(existing_locations, location) is None:
            existing_locations.append(location)
            existing_locations[:] = sorted(existing_locations, key=lambda x: x.lower())

        catalog['sheet_defaults'][existing_key] = {
            'state': existing_key,
            'general_location': location,
        }

        _save_catalog_unlocked(catalog)
        return deepcopy(_normalize_catalog(catalog))


def remove_sheet_default(sheet_name: str) -> Dict[str, Any]:
    """Convert a fixed program to selectable by removing its sheet default.

    Because the catalog always enforces state == sheet_name (see _normalize_catalog),
    the location simply stays in catalog.states[sheet_name] after the default is
    removed — no migration is needed.
    """
    sheet = _normalize_text(sheet_name)
    if not sheet:
        raise ValueError('sheet_name is required')

    with _CATALOG_LOCK:
        catalog = _load_catalog_unlocked()

        match_key = next(
            (k for k in catalog.get('sheet_defaults', {}).keys() if k.lower() == sheet.lower()),
            None,
        )
        if match_key is None:
            raise ValueError(f"Sheet default '{sheet_name}' not found")

        catalog['sheet_defaults'].pop(match_key)
        _save_catalog_unlocked(catalog)
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

