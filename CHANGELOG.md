# Changelog

All notable changes to TurtleTracker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **SuperPoint + LightGlue matching pipeline**: Replaces the legacy VLAD / FAISS search. `turtles/image_processing.py` defines a `TurtleDeepMatcher` singleton (`brain`) that pre-loads all reference `.pt` feature tensors into GPU VRAM (or CPU RAM when no GPU) at startup. Extracts 4-rotation SuperPoint features for queries once, reuses them across all fallback searches. Switchable device mode via `brain.set_device()`. Legacy `search_utils.py` kept as a no-op compatibility module.
- **Carapace support (dual matching paths)**: Every turtle can have two independent reference images — plastron (belly) and carapace (top of shell) — with separate VRAM caches (`vram_cache_plastron` / `vram_cache_carapace`). `match_against_cache(photo_type=...)` selects the right cache, and `refresh_database_index()` scans both `plastron/` and `carapace/` subfolders. Admin uploads are always plastron; community uploads arrive as `unclassified` and are classified in the review queue with Plastron / Carapace / Trash buttons before any matching runs.
- **Per-turtle folder structure with Old References / Other archives**: New turtle folders get `plastron/`, `plastron/Old References/`, `plastron/Other Plastrons/`, `carapace/`, `carapace/Old References/`, `carapace/Other Carapaces/` created up front. Legacy `ref_data/` and `loose_images/` still readable via fallback. Reference replacement archives the previous master to `Old References/` atomically; non-reference plastron/carapace images land in the corresponding `Other …/` folder instead of the generic `additional_images/` bucket.
- **Sheets browser photo management (replaces upload direct-add)**: The Google Sheets Browser turtle detail panel now hosts all turtle-specific photo operations. New red **Plastron** and **Carapace** buttons open a modal asking whether to replace the reference (old ref → `Old References/`) or save to the Other folder. Uploads are staged client-side with preview thumbnails + pending badges and only commit when the admin presses **Update Turtle**. Multiple replace candidates of the same type show a warning and the last one wins; earlier ones are demoted to `Other …/`.
- **Historical photo viewer**: New `OldTurtlePhotosSection` above the additional photos section. Renders a date dropdown populated from the backend's `history_dates` aggregation (unique sorted dates across `additional_images/YYYY-MM-DD/`, `plastron/Old References`, `plastron/Other Plastrons`, `carapace/Old References`, `carapace/Other Carapaces`, legacy `loose_images/`). Selecting a date filters thumbnails to that day and labels each with its source (`Old Plastron Ref`, `Other Carapace`, etc.).
- **EXIF date extraction + filename date stamping**: New `_extract_exif_date` helper (Pillow `DateTimeOriginal`, falling back through `DateTimeDigitized` / `DateTime`). Every new file written to a turtle folder gets a `_YYYY-MM-DD` suffix stamped into its filename, preferring the EXIF "when taken" date over the upload date. `GET /api/turtles/images` now exposes `exif_date` / `upload_date` per entry and sorts `history_dates` using the EXIF-first priority so bulk-ingested archival photos group by when they were *taken*, not when the server ingested them.
- **Enhanced `GET /api/turtles/images` response**: Adds `primary_carapace` (path to the carapace reference, parallel to `primary`), structured `loose` entries as `{path, source, timestamp, exif_date, upload_date}` with `TurtleLooseSource` discriminant (`plastron_old_ref`, `plastron_other`, `carapace_old_ref`, `carapace_other`, `loose_legacy`), and `history_dates: string[]`.
- **`POST /api/turtles/replace-reference` endpoint**: Direct reference replacement for existing turtles (admin only). Form: `turtle_id`, `photo_type` (`plastron` | `carapace`), `file`, optional `sheet_name`. Wraps new public methods `TurtleManager.replace_plastron_reference` / `replace_carapace_reference` / `replace_turtle_reference`, extracted from `_approve_review_packet_locked`. Full atomic swap: staged `_staged_{op_ts}` copies, SuperPoint feature extraction, promote-then-evict, VRAM cache incremental update. Guarded by `_approval_lock`.
- **Cross-check carapace on admin match page**: A carapace cross-check button appears on `AdminTurtleMatchPage` whenever the packet has a carapace additional image. On click, runs `POST /api/review-queue/<id>/cross-check` with `image_path`, renders the top 5 carapace matches side-by-side with the plastron matches. A "Top match differs" warning badge appears when the top carapace match disagrees with the top plastron match.
- **Flash-drive ingest to new folder structure**: `ingest_flash_drive()` creates `plastron/` / `carapace/` subfolders (based on `_detect_photo_type(filename)` routing), generates the full subfolder tree up front, and uses biology-ID-prepended turtle folder names (`F001_K14`) to avoid collisions.
- **`normalize_ingest.py` script**: Cleans up the on-disk Rebuild Ingest folder — zero-pads biology IDs (`F65` → `F065`), strips messy prefixes (`F445 4-18-2025 VS Lab carapace.JPG` → `F445 Carapace.JPG`), and keeps a single canonical file per (bio ID, photo type). Dry-run by default, `--apply` to execute.
- **`TurtleImageAdditional` / `TurtleLooseImage` / `TurtleLooseSource`** exported from `frontend/src/services/api/turtle.ts` for strongly-typed consumers of the new response shape.
- **Generalized Sheets Browser staging pipeline**: The Sheets Browser turtle detail panel now stages *every* photo-type button (Microhabitat, Condition, Carapace, Plastron, Additional) into the same "Pending photos (uncommitted)" box — previously only plastron and carapace went through staging. All other types went straight to the server. Nothing commits until the admin presses **Update Turtle**. The staging state was widened (`StagedType`/`ReferenceType`) and a type guard `isReferenceType` centralizes the "does this type even allow reference replacement?" check. Plastron / Carapace still prompt for **replace current reference?** — other types stage directly. The pending box also reserves a marked slot for the tag UI coming with the `main` merge (tag chosen in the pending box → backend rename on commit).
- **`AdditionalImagesSection` prop generalized**: `onStageReferencePhoto?: (type: 'carapace' | 'plastron', file) => void` replaced with `onStagePhoto?: (type: 'microhabitat' | 'condition' | 'carapace' | 'plastron' | 'additional', file) => void`. When provided, every upload button routes through staging; when omitted, immediate packet/turtle upload behaviour is preserved (backward-compatible).
- **Photo management on the Create New Turtle flow**: Both the inline Create New Turtle modal on `AdminTurtleMatchPage` and the standalone `CreateNewTurtleModal` in `AdminTurtleRecords` now embed `AdditionalImagesSection` (titled **Photos for this upload**) between the Primary ID block and the Google Sheets data form, so admins can add or remove Microhabitat / Condition / Carapace / Additional photos at creation time instead of discovering the omission post-approval.
- **`primary_info` / `primary_carapace_info` in `GET /api/turtles/images` response**: A new `_build_primary_info(path)` helper on the backend returns `{path, timestamp, exif_date, upload_date}` for each of the active plastron and carapace references. `history_dates` now folds in these dates (EXIF preferred, upload fallback) so a turtle whose only 2022 photo is the primary plastron now surfaces `2022` in the date picker. The legacy bare-string `primary` / `primary_carapace` fields are preserved for backward compatibility.
- **`OldTurtlePhotosSection` renders active references under their capture date**: The section now accepts optional `primaryInfo` / `primaryCarapaceInfo` props. When the selected date matches a primary's EXIF / upload / file timestamp, the primary is shown in the grid with label **Plastron (active)** / **Carapace (active)**.

