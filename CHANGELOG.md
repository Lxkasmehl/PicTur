# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Review queue (admin)**: While a community upload is still running SuperPoint matching, the API exposes `match_search_pending` and the Turtle Records queue shows **Finding matches…** instead of a misleading **0 matches**; the detail view explains that matching runs in the background and the list auto-refreshes (faster polling while any item is pending).
- **Backup (Google Sheets)**: Export admin and community spreadsheets to CSV and JSON for backup and history. Run `python -m backup.run` from backend; output under `BACKUP_OUTPUT_DIR/sheets/YYYY-MM-DD/` (one CSV per sheet plus optional JSON per spreadsheet). `BACKUP_OUTPUT_DIR` configurable via env (default `./backups`). Docker Compose mounts `./backups` on the host so backups survive container/volume removal. Strategy and retention in `docs/BACKUP.md`; backend README and env.template updated. `.gitignore` excludes `backups/`. `.env.docker.example` documents `GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID` for Docker.
- **Observer gamification**: Observer Hub, XP, weekly quests, badges, and reward flows on upload/home for **any logged-in role** (community, staff, admin). Progress is stored **per user id** in SQLite (`community_game`) and survives role promotion/demotion; guests see a sign-up teaser only (no anonymous progress). Client: Redux (`communityGameSlice`), local fallback when sync fails, debounced `GET`/`PUT /auth/community-game`. Navigation includes Observer HQ for staff/admin; staff match uploads can update progress before navigating to the match page. Backend validates payload bounds.
- **Auth backend**: `npm run delete-user` script (by email, refuses last admin; `CASCADE` cleans related rows).
- **E2E**: Playwright coverage for Review Queue → community upload → Create New Turtle: General Location is a plain text field (optional hint, no catalog “add new”), and the value stays after choosing sheet and sex; `expectGeneralLocationIsFreeTextInDialog` helper in `frontend/tests/e2e/fixtures.ts`.
- **Google Sheets (research)**: Canonical column order for new tabs (`CANONICAL_COLUMN_ORDER`); mappings for Freq, Specific Location, Flesh Flies?, and separate Plastron/Carapace Picture in Archive columns with legacy header aliases for older sheets. Missing columns required by a save are inserted automatically in canonical positions; cell values can be formatted on write (`value_normalize`). Sheet value reads use wider ranges (e.g. `A:ZZ`) so extra columns are not cut off. Biology IDs support more legacy cell formats and normalize to MFJU + three-digit sequence for display and generation.

### Changed

- **Community turtles**: General Location is optional free text in the community spreadsheet flow (review queue / new turtle); the catalog dropdown stays for research paths (admin sheets, backend locations, and matching community turtles into admin).
- **Email verification (frontend)**: Unverified logged-in users may open `/observer` (still redirected from other app areas until verified). After hydrating community game state, the verified observer badge is granted when the account is verified.
- **Auth backend**: Primary store is SQLite (`auth.sqlite`, `better-sqlite3`) instead of `auth.json`; one-time import from legacy `auth.json` when the DB is empty; WAL/foreign keys; `email_verifications.used_at` added for existing DBs when missing.
- **Google OAuth / signup**: New Google users get explicit verification timestamps on insert; duplicate-account path handles SQLite `UNIQUE` constraint errors (and removes the old post-insert delay).
- **Backend**: `reset_complete_backend.py` removes leftover Django artifacts (`backend/turtles/db.sqlite3`, `backend/turtles/media/`) instead of clearing tables via the Django ORM.
- **General locations & Drive**: Default Kansas general-location list and flat `DRIVE_LOCATION_TO_BACKEND_PATH` entries updated (e.g. Dee Hobelman, Other, West Topeka).
- **Admin turtle form / API types**: Form fields and `TurtleSheetsData` extended for the new sheet columns.

### Fixed

- **Forms**: Community general location no longer behaves as a catalog dropdown or gets cleared by catalog validation when the sheet is not part of the research location catalog.
- **Auth**: Authenticated requests fail with 403 when the user row no longer exists (e.g. after admin deletion); a valid JWT signature alone is not enough. Legacy `auth.json` import treats a missing `email_verified` field as verified and backfills `email_verified_at` from existing timestamps.
- **Community game (frontend)**: When syncing to the server fails after load or on debounced save, progress is written to local storage via `writePersistedGame` so offline or error paths do not silently drop state; local cache is cleared only after a successful server round-trip.

### Testing

- **Review queue**: Unit tests `tests/test_review_packet_format.py` for `format_review_packet_item` (`match_search_pending` vs empty `candidate_matches`); integration asserts `match_search_pending` on queue/packet GET; Playwright `admin-review-queue-matching-pending.spec.ts` (mocked API: list + detail + poll to ready).
- **Integration (admin role)**: `test_patch_user_role_as_admin_success` targets the seeded role-test community user (`E2E_ROLE_TEST_EMAIL`, default `role-test-community@test.com`) so role demotion does not revoke JWTs used by other tests.
- **Observer / auth**: Playwright E2E for Observer HQ (`observer-hub.spec.ts`: guest teaser, community hub, staff nav, mobile “Learn more”) and gamification (`observer-hq-gamification.spec.ts`: community upload → rewards modal +XP, `PUT /auth/community-game`, quests/badges on `/observer`; serial suite for shared seed user). Backend integration: `test_community_game_api.py` (401/400, roundtrip, user isolation) and `community_token` fixture in `conftest.py`.

### Removed

- **Backend**: Legacy Django project under `backend/turtles/` (identification app, `manage.py`, related tests). The HTTP API remains Flask-only; `backend/turtles/image_processing.py` (SuperPoint/LightGlue) is kept.
- **Backend**: Deprecated VLAD/FAISS helper `search_utils.py` and duplicate `vlad_utils` modules; removed direct `faiss-cpu` and explicit `scipy` from `requirements.txt` (scikit-learn may still install scipy as a dependency).
- **Backend**: Unused Flask imports in `app.py`.

## [1.0.0] - 2026-03-23

Version 1.0.0 is the milestone where the updated, properly functioning backend logic is merged and integrated with the latest frontend, so the stack finally works together end-to-end as one coherent application.

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

## [0.2.0] - 2026-03-14

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

## [0.1.0] - 2026-02-27

First release of TurtleTracker: a community-driven web platform for turtle population monitoring using image-based identification.

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

[Unreleased]: https://github.com/Lxkasmehl/TurtleProject/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v1.0.0
[0.2.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.2.0
[0.1.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.1.0
