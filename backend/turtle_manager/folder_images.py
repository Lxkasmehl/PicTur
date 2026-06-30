"""Scan a turtle data folder and build the GET /api/turtles/images response payload."""

import json
import os
import re
import time

from additional_image_labels import normalize_label_list, read_labels_for_file
from turtle_manager.path_utils import _extract_exif_date

# Matches a millisecond-epoch timestamp at the start of a loose-photo filename,
# e.g. "plastron_1712345678901_source.jpg" or "carapace_1712345678901_foo.jpg".
_LOOSE_TS_RE = re.compile(r'^(?:plastron|carapace)_(\d{10,13})_')
# Archived_Master_<ms>.jpg or Archived_Carapace_<ms>.jpg (with optional _YYYY-MM-DD suffix)
_ARCHIVED_TS_RE = re.compile(r'^Archived_(?:Master|Carapace)_(\d{10,13})')
# Obs_<unix_seconds>_original.jpg
_OBS_TS_RE = re.compile(r'^Obs_(\d{10,13})_')
# Embedded YYYY-MM-DD anywhere in filename (the upload-date stamp added by the manager)
_FILENAME_DATE_RE = re.compile(r'(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)')
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


def dir_has_image(dir_path):
    """True if ``dir_path`` or any descendant contains an image file."""
    if not dir_path or not os.path.isdir(dir_path):
        return False
    try:
        for _root, _dirs, files in os.walk(dir_path):
            if any(f.lower().endswith(IMAGE_EXTENSIONS) for f in files):
                return True
    except OSError:
        return False
    return False


def extract_upload_date_from_filename(filename, fallback_path=None):
    """Parse the system's upload date (YYYY-MM-DD) from a loose-photo filename."""
    m = _FILENAME_DATE_RE.search(filename)
    if m:
        return m.group(1)
    for rx in (_LOOSE_TS_RE, _ARCHIVED_TS_RE, _OBS_TS_RE):
        m = rx.search(filename)
        if m:
            raw = m.group(1)
            try:
                ts = int(raw)
                if ts > 1_000_000_000_000:
                    ts = ts / 1000
                return time.strftime('%Y-%m-%d', time.localtime(ts))
            except (ValueError, OSError):
                pass
    if fallback_path and os.path.exists(fallback_path):
        try:
            return time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(fallback_path)))
        except OSError:
            pass
    return None


def extract_upload_ts_from_filename(filename, fallback_path=None):
    """Epoch ms when this file was placed/last modified."""
    for rx in (_LOOSE_TS_RE, _ARCHIVED_TS_RE, _OBS_TS_RE):
        m = rx.search(filename)
        if m:
            try:
                ts = int(m.group(1))
                if ts < 1_000_000_000_000:
                    ts *= 1000
                return ts
            except ValueError:
                pass
    if fallback_path and os.path.exists(fallback_path):
        try:
            return int(os.path.getmtime(fallback_path) * 1000)
        except OSError:
            pass
    return None


def _build_primary_info(path):
    if not path:
        return None
    exif = _extract_exif_date(path)
    upload = extract_upload_date_from_filename(os.path.basename(path), fallback_path=path)
    upload_ts = extract_upload_ts_from_filename(os.path.basename(path), fallback_path=path)
    labels = read_labels_for_file(os.path.dirname(path), os.path.basename(path))
    info = {
        'path': path,
        'timestamp': exif or upload,
        'exif_date': exif,
        'upload_date': upload,
        'upload_ts': upload_ts,
    }
    if labels:
        info['labels'] = labels
    return info


def _find_first_image_in_dir(ref_dir):
    if not os.path.isdir(ref_dir):
        return None
    for f in sorted(os.listdir(ref_dir)):
        if f.lower().endswith(IMAGE_EXTENSIONS):
            return os.path.join(ref_dir, f)
    return None


def _parse_turtle_additional_dir(target_dir):
    results = []
    manifest_path = os.path.join(target_dir, 'manifest.json')
    processed_files = set()
    folder_date_match = _FILENAME_DATE_RE.search(os.path.basename(target_dir))
    folder_upload_date = folder_date_match.group(1) if folder_date_match else None

    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            for entry in manifest:
                fn = entry.get('filename')
                kind = entry.get('type', 'other')
                if fn:
                    p = os.path.join(target_dir, fn)
                    if os.path.isfile(p):
                        exif_date = entry.get('exif_date') or _extract_exif_date(p)
                        manifest_ts = entry.get('timestamp')
                        upload_date = (
                            manifest_ts[:10]
                            if isinstance(manifest_ts, str) and len(manifest_ts) >= 10
                            else None
                        ) or folder_upload_date
                        upload_ts = extract_upload_ts_from_filename(fn, fallback_path=p)
                        row = {
                            'path': p,
                            'type': kind,
                            'timestamp': exif_date or upload_date,
                            'exif_date': exif_date,
                            'upload_date': upload_date,
                            'upload_ts': upload_ts,
                            'uploaded_by': entry.get('uploaded_by'),
                        }
                        lbs = entry.get('labels')
                        if lbs:
                            row['labels'] = normalize_label_list(lbs)
                        results.append(row)
                        processed_files.add(fn)
        except (json.JSONDecodeError, OSError):
            pass

    if os.path.isdir(target_dir):
        for f in sorted(os.listdir(target_dir)):
            if (
                f != 'manifest.json'
                and f not in processed_files
                and f.lower().endswith(IMAGE_EXTENSIONS)
            ):
                full = os.path.join(target_dir, f)
                exif_date = _extract_exif_date(full)
                upload_date = extract_upload_date_from_filename(f, fallback_path=full) or folder_upload_date
                upload_ts = extract_upload_ts_from_filename(f, fallback_path=full)
                results.append({
                    'path': full,
                    'type': 'other',
                    'labels': [],
                    'timestamp': exif_date or upload_date,
                    'exif_date': exif_date,
                    'upload_date': upload_date,
                    'upload_ts': upload_ts,
                    'uploaded_by': None,
                })
    return results


