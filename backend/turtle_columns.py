"""
Which turtle data columns a database-backed research group uses.

The main group (Google Sheets) always has every standard column and none of its own. A research
group picks the standard columns it wants (the main group's spreadsheet is the template) and can
add its own columns. The choice lives in ``<group data dir>/turtle_columns.json``:

    {"standard": ["primary_id", "id", "sex", "name", ...],
     "custom": [{"key": "custom_eye_color", "label": "Eye color", "type": "select",
                 "options": ["brown", "red"]}]}

A missing file means every standard column (the state of groups created before this existed).
Hiding a column never deletes data: its cells stay in the rows and come back when it is shown
again. New program tabs are created with the chosen columns only.
"""

from __future__ import annotations

import json
import os
import re
import threading
from typing import Any, Dict, List, Optional

from sheets.columns import CANONICAL_COLUMN_ORDER, COLUMN_MAPPING

#: Always kept: Primary ID identifies the turtle, ID is its biology ID (generated from Sex), and
#: General Location follows the group's location setup (hidden there when it uses one location).
REQUIRED_FIELDS = ('primary_id', 'id', 'sex', 'general_location')
CUSTOM_TYPES = ('text', 'number', 'date', 'select', 'yesno', 'textarea')
CUSTOM_PREFIX = 'custom_'
MAX_CUSTOM_COLUMNS = 50
MAX_LABEL_LENGTH = 60
MAX_OPTIONS = 50

STANDARD_FIELDS: List[str] = [COLUMN_MAPPING[h] for h in CANONICAL_COLUMN_ORDER]
STANDARD_HEADER = {COLUMN_MAPPING[h]: h for h in CANONICAL_COLUMN_ORDER}

_lock = threading.RLock()
_cache: Dict[str, Any] = {}


def _schema_file(org_id: Optional[int] = None) -> Optional[str]:
    """The schema file of ``org_id``, else of the active research group (None: main group)."""
    import tenant

    if org_id is None:
        t = tenant.current()
        if t is None:
            return None
        org_id = t.id
    return os.path.join(tenant.data_dir(org_id), 'turtle_columns.json')


def is_configurable() -> bool:
    """Only database-backed research groups choose their columns."""
    return _schema_file() is not None


def _default_schema() -> Dict[str, Any]:
    return {'standard': list(STANDARD_FIELDS), 'custom': []}


def get_schema(org_id: Optional[int] = None) -> Dict[str, Any]:
    """The group's column choice (every standard column for the main group)."""
    path = _schema_file(org_id)
    if path is None or not os.path.exists(path):
        return _default_schema()
    try:
        mtime = os.path.getmtime(path)
        with _lock:
            hit = _cache.get(path)
            if hit and hit[0] == mtime:
                return hit[1]
        with open(path, 'r', encoding='utf-8') as f:
            schema = normalize_schema(json.load(f) or {})
    except (OSError, ValueError, json.JSONDecodeError):
        return _default_schema()
    with _lock:
        _cache[path] = (mtime, schema)
    return schema


def _slug(label: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')[:40] or 'field'


def normalize_schema(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Validated, canonical form of a schema. Raises ValueError with a readable message."""
    if not isinstance(raw, dict):
        raise ValueError('Invalid column setup')
    wanted = raw.get('standard')
    if wanted is None:
        wanted = list(STANDARD_FIELDS)
    if not isinstance(wanted, list):
        raise ValueError('standard must be a list of field keys')
    unknown = [k for k in wanted if k not in STANDARD_HEADER]
    if unknown:
        raise ValueError(f'Unknown standard columns: {", ".join(map(str, unknown))}')
    chosen = set(wanted) | set(REQUIRED_FIELDS)
    standard = [k for k in STANDARD_FIELDS if k in chosen]

    taken_headers = {h.lower() for h in CANONICAL_COLUMN_ORDER} | {'sheet_name', 'row_index'}
    taken_keys = set(STANDARD_FIELDS)
    custom = []
    items = raw.get('custom') or []
    if not isinstance(items, list):
        raise ValueError('custom must be a list')
    if len(items) > MAX_CUSTOM_COLUMNS:
        raise ValueError(f'At most {MAX_CUSTOM_COLUMNS} custom columns')
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Invalid custom column')
        label = ' '.join(str(item.get('label') or '').split())
        if not label:
            raise ValueError('Every custom column needs a name')
        if len(label) > MAX_LABEL_LENGTH:
            raise ValueError(f'Column names can have at most {MAX_LABEL_LENGTH} characters')
        if label.lower() in taken_headers:
            raise ValueError(f"A column named '{label}' already exists")
        col_type = item.get('type') or 'text'
        if col_type not in CUSTOM_TYPES:
            raise ValueError(f"Unknown column type '{col_type}'")
        key = str(item.get('key') or '')
        if not key.startswith(CUSTOM_PREFIX) or key in taken_keys:
            base = CUSTOM_PREFIX + _slug(label)
            key, n = base, 2
            while key in taken_keys:
                key, n = f'{base}_{n}', n + 1
        entry = {'key': key, 'label': label, 'type': col_type}
        if col_type == 'select':
            options = []
            for o in item.get('options') or []:
                o = ' '.join(str(o).split())
                if o and o not in options:
                    options.append(o)
            if not options:
                raise ValueError(f"'{label}' needs at least one option")
            if len(options) > MAX_OPTIONS:
                raise ValueError(f"'{label}' can have at most {MAX_OPTIONS} options")
            entry['options'] = options
        taken_headers.add(label.lower())
        taken_keys.add(key)
        custom.append(entry)
    return {'standard': standard, 'custom': custom}


def save_schema(raw: Dict[str, Any]) -> Dict[str, Any]:
    path = _schema_file()
    if path is None:
        raise ValueError('The columns of the main group follow its Google Sheet')
    schema = normalize_schema(raw)
    with _lock:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(schema, f, indent=2)
        os.replace(tmp, path)
        _cache.pop(path, None)
    return schema


def custom_column_mapping(org_id: Optional[int] = None) -> Dict[str, str]:
    """{sheet header: field key} of the group's own columns ({} for the main group)."""
    if _schema_file(org_id) is None:
        return {}
    return {c['label']: c['key'] for c in get_schema(org_id)['custom']}


def tab_headers(org_id: Optional[int] = None) -> List[str]:
    """Header row of a new program tab: the chosen standard columns, then the group's own."""
    schema = get_schema(org_id)
    enabled = set(schema['standard'])
    return [h for h in CANONICAL_COLUMN_ORDER if COLUMN_MAPPING[h] in enabled] + \
        [c['label'] for c in schema['custom']]
