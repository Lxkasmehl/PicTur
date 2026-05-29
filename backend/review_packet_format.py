"""Build review-queue packet JSON from on-disk packet folders."""

import json
import os

from additional_image_labels import normalize_label_list

_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


def _parse_review_additional_dir(target_dir):
    results = []
    manifest_path = os.path.join(target_dir, 'manifest.json')
    processed_files = set()

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
                        row = {
                            'filename': fn,
                            'type': kind,
                            'timestamp': entry.get('timestamp'),
                            'image_path': p,
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
                and f.lower().endswith(_IMAGE_EXTENSIONS)
            ):
                results.append({
                    'filename': f,
                    'type': 'other',
                    'labels': [],
                    'timestamp': None,
                    'image_path': os.path.join(target_dir, f),
                })
    return results


def _list_review_additional_images(packet_dir):
    additional_images = []
    additional_dir = os.path.join(packet_dir, 'additional_images')
    if os.path.isdir(additional_dir):
        additional_images.extend(_parse_review_additional_dir(additional_dir))
        for item in sorted(os.listdir(additional_dir)):
            item_path = os.path.join(additional_dir, item)
            if os.path.isdir(item_path):
                additional_images.extend(_parse_review_additional_dir(item_path))
    return additional_images


def format_review_packet_item(packet_dir, request_id):
    """Build one queue item dict from packet_dir (used by get_review_queue and get_review_packet)."""
    metadata_path = os.path.join(packet_dir, 'metadata.json')
    metadata = {}
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)

    additional_images = _list_review_additional_images(packet_dir)

    uploaded_image = None
    for f in os.listdir(packet_dir):
        if f.lower().endswith(('.jpg', '.png', '.jpeg')) and f != 'metadata.json' and not f.startswith('.'):
            uploaded_image = os.path.join(packet_dir, f)
            break

    candidates_dir = os.path.join(packet_dir, 'candidate_matches')
    failed_path = os.path.join(packet_dir, 'match_search_failed.json')
    match_search_failed = os.path.isfile(failed_path)
    match_search_error = None
    if match_search_failed:
        try:
            with open(failed_path, 'r', encoding='utf-8') as f:
                fail_data = json.load(f)
            if isinstance(fail_data, dict):
                err = (fail_data.get('error') or '').strip()
                match_search_error = err or None
        except (json.JSONDecodeError, OSError, TypeError):
            pass
        if match_search_error is None:
            match_search_error = 'Match search failed.'

    # Staff/admin /api/upload builds the packet synchronously before search. If search errors,
    # candidate_matches is never created; without a failure file (older uploads), the folder
    # is not "still matching" — classify as failed so the queue shows recovery actions.
    if (
        request_id.startswith('admin_')
        and not os.path.isdir(candidates_dir)
        and not match_search_failed
    ):
        match_search_failed = True
        match_search_error = (
            'Match search did not complete for this staff/admin upload. '
            'Try uploading again, or create a new turtle from this find.'
        )

    # candidate_matches is created after SuperPoint search succeeds in create_review_packet;
    # missing dir + no failure marker => matching still running (or legacy stuck community packet).
    match_search_pending = not os.path.isdir(candidates_dir) and not match_search_failed
    candidates = []
    if os.path.isdir(candidates_dir):
        for candidate_file in sorted(os.listdir(candidates_dir)):
            if candidate_file.lower().endswith(('.jpg', '.png', '.jpeg')):
                # Strip extension case-insensitively (.JPG was left on parts, breaking int() for Rank/Conf).
                root, ext = os.path.splitext(candidate_file)
                base_name = root if ext.lower() in ('.jpg', '.jpeg', '.png') else candidate_file
                parts = base_name.split('_')
                rank, turtle_id, confidence = 0, 'Unknown', 0
                for part in parts:
                    if part.startswith('Rank'):
                        rank = int(part.replace('Rank', ''))
                    elif part.startswith('ID'):
                        turtle_id = part.replace('ID', '')
                    elif part.startswith('Conf'):
                        confidence = int(part.replace('Conf', ''))
                    elif part.startswith('Score'):
                        confidence = 0
                candidates.append({
                    'rank': rank,
                    'turtle_id': turtle_id,
                    'confidence': confidence,
                    'image_path': os.path.join(candidates_dir, candidate_file),
                })

    return {
        'request_id': request_id,
        'uploaded_image': uploaded_image,
        'metadata': metadata,
        'additional_images': additional_images,
        'candidates': sorted(candidates, key=lambda x: x['rank']),
        'match_search_pending': match_search_pending,
        'match_search_failed': match_search_failed,
        'match_search_error': match_search_error,
        'status': 'pending',
        'photo_type': metadata.get('photo_type', 'plastron'),
    }
