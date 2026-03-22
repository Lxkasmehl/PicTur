"""
Google Sheets API endpoints
"""

import os
import re
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from flask import request, jsonify
from auth import require_admin
from services.manager_service import get_sheets_service, get_community_sheets_service
from general_locations_catalog import resolve_general_location_from_sheet_and_value
from sheets import sheet_management

# Timeout for single attempt to find sheet + get turtle data (avoids hanging on SSL/slow API)
SHEETS_TURTLE_DATA_TIMEOUT_SEC = 25

# Lock for list_turtle_names so concurrent requests don't trigger SSL errors (WRONG_VERSION_NUMBER)
# when making many Google API calls in parallel.
_turtle_names_lock = threading.Lock()


def _refresh_general_location_validation_for_sheet(service, sheet_name: str) -> None:
    """Best-effort: push catalog-based General Location dropdown to this tab (research spreadsheet)."""
    if not sheet_name:
        return
    try:
        updated = sheet_management.sync_general_location_validations(service, [sheet_name])
        if updated:
            print(f"✅ General Location validation synced for sheet '{sheet_name}'")
    except Exception as e:
        print(f"⚠️ General Location validation sync skipped for '{sheet_name}': {e}")


def _is_ssl_or_connection_error(e):
    """True if the exception looks like an SSL or connection flake (retry after reinit)."""
    msg = (str(e) or '').lower()
    return (
        'ssl' in msg
        or 'record' in msg  # e.g. [SSL] record layer failure
        or 'decryption_failed' in msg
        or 'wrong_version' in msg
        or 'incompleteread' in msg
        or 'bad record mac' in msg
    )


def _fetch_turtle_sheets_data_impl(service, primary_id, sheet_name_arg, state, location):
    """Run in thread: find sheet (if needed) and get turtle data. Returns (sheet_name or None, turtle_data or None)."""
    sn = (sheet_name_arg or '').strip()
    if not sn:
        sn = service.find_turtle_sheet(primary_id)
    if not sn:
        return None, None
    data = service.get_turtle_data(primary_id, sn, state, location)
    return sn, data


def _fetch_turtle_sheets_data_community_impl(service, primary_id, community_sheet_name):
    """Run in thread: get turtle data from community spreadsheet. sheet = tab name (e.g. second path segment)."""
    sn = (community_sheet_name or '').strip()
    if not sn:
        return None, None
    # Community sheets: state/location convention may use sheet as both
    data = service.get_turtle_data(primary_id, sn, sn, '')
    return sn, data


