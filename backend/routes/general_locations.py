"""
General location catalog endpoints.
"""

from flask import jsonify, request

from auth import require_admin
from general_locations_catalog import (
    add_general_location,
    delete_general_location,
    get_general_location_catalog,
)
from services import manager_service
from services.manager_service import get_sheets_service
from sheets import bulk_ops, sheet_management


def _serialize_catalog(catalog):
    states = [
        {'state': state, 'locations': locations}
        for state, locations in catalog.get('states', {}).items()
    ]
    sheet_defaults = [
        {'sheet_name': sheet_name, **rule}
        for sheet_name, rule in catalog.get('sheet_defaults', {}).items()
    ]
    return {
        'catalog': catalog,
        'states': states,
        'sheet_defaults': sheet_defaults,
    }


def _get_affected_turtles_across_sheets(sheets_svc, general_location: str):
    """
    Scan all research spreadsheet tabs for turtles whose 'General Location' equals
    general_location. Returns a list of {sheet_name, count, rows[]} dicts.
    """
    results = []
    try:
        all_sheets = sheets_svc.list_sheets()
    except Exception:
        return results

    with sheets_svc._api_lock:
        for sheet_name in all_sheets:
            try:
                rows = bulk_ops.find_rows_by_general_location(
                    sheets_svc.service,
                    sheets_svc.spreadsheet_id,
                    sheet_name,
                    general_location,
                )
                if rows:
                    results.append({'sheet_name': sheet_name, 'count': len(rows), 'rows': rows})
            except Exception as exc:
                print(f'affected-turtles: error scanning {sheet_name!r}: {exc}')

    return results


def register_general_location_routes(app):
    """Register general location catalog endpoints."""

    @app.route('/api/general-locations', methods=['GET', 'POST'])
    @require_admin
    def general_locations():
        if request.method == 'GET':
            catalog = get_general_location_catalog()
            return jsonify({'success': True, **_serialize_catalog(catalog)})

        data = request.get_json(silent=True) or {}
        state = (data.get('state') or '').strip()
        general_location = (data.get('general_location') or '').strip()
        if not state:
            return jsonify({'success': False, 'error': 'state is required'}), 400
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        try:
            catalog = add_general_location(state, general_location)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        sheets_updated = 0
        sync_error = None
        service = None
        try:
            service = get_sheets_service()
            if service:
                sheets_updated = sheet_management.sync_general_location_validations(service)
        except Exception as exc:  # pragma: no cover - best effort sync
            sync_error = str(exc)

        # True only when at least one tab received updated validation (not merely "API client exists")
        synced = bool(service) and sheets_updated > 0 and sync_error is None

        response = {'success': True, **_serialize_catalog(catalog), 'synced': synced}
        if service is not None:
            response['sheets_updated'] = sheets_updated
        if sync_error:
            response['sync_error'] = sync_error
        elif service and sheets_updated == 0:
            response['sync_warning'] = (
                'Google Sheets General Location dropdown was not updated on any tab. '
                'Ensure each state tab has a "General Location" header in row 1, or re-save a turtle on that tab.'
            )
        return jsonify(response)

    @app.route('/api/general-locations/affected-turtles', methods=['GET'])
    @require_admin
    def general_locations_affected_turtles():
        general_location = (request.args.get('general_location') or '').strip()
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        sheets_svc = get_sheets_service()
        if not sheets_svc:
            return jsonify({'success': True, 'total': 0, 'sheets': []})

        affected = _get_affected_turtles_across_sheets(sheets_svc, general_location)
        total = sum(s['count'] for s in affected)
        sheets_summary = [{'sheet_name': s['sheet_name'], 'count': s['count']} for s in affected]
        return jsonify({'success': True, 'total': total, 'sheets': sheets_summary})

    @app.route('/api/general-locations', methods=['DELETE'])
    @require_admin
    def delete_general_location_endpoint():
        data = request.get_json(silent=True) or {}
        state = (data.get('state') or '').strip()
        general_location = (data.get('general_location') or '').strip()
        target_general_location = (data.get('target_general_location') or '').strip()

        if not state:
            return jsonify({'success': False, 'error': 'state is required'}), 400
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        sheets_svc = get_sheets_service()

        # Find affected turtles before deleting the location.
        affected = _get_affected_turtles_across_sheets(sheets_svc, general_location) if sheets_svc else []
        total_affected = sum(s['count'] for s in affected)

        if total_affected > 0 and not target_general_location:
            sheets_summary = [{'sheet_name': s['sheet_name'], 'count': s['count']} for s in affected]
            return jsonify({
                'success': False,
                'error': 'turtles_exist',
                'total': total_affected,
                'sheets': sheets_summary,
            }), 409

        # Move turtles to the target location if needed.
        move_errors = []
        if total_affected > 0 and target_general_location and sheets_svc:
            with sheets_svc._api_lock:
                for sheet_info in affected:
                    sheet_name = sheet_info['sheet_name']
                    try:
                        bulk_ops.bulk_update_general_location(
                            sheets_svc.service,
                            sheets_svc.spreadsheet_id,
                            sheet_name,
                            general_location,
                            target_general_location,
                        )
                    except Exception as exc:
                        move_errors.append(f'{sheet_name}: {exc}')
                        continue

                    # Best-effort folder relocation per turtle.
                    if manager_service.manager is not None:
                        for row in sheet_info.get('rows', []):
                            pid = row.get('primary_id') or ''
                            bio = row.get('id') or ''
                            try:
                                manager_service.manager.relocate_turtle_folder(
                                    pid, sheet_name, target_general_location,
                                    bio_id=bio or None,
                                )
                            except Exception:
                                pass

        if move_errors:
            return jsonify({
                'success': False,
                'error': f'Failed to move turtles in some sheets: {"; ".join(move_errors)}',
            }), 500

        # Delete the location from the catalog.
        try:
            catalog = delete_general_location(state, general_location)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        # Sync Google Sheets validation dropdowns.
        sheets_updated = 0
        sync_error = None
        service = get_sheets_service()
        try:
            if service:
                sheets_updated = sheet_management.sync_general_location_validations(service)
        except Exception as exc:
            sync_error = str(exc)

        synced = bool(service) and sheets_updated > 0 and sync_error is None

        response = {
            'success': True,
            **_serialize_catalog(catalog),
            'synced': synced,
            'moved': total_affected,
        }
        if service is not None:
            response['sheets_updated'] = sheets_updated
        if sync_error:
            response['sync_error'] = sync_error
        return jsonify(response)