### Changed

- **Folder layout migration**: `ref_data/` → `plastron/`, `loose_images/` → `plastron/Other Plastrons/`. Legacy paths are still read (backwards-compatible fallback), but new writes always use the new layout. `refresh_database_index`, `_recover_staged_files`, `get_locations`, `_process_single_turtle`, `add_additional_images_to_turtle`, `add_observation_to_turtle`, and `_approve_review_packet_locked` all updated.
- **Admin upload is always plastron**: Removed the photo-type selector from `AdminTurtleMatchPage` — the admin's primary photo is always the plastron; carapace is uploaded via the additional-images button. Community uploads arrive as `unclassified` and `photo_type` is decided in the review queue classify step.
- **Biology IDs zero-padded to 3 digits**: `F002` / `M010` / `J025` is the canonical form. Turtle folder names are now `BiologyID_PrimaryKey` (e.g. `F001_K14`) so biology IDs reused across sheets don't collide on disk. Google Sheets being updated to match; backend `_parse_bio_id` handles both padded and legacy forms on read.
- **Additional images section renamed**: The shared `AdditionalImagesSection` title in the Google Sheets browser changes from "Turtle photos (Microhabitat / Condition) - {date}" to just **Additional Turtle Photos**. All add buttons unified to the default red theme (dropped the earlier `teal` and `grape` colors on carapace/plastron buttons).
- **Review queue community flow**: Unclassified community uploads now show three buttons — **Proceed with matching** (carapace), **Cross-check with plastron** (when a plastron additional image exists, runs both searches and displays them side-by-side with a "Top match differs" warning), and **Delete**.
- **Incremental VRAM cache updates**: Replace / approve operations no longer rebuild the entire index. `brain.add_single_to_vram()` and per-attr cache eviction keep latency flat as the dataset grows.
- **Crash recovery**: `_recover_staged_files` now scans `plastron/`, `ref_data/` (legacy), and `carapace/` for orphaned `_staged_*` files on startup and promotes any that survived an interrupted reference-replacement operation.
- **Replace-reference controls moved on admin match page**: The **Replace plastron reference with this upload** and **Replace carapace reference (first carapace photo)** checkboxes (plus their warning Alerts) moved out of the bottom action-buttons panel into a dedicated Paper placed directly under the **Additional Photos** panel. The decision and the photos it affects are now co-located; the bottom panel only holds Cancel / Save / Create-New-Turtle-Instead actions.
- **"Additional Turtle Photos" pane on Sheets Browser shows only today's uploads**: Previously filtered by the most-recent date folder seen on disk, so on a day with no new uploads it kept surfacing yesterday's (or older) photos. Now it uses today's local date (matching the backend's `time.strftime('%Y-%m-%d')` localtime folder naming), and the pane resets to just the upload buttons each new day. All prior uploads remain visible in **View Old Turtle Photos**.

