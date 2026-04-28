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

1. **Photo Upload (match flow)**:

   - Admin uploads a plastron photo (always the primary reference)
   - SuperPoint + LightGlue returns the top 5 plastron matches
   - If a carapace photo is attached as an additional image, a **Cross-check carapace** button runs a parallel carapace search and displays both result sets side-by-side, flagging disagreements
   - Admin selects the best match (optionally marking the upload as the new reference) or creates a new turtle

2. **Review Queue**:

   - Admin sees all community uploads, ordered by upload date
   - Community photos arrive as `unclassified` — admin classifies each as **Plastron** or **Carapace** (or trashes it) before matching runs against the correct VRAM cache
   - Each upload lists its top 5 suggested matches and any additional photos the community user included
   - Cross-check flow: if the community upload also has a plastron additional image, **Cross-check with plastron** runs both searches

3. **Google Sheets Browser (Turtle Records)**:
   - Browse all turtles from Google Sheets with primary plastron thumbnails
   - Select a turtle to edit its sheet data and manage its photos end-to-end
   - **Additional Turtle Photos** section: drop new plastron, carapace, microhabitat, condition, or generic additional photos onto a turtle. *Every* photo-type button routes through the **Pending photos (uncommitted)** box first — nothing is written to the turtle until the admin presses **Update Turtle**. Plastron and Carapace uploads additionally open a modal asking whether to replace the existing reference (**Yes, replace** archives the old reference to `plastron/Old References/` or `carapace/Old References/`; **No, save as Other** routes the photo to the Other folder). The pending box has a reserved slot for the tagging UI (rename-on-commit).
   - The Additional pane resets every calendar day — it only lists uploads from the current local date. Older day-folders remain visible via **View Old Turtle Photos** below.
   - **View Old Turtle Photos** section: a date dropdown lists every date this turtle has a photo on file (EXIF "when taken" dates preferred, upload dates as fallback). Selecting a date shows all thumbnails from that day alongside their source (`Old Plastron Ref`, `Other Carapace`, `Microhabitat`, etc.). Active plastron and carapace references are included under their capture date with a **(active)** badge.

4. **Create New Turtle** (from either the Admin Match page or the Sheets Browser):
   - Between the auto-generated Primary ID and the Google Sheets form, a **Photos for this upload** panel offers Microhabitat / Condition / Carapace / Additional upload buttons and displays any photos already attached to the packet. Admins can correct a forgotten photo at creation time instead of discovering the gap post-approval.
   - All sheet-data fields start **fully editable** — the per-field click-to-unlock flow only applies when *editing* an existing turtle.

5. **Admin Match Page — Match Selected view**:
   - Order top-to-bottom: uploaded-vs-candidate comparison → **Additional Photos** panel → **Replace plastron / carapace reference** checkboxes → Google Sheets data form → action buttons (Cancel / Save to Sheets & Confirm Match / Create New Turtle Instead). The replace-reference decision sits directly under the photos it affects.
   - Each candidate card (plastron and cross-checked carapace) shows the on-disk biology id, the turtle's **chosen name** from Google Sheets when set, and the auto-generated **Primary ID** when distinct from the biology id, plus location and confidence. Per-candidate name/Primary ID is read from Sheets in parallel after the match list resolves; Sheets writes are never made from this page.

6. **Backup countdown overlay (staff + admin only)**:
   - Five minutes before the nightly chronodrop kicks off (`03:00` server time by default), an orange floating badge appears bottom-right on every admin page with a live `mm:ss` countdown and the message *"Server backup in X:XX — please save your work."*
   - At T-0 the overlay flips to a full-screen un-dismissable modal (*"Nightly backup is running — the system will resume automatically"*) that blocks interaction while the chronodrop runs and, when needed, while the backend container restarts to pick up renamed turtle folders.
   - The modal polls the backend's health endpoint every 5 seconds and dismisses itself the moment the server is back up *and* the expected duration has elapsed. After 10 minutes of stalled maintenance it surfaces a contact-admin hint.
   - Schedule and duration are configurable via the backend env vars `BACKUP_SCHEDULE_HOUR`, `BACKUP_SCHEDULE_MINUTE`, and `BACKUP_DURATION_SECONDS`. Window times come from the new `GET /api/backup/window` endpoint, so the server is the source of truth — client clock drift cannot skew the countdown.

### Community Users

1. **Photo Upload**:
   - Community member uploads a photo
   - System creates a review-queue packet asynchronously; the response returns immediately
   - Matching runs in a background thread once an admin classifies the photo as plastron or carapace
   - Waits for admin review

## Matching, Image Storage, and Data Layout

### Backend AI Pipeline

The turtle backend uses **SuperPoint** for keypoint extraction (4,096 keypoints per image across 4 rotations) and **LightGlue** for keypoint matching. The matcher maintains two VRAM caches — one for plastron references and one for carapace references — and switches between them based on the query's `photo_type`. On startup the backend pre-loads every `.pt` feature tensor from disk into GPU VRAM (or CPU RAM when no GPU is detected) so subsequent queries only need to extract features for the query image and run LightGlue against the live cache.

Reference replacement (promoting a new plastron or carapace as the primary reference for a turtle) is atomic: the new `.pt` and image are staged under a temporary `_staged_{timestamp}` name, SuperPoint feature extraction runs against the staged copy, the old reference is archived to `Old References/`, and only then are the staged files promoted to their canonical names. A crash at any step either leaves the old reference intact or the new reference fully in place — never a half-replaced state. On next startup, `_recover_staged_files` sweeps orphaned staged files and promotes any that survived.

### On-Disk Layout

Every turtle folder has the same structure regardless of which references exist:

```
<State>/<Location>/<BiologyID_PrimaryKey>/
├── plastron/
│   ├── <turtle_id>.jpg            # primary plastron reference
│   ├── <turtle_id>.pt             # SuperPoint features for the reference
│   ├── Old References/            # archived previous plastron references
│   └── Other Plastrons/           # non-reference plastron photos
├── carapace/
│   ├── <turtle_id>.jpg            # primary carapace reference (if any)
│   ├── <turtle_id>.pt
│   ├── Old References/
│   └── Other Carapaces/
├── additional_images/
│   └── YYYY-MM-DD/                # microhabitat, condition, generic additional
│       ├── manifest.json
│       └── <type>_<ms>_<date>_<filename>.jpg
└── find_metadata.json             # flag / physical / digital metadata
```

Biology IDs are zero-padded to three digits (`F002`, `M010`) and folder names prepend the biology ID to the primary key (`F001_K14`) so IDs reused across sheets don't collide. Every new file written to a turtle folder gets a `_YYYY-MM-DD` suffix embedded in its filename, using the EXIF `DateTimeOriginal` date when available so bulk-ingested archival photos still group correctly in the historical viewer.

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
- Uses `turtle_manager.py` for main logic — approval flow, reference replacement (plastron + carapace, atomic and crash-safe), flash-drive ingest, Google Sheets sync
- SuperPoint + LightGlue for feature extraction and matching (4,096 keypoints × 4 rotations per query)
- Dual in-memory VRAM caches (plastron / carapace) with incremental updates on approve / replace / ingest — no full rebuild
- `POST /api/turtles/replace-reference` for direct admin reference replacement from the Sheets Browser
- `GET /api/turtles/images` exposes primary plastron, primary carapace, date-stamped `additional_images`, structured `loose` images (with `source` discriminant + EXIF/upload dates), and `history_dates` for the historical viewer

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
