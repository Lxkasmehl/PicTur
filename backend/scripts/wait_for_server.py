"""
Simple script to wait for Flask server to be ready.
This can be used to verify the server is actually accepting connections.
"""
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))  # scripts/ for ingest_common etc.
import sys
import time
import socket
import requests
from urllib.parse import urlparse

def check_port(host, port, timeout=1):
    """Check if a port is open and accepting connections"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception as e:
        return False

def check_http(url, timeout=5):
    """Check if HTTP endpoint is responding"""
    try:
        response = requests.get(url, timeout=timeout)
        return response.status_code == 200
    except Exception as e:
        return False

def wait_for_server(url, max_attempts=120, delay=1):
    """Wait for server to be ready"""
    parsed = urlparse(url)
    host = parsed.hostname or 'localhost'
    port = parsed.port or (80 if parsed.scheme == 'http' else 443)
    
    print(f"[WAIT] Waiting for server at {url}")
    print(f"[WAIT] Host: {host}, Port: {port}")
    
    for attempt in range(1, max_attempts + 1):
        # First check if port is open
        if check_port(host, port, timeout=1):
            print(f"[WAIT] Port {port} is open (attempt {attempt})")
            # Then check if HTTP endpoint responds
            if check_http(url, timeout=2):
                print(f"[WAIT] ✅ Server is ready! (attempt {attempt})")
                return True
            else:
                print(f"[WAIT] Port open but HTTP not responding yet (attempt {attempt})")
        else:
            print(f"[WAIT] Port {port} not open yet (attempt {attempt}/{max_attempts})")
        
        if attempt < max_attempts:
            time.sleep(delay)
    
    print(f"[WAIT] ❌ Timeout: Server not ready after {max_attempts} attempts")
    return False

if __name__ == '__main__':
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5000/'
    success = wait_for_server(url)
    sys.exit(0 if success else 1)
