"""
General location catalog endpoints.
"""

from flask import jsonify, request

from auth import require_admin, require_admin_only
from general_locations_catalog import (
    add_general_location,
    add_sheet_default,
    delete_general_location,
    get_general_location_catalog,
    get_locations_for_state,
    get_sheet_state,
    remove_sheet_default,
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


def _get_affected_turtles_across_sheets(
    sheets_svc,
    general_location: str,
    state: str = '',
    fail_on_error: bool = False,
):
    """
    Scan research spreadsheet tabs for turtles whose 'General Location' equals
    general_location.  When *state* is provided only tabs belonging to that state
    are scanned (prevents cross-state false positives for shared location names).
    When *fail_on_error* is True any scan failure raises RuntimeError instead of
    being silently dropped.
    Returns a list of {sheet_name, count, rows[]} dicts.
    """
    results = []
    scan_errors: list = []
    try:
        all_sheets = sheets_svc.list_sheets()
    except Exception as exc:
        if fail_on_error:
            raise RuntimeError(f'Failed to list sheets: {exc}') from exc
        return results

    state_lower = state.strip().lower()

    with sheets_svc._api_lock:
        for sheet_name in all_sheets:
            if state_lower and (get_sheet_state(sheet_name) or '').lower() != state_lower:
                continue
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
                if fail_on_error:
                    scan_errors.append(f'{sheet_name}: {exc}')

    if scan_errors:
        raise RuntimeError('; '.join(scan_errors))

    return results


def register_general_location_routes(app):
    """Register general location catalog endpoints."""

    # GET is kept staff-visible (require_admin): the staff turtle create/edit form
    # (useTurtleSheetsDataForm -> TurtleSheetsDataForm) reads this catalog for its
    # General Location dropdown. All mutations below are admin-only.
    @app.route('/api/general-locations', methods=['GET'])
    @require_admin
    def general_locations_get():
        catalog = get_general_location_catalog()
        return jsonify({'success': True, **_serialize_catalog(catalog)})

    @app.route('/api/general-locations', methods=['POST'])
    @require_admin_only
    def general_locations_post():
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
    @require_admin_only
    def general_locations_affected_turtles():
        general_location = (request.args.get('general_location') or '').strip()
        state = (request.args.get('state') or '').strip()
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        sheets_svc = get_sheets_service()
        if not sheets_svc:
            return jsonify({'success': True, 'total': 0, 'sheets': []})

        affected = _get_affected_turtles_across_sheets(sheets_svc, general_location, state=state)
        total = sum(s['count'] for s in affected)
        sheets_summary = [{'sheet_name': s['sheet_name'], 'count': s['count']} for s in affected]
        return jsonify({'success': True, 'total': total, 'sheets': sheets_summary})

    @app.route('/api/general-locations', methods=['DELETE'])
    @require_admin_only
    def delete_general_location_endpoint():
        data = request.get_json(silent=True) or {}
        state = (data.get('state') or '').strip()
        general_location = (data.get('general_location') or '').strip()
        target_general_location = (data.get('target_general_location') or '').strip()
        force = bool(data.get('force', False))

        if not state:
            return jsonify({'success': False, 'error': 'state is required'}), 400
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        # Preflight: validate the catalog operation before any irreversible writes.
        catalog_check = get_general_location_catalog()
        state_key = next(
            (k for k in catalog_check.get('states', {}).keys() if k.lower() == state.lower()),
            None,
        )
        if state_key is None:
            return jsonify({'success': False, 'error': f"State '{state}' not found in catalog"}), 400
        if not any(loc.lower() == general_location.lower() for loc in catalog_check['states'].get(state_key, [])):
            return jsonify({'success': False, 'error': f"General location '{general_location}' not found in state '{state}'"}), 400
        if not force:
            for sn_check, rule in catalog_check.get('sheet_defaults', {}).items():
                if (
                    rule.get('state', '').lower() == state.lower()
                    and rule.get('general_location', '').lower() == general_location.lower()
                ):
                    return jsonify({
                        'success': False,
                        'error': (
                            f"Cannot delete '{general_location}': it is the fixed General Location "
                            f"for sheet '{sn_check}'. Remove that sheet default first."
                        ),
                    }), 400

        sheets_svc = get_sheets_service()

        # Find affected turtles scoped to this state, aborting on any scan failure.
        affected: list = []
        if sheets_svc:
            try:
                affected = _get_affected_turtles_across_sheets(
                    sheets_svc, general_location, state=state, fail_on_error=True,
                )
            except RuntimeError as exc:
                return jsonify({
                    'success': False,
                    'error': f'Could not scan all sheets for affected turtles: {exc}',
                }), 500
        total_affected = sum(s['count'] for s in affected)

        if total_affected > 0 and not target_general_location:
            sheets_summary = [{'sheet_name': s['sheet_name'], 'count': s['count']} for s in affected]
            return jsonify({
                'success': False,
                'error': 'turtles_exist',
                'total': total_affected,
                'sheets': sheets_summary,
            }), 409

        # Validate the target location before any writes.
        # Exclude the location being deleted — it cannot be its own move target.
        if total_affected > 0 and target_general_location:
            if target_general_location.lower() == general_location.lower():
                return jsonify({
                    'success': False,
                    'error': f"Cannot move turtles to '{target_general_location}': that is the location being deleted",
                }), 400
            if not force:
                valid_locations = get_locations_for_state(state)
                if not any(loc.lower() == target_general_location.lower() for loc in valid_locations):
                    return jsonify({
                        'success': False,
                        'error': f"Target location '{target_general_location}' is not configured for state '{state}'",
                    }), 400

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

        # Delete the location from the catalog (force=True also removes sheet_defaults).
        try:
            catalog = delete_general_location(state, general_location, force=force)
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

    @app.route('/api/general-locations/sheet-defaults', methods=['POST'])
    @require_admin_only
    def add_sheet_default_endpoint():
        """Create a fixed program (sheet default) or convert a selectable program to fixed."""
        data = request.get_json(silent=True) or {}
        sheet_name = (data.get('sheet_name') or '').strip()
        general_location = (data.get('general_location') or '').strip()

        if not sheet_name:
            return jsonify({'success': False, 'error': 'sheet_name is required'}), 400
        if not general_location:
            return jsonify({'success': False, 'error': 'general_location is required'}), 400

        # Block the conversion if existing turtles have a different General Location.
        sheets_svc = get_sheets_service()
        if sheets_svc:
            with sheets_svc._api_lock:
                try:
                    conflicting = bulk_ops.find_rows_by_non_matching_general_location(
                        sheets_svc.service,
                        sheets_svc.spreadsheet_id,
                        sheet_name,
                        general_location,
                    )
                except Exception as exc:
                    return jsonify({
                        'success': False,
                        'error': f"Could not scan sheet '{sheet_name}' for conflicting turtles: {exc}",
                    }), 500
            if conflicting:
                return jsonify({
                    'success': False,
                    'error': (
                        f"{len(conflicting)} turtle(s) in sheet '{sheet_name}' already have a "
                        f"different General Location. Move them to '{general_location}' first."
                    ),
                }), 409

        try:
            catalog = add_sheet_default(sheet_name, general_location)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        sheets_updated = 0
        sync_error = None
        service = get_sheets_service()
        try:
            if service:
                sheets_updated = sheet_management.sync_general_location_validations(service)
        except Exception as exc:
            sync_error = str(exc)

        synced = bool(service) and sheets_updated > 0 and sync_error is None
        response = {'success': True, **_serialize_catalog(catalog), 'synced': synced}
        if service is not None:
            response['sheets_updated'] = sheets_updated
        if sync_error:
            response['sync_error'] = sync_error
        return jsonify(response)

    @app.route('/api/general-locations/sheet-defaults', methods=['DELETE'])
    @require_admin_only
    def remove_sheet_default_endpoint():
        """Convert a fixed program to selectable by removing its sheet default."""
        data = request.get_json(silent=True) or {}
        sheet_name = (data.get('sheet_name') or '').strip()

        if not sheet_name:
            return jsonify({'success': False, 'error': 'sheet_name is required'}), 400

        try:
            catalog = remove_sheet_default(sheet_name)
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400

        sheets_updated = 0
        sync_error = None
        service = get_sheets_service()
        try:
            if service:
                sheets_updated = sheet_management.sync_general_location_validations(service)
        except Exception as exc:
            sync_error = str(exc)

        synced = bool(service) and sheets_updated > 0 and sync_error is None
        response = {'success': True, **_serialize_catalog(catalog), 'synced': synced}
        if service is not None:
            response['sheets_updated'] = sheets_updated
        if sync_error:
            response['sync_error'] = sync_error
        return jsonify(response)

