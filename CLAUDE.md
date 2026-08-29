# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PicTur** (repo: TurtleTracker) is a community-driven web platform for turtle population monitoring using image-based identification. It has three services: a React frontend, a Node.js/Express auth backend, and a Python/Flask backend that runs SuperPoint + LightGlue AI matching.

## Development Commands

### Running Everything

```powershell
# Windows (auto-detects GPU)
./scripts/docker-up.ps1

# Explicit CPU
docker compose up --build

# Explicit GPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

### Frontend (`frontend/`)

```bash
npm run dev        # Vite dev server on port 5173
npm run build      # TypeScript + Vite production build
npm run lint       # ESLint
npm test           # Playwright E2E (requires running services at http://localhost)
npm run test:ui    # Playwright UI mode
npm run test:headed
npm run test:debug
```

### Auth Backend (`auth-backend/`)

```bash
npm run dev           # tsx watch mode
npm run build         # TypeScript compile
npm run db:migrate    # Run database migrations
npm run create-admin  # Create initial admin user
npm run seed-test-users
```

### Python Backend (`backend/`)

```bash
python app.py                          # Flask dev server (port 5000)
pip install -r requirements.txt
python -m pytest tests/integration -v  # Integration tests (requires Docker services)
python -m pytest tests/unit -v         # Unit tests
python -m backup.run                   # Export sheets to CSV/JSON
```

### CI Test Commands

```bash
# E2E (from frontend/)
PLAYWRIGHT_BASE_URL=http://localhost npm test

# Backend integration (from backend/)
BACKEND_URL=http://localhost:5000 AUTH_URL=http://localhost:3001/api python -m pytest tests/integration -v
```

## Architecture

Three services communicate directly; no message queue:

```
frontend (React/Vite :5173)
    → auth-backend (Express :3001)  — JWT auth, user management, SQLite/PostgreSQL
    → backend (Flask :5000)         — turtle data, AI matching, Google Sheets sync
```

### Frontend (`frontend/src/`)

- **pages/** — full-page route components (admin match, records, user management, observer hub, login)
- **components/** — 100+ UI components; notable clusters: `AdminTurtleMatch/`, `AdminTurtleRecords/`, `MapDisplay/`, `game/`
- **services/api.ts** + **services/api/** — all HTTP calls; `auth.ts` hits auth-backend, `sheets.ts` hits Flask backend
- **store/slices/** — Redux Toolkit slices for user session and community game state
- **utils/** — image compression, EXIF extraction (piexifjs), validation

### Auth Backend (`auth-backend/src/`)

- **routes/** — auth (register/login/JWT), googleAuth (OAuth), admin, communityGame, contact
- **middleware/auth.ts** + **middleware/admin.ts** — JWT verification, role guard
- **db/database.ts** — SQLite (dev) or PostgreSQL (prod) via better-sqlite3
- **services/email.ts** — SMTP via Nodemailer; **services/githubFeedback.ts** — posts feedback as GitHub issues

### Python Backend (`backend/`)

- **app.py** — Flask app + CORS + blueprint registration
- **routes/** — upload, review, turtles, sheets, locations, admin_backup, health
- **turtle_manager.py** — core: manages Google Drive folder structure, atomic reference replacement, crash recovery via `_recover_staged_files`
- **turtles/image_processing.py** — SuperPoint + LightGlue matching; runs 4 rotations × 4096 keypoints; maintains in-memory VRAM cache keyed by plastron/carapace
- **google_sheets_service.py** — Google Sheets API wrapper
- **sheets/** — CRUD (`crud.py`), lookup (`lookup.py`), column header mapping (`columns.py`), value normalization (`value_normalize.py`)
- **backup/run.py** — nightly snapshot export

### Key Data Flows

**Community upload**: photo → `routes/upload.py` → queued for admin review (no immediate matching)

**Admin upload**: photo → `routes/upload.py` → SuperPoint feature extraction → LightGlue matching against cached tensors → match candidates returned → admin approves/creates turtle → `turtle_manager.py` updates Drive folders + Google Sheets atomically

**Turtle storage**: Google Sheets is the source of truth for turtle metadata. Each turtle has a Drive folder with `plastron/` and `carapace/` subdirs holding reference photos. The VRAM cache (`image_processing.py`) holds extracted feature tensors for fast matching; it is updated incrementally on approve/replace operations.

### Role Model

- **Community users**: upload photos, see queue status, earn gamification badges
- **Admins**: run matching, review/approve submissions, manage Sheets records, trigger backups

## Environment Setup

Copy `.env.docker.example` → `.env` at the repo root and fill in:
- `JWT_SECRET`, `SESSION_SECRET`
- Google OAuth client ID/secret
- SMTP credentials
- Google Sheets spreadsheet IDs
- Google Drive service account credentials (mounted as volume)

Auth backend also needs `auth-backend/.env`; Flask backend needs `backend/.env` (see `backend/env.template`).

## Testing Notes

- Playwright tests require all three services running and accessible at `http://localhost`
- Python integration tests require the Docker compose stack (`docker-compose.integration.yml`) to be up
- The CUDA smoke test in CI only checks that the GPU image imports PyTorch correctly — it does not run matching
- Unit tests in `backend/tests/unit/` cover: value normalization, carapace column support, staged-file crash recovery, rate limiting
