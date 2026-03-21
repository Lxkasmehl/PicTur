# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Replaced the free-text General Location field with a state-dependent dropdown and add-new flow in the admin turtle forms.
- Added shared general-location catalog support with sheet-specific auto-fill rules for fixed mappings (e.g. `NebraskaCPBS`, `IowaHawkeye`).
- Applied Google Sheets validation for General Location so new sheets use the same allowed options.

### Fixed

- **General location catalog**: Normalization no longer merges placeholder example states into an existing `general_locations.json`, so POST add-location does not persist fake keys; in-repo defaults match `general_locations.json` for first-run seeding.
- **Google Sheets General Location dropdown**: `POST /api/general-locations` now applies validation using the real Sheets API client (`GoogleSheetsService.service`); previously sync silently updated 0 tabs, so new locations stayed invalid in Sheets. Research turtle create/update also re-syncs validation for the affected tab.

### Changed

- **Admin turtle form**: Changing Sheet/Location clears General Location, then sheet default rules re-apply; General Location `Select` remounts on sheet change so Mantine does not show a stale label.
- **Staff photo upload (Home)**: Match-scope `Select` always keeps a value that exists in its option list (required, no deselect); avoids an empty-looking control when the stored value is not in `data`. (This is separate from the admin turtle form General Location field.)
- **Upload instructions (frontend)**: Redesigned photo submission instructions modal with clearer layout, spacing, and alignment; prominent “plastron must have” checklist (full frame, no reflections, centered/sharp, clear pattern). Added note that the example image is an ideal lab photo and field photos need not match it. When reopening instructions after first visit (reminder), modal can be closed via X or click-outside without scrolling or checkbox. Optional hint for microhabitat/condition photos. Home page header simplified to centered title, subtitle, and “View instructions” button below.
- **CI (Playwright E2E)**: Workflow uses a smoke job, parallel `--shard` matrix over `tests/e2e` (full browser matrix unchanged), shared `.github/actions/e2e-playwright-prepare` for Docker Compose + Playwright install, and an `e2e-success` job to aggregate status; HTML reports uploaded per smoke/shard.

---

## [0.2.0] - 2026-03-14

### Added

- **Three-tier user roles**: Roles are now **community**, **staff**, and **admin**. Community unchanged. **Staff** has the same app access as admins (Turtle Records, Release, Sheets, review, create turtle) but cannot manage users. **Admin** can promote/demote users and access User Management (GET users, PATCH user role, promote to admin/invite). Auth backend: `requireStaff` for operational routes, `requireAdmin` only for user management; new `PATCH /admin/users/:id/role`. Frontend: `isStaffRole(role)`, User Management page shows all users with role dropdown; only admins see the User Management nav link and page. Python backend `require_admin` allows both staff and admin. E2E: `loginAsStaff`, seed scripts create staff@test.com.
- **CI/E2E**: Staff test user credentials (`E2E_STAFF_EMAIL`, `E2E_STAFF_PASSWORD`) are passed in backend-integration and Playwright workflows and used by seed-test-users. Frontend E2E adds Staff login test; photo upload treats staff like admin for match sheet and post-upload navigation.
- **Auth**: Last-admin protection—demoting the last admin is blocked with a 400 error. New POST /auth/validate for token validation (signature and revocation). Flask backend optional AUTH_URL; when set, staff/admin routes call the auth service so demotion revocation (tokens_valid_after) is enforced.

### Changed

- **Upload instructions (frontend)**: Redesigned photo submission instructions modal with clearer layout, spacing, and alignment; prominent “plastron must have” checklist (full frame, no reflections, centered/sharp, clear pattern). Added note that the example image is an ideal lab photo and field photos need not match it. When reopening instructions after first visit (reminder), modal can be closed via X or click-outside without scrolling or checkbox. Optional hint for microhabitat/condition photos. Home page header simplified to centered title, subtitle, and “View instructions” button below.

## Fixed

- **E2E**: Stabilize flaky tests: scope sex dropdown option to listbox and wait before click (fixes WebKit failure in admin-turtle-id-auto-generate); increase timeout for "From this upload" on turtle match page (Chromium/Mobile Chrome); wait for review queue content before branching and add timeouts for "No pending reviews" (Mobile Safari).
- **Auth**: When an admin demotes a user (e.g. admin→staff or staff→community), existing JWTs are invalidated so elevated privileges are revoked immediately. Auth backend stores `tokens_valid_after` per user and rejects tokens issued before that time.
- **E2E**: Staff/community test stability: dedicated role-test-community@test.com user for the “change role” test so community@test.com is never mutated and Community badge tests stay correct. Role-update test accepts either “Role updated” toast or row showing Staff (10s timeout). Mobile menu opens with force-click when overlays intercept the burger. Review Queue test waits for “No pending reviews” or “X matches” (15s) before branching. CI seeds the role-test user.
- **Auth backend**: Last-admin demotion check now uses `SELECT id ... .all('admin')` and counts length; `COUNT(*)` with `.get()` was unreliable with the in-repo JSON/SQLite setup.
- **Backend**: Staff/admin photo upload enforces token revocation (`check_auth_revocation`); temp file is removed on 403. `check_auth_revocation` exported from `auth` for use in upload route.
- **E2E**: More reliable nav and staff tests: `data-testid="nav-drawer"` on mobile drawer; `navClick` scopes button to drawer and waits for it to avoid detach; Staff "Turtle Records" test uses wide viewport (1400×800) so header nav is used. Playwright webServer uses `cwd` and `127.0.0.1`; Vite `strictPort: true`. Unused `loginAsCommunity` import removed from staff-and-user-management spec.
- **Admin match page**: `useEffect` dependency for loading turtle images fixed to `selectedMatchData` instead of `selectedMatchData?.location`.

