# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Three-tier user roles**: Roles are now **community**, **staff**, and **admin**. Community unchanged. **Staff** has the same app access as admins (Turtle Records, Release, Sheets, review, create turtle) but cannot manage users. **Admin** can promote/demote users and access User Management (GET users, PATCH user role, promote to admin/invite). Auth backend: `requireStaff` for operational routes, `requireAdmin` only for user management; new `PATCH /admin/users/:id/role`. Frontend: `isStaffRole(role)`, User Management page shows all users with role dropdown; only admins see the User Management nav link and page. Python backend `require_admin` allows both staff and admin. E2E: `loginAsStaff`, seed scripts create staff@test.com.
- **Email verification**: New users (email/password registration) must verify their email via a link sent on signup. Auth backend supports `email_verified` / `email_verified_at` on users, an `email_verifications` table for tokens, and endpoints `POST /auth/verify-email` and `POST /auth/resend-verification`. Google OAuth users are treated as verified. Admin-only routes (promote-to-admin, users list) require a verified email via `requireEmailVerified` middleware.
- **Password policy**: Registration and change-password enforce a password policy via `validatePassword`. New endpoint `POST /auth/change-password` (authenticated) to update password with the same policy.
- **Email service**: Verification emails via `sendVerificationEmail`; shared helpers `wrapEmailHtml` and `sendMailSafe`; admin promotion and invitation emails refactored to use them. No-reply sender configurable via `SMTP_FROM`.
- **Docker**: Configurable frontend host port via `FRONTEND_PORT` in `.env` (default 80). When port 80 is in use, set `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080` so auth redirects work correctly. See `.env.docker.example` and comments in `docker-compose.yml`.
- **CI/E2E**: Staff test user credentials (`E2E_STAFF_EMAIL`, `E2E_STAFF_PASSWORD`) are passed in backend-integration and Playwright workflows and used by seed-test-users. Backend integration tests add `staff_token` fixture and README documents admin-role tests. Frontend E2E adds Staff login test and Playwright env for staff credentials; photo upload treats staff like admin for match sheet and post-upload navigation.
- **Auth**: Last-admin protection—demoting the last admin is blocked with a 400 error. New POST /auth/validate for token validation (signature and revocation). Flask backend optional AUTH_URL; when set, staff/admin routes call the auth service so demotion revocation (tokens_valid_after) is enforced.

### Changed

- **Auth backend**: Database migration adds `email_verified` and `email_verified_at` to existing users (treated as verified). SQLite-style wrapper supports `email_verifications` table and DELETE on verification tokens. JWT and `/auth/me` include `email_verified`. Admin and auth middleware use Express `Request` with `AuthRequest` cast where needed.
- **Test setup**: `seed-test-users` and `test-setup` scripts set test users to email-verified so E2E login flows land on the app as expected.
- **Intake survey**: "Health Status" field with free-text input and an optional "?" tooltip guiding community members on what to look for when assessing turtle health (e.g. mucous discharge, eye coloration, shell damage, dehydration, flesh flies, mites). Data is stored in Google Sheets when the "Health Status" column is present.
- **Docker**: Configurable frontend host port via `FRONTEND_PORT` in `.env` (default 80). When port 80 is in use, set `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080` so auth redirects work correctly. See `.env.docker.example` and comments in `docker-compose.yml`.

### Changed

- **Turtle forms**: ID field is always read-only (create and edit). Description clarifies read-only behavior and that IDs may not be unique across sheets. E2E tests cover ID read-only and descriptions in create (match dialog) and edit (Sheets Browser) flows.

### Fixed

- **Google Sheets**: Single RLock for all Sheets API use and reinit to avoid concurrent SSL/connection errors (e.g. DECRYPTION_FAILED_OR_BAD_RECORD_MAC, record layer failure) and process segfaults (exit 139). Route that reads sheet values for validation now holds the same lock.
- **E2E**: Stabilize flaky tests: scope sex dropdown option to listbox and wait before click (fixes WebKit failure in admin-turtle-id-auto-generate); increase timeout for "From this upload" on turtle match page (Chromium/Mobile Chrome); wait for review queue content before branching and add timeouts for "No pending reviews" (Mobile Safari).
- **Auth**: When an admin demotes a user (e.g. admin→staff or staff→community), existing JWTs are invalidated so elevated privileges are revoked immediately. Auth backend stores `tokens_valid_after` per user and rejects tokens issued before that time.
- **E2E**: Staff/community test stability: dedicated role-test-community@test.com user for the “change role” test so community@test.com is never mutated and Community badge tests stay correct. Role-update test accepts either “Role updated” toast or row showing Staff (10s timeout). Mobile menu opens with force-click when overlays intercept the burger. Review Queue test waits for “No pending reviews” or “X matches” (15s) before branching. CI seeds the role-test user.
- **Auth backend**: Last-admin demotion check now uses `SELECT id ... .all('admin')` and counts length; `COUNT(*)` with `.get()` was unreliable with the in-repo JSON/SQLite setup.
- **Backend**: Staff/admin photo upload enforces token revocation (`check_auth_revocation`); temp file is removed on 403. `check_auth_revocation` exported from `auth` for use in upload route.
- **E2E**: More reliable nav and staff tests: `data-testid="nav-drawer"` on mobile drawer; `navClick` scopes button to drawer and waits for it to avoid detach; Staff "Turtle Records" test uses wide viewport (1400×800) so header nav is used. Playwright webServer uses `cwd` and `127.0.0.1`; Vite `strictPort: true`. Unused `loginAsCommunity` import removed from staff-and-user-management spec.
- **Admin match page**: `useEffect` dependency for loading turtle images fixed to `selectedMatchData` instead of `selectedMatchData?.location`.

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
