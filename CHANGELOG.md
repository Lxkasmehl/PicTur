# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Intake survey**: "Health Status" field with free-text input and an optional "?" tooltip guiding community members on what to look for when assessing turtle health (e.g. mucous discharge, eye coloration, shell damage, dehydration, flesh flies, mites). Data is stored in Google Sheets when the "Health Status" column is present.
- **Docker**: Configurable frontend host port via `FRONTEND_PORT` in `.env` (default 80). When port 80 is in use, set `FRONTEND_PORT=8080` and `FRONTEND_URL=http://localhost:8080` so auth redirects work correctly. See `.env.docker.example` and comments in `docker-compose.yml`.

### Changed

- **Turtle forms**: ID field is always read-only (create and edit). Description clarifies read-only behavior and that IDs may not be unique across sheets. E2E tests cover ID read-only and descriptions in create (match dialog) and edit (Sheets Browser) flows.

### Fixed

- **Google Sheets**: Single RLock for all Sheets API use and reinit to avoid concurrent SSL/connection errors (e.g. DECRYPTION_FAILED_OR_BAD_RECORD_MAC, record layer failure) and process segfaults (exit 139). Route that reads sheet values for validation now holds the same lock.
- **E2E**: Stabilize flaky tests: scope sex dropdown option to listbox and wait before click (fixes WebKit failure in admin-turtle-id-auto-generate); increase timeout for "From this upload" on turtle match page (Chromium/Mobile Chrome); wait for review queue content before branching and add timeouts for "No pending reviews" (Mobile Safari).

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
