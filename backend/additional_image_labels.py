"""Shared parsing/normalization for additional image types and labels (manifest.json)."""

import json
import os
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
    'additional': 'other',
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


# --- Per-directory manifest helpers ---------------------------------------
#
# Every reference / loose / additional photo subdirectory under a turtle folder
# can hold an optional ``manifest.json`` listing per-file metadata. The format
# is the same shape additional_images has used since the start:
#
#     [
#       { "filename": "F003.jpg", "labels": ["healthy"] },
#       { "filename": "F003_archived_2024.jpg", "labels": ["scarred"] },
#       …
#     ]
#
# Entries may carry extra keys (``type``, ``timestamp``, ``uploaded_by`` for
# additional_images). The label helpers below ignore unknown keys and only
# touch the ``labels`` field, so they're safe to use against existing
# additional_images manifests AND new manifests in plastron/, carapace/,
# Old References/, Other Plastrons/, etc. Files without an entry simply
# return an empty label list.


def _read_manifest(manifest_path: str) -> List[dict]:
    """Read manifest.json or return an empty list. Tolerant of missing/
    malformed files — the caller should not crash a list endpoint just
    because one manifest is unreadable."""
    if not os.path.isfile(manifest_path):
        return []
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def read_labels_for_file(parent_dir: str, filename: str) -> List[str]:
    """Look up labels for ``filename`` in ``<parent_dir>/manifest.json``.

    Returns an empty list when the manifest is missing, the file is not
    listed, or the entry has no ``labels`` field. Always returns a list
    (never None) so callers can use it directly.
    """
    if not parent_dir or not filename:
        return []
    manifest_path = os.path.join(parent_dir, 'manifest.json')
    for entry in _read_manifest(manifest_path):
        if not isinstance(entry, dict):
            continue
        if entry.get('filename') == filename:
            return normalize_label_list(entry.get('labels'))
    return []


def migrate_labels_to_archive(
    source_dir: str,
    source_filename: str,
    archive_dir: str,
    archive_filename: str,
) -> None:
    """Move a file's labels from one directory's manifest to another's.

    Used when a file is archived (e.g. an active reference being replaced and
    moved to Old References/, or a soft-delete moving an image to Deleted/).
    Without this, the manifest entry stays in the source directory keyed by
    filename — the new file written at that path silently inherits the old
    file's tags, while the archived copy under its new name carries none.

    No-ops cleanly when source has no labels or paths are bad.
    """
    if not source_dir or not source_filename or not archive_dir or not archive_filename:
        return
    labels = read_labels_for_file(source_dir, source_filename)
    if not labels:
        return
    set_labels_for_file(archive_dir, archive_filename, labels)
    # Clear the source entry so a NEW file written at the same path doesn't
    # silently inherit the old labels.
    set_labels_for_file(source_dir, source_filename, [])


def set_labels_for_file(parent_dir: str, filename: str, labels: List[str]) -> None:
    """Update labels for ``filename`` in ``<parent_dir>/manifest.json``,
    preserving any other fields on the entry (type, timestamp, etc.).

    Creates the manifest if absent. Adds an entry if the file isn't listed
    yet. Removes the entry entirely when ``labels`` is empty AND the entry
    has no other meaningful fields, to keep manifests tidy.
    """
    if not parent_dir or not filename:
        return
    os.makedirs(parent_dir, exist_ok=True)
    manifest_path = os.path.join(parent_dir, 'manifest.json')
    entries = _read_manifest(manifest_path)
    normalized = normalize_label_list(labels)
    found = False
    cleaned: List[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get('filename') == filename:
            found = True
            entry = dict(entry)
            if normalized:
                entry['labels'] = normalized
            else:
                entry.pop('labels', None)
            # Drop the entry entirely when nothing meaningful remains.
            other_keys = [
                k for k in entry.keys()
                if k not in ('filename',) and entry.get(k) not in (None, '', [])
            ]
            if not other_keys:
                continue
        cleaned.append(entry)
    if not found and normalized:
        cleaned.append({'filename': filename, 'labels': normalized})

    try:
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(cleaned, f, indent=2)
    except OSError:
        pass
