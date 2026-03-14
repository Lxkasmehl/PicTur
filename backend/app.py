"""
Flask API Server for Turtle Project
Handles photo uploads, matching, and review queue
"""

import os
import sys

# Import configuration first (sets up environment)
import config

# Import Flask and CORS
from flask import Flask
from flask_cors import CORS

# Import services
from services import manager_service

# Import routes
from routes.health import register_health_routes
from routes.upload import register_upload_routes
from routes.review import register_review_routes
from routes.images import register_image_routes
from routes.sheets import register_sheets_routes
from routes.turtles import register_turtle_routes
from routes.locations import register_locations_routes

# Create Flask app
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*", "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "allow_headers": ["Content-Type", "Authorization"]}})  # Enable CORS for frontend

# Add after_request handler to ensure CORS headers are always set
@app.after_request
def after_request(response):
    # Add CORS headers to all responses
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    return response

# Register all routes
register_health_routes(app)
register_upload_routes(app)
register_review_routes(app)
register_image_routes(app)
register_sheets_routes(app)
register_turtle_routes(app)
register_locations_routes(app)


@app.errorhandler(Exception)
def handle_exception(err):
    """Log unhandled exceptions and return JSON (works in debug mode too)."""
    import traceback
    tb = traceback.format_exc()
    prefix = "[UNHANDLED]"
    sys.stderr.write(f"{prefix} {err}\n{tb}")
    sys.stderr.flush()
    try:
        print(f"{prefix} {err}", flush=True)
    except Exception:
        pass
    return (
        {'error': f'Server error: {str(err)}', 'details': tb if app.debug else None},
        500,
        {'Content-Type': 'application/json'},
    )

if __name__ == '__main__':
    # Determine if debug mode should be enabled
    # Disable debug mode for tests to avoid reload issues
    debug_mode = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    port = int(os.environ.get('PORT', '5000'))
    
    try:
        print("🐢 Starting Turtle API Server...", flush=True)
        print(f"🌐 Server will be available at http://localhost:{port}", flush=True)
        if manager_service.manager is not None:
            print(f"📁 Data directory: {manager_service.manager.base_dir}", flush=True)
        sys.stdout.flush()
    except UnicodeEncodeError:
        print("[TURTLE] Starting Turtle API Server...", flush=True)
        print(f"[NET] Server will be available at http://localhost:{port}", flush=True)
        if manager_service.manager is not None:
            print(f"[DIR] Data directory: {manager_service.manager.base_dir}", flush=True)
        sys.stdout.flush()
    
    try:
        # Use Werkzeug's development server which prints when ready
        # This ensures we can see when the server actually starts
        app.run(debug=debug_mode, host='0.0.0.0', port=port, use_reloader=False)
    except Exception as e:
        print(f"[ERROR] Exception during app.run(): {str(e)}", flush=True)
        sys.stdout.flush()
        import traceback
        traceback.print_exc()
        sys.stderr.flush()