### Fixed

- **Carapace additional images routed to `additional_images/` by mistake**: The approve-packet merge block was copying carapace entries into the turtle's `additional_images/` folder alongside microhabitat/condition photos. Now the merge block skips type `carapace` / `plastron` entries; the subsequent reference-processing block routes the first carapace to the reference (or replaces it with `replace_carapace_reference=True`) and any 2nd+ carapaces to `carapace/Other Carapaces/`. Same fix applied to `plastron`.
- **Superseded replacement candidates were lost**: When multiple plastron (or carapace) replace-reference uploads were staged on the Sheets Browser and committed, only the last one became the new reference and the earlier ones used to silently disappear. They now route to `Other Plastrons` / `Other Carapaces` with a warning chip on the staged preview so nothing is lost.
- **`add_additional_images_to_turtle` routed everything to `additional_images/`**: Now types `plastron` / `carapace` are redirected to `plastron/Other Plastrons/` or `carapace/Other Carapaces/`. Only microhabitat/condition/additional/other still land in the date-stamped `additional_images/` tree.

### Removed

- **"Add to specific turtle" direct-add mode on the HomePage**: The SegmentedControl toggle, cascading Sheet → General Location → Turtle dropdowns, and the `target_turtle_id` / `target_location` upload path are all gone. The same workflow lives in the Google Sheets Browser now where the turtle context is already established. `HomePage.tsx`, `usePhotoUpload.tsx`, `turtle.ts` (`uploadTurtlePhoto` signature, `UploadPhotoResponse` interface), and `backend/routes/upload.py` all simplified.

### Testing

- **`tests/test_carapace_support.py`**: Dual VRAM cache behaviour, `refresh_database_index` scanning both plastron and carapace folders, `_process_single_turtle` folder structure for both photo types, `search_for_matches` photo-type routing, `create_review_packet` unclassified flow, `approve_review_packet` with carapace. Updated for the new `plastron/` folder layout.
- **`tests/test_crash_recovery.py`**: Atomic reference replacement (plastron + carapace), staged file recovery from `_recover_staged_files`, VRAM cache eviction after a replace, temp file cleanup in the upload folder. Updated assertions now check `plastron/Old References/Archived_Master_*` for archived masters.
- **`tests/test_vram_cache_updates.py`**: `add_single_to_vram`, incremental updates after approve/replace, ingest refresh skip logic.
- **`tests/e2e/admin-match.spec.ts`**: Two new specs — (1) Create New Turtle modal exposes `AdditionalImagesSection` with Microhabitat / Condition / Carapace / Additional upload buttons; (2) `Replace plastron reference` checkbox renders *above* the `Save to Sheets & Confirm Match` button (placement check via `compareDocumentPosition`), guarding against a regression where it gets pushed back into the bottom action panel.

---

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

### Changed

- **Matching pipeline**: Admin and GUI match flows now use SuperPoint/LightGlue match outputs (`score`, `confidence`) consistently across backend and frontend.
- **Search filtering**: Fixed default and location-filtered matching in GUI/API by normalizing location filters and aligning filter labels with cached index locations.
- **Review safety**: Hardened review-packet processing with safer packet IDs and staged reference-image replacement to avoid losing existing reference data if feature extraction fails.
- **Dependencies**: Pinned LightGlue to `v0.2` for reproducible backend installs.
- **Legacy compatibility**: Removed remaining SIFT-based processing calls and marked VLAD/FAISS helpers as deprecated compatibility modules (non-default path).
- **Docker runtime UX**: Added GPU compose override (`docker-compose.gpu.yml`) plus cross-platform launchers (`scripts/docker-up.ps1`, `scripts/docker-up.sh`) that prefer GPU when available and fall back to CPU automatically.
- **CI hardening**: Added Linux launcher validation in GitHub Actions (`bash -n` + `shellcheck`) to keep Docker startup parity healthy across platforms.
- **Repository cleanup**: Removed unused root-level `package.json` to avoid confusion with the actual frontend package.

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