def register_sheets_routes(app):
    """Register Google Sheets routes"""
    
    @app.route('/api/sheets/turtle/<primary_id>', methods=['GET'])
    @require_admin
    def get_turtle_sheets_data(primary_id):
        """
        Get turtle data from Google Sheets by primary ID (Admin only)
        If sheet_name is not provided, automatically finds the sheet containing the turtle.
        Uses a timeout so the request cannot hang on slow/SSL-flaky API calls.
        """
        try:
            sheet_name = request.args.get('sheet_name', '')
            state = request.args.get('state', '')
            location = request.args.get('location', '')
            
            # When match is from Community_Uploads, fetch from community spreadsheet (sheet = second path segment).
            use_community = (state or '').strip() == 'Community_Uploads'
            if use_community:
                service = get_community_sheets_service()
            else:
                service = get_sheets_service()
            if not service:
                return jsonify({'error': 'Google Sheets service not configured'}), 503
            
            result_sheet = None
            result_data = None
            for attempt in range(2):
                executor = ThreadPoolExecutor(max_workers=1)
                try:
                    if use_community:
                        community_sheet = (location or sheet_name or '').strip()
                        future = executor.submit(
                            _fetch_turtle_sheets_data_community_impl,
                            service, primary_id, community_sheet
                        )
                    else:
                        future = executor.submit(
                            _fetch_turtle_sheets_data_impl,
                            service, primary_id, sheet_name, state, location
                        )
                    result_sheet, result_data = future.result(timeout=SHEETS_TURTLE_DATA_TIMEOUT_SEC)
                    break
                except FuturesTimeoutError:
                    print(f"Timeout loading turtle data for {primary_id} (attempt {attempt + 1}/2)")
                    if attempt == 0:
                        try:
                            service._reinitialize_service()
                            time.sleep(1.0)
                        except Exception as reinit_err:
                            print(f"Reinit failed: {reinit_err}")
                        continue
                    print("Second attempt timed out; returning minimal data so client is not stuck.")
                    return jsonify({
                        'success': True,
                        'data': {'primary_id': primary_id},
                        'exists': False
                    })
                except Exception as e:
                    print(f"Error in turtle sheets data for {primary_id}: {e}")
                    if attempt == 0 and _is_ssl_or_connection_error(e):
                        try:
                            service._reinitialize_service()
                            time.sleep(1.0)
                        except Exception as reinit_err:
                            print(f"Reinit failed: {reinit_err}")
                        continue
                    result_sheet = None
                    result_data = None
                    break
                finally:
                    executor.shutdown(wait=False)
            
            if result_data:
                return jsonify({
                    'success': True,
                    'data': result_data,
                    'exists': True
                })
            return jsonify({
                'success': True,
                'data': {'primary_id': primary_id},
                'exists': False
            })
        
        except ValueError as e:
            # Handle validation errors (e.g., empty sheet_name)
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Validation error getting turtle data from sheets: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Validation error getting turtle data from sheets: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Validation error: {str(e)}'}), 400
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error getting turtle data from sheets: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error getting turtle data from sheets: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to get turtle data: {str(e)}'}), 500

    @app.route('/api/sheets/generate-primary-id', methods=['POST'])
    @require_admin
    def generate_primary_id():
        """
        Generate a new unique primary ID for a turtle (Admin only)
        Checks all sheets to ensure uniqueness across the entire spreadsheet.
        """
        try:
            data = request.json or {}
            state = data.get('state', '')
            location = data.get('location', '')
            
            # State is no longer required - Primary IDs are globally unique
            service = get_sheets_service()
            if not service:
                return jsonify({'error': 'Google Sheets service not configured'}), 503
            
            primary_id = service.generate_primary_id(state, location)
            
            return jsonify({
                'success': True,
                'primary_id': primary_id
            })
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error generating primary ID: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error generating primary ID: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to generate primary ID: {str(e)}'}), 500

    @app.route('/api/sheets/generate-id', methods=['POST'])
    @require_admin
    def generate_turtle_id():
        """
        Generate the next biology ID (ID column) for the given sheet: M/F/J/U + next sequence number (Admin only).
        Body: { "sex": "M"|"F"|"J"|"U", "sheet_name": "Kansas", "target_spreadsheet": "research"|"community" }.
        Sequence is scoped to that sheet only. Use target_spreadsheet so community sheets are not created in research.
        """
        try:
            data = request.json or {}
            sex = (data.get('sex') or data.get('gender') or '').strip().upper()
            sheet_name = (data.get('sheet_name') or '').strip()
            target_spreadsheet = (data.get('target_spreadsheet') or 'research').strip().lower()
            if target_spreadsheet not in ('research', 'community'):
                target_spreadsheet = 'research'
            # Normalize: M, F, J, U; anything else -> U
            if sex in ('M', 'F', 'J'):
                gender = sex
            elif sex in ('U', ''):
                gender = 'U'
            else:
                gender = 'U'

            if not sheet_name:
                return jsonify({'error': 'sheet_name is required for ID generation'}), 400

            if target_spreadsheet == 'community':
                service = get_community_sheets_service()
                if not service:
                    return jsonify({'error': 'Community Google Sheets not configured'}), 503
            else:
                service = get_sheets_service()
                if not service:
                    return jsonify({'error': 'Google Sheets service not configured'}), 503

            # If sheet does not exist in the TARGET spreadsheet, create it there only (do not touch the other spreadsheet)
            existing_sheets = service.list_sheets()
            if sheet_name not in existing_sheets:
                if not service.create_sheet_with_headers(sheet_name):
                    return jsonify({'error': f'Could not create sheet "{sheet_name}" for ID generation'}), 500
                print(f"✅ Created new sheet '{sheet_name}' in {'community' if target_spreadsheet == 'community' else 'research'} spreadsheet (for ID generation)")

            id_value = service.generate_biology_id(gender, sheet_name)
            return jsonify({
                'success': True,
                'id': id_value
            })
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error generating turtle ID: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error generating turtle ID: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to generate turtle ID: {str(e)}'}), 500

    @app.route('/api/sheets/turtle', methods=['POST'])
    @require_admin
    def create_turtle_sheets_data():
        """
        Create new turtle data in Google Sheets (Admin only).
        Optional body param target_spreadsheet: 'research' (default) or 'community'.
        Use 'community' when creating a turtle from a community upload in the review queue.
        """
        try:
            data = request.json or {}
            sheet_name = data.get('sheet_name', '').strip()
            state = data.get('state', '')
            location = data.get('location', '')
            turtle_data = data.get('turtle_data', {})
            target_spreadsheet = (data.get('target_spreadsheet') or 'research').strip().lower()
            if target_spreadsheet not in ('research', 'community'):
                target_spreadsheet = 'research'

            if not sheet_name:
                return jsonify({'error': 'sheet_name is required'}), 400

            if target_spreadsheet == 'community':
                service = get_community_sheets_service()
                if not service:
                    return jsonify({'error': 'Community Google Sheets not configured'}), 503
            else:
                service = get_sheets_service()
                if not service:
                    return jsonify({'error': 'Google Sheets service not configured'}), 503

            if target_spreadsheet != 'community':
                try:
                    turtle_data['general_location'] = resolve_general_location_from_sheet_and_value(
                        sheet_name,
                        turtle_data.get('general_location'),
                        state=sheet_name,
                        allow_blank=False,
                    )
                except ValueError as exc:
                    return jsonify({'error': str(exc)}), 400

            # If sheet (tab) does not exist, create it with required headers
            existing_sheets = service.list_sheets()
            if sheet_name not in existing_sheets:
                if not service.create_sheet_with_headers(sheet_name):
                    return jsonify({'error': f'Could not create sheet "{sheet_name}" in spreadsheet'}), 500
                print(f"✅ Created new sheet '{sheet_name}' in {'community' if target_spreadsheet == 'community' else 'research'} spreadsheet")

            if turtle_data.get('primary_id'):
                primary_id = turtle_data['primary_id']
            else:
                primary_id = service.generate_primary_id(state, location)
                turtle_data['primary_id'] = primary_id

            sex = (turtle_data.get('sex') or '').strip().upper()
            gender = sex if sex in ('M', 'F', 'J') else 'U'
            turtle_data['id'] = service.generate_biology_id(gender, sheet_name)

            created_id = service.create_turtle_data(turtle_data, sheet_name, state, location)

            if created_id:
                print(f"✅ Successfully created turtle in sheets with Primary ID: {created_id}")
                if target_spreadsheet != 'community':
                    _refresh_general_location_validation_for_sheet(service, sheet_name)
                return jsonify({
                    'success': True,
                    'primary_id': created_id,
                    'id': turtle_data.get('id'),
                    'message': 'Turtle data created successfully'
                })
            else:
                print(f"❌ Failed to create turtle in sheets - create_turtle_data returned None")
                return jsonify({'error': 'Failed to create turtle data'}), 500
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error creating turtle data in sheets: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error creating turtle data in sheets: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to create turtle data: {str(e)}'}), 500

    @app.route('/api/sheets/turtle/<primary_id>', methods=['PUT'])
    @require_admin
    def update_turtle_sheets_data(primary_id):
        """
        Update or create turtle data in Google Sheets (Admin only).
        Optional body param target_spreadsheet: 'research' (default) or 'community'.
        If turtle doesn't exist, creates it. Otherwise updates it.
        """
        try:
            data = request.json or {}
            sheet_name = data.get('sheet_name', '').strip()
            state = data.get('state', '')
            location = data.get('location', '')
            turtle_data = data.get('turtle_data', {})
            target_spreadsheet = (data.get('target_spreadsheet') or 'research').strip().lower()
            if target_spreadsheet not in ('research', 'community'):
                target_spreadsheet = 'research'

            if not sheet_name:
                print(f"ERROR: sheet_name is empty. Received data: {data}")
                return jsonify({'error': 'sheet_name is required'}), 400

            if target_spreadsheet == 'community':
                service = get_community_sheets_service()
                if not service:
                    return jsonify({'error': 'Community Google Sheets not configured'}), 503
            else:
                service = get_sheets_service()
                if not service:
                    return jsonify({'error': 'Google Sheets service not configured'}), 503

            if target_spreadsheet != 'community':
                try:
                    turtle_data['general_location'] = resolve_general_location_from_sheet_and_value(
                        sheet_name,
                        turtle_data.get('general_location'),
                        state=sheet_name,
                        allow_blank=False,
                    )
                except ValueError as exc:
                    return jsonify({'error': str(exc)}), 400

            # If sheet (tab) does not exist, create it with required headers (e.g. when using backend locations like "Kansas")
            existing_sheets = service.list_sheets()
            if sheet_name not in existing_sheets:
                if not service.create_sheet_with_headers(sheet_name):
                    return jsonify({'error': f'Could not create sheet "{sheet_name}" in spreadsheet'}), 500
                print(f"✅ Created new sheet '{sheet_name}' in {'community' if target_spreadsheet == 'community' else 'research'} spreadsheet")

            # Check if turtle exists in the new sheet
            existing_data = service.get_turtle_data(primary_id, sheet_name, state, location)
            
            # Find which sheet currently contains this turtle (if any)
            current_sheet = service.find_turtle_sheet(primary_id)
            
            # Check if turtle is being moved to a different sheet
            if current_sheet and current_sheet != sheet_name:
                # Turtle exists in a different sheet - need to move it
                print(f"🔄 Moving turtle {primary_id} from sheet '{current_sheet}' to sheet '{sheet_name}'")
                
                # Delete from old sheet
                deleted = service.delete_turtle_data(primary_id, current_sheet)
                if not deleted:
                    print(f"⚠️  Warning: Could not delete turtle from old sheet '{current_sheet}', but continuing with creation in new sheet")
                
                # Create in new sheet
                turtle_data_clean = {k: v for k, v in turtle_data.items() if k != 'sheet_name'}
                turtle_data_clean['primary_id'] = primary_id
                if not turtle_data_clean.get('id'):
                    sex = (turtle_data_clean.get('sex') or '').strip().upper()
                    gender = sex if sex in ('M', 'F') else ('U' if sex in ('J', 'U', '') else 'U')
                    turtle_data_clean['id'] = service.generate_biology_id(gender, sheet_name)

                created_id = service.create_turtle_data(turtle_data_clean, sheet_name, state, location)
                if created_id:
                    if target_spreadsheet != 'community':
                        _refresh_general_location_validation_for_sheet(service, sheet_name)
                    return jsonify({
                        'success': True,
                        'message': f'Turtle moved from "{current_sheet}" to "{sheet_name}" successfully',
                        'primary_id': created_id
                    })
                else:
                    return jsonify({'error': 'Failed to move turtle data'}), 500
            
            elif existing_data:
                # Update existing turtle in the same sheet
                # Remove sheet_name from turtle_data if present (it's a metadata field, not data)
                turtle_data_clean = {k: v for k, v in turtle_data.items() if k != 'sheet_name'}
                success = service.update_turtle_data(primary_id, turtle_data_clean, sheet_name, state, location)
                if success:
                    if target_spreadsheet != 'community':
                        _refresh_general_location_validation_for_sheet(service, sheet_name)
                    return jsonify({
                        'success': True,
                        'message': 'Turtle data updated successfully',
                        'primary_id': primary_id
                    })
                else:
                    return jsonify({'error': 'Failed to update turtle data'}), 500
            else:
                # Create new turtle (turtle doesn't exist yet)
                # Ensure primary_id is set in turtle_data
                # Remove sheet_name from turtle_data if present (it's a metadata field, not data)
                turtle_data_clean = {k: v for k, v in turtle_data.items() if k != 'sheet_name'}
                # Set primary_id in the Primary ID column (not just id)
                turtle_data_clean['primary_id'] = primary_id
                # Auto-generate biology ID (ID column) from sex if not present (scoped to this sheet)
                if not turtle_data_clean.get('id'):
                    sex = (turtle_data_clean.get('sex') or '').strip().upper()
                    gender = sex if sex in ('M', 'F', 'J') else 'U'
                    turtle_data_clean['id'] = service.generate_biology_id(gender, sheet_name)
                created_id = service.create_turtle_data(turtle_data_clean, sheet_name, state, location)
                if created_id:
                    if target_spreadsheet != 'community':
                        _refresh_general_location_validation_for_sheet(service, sheet_name)
                    return jsonify({
                        'success': True,
                        'message': 'Turtle data created successfully',
                        'primary_id': created_id
                    })
                else:
                    return jsonify({'error': 'Failed to create turtle data'}), 500
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error updating turtle data in sheets: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error updating turtle data in sheets: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to update turtle data: {str(e)}'}), 500

    def _safe_folder_name(name):
        """Sanitize sheet name for filesystem (e.g. for Community_Uploads subfolder)."""
        if not name or not isinstance(name, str):
            return '_'
        out = re.sub(r'[/\\:*?"<>|]', '_', name.strip())
        return out or '_'

    @app.route('/api/sheets/sheets', methods=['GET', 'POST'])
    @require_admin
    def list_sheets():
        """
        List all available sheets (tabs) in the Google Spreadsheet (Admin only)
        POST: Create a new sheet with headers. Body may include target_spreadsheet: 'research' | 'community'.
        GET: List all sheets
        """
        try:
            if request.method == 'POST':
                data = request.json or {}
                sheet_name = data.get('sheet_name', '').strip()
                target = (data.get('target_spreadsheet') or 'research').strip().lower()
                if target not in ('research', 'community'):
                    target = 'research'

                if not sheet_name:
                    return jsonify({
                        'success': False,
                        'error': 'sheet_name is required'
                    }), 400

                if target == 'community':
                    service = get_community_sheets_service()
                    if not service:
                        return jsonify({
                            'success': False,
                            'error': 'Community Google Sheets not configured',
                            'sheets': []
                        }), 503
                else:
                    service = get_sheets_service()
                    if not service:
                        return jsonify({
                            'success': False,
                            'error': 'Google Sheets service not configured',
                            'sheets': []
                        }), 503

                existing_sheets = service.list_sheets()
                if sheet_name in existing_sheets:
                    return jsonify({
                        'success': True,
                        'message': f'Sheet "{sheet_name}" already exists',
                        'sheets': service.list_sheets()
                    })

                if service.create_sheet_with_headers(sheet_name):
                    if target == 'community':
                        try:
                            backend_base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                            data_dir = os.path.join(backend_base, 'data')
                            community_dir = os.path.join(data_dir, 'Community_Uploads')
                            safe_name = _safe_folder_name(sheet_name)
                            os.makedirs(os.path.join(community_dir, safe_name), exist_ok=True)
                        except Exception as folder_err:
                            print(f"Warning: could not create Community_Uploads folder for new sheet: {folder_err}")
                    return jsonify({
                        'success': True,
                        'message': f'Sheet "{sheet_name}" created successfully',
                        'sheets': service.list_sheets()
                    })
                return jsonify({
                    'success': False,
                    'error': f'Failed to create sheet "{sheet_name}"'
                }), 500

            service = get_sheets_service()
            if not service:
                return jsonify({
                    'success': False,
                    'error': 'Google Sheets service not configured',
                    'sheets': []
                }), 503

            # GET: List sheets
            try:
                sheets = service.list_sheets()
                if not isinstance(sheets, list):
                    sheets = []
            except Exception as list_error:
                print(f"Error calling list_sheets(): {list_error}")
                traceback.print_exc()
                # Return empty list instead of failing completely
                return jsonify({
                    'success': False,
                    'error': f'Failed to list sheets: {str(list_error)}',
                    'sheets': []
                }), 500
            
            return jsonify({
                'success': True,
                'sheets': sheets
            })
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error in sheets endpoint: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error in sheets endpoint: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            # Return empty list instead of failing completely
            return jsonify({
                'success': False,
                'error': f'Failed to process request: {str(e)}',
                'sheets': []
            }), 500

    @app.route('/api/sheets/community-sheets', methods=['GET'])
    @require_admin
    def list_community_sheets():
        """
        List all sheet (tab) names from the community-facing spreadsheet (Admin only).
        Used when approving a community upload so the admin can pick the community sheet to store the turtle in.
        """
        try:
            service = get_community_sheets_service()
            if not service:
                return jsonify({
                    'success': False,
                    'error': 'Community Google Sheets not configured',
                    'sheets': []
                }), 503
            try:
                sheets = service.list_sheets()
                if not isinstance(sheets, list):
                    sheets = []
            except Exception as list_error:
                print(f"Error listing community sheets: {list_error}")
                traceback.print_exc()
                return jsonify({
                    'success': False,
                    'error': f'Failed to list community sheets: {str(list_error)}',
                    'sheets': []
                }), 500
            return jsonify({'success': True, 'sheets': sheets})
        except Exception as e:
            traceback.print_exc()
            return jsonify({
                'success': False,
                'error': str(e),
                'sheets': []
            }), 500

    @app.route('/api/sheets/turtles', methods=['GET', 'OPTIONS'])
    @require_admin
    def list_all_turtles():
        """
        List all turtles from Google Sheets (Admin only)
        Can filter by sheet name (state)
        Also triggers migration check if not already done
        """
        try:
            sheet_name = request.args.get('sheet', '')  # Optional: filter by sheet name
            
            # Try to get service, but don't fail if not configured (return empty list)
            # This will also trigger migration check
            try:
                service = get_sheets_service()
            except Exception as service_error:
                print(f"Warning: Google Sheets service not available: {service_error}")
                return jsonify({
                    'success': True,
                    'turtles': [],
                    'count': 0,
                    'message': 'Google Sheets service not configured'
                })
            
            if not service:
                return jsonify({
                    'success': True,
                    'turtles': [],
                    'count': 0,
                    'message': 'Google Sheets service not configured'
                })
            
            # Get all sheets or specific sheet (list_sheets already excludes backup sheets)
            if sheet_name:
                # Validate that it's not a backup sheet (note: "Inital" is a typo in the actual sheet name)
                backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
                if sheet_name in backup_sheet_names:
                    return jsonify({'error': f"Sheet '{sheet_name}' is a backup sheet and cannot be accessed"}), 400
                sheets_to_search = [sheet_name]
            else:
                sheets_to_search = service.list_sheets()  # Already excludes backup sheets
            
            all_turtles = []
            # Filter out backup sheets
            backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
            sheets_to_search = [s for s in sheets_to_search if s not in backup_sheet_names]
            
            for sheet in sheets_to_search:
                try:
                    # Ensure Primary ID column exists in this sheet
                    service._ensure_primary_id_column(sheet)
                    
                    # Get all rows from the sheet (skip header row)
                    # Escape sheet name for range notation
                    escaped_sheet = sheet
                    if any(char in sheet for char in [' ', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=']):
                        escaped_sheet = f"'{sheet}'"
                    range_name = f"{escaped_sheet}!A:Z"
                    result = service.service.spreadsheets().values().get(
                        spreadsheetId=service.spreadsheet_id,
                        range=range_name
                    ).execute()
                    
                    values = result.get('values', [])
                    if len(values) < 2:
                        continue  # No data rows
                    
                    # Get headers
                    headers = values[0]
                    column_indices = {}
                    for idx, header in enumerate(headers):
                        if header and header.strip():
                            column_indices[header.strip()] = idx
                    
                    # Process data rows
                    for row_idx, row_data in enumerate(values[1:], start=2):
                        if not row_data or len(row_data) == 0:
                            continue
                        
                        # Map row data to field names
                        turtle_data = {}
                        for header, col_idx in column_indices.items():
                            if header in service.COLUMN_MAPPING:
                                field_name = service.COLUMN_MAPPING[header]
                                value = row_data[col_idx] if col_idx < len(row_data) else ''
                                turtle_data[field_name] = value.strip() if value else ''
                        
                        # Primary ID should come from "Primary ID" column, not "ID" column
                        primary_id = turtle_data.get('primary_id')
                        
                        # Only include if it has a Primary ID or ID (for backwards compatibility)
                        # If it only has ID but no Primary ID, we'll handle migration separately
                        if primary_id or turtle_data.get('id'):
                            turtle_data['primary_id'] = primary_id or turtle_data.get('id')
                            turtle_data['sheet_name'] = sheet
                            turtle_data['row_index'] = row_idx
                            all_turtles.append(turtle_data)
                except Exception as e:
                    print(f"Error reading sheet {sheet}: {e}")
                    continue
            
            return jsonify({
                'success': True,
                'turtles': all_turtles,
                'count': len(all_turtles)
            })
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error listing turtles: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error listing turtles: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to list turtles: {str(e)}'}), 500

    @app.route('/api/sheets/turtle-names', methods=['GET'])
    @require_admin
    def list_turtle_names():
        """
        List all turtle names across all location sheets (Admin only).
        Used by the frontend to prevent duplicate names when creating/editing turtles.
        Returns name and primary_id so the form can allow the same name when editing the same turtle.
        """
        try:
            try:
                service = get_sheets_service()
            except Exception as service_error:
                print(f"Warning: Google Sheets service not available: {service_error}")
                return jsonify({
                    'success': True,
                    'names': [],
                    'message': 'Google Sheets service not configured'
                })

            if not service:
                return jsonify({
                    'success': True,
                    'names': [],
                    'message': 'Google Sheets service not configured'
                })

            sheets_to_search = service.list_sheets()
            backup_sheet_names = ['Backup (Initial State)', 'Backup (Inital State)', 'Backup']
            sheets_to_search = [s for s in sheets_to_search if s not in backup_sheet_names]

            all_names = []
            with _turtle_names_lock:
                for sheet in sheets_to_search:
                    sheet_ok = False
                    for name_attempt in range(2):
                        try:
                            with service._api_lock:
                                service._ensure_primary_id_column(sheet)
                                escaped_sheet = sheet
                                if any(char in sheet for char in [' ', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=']):
                                    escaped_sheet = f"'{sheet}'"
                                range_name = f"{escaped_sheet}!A:Z"
                                result = service.get_sheet_values(range_name)
                                if not result:
                                    sheet_ok = True
                                    break

                            values = result.get('values', []) if result else []
                            if len(values) < 2:
                                sheet_ok = True
                                break

                            headers = values[0]
                            column_indices = {}
                            for idx, header in enumerate(headers):
                                if header and header.strip():
                                    column_indices[header.strip()] = idx

                            primary_id_idx = column_indices.get('Primary ID')
                            name_idx = column_indices.get('Name')
                            if primary_id_idx is None and 'ID' in column_indices:
                                primary_id_idx = column_indices.get('ID')
                            if name_idx is None or primary_id_idx is None:
                                sheet_ok = True
                                break

                            for row_data in values[1:]:
                                if not row_data:
                                    continue
                                max_idx = max(primary_id_idx if primary_id_idx is not None else -1, name_idx)
                                if len(row_data) <= max_idx:
                                    continue
                                primary_id = (row_data[primary_id_idx] or '').strip() if primary_id_idx is not None else ''
                                name = (row_data[name_idx] or '').strip() if name_idx is not None else ''
                                if primary_id and name:
                                    all_names.append({'name': name, 'primary_id': primary_id})
                            sheet_ok = True
                            break
                        except Exception as e:
                            print(f"Error reading sheet {sheet} for turtle names: {e}")
                            if name_attempt == 0 and _is_ssl_or_connection_error(e):
                                try:
                                    service._reinitialize_service()
                                    time.sleep(1.0)
                                except Exception as reinit_err:
                                    print(f"Reinit failed: {reinit_err}")
                                continue
                            break

            return jsonify({
                'success': True,
                'names': all_names
            })

        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"Error listing turtle names: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error listing turtle names: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to list turtle names: {str(e)}'}), 500

    @app.route('/api/sheets/migrate-ids', methods=['POST'])
    @require_admin
    def migrate_ids_to_primary_ids():
        """
        Migrate all turtles from "ID" column to "Primary ID" column.
        Generates new unique Primary IDs for all turtles that don't have one.
        Uses batch updates to avoid rate limiting.
        """
        try:
            service = get_sheets_service()
            if not service:
                return jsonify({'error': 'Google Sheets service not configured'}), 503
            
            print("🔄 Starting ID migration to Primary IDs...")
            migration_stats = service.migrate_ids_to_primary_ids()
            
            total_migrated = sum(migration_stats.values())
            
            return jsonify({
                'success': True,
                'message': f'Migration completed. {total_migrated} turtles migrated across {len(migration_stats)} sheets.',
                'stats': migration_stats,
                'total_migrated': total_migrated
            })
        
        except Exception as e:
            error_trace = traceback.format_exc()
            try:
                print(f"❌ Error migrating IDs: {str(e)}")
            except UnicodeEncodeError:
                print(f"[ERROR] Error migrating IDs: {str(e)}")
            print(f"Traceback:\n{error_trace}")
            return jsonify({'error': f'Failed to migrate IDs: {str(e)}'}), 500