---

## [0.2.0] - 2026-03-14

### Added

- **Location hierarchy (sheet + location)**: New turtles and community uploads use a two-level selection (e.g. sheet Kansas → location Wichita). Backend paths: `data/<sheet>/<location>/<turtle_id>/`. New locations can be added under an existing sheet without a new Google Sheet tab. Resolves #96.
- **Post-confirmation automation**: After confirming an upload (match or new turtle), the backend relabels photos with the confirmed turtle ID and syncs to a community-facing Google Spreadsheet. Configure `GOOGLE_SHEETS_COMMUNITY_SPREADSHEET_ID` in backend `.env`. Resolves #73.
- **Email verification & password policy**: New users (email/password) must verify their email via signup link (`POST /auth/verify-email`, `POST /auth/resend-verification`). Google OAuth users count as verified; admin routes require verified email. Registration and change-password enforce policy via `validatePassword`; new endpoint `POST /auth/change-password` (authenticated). Shared email helpers for verification, admin promotion, and invitations; sender configurable via `SMTP_FROM`.
- **Docker**: Frontend port configurable via `FRONTEND_PORT` (default 80). For port 80 conflicts use `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080`. See `.env.docker.example` and comments in `docker-compose.yml`.
- **Review queue & community sheets**: Badges for "Admin upload" vs "Community upload"; sheet/location dropdown respects `sheetSource`. API: `GET /api/sheets/community-sheets`; sheets/turtle endpoints accept `target_spreadsheet: 'community'`. Option "+ Create New Sheet" for community turtles (creates tab and `data/Community_Uploads/<name>`). Backend layout: `data/<admin sheet>`, `data/Community_Uploads/<community sheet>`.
- **Community turtle → admin**: When matching a community turtle to the research spreadsheet, flow selects admin sheet + location, creates turtle row, moves folder to `data/<State>/<Location>/`, and removes from community sheet. Match search includes selected location, all community turtles, and incidental finds.
- **Flash-drive ingest**: Configurable ingest routing maps drive folder names to backend destinations (`State/Location`) without renaming source folders. Supports flat and hierarchical layouts; explicit state-level folder handling for `data/<State>/...` imports.
- **Match scope**: With a location selected, match search runs against that location plus all Community_Uploads and Incidental_Finds. Home page options: "Community Turtles only" (Community_Uploads only) or "All locations" (everything). Helper text describes the three scope behaviors.

### Changed

- **Auth**: DB migration adds `email_verified` / `email_verified_at`; existing users treated as verified. JWT and `/auth/me` include `email_verified`. E2E test setup marks test users verified.
- **Intake survey**: "Health Status" field with free-text and optional tooltip (mucous, eyes, shell, dehydration, mites, etc.); stored in Sheets when column exists.
- **Turtle forms & locations**: ID field always read-only (create and edit); copy clarifies IDs may not be unique across sheets. General Location required for admin turtles; paths `data/State/Location/PrimaryID`. `get_all_locations()` includes state-level folders so sheet-based states appear in dropdowns. Review queue: admin `new_location` = Sheet/general_location; community = single sheet in community spreadsheet.
- **Google Sheets / Turtle data**: Optional mass and morphometrics fields: mass (g); curved/straight carapace length, carapace width; curved/straight plastron length, plastron width; dome height (mm). Stored in Sheets when columns exist; form and API support with backend integration and E2E tests.
- **Create New Turtle / Sheet–Location**: Sheet/Location dropdown shows only top-level states (e.g. Kansas); Kansas sublocations (e.g. Kansas/Wichita) and system folders (Community_Uploads, Review_Queue, Incidental_Finds) are no longer selectable. In backend-location mode, Kansas expands to location entries; selecting `Kansas/<location>` keeps Sheets tab at state level while targeting backend path at location level. `LOCATION_SYSTEM_FOLDERS` and `SYSTEM_FOLDERS` include Incidental_Finds.
- **Admin upload match scope**: Home page "Which location to test against?" supports location-level options in `State/Location` format; Kansas expands to locations, other states remain state-level.
- **CI (Playwright)**: E2E runs smoke tests (auth, navigation, upload) first, then remaining E2E; Playwright report artifact uploaded only on failure.

### Fixed

- **Google Sheets**: Single RLock for all Sheets API use and reinit to avoid concurrent SSL/connection errors (e.g. DECRYPTION_FAILED_OR_BAD_RECORD_MAC, record layer failure) and process segfaults (exit 139). Route that reads sheet values for validation now holds the same lock.
- **Create New Turtle E2E**: ID field now populates on WebKit/Firefox (request biology ID when sex selected; test mocks `/api/locations` and waits for generate-id).
- **Community sheet creation**: "Create New Sheet" for community turtles no longer creates the tab in the research spreadsheet; generate-id and update-turtle accept `target_spreadsheet`; frontend passes it when `sheetSource` is community.
- **E2E and test setup**: Test user seed scripts always update password and role for existing users so E2E credentials work regardless of prior state. Login fixtures use `noWaitAfter`, detect login errors, and throw clear messages suggesting `npm run test:setup`. Selectors: `getByRole('textbox')` for Sheet/Location, regex for General Location; ID field always disabled; sheet option selection uses exact match (Kansas vs Kansas/Wichita).
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

[Unreleased]: https://github.com/Lxkasmehl/TurtleProject/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.2.0
[0.1.0]: https://github.com/Lxkasmehl/TurtleProject/releases/tag/v0.1.0
