# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Frontend favicon & attribution**: Turtle favicon from Flaticon (`frontend/public/favicon.png`) with `rel="icon"` and `apple-touch-icon` in `index.html`; global app footer with required Freepik / www.flaticon.com links and a link to the specific icon for license compliance.
- **Admin offline backup (ZIP)**: `GET /api/admin/backup/archive` (`scope=all` or `scope=sheet&sheet=…`) returns a ZIP mirroring `data/` plus Google Sheets CSV/JSON exports (`require_admin_only`, not staff). **Google Sheets Browser** shows an admin-only “Offline backup (ZIP)” menu (full archive or current tab). Client: `downloadAdminBackupArchive`, `isAdminRole`.

### Changed

- **Frontend**: Default document title set to **Turtle Project** (replacing “Turtle Frontend”).

## [1.1.0] - 2026-04-05 — Observer hub, backups, mortality tooling, and SQLite auth

### Added

- **Google Sheets backup**: `python -m backup.run` exports admin and community spreadsheets to CSV/JSON under `BACKUP_OUTPUT_DIR` (default `./backups`); Docker documents a host mount; see `docs/BACKUP.md`.
- **Observer gamification**: Observer Hub with XP, quests, badges, and rewards for logged-in users; state in SQLite (`community_game`) with `GET`/`PUT /auth/community-game`, Redux on the client and local fallback when sync fails.
- **Deceased turtles**: `Deceased?` column and sheet styling; APIs to mark deceased without plastron ID (`mark-deceased`, lookup options); staff UI on home and turtle forms.
- **Review queue**: `match_search_pending` and UI for in-progress SuperPoint matching (no misleading “0 matches”); faster list polling while any item is pending.
- **Deploy on GitHub Release**: Workflow checks out the release tag over SSH and runs `docker compose up --build -d` (`.github/workflows/deploy-release.yml`; secrets and `DEPLOY_PATH` documented in repo).
- **Auth tooling**: `npm run delete-user` in auth-backend (by email; refuses removing the last admin).

### Changed

- **Auth storage**: Primary store is SQLite (`auth.sqlite`, `better-sqlite3`) with one-time import from legacy `auth.json`; WAL, foreign keys, and `email_verifications.used_at` when missing. Google signup handles verification timestamps and duplicate SQLite `UNIQUE` errors cleanly.
- **Auth behavior**: JWTs are rejected with 403 if the user row no longer exists. Unverified users may use `/observer` (other areas still require verification).
- **Community general location**: Optional free text in community flows (review queue, new turtle); research paths keep the catalog dropdown. Community sheet tabs do not use research catalog validation on that column (including clearing validation after row writes).
- **Research sheet schema**: Canonical column order and exact headers for new tabs (frequency, DNA, cow interactions, flesh flies, morphometrics, etc.); wider read ranges; biology ID parsing/normalization for display and generation. Admin turtle form and Turtle Match follow the same layout; Pit/archive/adoption/iButton/cow/flesh fields are free text; `value_normalize` applies only to the biology ID column.
- **General locations & Drive**: Default Kansas list and `DRIVE_LOCATION_TO_BACKEND_PATH` updates.
- **`reset_complete_backend.py`**: Removes leftover Django DB/media paths instead of clearing via the old ORM.

### Fixed

- **Community game**: Progress persists to local storage when server sync fails; cache clears only after a successful round-trip.
- **Legacy auth import**: Missing `email_verified` in imported JSON treated as verified with sensible `email_verified_at` backfill.

### Testing

- Playwright and pytest coverage expanded for review-queue pending state, Observer HQ and gamification, community general location in create flow, and community-game API behavior.

### Removed

- Legacy Django app under `backend/turtles/` (Flask-only API; `image_processing.py` for SuperPoint/LightGlue retained).
- Deprecated VLAD/FAISS helpers (`search_utils.py`, duplicate `vlad_utils` modules); direct `faiss-cpu` and explicit `scipy` dropped from `requirements.txt` (transitive installs may still apply).
- Unused Flask imports in `app.py`.

## [1.0.0] - 2026-03-23 — End-to-end stack: matching, general locations, and ops polish

### Added

- **General locations**: State-dependent catalog in admin turtle forms (dropdown + add-new), sheet-specific defaults, and Google Sheets validation on new tabs.
- **Docker**: `docker-compose.gpu.yml` and `scripts/docker-up.ps1` / `docker-up.sh` (prefer GPU, fall back to CPU).

