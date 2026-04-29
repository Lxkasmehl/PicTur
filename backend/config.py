"""
Configuration and environment setup for PicTur Flask API
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import tempfile

# Fix Unicode encoding issues on Windows
if sys.platform == 'win32':
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError, OSError):
        pass

# Load project .env files. auth-backend is separate.
#
# With override=False, values already in the OS environment win over the file. Load root .env
# first, then backend/.env with override=True so backend/.env overrides inherited/user JWT_SECRET
# on Windows (common source of JWT mismatches with auth-backend).
_root_env = Path(__file__).parent.parent / '.env'
_backend_env = Path(__file__).parent / '.env'

env_loaded = False
if _root_env.exists():
    load_dotenv(_root_env, override=False)
    try:
        print(f"✅ Loaded .env from: {_root_env}")
    except UnicodeEncodeError:
        print(f"[OK] Loaded .env from: {_root_env}")
    env_loaded = True
if _backend_env.exists():
    load_dotenv(_backend_env, override=True)
    try:
        print(f"✅ Loaded .env from: {_backend_env}")
    except UnicodeEncodeError:
        print(f"[OK] Loaded .env from: {_backend_env}")
    env_loaded = True

if not env_loaded:
    try:
        print("⚠️  No .env file found. Using environment variables or defaults.")
    except UnicodeEncodeError:
        print("[WARN] No .env file found. Using environment variables or defaults.")

# Ensure PORT is set to 5000 for Flask backend (default)
if 'PORT' not in os.environ:
    os.environ['PORT'] = '5000'
    try:
        print("🔧 Using default PORT=5000 for Flask backend")
    except UnicodeEncodeError:
        print("[CFG] Using default PORT=5000 for Flask backend")

# Configuration constants
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# JWT Configuration - must match auth-backend JWT_SECRET
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')

# Auth service URL (required for staff/admin routes). E.g. http://localhost:3001/api
AUTH_URL = os.environ.get('AUTH_URL', '').rstrip('/')

if JWT_SECRET == 'your-secret-key-change-in-production':
    try:
        print("⚠️  WARNING: Using default JWT_SECRET. This should match auth-backend JWT_SECRET!")
    except UnicodeEncodeError:
        print("[WARN] WARNING: Using default JWT_SECRET. This should match auth-backend JWT_SECRET!")


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