def _list_turtle_additional_images(turtle_dir):
    additional = []
    additional_dir = os.path.join(turtle_dir, 'additional_images')
    if os.path.isdir(additional_dir):
        additional.extend(_parse_turtle_additional_dir(additional_dir))
        for item in sorted(os.listdir(additional_dir)):
            item_path = os.path.join(additional_dir, item)
            if os.path.isdir(item_path):
                additional.extend(_parse_turtle_additional_dir(item_path))
    return additional


def _list_turtle_loose_images(turtle_dir):
    loose = []
    loose_folders = [
        ('plastron/Other Plastrons', 'plastron_other'),
        ('plastron/Old References', 'plastron_old_ref'),
        ('carapace/Other Carapaces', 'carapace_other'),
        ('carapace/Old References', 'carapace_old_ref'),
        ('loose_images', 'loose_legacy'),
    ]
    for folder_rel, source_tag in loose_folders:
        ld = os.path.join(turtle_dir, folder_rel)
        if not os.path.isdir(ld):
            continue
        for f in sorted(os.listdir(ld)):
            if not f.lower().endswith(IMAGE_EXTENSIONS):
                continue
            full = os.path.join(ld, f)
            exif_date = _extract_exif_date(full)
            upload_date = extract_upload_date_from_filename(f, fallback_path=full)
            upload_ts = extract_upload_ts_from_filename(f, fallback_path=full)
            labels = read_labels_for_file(ld, f)
            entry = {
                'path': full,
                'source': source_tag,
                'timestamp': exif_date or upload_date,
                'exif_date': exif_date,
                'upload_date': upload_date,
                'upload_ts': upload_ts,
            }
            if labels:
                entry['labels'] = labels
            loose.append(entry)
    return loose


def _collect_history_dates(additional, loose, primary_info, primary_carapace_info):
    date_set = set()
    for a in additional:
        best = a.get('exif_date') or a.get('upload_date') or a.get('timestamp')
        if isinstance(best, str) and len(best) >= 10:
            date_set.add(best[:10])
        else:
            m = re.search(r'additional_images[/\\](\d{4}-\d{2}-\d{2})[/\\]', a.get('path', ''))
            if m:
                date_set.add(m.group(1))
    for l in loose:
        best = l.get('exif_date') or l.get('upload_date') or l.get('timestamp')
        if isinstance(best, str) and len(best) >= 10:
            date_set.add(best[:10])
    for info in (primary_info, primary_carapace_info):
        if info:
            best = info.get('exif_date') or info.get('upload_date') or info.get('timestamp')
            if isinstance(best, str) and len(best) >= 10:
                date_set.add(best[:10])
    return sorted(date_set, reverse=True)


def build_turtle_images_payload(turtle_dir, manager, turtle_id, sheet_name):
    """Return the JSON-serializable body for GET /api/turtles/images."""
    primary_path = None
    for ref_folder in ('plastron', 'ref_data'):
        primary_path = _find_first_image_in_dir(os.path.join(turtle_dir, ref_folder))
        if primary_path:
            break
    primary_info = _build_primary_info(primary_path)

    primary_carapace_path = _find_first_image_in_dir(os.path.join(turtle_dir, 'carapace'))
    primary_carapace_info = _build_primary_info(primary_carapace_path)

    additional = _list_turtle_additional_images(turtle_dir)
    loose = _list_turtle_loose_images(turtle_dir)
    history_dates = _collect_history_dates(additional, loose, primary_info, primary_carapace_info)

    deleted = []
    try:
        deleted = manager.list_deleted_turtle_images(turtle_id, sheet_name)
    except Exception as e:
        print(f"Warning: could not list deleted images for {turtle_id}: {e}")

    return {
        'primary': primary_path,
        'primary_carapace': primary_carapace_path,
        'primary_info': primary_info,
        'primary_carapace_info': primary_carapace_info,
        'additional': additional,
        'loose': loose,
        'history_dates': history_dates,
        'deleted': deleted,
    }
