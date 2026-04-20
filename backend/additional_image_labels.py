"""Shared parsing/normalization for additional image types and labels (manifest.json)."""

import json
from typing import Any, List, Optional

VALID_ADDITIONAL_TYPES = frozenset({'microhabitat', 'condition', 'carapace', 'other'})


def normalize_additional_type(raw: Optional[str]) -> str:
    t = (raw or 'other').strip().lower()
    return t if t in VALID_ADDITIONAL_TYPES else 'other'


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
