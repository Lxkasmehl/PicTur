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
    # Set stdout/stderr encoding to UTF-8 on Windows
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError, OSError):
        # If reconfigure fails, try to set encoding via environment
        # This won't affect current process but helps with subprocesses
        pass

# Load environment variables from .env file
# Only load backend/.env and root .env - keep auth-backend completely separate
env_paths = [
    Path(__file__).parent / '.env',  # backend/.env (highest priority)
    Path(__file__).parent.parent / '.env',  # root .env (for shared config like JWT_SECRET)
]

# Load .env files in priority order
env_loaded = False
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path, override=False)  # Don't override if already set
        try:
            print(f"✅ Loaded .env from: {env_path}")
        except UnicodeEncodeError:
            print(f"[OK] Loaded .env from: {env_path}")
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
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# JWT Configuration - must match auth-backend JWT_SECRET
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')

# Auth service URL (required for staff/admin routes). Staff/admin role checks call the auth
# service to enforce demotion revocation (tokens_valid_after). If unset, privileged access
# is denied (fail closed). E.g. http://localhost:3001/api
AUTH_URL = os.environ.get('AUTH_URL', '').rstrip('/')

if JWT_SECRET == 'your-secret-key-change-in-production':
    try:
        print("⚠️  WARNING: Using default JWT_SECRET. This should match auth-backend JWT_SECRET!")
    except UnicodeEncodeError:
        print("[WARN] WARNING: Using default JWT_SECRET. This should match auth-backend JWT_SECRET!")

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
