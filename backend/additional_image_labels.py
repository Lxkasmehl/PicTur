"""Shared parsing/normalization for additional image types and labels (manifest.json)."""

import json
from typing import Any, Dict, List, Optional

ADDITIONAL_TYPE_ALIASES: Dict[str, str] = {
    'microhabitat': 'microhabitat',
    'condition': 'condition',
    'carapace': 'carapace',
    'plastron': 'plastron',
    'anterior': 'anterior',
    'posterior': 'posterior',
    'leftside': 'left-side',
    'rightside': 'right-side',
    # Legacy aliases kept for backwards compatibility with older clients/buttons.
    'head': 'anterior',
    'tail': 'posterior',
    'people': 'people',
    'injury': 'injury',
    'other': 'other',
}

VALID_ADDITIONAL_TYPES = frozenset(ADDITIONAL_TYPE_ALIASES.values())


def _type_key(raw: Optional[str]) -> str:
    return ''.join(ch for ch in (raw or '').strip().lower() if ch.isalnum())


def normalize_additional_type(raw: Optional[str]) -> str:
    return ADDITIONAL_TYPE_ALIASES.get(_type_key(raw), 'other')


def parse_additional_type_filter(raw: Optional[str]) -> Optional[str]:
    """Return canonical type or None (for empty). Raise ValueError for invalid non-empty input."""
    if raw is None:
        return None
    stripped = str(raw).strip()
    if not stripped:
        return None
    key = _type_key(stripped)
    parsed = ADDITIONAL_TYPE_ALIASES.get(key)
    if not parsed:
        raise ValueError('Invalid additional image type filter')
    return parsed


def normalize_label_list(labels: Any) -> List[str]:
    """Deduplicate case-insensitively, preserve first spelling."""
    if not labels:
        return []
    if isinstance(labels, str):
        labels = [labels]
    if not isinstance(labels, list):
        return []
    out: List[str] = []
    seen: set = set()
    for x in labels:
        s = str(x).strip()
        if not s:
            continue
        k = s.lower()
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def parse_labels_from_form(form, idx: str, key_prefix: str = 'labels') -> List[str]:
    """
    Accept labels_N (or keyPrefix_N) as comma-separated text or JSON array string.
    """
    key = f'{key_prefix}_{idx}'
    raw = (form.get(key) or '').strip()
    if not raw:
        return []
    if raw.startswith('['):
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return normalize_label_list(data)
        except (json.JSONDecodeError, TypeError):
            pass
    parts = [p.strip() for p in raw.replace(';', ',').split(',')]
    return normalize_label_list(parts)


def label_query_matches(labels: Any, query: str) -> bool:
    q = (query or '').strip().lower()
    if not q:
        return False
    if not isinstance(labels, list):
        return False
    for lab in labels:
        if q in str(lab).lower():
            return True
    return False
