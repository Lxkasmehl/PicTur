"""
Backend location folders (State/Location) for review and manual upload.
Used for two-level path selection: sheet (state) + location.
"""

from flask import jsonify
from auth import require_admin
from services import manager_service


def register_locations_routes(app):
    """Register location-related routes"""

    @app.route('/api/locations', methods=['GET'])
    @require_admin
    def get_locations():
        """
        List backend location paths for dropdowns (Admin only).
        Returns State/Location strings, e.g. ["Kansas/Wichita", "Kansas/Lawrence", "Nebraska/Topeka", "Community_Uploads"].
        Used for community upload new-turtle and manual upload location selection.
        """
        if not manager_service.manager_ready.wait(timeout=30):
            return jsonify({'error': 'TurtleManager is still initializing'}), 503
        if manager_service.manager is None:
            return jsonify({'error': 'TurtleManager failed to initialize'}), 500
        try:
            locations = manager_service.manager.get_all_locations()
            return jsonify({'success': True, 'locations': locations})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
