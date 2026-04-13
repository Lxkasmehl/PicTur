# PicTur

**PicTur: A Community-Driven Web Platform for Turtle Population Monitoring Using Image-Based Identification**

A system for identifying turtles through photo upload and automatic matching.

## Project Structure

```
PicTur/
├── frontend/          # React Frontend (TypeScript)
├── auth-backend/      # Node.js/Express Auth Backend (Port 3001)
├── backend/           # Flask API Server (Python) (Port 5000)
└── README.md          # This file
```

## Quick Start

### Option A: Run with Docker (recommended for deployment)

You need **Docker** and **Docker Compose** installed.

1. Copy the example environment file and adjust if needed:

   ```bash
   cp .env.docker.example .env
   ```

2. (Optional) For Google Sheets: create `backend/credentials/`, place your **Google Service Account** JSON there (e.g. `google-sheets-credentials.json`), and set `GOOGLE_SHEETS_SPREADSHEET_ID` in `.env`. If the file has another name, set `GOOGLE_SHEETS_CREDENTIALS_PATH=/app/credentials/your-filename.json` in `.env` (path is inside the container; the folder `backend/credentials/` is mounted into the container).

3. Build and start all services (CPU default):

   ```bash
   docker compose up --build
   ```

   GPU-capable startup options:

   ```powershell
   # Windows/PowerShell: auto-select GPU when NVIDIA runtime is available; fallback to CPU
   ./scripts/docker-up.ps1

   # Force CPU mode
   ./scripts/docker-up.ps1 -CpuOnly
   ```

   ```bash
   # Linux/macOS: make launcher executable once
   chmod +x ./scripts/docker-up.sh

   # Auto-select GPU when NVIDIA runtime is available; fallback to CPU
   ./scripts/docker-up.sh

   # Force CPU mode
   ./scripts/docker-up.sh --cpu-only
   ```

   ```bash
   # Manual GPU override (Linux/macOS/CI)
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
   ```

4. Open **http://localhost** in your browser (frontend). Auth API: **http://localhost:3001**, PicTur API: **http://localhost:5000**.

GPU mode uses `backend/Dockerfile.cuda` and requires the NVIDIA Container Toolkit/runtime.
If GPU runtime is unavailable, use CPU default (`docker compose up --build`) or the platform launcher fallback script.

5. **Promote the first user to admin** (so you can use admin features like Turtle Records and photo matching). After signing up or logging in once, run this once (replace with your email and a password):

   ```bash
   docker compose run --rm -e INITIAL_ADMIN_EMAIL=your@email.com -e INITIAL_ADMIN_PASSWORD=your-password auth-backend node dist/scripts/create-initial-admin.js
   ```

   - Use the **exact email** you use to log in (e.g. your Google account email).
   - If that user already exists, they are promoted to admin (password is ignored). If not, a new admin user is created with that email and password.
   - Log out and log in again; you should see the Admin badge and admin menu items.

Data (auth DB, review queue, uploads) is stored in Docker volumes and persists between runs. See `docs/DOCKER.md` for details.

---

### Option B: Run locally (development)

#### Prerequisites

- **Node.js** (v18+) for auth-backend and frontend
- **Python** (3.8+) for the PicTur backend
- **npm** or **yarn** for Node.js packages
- **pip** for Python packages

### 1. Start Auth Backend (Port 3001)

The auth backend handles user authentication, login, registration, and Google OAuth.

1. Navigate to the auth-backend directory:

```bash
cd auth-backend
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file (see `auth-backend/README.md` for details):

```env
PORT=3001
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-here
SESSION_SECRET=your-super-secret-session-key-here
FRONTEND_URL=http://localhost:5173
# ... (see auth-backend/README.md for full configuration)
```

4. Start the auth server:

```bash
npm run dev
```

The auth backend runs on `http://localhost:3001`

### 2. Start PicTur Backend (Port 5000)

The PicTur backend handles photo uploads, matching, and review queue.

1. Navigate to the backend directory:

```bash
cd backend
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start the Flask server:

```bash
python app.py
```

The PicTur backend runs on `http://localhost:5000`