### Fixed

- **Catalog & Sheets**: Safer `general_locations.json` handling (no placeholder injection; POST add-location does not persist fake keys; first-run seed matches repo); `POST /api/general-locations` applies dropdown rules via the real Sheets client; research turtle create/update re-syncs the affected tab.
- **Search & staff upload**: Normalized location filters aligned with the cached index; match-scope select always shows a valid option when stored values are missing from loaded data.

### Changed

- **Matching**: SuperPoint/LightGlue outputs (`score`, `confidence`) consistent across backend, admin, and GUI; LightGlue pinned to `v0.2`; SIFT paths removed; VLAD/FAISS left as deprecated compatibility-only.
- **Admin & uploads**: Sheet/location changes clear and remount General Location to avoid stale Mantine labels; clearer upload instructions (layout, plastron checklist, lab vs field note, closable reminder, “View instructions” header).
- **Review queue**: Safer packet IDs and staged reference-image replacement so failed feature extraction does not wipe existing reference data.
- **CI (Playwright E2E)**: Smoke run, parallel `--shard` matrix on `tests/e2e`, shared `e2e-playwright-prepare` action, `e2e-success` gate, HTML reports per smoke/shard (browser matrix unchanged); `bash -n` and `shellcheck` on Docker launchers (Linux).

### Removed

- Unused root `package.json` (frontend remains the npm entry point).

---

## [0.2.0] - 2026-03-14 — Sheet/location hierarchy, community spreadsheets, and verified accounts

### Added

- **Location hierarchy (sheet + location)**: New turtles and community uploads use a two-level selection (e.g. sheet Kansas → location Wichita). Backend paths: `data/<sheet>/<location>/<turtle_id>/`. New locations can be added under an existing sheet without a new Google Sheet tab. Resolves #96.
- **Post-confirmation automation**: After confirming an upload (match or new turtle), the backend relabels photos with the confirmed turtle ID and syncs to a community-facing Google Spreadsheet. Configure `GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID` in backend `.env`. Resolves #73.
- **Email verification & password policy**: New users (email/password) must verify their email via signup link (`POST /auth/verify-email`, `POST /auth/resend-verification`). Google OAuth users count as verified; admin routes require verified email. Registration and change-password enforce policy via `validatePassword`; new endpoint `POST /auth/change-password` (authenticated). Shared email helpers for verification, admin promotion, and invitations; sender configurable via `SMTP_FROM`.
- **Docker**: Frontend port configurable via `FRONTEND_PORT` (default 80). For port 80 conflicts use `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080`. See `.env.docker.example`.
- **Review queue & community sheets**: Badges for "Admin upload" vs "Community upload"; sheet/location dropdown respects `sheetSource`. API: `GET /api/sheets/community-sheets`; sheets/turtle endpoints accept `target_spreadsheet: 'community'`. Option "+ Create New Sheet" for community turtles (creates tab and `data/Community_Uploads/<name>`). Backend layout: `data/<admin sheet>`, `data/Community_Uploads/<community sheet>`.
- **Community turtle → admin**: When matching a community turtle to the research spreadsheet, flow selects admin sheet + location, creates turtle row, moves folder to `data/<State>/<Location>/`, and removes from community sheet. Match search includes selected location, all community turtles, and incidental finds.
- **Flash-drive ingest**: Configurable ingest routing maps drive folder names to backend destinations (`State/Location`) without renaming source folders. Supports flat and hierarchical layouts; explicit state-level folder handling for `data/<State>/...` imports.
- **Match scope**: With a location selected, match search runs against that location plus all Community_Uploads and Incidental_Finds. Home page options: "Community Turtles only" (Community_Uploads only) or "All locations" (everything). Helper text describes the three scope behaviors.

### Changed

