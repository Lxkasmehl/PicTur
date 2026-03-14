# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Location hierarchy (sheet + location)**: New turtles and community uploads use a two-level selection (e.g. sheet Kansas → location Wichita). Backend paths: `data/<sheet>/<location>/<turtle_id>/`. New locations can be added under an existing sheet without a new Google Sheet tab. Resolves #96.
- **Post-confirmation automation**: After confirming an upload (match or new turtle), the backend relabels photos with the confirmed turtle ID and syncs data to a **community-facing Google Spreadsheet**. Configure `GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID` in backend `.env`. Resolves #73.
- **Email verification**: New users (email/password) must verify their email via signup link. Endpoints: `POST /auth/verify-email`, `POST /auth/resend-verification`. Google OAuth users count as verified. Admin routes require verified email.
- **Password policy**: Registration and change-password enforce policy via `validatePassword`. New endpoint `POST /auth/change-password` (authenticated).
- **Email service**: Verification, admin promotion, and invitation emails use shared helpers; sender configurable via `SMTP_FROM`.
- **Docker**: Frontend port configurable via `FRONTEND_PORT` (default 80). For port 80 conflicts use `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080`. See `.env.docker.example`.
- **Review queue**: Badges for "Admin upload" vs "Community upload"; sheet/location dropdown respects `sheetSource` (admin vs community). API: `GET /api/sheets/community-sheets`; sheets/turtle endpoints accept `target_spreadsheet: 'community'`.
- **Community sheets**: Option "+ Create New Sheet" for community turtles (creates tab and `data/Community_Uploads/<name>`). Backend folder layout: `data/<admin sheet>`, `data/Community_Uploads/<community sheet>`.
- **Community turtle → admin**: When matching a community turtle to the research spreadsheet, flow selects admin sheet + location, creates turtle row, moves folder to `data/<State>/<Location>/`, and removes from community sheet. Match search includes selected location plus all community turtles.
- **Flash-drive ingest mapping**: Configurable ingest routing maps drive folder names to backend destinations (`State/Location`) without renaming source folders. Supports flat drive roots and hierarchical `State/Location` layouts.
- **Ingest state-level folder handling**: Added explicit support for top-level ingest folders that should be treated as state roots (not location folders), so imports can target `data/<State>/...` when needed.
- **Incidental Finds in match scope**: Match search when a location is selected now includes the selected location, all Community_Uploads, and all Incidental_Finds. New Home page option “Community Turtles only” searches only Community_Uploads; “All locations” searches everything.

### Changed

- **Auth**: DB migration adds `email_verified` / `email_verified_at`; existing users treated as verified. JWT and `/auth/me` include `email_verified`. Test setup marks test users verified for E2E.
- **Intake survey**: "Health Status" field with free-text and optional tooltip (what to look for: mucous, eyes, shell, dehydration, mites, etc.); stored in Sheets when column exists.
- **Turtle forms**: ID field always read-only (create and edit); copy clarifies that IDs may not be unique across sheets. General Location required for admin turtles; paths `data/State/Location/PrimaryID`.
- **Locations**: `get_all_locations()` includes state-level folders so sheet-based states appear in dropdowns without subfolders. Review queue: admin `new_location` = Sheet/general_location; community = single sheet in community spreadsheet.
- **Match search**: With a location selected, search runs against that location plus all `Community_Uploads` turtles; home page helper text updated.
- **Admin upload match scope**: Home page selector "Which location to test against?" now supports location-level options in `State/Location` format; Kansas expands to location entries while other states remain state-level.
- **Create New Turtle selector**: In backend-location mode, `Sheet / Location` now mirrors Kansas-only location expansion. Selecting `Kansas/<location>` keeps Google Sheets tab at state level while targeting backend path at location level.
- **Match scope and locations**: Backend location_filter when a sheet is selected: single location + Community_Uploads + Incidental_Finds; when scope is “Community_Uploads” only that folder is searched. Home page helper text describes the three scope behaviors (location + Community + Incidental Finds, Community only, All).
- **Create New Turtle / locations**: Sheet / Location dropdown shows only top-level states (e.g. Kansas); Kansas sublocations (e.g. Kansas/Wichita) and system folders (Community_Uploads, Review_Queue, Incidental_Finds) are no longer selectable. LOCATION_SYSTEM_FOLDERS and SYSTEM_FOLDERS include Incidental_Finds.
- **CI (Playwright)**: E2E runs smoke tests (auth, navigation, upload) first, then remaining E2E; Playwright report artifact is uploaded only on failure.

### Fixed

- **Google Sheets**: Single RLock for all Sheets API use and reinit to avoid concurrent SSL errors and segfaults (e.g. DECRYPTION_FAILED_OR_BAD_RECORD_MAC, exit 139).
- **Create New Turtle E2E**: ID field now populates on WebKit/Firefox (request biology ID when sex selected; test mocks `/api/locations` and waits for generate-id).
- **E2E**: Flaky fixes—sex dropdown scoped to listbox, longer timeout for "From this upload", review queue content wait and "No pending reviews" timeouts (WebKit, Mobile Safari).
- **Community sheet creation**: "Create New Sheet" for community turtles no longer creates the tab in the research spreadsheet; generate-id and update-turtle accept `target_spreadsheet`, frontend passes it when `sheetSource` is community.
- **E2E and test setup**: Test user seed scripts always update password and role for existing users so E2E credentials work regardless of prior state. Playwright webServer uses `path`/`cwd` and `127.0.0.1`; Vite `strictPort: true`. Login fixtures use `noWaitAfter`, detect login errors, and throw clear messages suggesting `npm run test:setup`. E2E selectors: `getByRole('textbox')` for Sheet/Location and regex for General Location to avoid strict mode; ID field always disabled; sheet select `all
- **New turtle create flow UX**: Added in-progress/success notification updates and short post-success delay before redirect so completion feedback remains visible.
- **New turtle create latency**: Removed duplicate primary-ID generation path in frontend create/confirm flow to reduce unnecessary round-trips.

### Removed

- **Incidental_Finds**: Removed from backend (reset, turtle_manager, README), frontend (HomePage, useTurtleSheetsDataForm), and locations API.

### Testing

- **E2E**: Review queue upload-source badges (Admin vs Community) and community-turtle-move-to-admin flow; `data-testid` on badges. Create New Turtle duplicate-name tests mock `/api/locations` and fill General Location.
- **Integration**: Tests for `GET /api/locations` and for `POST /api/sheets/generate-id` with `target_spreadsheet` (research/community).
- **E2E**: Home page match-scope helper text (Incidental Finds, “Community Turtles only”, “All locations”); Create New Turtle sheet dropdown shows only top-level states and excludes sublocations/system folders. admin-community-to-admin and Create New Turtle handle both Mantine Select and native <select> for Sheet/Location; sheet option selection uses exact match to avoid Kansas vs Kansas/Wichita.

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
- **Deployment**: Docker Compose setup for running frontend, auth-backend, and backend together; persistent volumes for DB, uploads, and review state.
- **Testing**: Playwright E2E tests (Docker-based) and backend integration tests (pytest); CI workflows for main/develop.
- **Documentation**: README with quick start (Docker and local), functionality overview, and versioning guide in `docs/VERSION_AND_RELEASES.md`.
- Version control and release process: `CHANGELOG.md`, version in `frontend/package.json`, and guide in `docs/VERSION_AND_RELEASES.md`.

[Unreleased]: https://github.com/Lxkasmehl/TurtleProject/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.1.0