### 3. Start Frontend

1. Navigate to the frontend directory:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. (Optional) Create a `.env` file if you need to customize API URLs:

```env
VITE_AUTH_API_URL=http://localhost:3001/api
VITE_API_URL=http://localhost:5000/api
```

4. Start the development server:

```bash
npm run dev
```

The frontend runs on `http://localhost:5173` (or another port, depending on Vite configuration)

## Running All Services

You need to run **all three services** simultaneously:

1. **Terminal 1**: Auth Backend (Port 3001)

   ```bash
   cd auth-backend && npm run dev
   ```

2. **Terminal 2**: PicTur Backend (Port 5000)

   ```bash
   cd backend && python app.py
   ```

3. **Terminal 3**: Frontend (Port 5173)
   ```bash
   cd frontend && npm run dev
   ```

## Functionality

### Admin Users

1. **Photo Upload**:

   - Admin uploads a photo
   - System processes the photo immediately
   - Top 5 matches are displayed
   - Admin selects the best match

2. **Review Queue**:
   - Admin sees all community uploads
   - Each upload has 5 suggested matches
   - Admin selects the best match or creates a new turtle

### Community Users

1. **Photo Upload**:
   - Community member uploads a photo
   - System processes the photo
   - Photo is saved to review queue
   - Waits for admin review

## API Configuration

The frontend is configured to use:

- **Auth Backend**: `http://localhost:3001/api` (for authentication)
- **PicTur Backend**: `http://localhost:5000/api` (for photo uploads and matching)

If your backends run on different ports, set these environment variables in the frontend:

```bash
# In the frontend directory
echo "VITE_AUTH_API_URL=http://localhost:3001/api" >> .env
echo "VITE_API_URL=http://localhost:5000/api" >> .env
```

## Development

### Auth Backend Development

- Node.js/Express server with CORS for frontend communication
- JWT-based authentication
- Google OAuth integration
- User management and role-based access control

### PicTur Backend Development

- Flask server with CORS for frontend communication
- Uses `turtle_manager.py` for main logic
- SuperPoint + LightGlue for feature extraction and matching
- In-memory tensor cache for fast repeated matching

### Frontend Development

- React with TypeScript
- Mantine UI Components
- Redux for state management
- React Router for navigation

## Testing

Tests run against the real backends (no fake backends). Use Docker to run services, then run tests.

- **Backend integration tests:** `backend/tests/integration/`. Start auth + backend with Docker, then run pytest:
  ```bash
  docker compose -f docker-compose.integration.yml up -d --build
  # Seed test user (once): docker compose -f docker-compose.integration.yml exec -e E2E_ADMIN_EMAIL=admin@test.com -e E2E_ADMIN_PASSWORD=testpassword123 auth-backend node dist/scripts/seed-test-users.js
  cd backend && BACKEND_URL=http://localhost:5000 AUTH_URL=http://localhost:3001/api python -m pytest tests/integration -v
  ```
- **E2E tests (Frontend):** `frontend/tests/e2e/` (Playwright). Start the full stack with Docker, then run Playwright:
  ```bash
  docker compose up -d --build
  # Seed test users (see .github/workflows/playwright-e2e-tests.yml), then:
  cd frontend && PLAYWRIGHT_BASE_URL=http://localhost npm test
  ```

## Further Information

- See `auth-backend/README.md` for detailed auth backend documentation
- See `backend/README.md` for detailed PicTur backend documentation
- See `docs/VERSION_AND_RELEASES.md` for versioning, changelog, and GitHub Releases

## Funding & Acknowledgments

This project was supported by a **K-INBRE Research Training Award** in the spring of 2026.

### Required Acknowledgment

This project was supported by an Institutional Development Award (IDeA) from the National Institute of General Medical Sciences of the National Institutes of Health under grant number **P20 GM103418**.

### NIH Public Access Policy

Any publications acknowledging the K-INBRE grant must be deposited in PubMed Central and have a PMCID# to comply with the NIH public access policy. For more information, visit: https://www.k-inbre.org/pages/k-inbre_fund-opp_award-agreement.html
