"""
Turtle data columns of the active research group (see turtle_columns.py).
"""

from flask import jsonify, request

import tenant
from auth import require_admin_only, require_auth
from services.manager_service import get_sheets_service, get_community_sheets_service
from sheets.helpers import escape_sheet_name
import turtle_columns


def _payload(schema):
    enabled = set(schema['standard'])
    return {
        'success': True,
        'configurable': turtle_columns.is_configurable(),
        'standard': [
            {'key': key, 'header': turtle_columns.STANDARD_HEADER[key],
             'required': key in turtle_columns.REQUIRED_FIELDS, 'enabled': key in enabled}
            for key in turtle_columns.STANDARD_FIELDS
        ],
        'custom': schema['custom'],
        'custom_types': list(turtle_columns.CUSTOM_TYPES),
    }


def _rename_headers(renames):
    """Renamed custom columns: rewrite their header cell in every tab so the data follows."""
    for svc in (get_sheets_service(), get_community_sheets_service()):
        if not svc:
            continue
        with svc._api_lock:
            for tab in svc.list_sheets() or []:
                rng = f'{escape_sheet_name(tab)}!1:1'
                headers = svc.service.spreadsheets().values().get(
                    spreadsheetId=svc.spreadsheet_id, range=rng).execute().get('values', [[]])
                row = list(headers[0]) if headers else []
                changed = False
                for i, h in enumerate(row):
                    new = renames.get((h or '').strip())
                    if new:
                        row[i] = new
                        changed = True
                if changed:
                    svc.service.spreadsheets().values().update(
                        spreadsheetId=svc.spreadsheet_id, range=rng, valueInputOption='RAW',
                        body={'values': [row]}).execute()
                    svc._invalidate_column_indices_cache(tab)


def register_turtle_column_routes(app):
    @app.route('/api/turtle-columns', methods=['GET'])
    @require_auth
    def get_turtle_columns():
        """Columns the turtle forms show for the active group.

        Without a group this is the template of the original PicTur group, which super admins
        pick from when creating a group; they are often not staff of the main group themselves.
        """
        if tenant.current() is not None and (request.user or {}).get('role') not in ('staff', 'admin'):
            return jsonify({'error': 'Staff or admin access required'}), 403
        return jsonify(_payload(turtle_columns.get_schema()))

    @app.route('/api/turtle-columns', methods=['POST'])
    @require_admin_only
    def set_turtle_columns():
        """Choose standard columns and define the group's own. Body: {standard: [...], custom: [...]}."""
        if tenant.current() is None:
            return jsonify({'success': False,
                            'error': 'The columns of the main group follow its Google Sheet'}), 400
        before = {c['key']: c['label'] for c in turtle_columns.get_schema()['custom']}
        try:
            schema = turtle_columns.save_schema(request.get_json(silent=True) or {})
        except ValueError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 400
        renames = {before[c['key']]: c['label'] for c in schema['custom']
                   if c['key'] in before and before[c['key']] != c['label']}
        if renames:
            try:
                _rename_headers(renames)
            except Exception as exc:  # pragma: no cover - reported, schema is saved
                return jsonify({**_payload(schema), 'warning': f'Could not rename columns: {exc}'})
        return jsonify(_payload(schema))