- **Auth**: DB migration adds `email_verified` / `email_verified_at`; existing users treated as verified. JWT and `/auth/me` include `email_verified`. E2E test setup marks test users verified.
- **Intake survey**: "Health Status" field with free-text and optional tooltip (mucous, eyes, shell, dehydration, mites, etc.); stored in Sheets when column exists.
- **Turtle forms & locations**: ID field always read-only (create and edit); copy clarifies IDs may not be unique across sheets. General Location required for admin turtles; paths `data/State/Location/PrimaryID`. `get_all_locations()` includes state-level folders so sheet-based states appear in dropdowns. Review queue: admin `new_location` = Sheet/general_location; community = single sheet in community spreadsheet.
- **Create New Turtle / Sheet–Location**: Sheet/Location dropdown shows only top-level states (e.g. Kansas); Kansas sublocations (e.g. Kansas/Wichita) and system folders (Community_Uploads, Review_Queue, Incidental_Finds) are no longer selectable. In backend-location mode, Kansas expands to location entries; selecting `Kansas/<location>` keeps Sheets tab at state level while targeting backend path at location level. `LOCATION_SYSTEM_FOLDERS` and `SYSTEM_FOLDERS` include Incidental_Finds.
- **Admin upload match scope**: Home page "Which location to test against?" supports location-level options in `State/Location` format; Kansas expands to locations, other states remain state-level.
- **CI (Playwright)**: E2E runs smoke tests (auth, navigation, upload) first, then remaining E2E; Playwright report artifact uploaded only on failure.

### Fixed

- **Google Sheets**: Single RLock for all Sheets API use and reinit to avoid concurrent SSL errors and segfaults (e.g. DECRYPTION_FAILED_OR_BAD_RECORD_MAC, exit 139).
- **Create New Turtle E2E**: ID field now populates on WebKit/Firefox (request biology ID when sex selected; test mocks `/api/locations` and waits for generate-id).
- **E2E flakiness**: Sex dropdown scoped to listbox; longer timeout for "From this upload"; review queue content and "No pending reviews" timeouts (WebKit, Mobile Safari).
- **Community sheet creation**: "Create New Sheet" for community turtles no longer creates the tab in the research spreadsheet; generate-id and update-turtle accept `target_spreadsheet`; frontend passes it when `sheetSource` is community.
- **E2E and test setup**: Test user seed scripts always update password and role for existing users so E2E credentials work regardless of prior state. Playwright webServer uses `path`/`cwd` and `127.0.0.1`; Vite `strictPort: true`. Login fixtures use `noWaitAfter`, detect login errors, and throw clear messages suggesting `npm run test:setup`. Selectors: `getByRole('textbox')` for Sheet/Location, regex for General Location; ID field always disabled; sheet option selection uses exact match (Kansas vs Kansas/Wichita).
- **New turtle create UX**: In-progress/success notification updates and short post-success delay before redirect so completion feedback remains visible. Removed duplicate primary-ID generation path in frontend create/confirm flow to reduce round-trips.

### Testing

- **E2E**: Review queue upload-source badges (Admin vs Community), community-turtle-move-to-admin flow (`data-testid` on badges). Create New Turtle duplicate-name tests mock `/api/locations` and fill General Location. Home page match-scope helper text and sheet dropdown (top-level states only, no sublocations/system folders). admin-community-to-admin and Create New Turtle support both Mantine Select and native `<select>` for Sheet/Location.
- **Integration**: Tests for `GET /api/locations` and for `POST /api/sheets/generate-id` with `target_spreadsheet` (research/community).

---

## [0.1.0] - 2026-02-27 — First release: community turtle ID and review workflow

### Added

- **Authentication**: User registration, login, and Google OAuth via auth backend (Node.js/Express). JWT-based sessions and role-based access (admin vs community).
- **Photo upload and matching**: Admins and community users can upload turtle photos; system returns top matches. Community uploads go to a review queue for admin approval.
- **Admin features**: Review queue for community uploads with suggested matches; admin can confirm match or create new turtle. Photo upload with immediate top-5 match selection.
- **Turtle records / data**: Turtle data management with optional Google Sheets integration (service account); auto-generated biology IDs and configurable fields.
- **Frontend**: React (TypeScript) app with Mantine UI, Tailwind, Leaflet maps; configured for auth and turtle API backends.
- **Backend**: Flask API (Python) for photo processing and matching; auth backend for user and session management.
- **Deployment**: Docker Compose setup for frontend, auth-backend, and backend; persistent volumes for DB, uploads, and review state.
- **Testing**: Playwright E2E tests (Docker-based) and backend integration tests (pytest); CI workflows for main/develop.
- **Documentation**: README with quick start (Docker and local), functionality overview, and versioning guide in `docs/VERSION_AND_RELEASES.md`.
- Version control and release process: `CHANGELOG.md`, version in `frontend/package.json`, and guide in `docs/VERSION_AND_RELEASES.md`.

[Unreleased]: https://github.com/Lxkasmehl/TurtleProject/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v1.1.0
[1.0.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v1.0.0
[0.2.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.2.0
[0.1.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.1.0
