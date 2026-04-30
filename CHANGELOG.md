# Changelog

All notable changes to PicTur will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.21] - 2026-04-29 — Image previews, Flask HTTP errors, proxy routing docs

### Added

- **`GET /api/images`**: Optional **`max_dim`** query parameter (32–2048, longest edge in pixels) returns a server-generated JPEG preview when the original is larger; transparent/palette images flattened to RGB; HEIF/HEIC supported via existing Pillow registration.
- **`getImageUrl`** (`frontend/src/services/api/turtle.ts`): Optional **`GetImageUrlOptions.maxDim`** appends **`max_dim`** for downscaled URLs (clamped to the same range as the API).

### Fixed

- **Flask** (`backend/app.py`): Handle **`HTTPException`** (404, 405, etc.) before the generic **`Exception`** handler so client errors keep the correct status and JSON **`error`** body instead of being treated as **500**.

### Changed

- **`.env.docker.example`**: Clarify reverse-proxy routing — send **`/api/auth`**, **`/api/admin`**, **`/api/contact`**, **`/api/feedback`** (and auth-backend **`/api/health`**) to the Node auth service; route remaining **`/api/*`** to Flask — with longest/specific paths first so contact and feedback are not handled by Flask by mistake.
- **Admin UI** (additional images, Review Queue, Sheets browser): Image **`src`** uses scaled previews where sizes are bounded (e.g. thumbnails vs. lightbox still uses full **`getImageUrl`** where wired); **`loading="lazy"`** and **`decoding="async"`** on those **`<Image>`** elements.

## [1.2.20] - 2026-04-29 — Footer & contact, GitHub feedback, extended turtle photos

### Added

- **About & Contact in the footer** (Washburn-focused copy); staff/admin drawer breakpoint adjusted. Contact uses **`POST /api/contact`** on the auth-backend (**`CONTACT_FORM_RECIPIENTS`**, SMTP, Reply-To visitor); Washburn links remain as fallback where applicable.
- **`/feedback`** with **`POST /api/feedback`**: creates GitHub issues (REST); optional Projects v2 link and status via GraphQL; labels from **`GITHUB_FEEDBACK_LABELS`** plus type labels. Env documented in **`.env.docker.example`**.
- **Turtle photo categories** (homepage, Sheets browser, Review Queue, Match): anterior, posterior, left/right side, people, injury, plus existing types; filenames encode category (e.g. `right-side_…`). **Drag-and-drop** onto category buttons to stage photos (homepage and admin).
- **Sheets browser**: optional photo category filter; **`GET /api/turtles/images/search-labels`** supports tag-only, category-only, or combined queries (`q` and/or `type`, at least one required).

### Changed

- **`EmailVerificationGuard`**: **`/feedback`** allowed before email verification (same as About/Contact).
- **`.gitignore`**: **`project-query.graphql`** (local GraphQL helpers).
- **Legacy labels**: `head` / `tail` no longer shown as buttons; stored values still map to **anterior** / **posterior**.
- **Review queue** additional-image uploads use the same category set as turtle records.
- **Admin token validation**: if **`AUTH_URL`** uses `localhost` and validation fails, one retry against **`127.0.0.1`** (Windows/dev hostname quirks).

### Testing

- Playwright: footer nav including Feedback; Sheets browser type-only search; homepage categories and drag-and-drop (mobile/WebKit skipped where unreliable).
- Backend: **`search-labels`** filters; **`right-side`** on review packet additional images.

## [1.2.19] - 2026-04-27 — Mobile tutorial viewport + Specific Property label and Location reminder

### Fixed

- **UI polish**: Inline **external-link** icons, clearer **Contact** CTA, automatic footer height (`311444d`).
- **First-visit mobile tutorial viewport**: Fixed a mobile rendering issue where opening the instructions tutorial on a fresh device could initially render the app in desktop-like scale. Mobile media queries now resolve on initial render for home/tutorial flow, and tutorial scroll height uses dynamic viewport sizing for more stable phone layout.

### Changed

- Renamed the Google Sheets column label **Specific Location** to **Specific Property** across the WebApp form and backend sheet column mapping.
- Added reminder text to the **Location** field (Column S) in the WebApp form: enter who first found the turtle.
- Updated the related sheet-column mapping test to validate **Specific Property** ordering before **General Location**.

## [1.2.18] - 2026-04-24 — Review approve research/community sync guard + match-form General Location unlock

### Fixed

- **Review approve — research match**: Confirming a match to an **admin/research** turtle no longer writes or updates the **community** Google Sheet. Admin and community spreadsheets stay separate; only **community → admin** moves still delete the row from the community sheet (`match_from_community`). Resolves unwanted extra rows (e.g. #150).
- **Admin Turtle Match — General Location**: On the match sheet form, **General Location** was hard read-only (plain text + “Add new General Location” only, no catalog dropdown). It is now in the same **Unlock editing** flow as other editable match columns; after confirm, the **catalog select** works like elsewhere. Sheets with a **fixed catalog default** (`generalLocationLocked`) still show a disabled control **without** an extra unlock step.

### Testing

- **`backend/tests/test_review_approve_no_community_sync_on_research_match.py`**: Unit tests (Flask test client + mocks) assert that approving a **research-only** match does not call `get_community_sheets_service`, and that **community → admin** approval still calls `delete_turtle_data` only (no community create/update).
- **Playwright** (`frontend/tests/e2e/admin-match.spec.ts`): **Edit matched research turtle** asserts General Location starts locked with **Unlock editing**, then offers catalog options including **West Topeka** after unlock.

## [1.2.17] - 2026-04-21 — Sheets browser biology ID for disk images + primaries batch

### Fixed

- **Admin Sheets browser — identifier plastron and thumbnails**: Image APIs (`GET /api/turtles/images`, batch primaries, identifier upload, additional photos) now use **`turtleDiskFolderId`**: the sheet **ID** (biology folder name, e.g. **`F439`**) when present, then **Primary ID** (`T177…`). On-disk layout is almost always **`data/…/<biology id>/ref_data/`**; sending Primary ID first left **`primary: null`** and empty previews even when `F439.JPG` / `F439.pt` existed.
- **Batch primaries map**: Response rows are applied **in request order** with stable **`turtleKey`** (includes optional **`row_index`** from `/api/sheets/turtles`) so list thumbnails do not mis-assign or overwrite when many turtles load at once.
- **Photo tags → sheet row**: `findTurtleForMatch` matches **`m.turtle_id`** against **either** biology **`id`** or **`primary_id`**.
- **`TurtleSheetsDataForm`**: Dynamic field values are coerced to **strings** so numeric **`row_index`** on list payloads does not break `TurtleFormField` (`string | number`).

### Changed

- **Sheets browser identifier panel**: Removed the redundant **orange** general/location warning; short guidance remains in the muted help text. **Search** in the turtle list also matches **Primary ID**.

## [1.2.16] - 2026-04-23 — Sheets folder resolution (primary path + state/site layout)

### Fixed

- **`_get_turtle_folder` / Sheets primary thumbnails**: If `data/<sheet_name hint>/<turtle_id>/` existed as an empty (or weak) folder while the real turtle data lived deeper (e.g. `data/Kansas/Topeka/T42`), the API returned **`primary: null`** and the UI showed **Set identifier** for everyone. Resolution now scores **`ref_data`** (`.pt` / reference image) across all matching folders and picks the strongest match instead of trusting the hinted path alone.
- **Sheets browser vs disk layout (Kansas etc.)**: The spreadsheet tab name (`sheet_name`, e.g. `Kansas`) is not the same as the filesystem path when turtles live under **`data/Kansas/<site>/<biology id>/`**. The Sheets UI now passes **`general_location` + `location`** as the folder hint (same idea as review queue `state/location`). **`resolve_turtle_dir_for_sheet_upload`** resolves **`State/turtle_id`** by scanning **`State/<site>/turtle_id`**, and **does not** auto-create **`data/State/<new primary id>/`** when the state directory already has site-style subfolders (prevents stray `Kansas/T177…/` trees).

## [1.2.15] - 2026-04-22 — Primary ID sync before nightly Sheets backup

### Changed

- **`python -m backup.run`** (used by **`scripts/daily-backup.sh`**): Before exporting CSV/JSON, runs the same **Primary ID migration** as backend startup for the **admin** and **community** spreadsheets when needed (biology **ID** present, **Primary ID** empty). Nightly backups therefore include complete Primary IDs without restarting the API container.

## [1.2.14] - 2026-04-22 — Sheets plastron workflows (identifier uploads, additional plastron)

### Added

- **Sheets browser — plastron workflows**: Set a first-time identifier plastron for sheet-only turtles (creates `data/<location>/<turtle_id>/` when needed), replace the existing SuperPoint reference (old master archived to `loose_images`), or upload an **extra** underside photo as **Plastron (additional)** in the manifest (does not create or replace `.pt`). New admin API **`POST /api/turtles/images/identifier-plastron`** (`turtle_id`, `file`, `mode`: `set_if_missing` | `replace`, optional `sheet_name`). Additional-image type **`plastron`** is allowed server-side. **`POST /api/turtles/images/additional`** now creates the turtle folder from `sheet_name` when it was missing (same resolver), so microhabitat uploads work for new rows too.

### Testing

- **`backend/tests/test_turtle_plastron_upload.py`**: folder resolution, first identifier, set-if-missing conflict, replace archives old master, additional upload creates folder (brain `process_and_save` mocked to write a dummy `.pt`); **`test_get_turtle_folder_prefers_real_ref_data_over_empty_hint`**; **`test_resolve_finds_nested_when_hint_is_state_only`** / **`test_resolve_no_shallow_folder_when_state_has_site_layout`** for state-only hints vs nested layout.

## [1.2.13] - 2026-04-20 — Review queue candidate filenames with uppercase extensions

### Fixed

- **`GET /api/review-queue` HTTP 500** when a packet’s `candidate_matches` images use an uppercase extension (e.g. **`Rank1_IDT42_Conf85.JPG`**). Parsing stripped only lowercase `.jpg`/`.png`/`.jpeg`, so `Conf`/`Rank` segments still contained **`.JPG`** and `int()` raised **`invalid literal for int() with base 10: '85.JPG'`**. **`format_review_packet_item`** now removes the extension with **`os.path.splitext`** and a case-insensitive suffix check before splitting on **`_`**.

### Testing

- **`backend/tests/test_review_packet_format.py`**: **`test_candidate_uppercase_jpg_extension_parsed`** asserts **`Rank1_IDT42_Conf85.JPG`** yields the same rank, turtle id, and confidence as the lowercase **`.jpg`** case.

## [1.2.12] - 2026-04-20 — Upload favorites, extra photo tags, admin Sheets browser

### Added

- **Home match-scope favorites (staff)**: Star locations (including “All locations”) in the upload scope `Select`; favorites are grouped (“Favorites” / “More locations”), default scope respects saved order after reload (waits for `GET /locations` before locking selection). Preferences sync to **`GET`/`PUT /api/auth/user-ui-preferences`** (SQLite table `user_ui_preferences` in auth-backend) when logged in, with **localStorage** fallback and one-time migration from cache if the profile is empty.
- **Additional turtle photos**: Optional **tags** on extra images (manifest); types **carapace**, **condition**, **microhabitat**, and **other**; admin APIs `GET /api/turtles/images/search-labels` and `PATCH /api/turtles/images/additional-labels`; integration tests in `test_turtles_routes.py`.
- **Admin UI**: Staged upload with per-image type and tags; inline tag editing on saved photos (turtle folders); **Sheets browser** “Photo tags” mode with grouped results and larger previews; home/upload flow sends tagged extras via `extra_*` + `extra_labels_*`.

### Changed

- **CORS**: `PATCH` included in allowed methods for cross-origin tag updates.
- **Upload route**: Shared `_collect_extra_upload_files` parses `extra_carapace_*`, `extra_other_*`, and per-index labels.
- **Turtle additional photos**: POST stores `original_filename`; when images are merged into turtle folders, the stored file name uses the upload’s original basename instead of only the temp path. Integration test for review-queue carapace + labels; HTTP test client supports `PATCH`.

## [1.2.11] - 2026-04-18 — Biology ID parsing with trailing sheet notes

### Fixed

- **Max biology ID when the ID cell includes extra text**: Only values matching a strict “letter + digits only” pattern were counted toward the highest numeric suffix. Real sheet cells often append notes (e.g. **`J666 (UT1 4/13/2026)`**, **`M637 (UT 713 …)`**), so those rows were skipped and the next ID could be far too low (e.g. **637** while **666** already existed). **`get_max_biology_id_number`** now treats every **M/F/J/U** + digits token in the cell (and a leading ID before spaces or parentheses) so the shared sequence advances correctly (e.g. **U667** after **J666**). **`normalize_biology_id_display`** strips the same leading ID for canonical **MFJU** + three-digit form.

### Testing

- **`backend/tests/test_sheets_sparse_column_regression.py`**: Cases where **J666** appears with a **(UT …)** suffix; **`generate_biology_id`** yields **U667**.
- **`backend/tests/test_value_normalize_and_biology.py`**: Parametrised normalize cases for annotated IDs.

## [1.2.10] - 2026-04-18 — Google Sheets sparse-column reads (new turtle row / max biology ID)

### Fixed

- **Google Sheets new-turtle row / biology ID scan (sparse columns)**: Reading only column **A** (or only the biology **ID** column) for `values.get` can omit rows where that cell is empty but another column in the same row has data. That made `create_turtle_data` compute too small a `next_row` and **overwrite an existing turtle row**, and `get_max_biology_id_number` miss high IDs (e.g. **J666**) so the next ID was too low (e.g. **U637** instead of **U667**). **Append** now uses a range spanning **Primary ID through ID**; **max biology suffix** is scanned from **column A through the ID column** (`A2:…` for the max scan so the header row is not parsed as an ID).

### Testing

- **`backend/tests/fakes/google_sheets_api_fake.py`**: Fake `spreadsheets.values` that models sparse **single-column** `values.get` (rows omitted when that column is empty). Used to assert **behaviour** (which sheet row is written; max biology suffix / next U-ID), not only range strings.
- **`backend/tests/test_sheets_sparse_column_regression.py`**: Behavioural regression for the admin “new turtle” chat bug — **no overwrite** of an existing row when Primary ID is missing on some lines; **J666 → next U667** (and documents **U637** as max-stuck-at-636). Reverting the `crud`/`migration` fixes should fail these tests; E2E against real Google Sheets is not required for this class of bug.

## [1.2.9] - 2026-04-17 — Backup dates follow host TZ; daily-backup invokes data script with bash

### Changed

- **Backup folder dates (`sheets/…/YYYY-MM-DD/`, `data/…/YYYY-MM-DD/`)**: `scripts/daily-backup.sh` sets **`BACKUP_DATE`** from the host (`date +%Y-%m-%d`) and passes it into `python -m backup.run` so Sheets exports match the same calendar day as `backup-backend-data.sh`. **`scripts/backup-backend-data.sh`** uses the host local date by default (no longer UTC-only). **`backend/backup/run.py`** reads optional env **`BACKUP_DATE`**; otherwise uses `datetime.now()` in the container.
- **`scripts/daily-backup.sh`**: Calls **`bash`** on `backup-backend-data.sh` so the data backup runs without the execute bit on `.sh` files.

## [1.2.8] - 2026-04-16 - Host data/ backups + daily backup scripts

### Added

- **Host backup of backend `data/` (Docker volume)**: `scripts/backup-backend-data.sh` copies `/app/data` from the running backend (or from the `backend-data` volume if the container is down) to `BACKUP_OUTPUT_DIR/data/YYYY-MM-DD/` on the host. `scripts/daily-backup.sh` runs `python -m backup.run` (Sheets CSV/JSON) then the data copy so one cron job covers spreadsheets and images. Documented in **docs/BACKUP.md** and **backend/README.md** (combined `crontab` example with `COMPOSE_DIR` / `BACKUP_OUTPUT_DIR`).

### CI

- **CUDA requirements parity**: `backend/scripts/check_requirements_cuda_sync.py` ensures `requirements-docker-cuda.txt` lists every pip package from `requirements.txt` except `torch` and `torchvision` (installed separately in `Dockerfile.cuda`). Covered by `backend/tests/test_requirements_cuda_sync.py`; wired as job `cuda-requirements-sync` in **Backend Integration Tests**.
- **Production GPU image smoke**: Job `backend-cuda-image-smoke` builds `backend/Dockerfile.cuda` (GitHub Actions cache for Docker layers) and runs `python3 -c "import app"` inside the image so missing dependencies and import-time crashes in the same stack as production deploy surface before merge. Runs in parallel with the existing integration job after the sync check; Playwright/E2E Compose still uses the CPU `Dockerfile`, so this closes the Dockerfile.cuda gap.

## [1.2.7] - 2026-04-16 - Add pillow-heif to CUDA image and libheif runtime deps

### Fixed

- **GPU backend crash on startup (production)**: `Dockerfile.cuda` installs only `backend/requirements-docker-cuda.txt`, which did not include `pillow-heif` after HEIC support landed in `requirements.txt`. `app.py` imports upload routes → `image_utils` → `pillow_heif` at startup, so the container exited with `ModuleNotFoundError` and the API never stayed up. Added `pillow-heif>=0.16.0` to `requirements-docker-cuda.txt`. Installed **`libheif1`** and **`libde265-0`** via `apt` in `Dockerfile` and `Dockerfile.cuda` so the HEIF stack has runtime libraries inside the image (no host-level installs required).

## [1.2.6] - 2026-04-15 — HEIC uploads + case-insensitive image lookup

### Fixed

- **Match thumbnails missing for `.JPG` references (Linux)**: Reference images saved with uppercase extensions (e.g. `F128.JPG`) were not resolving on the production Linux server because `convert_pt_to_image_path` and the related candidate-copy / replace-reference paths hard-coded a lowercase extension list (`['.jpg', '.jpeg', '.png']`) combined with `os.path.exists`. Case-sensitive filesystems silently returned the raw `.pt` path, which the frontend then couldn't render. Added case-insensitive helpers `routes.upload.find_image_for_pt`, `turtle_manager._find_image_next_to_pt`, and `turtle_manager._find_image_in_dir` that scan the containing directory and match the file stem against any supported image extension regardless of case. Windows/NTFS was never affected because its filesystem is case-insensitive.
- **HEIC upload failures without EXIF**: `image_utils.normalize_to_jpeg` previously passed `img.info.get('exif', b'')` to Pillow's JPEG encoder, but some HEIC files store `'exif'` mapped to `None` rather than omitting the key, bypassing the default and crashing the encoder with `TypeError: object of type 'NoneType' has no len()`. Guarded so `exif=` is only passed to `save()` when actual bytes are present.

### Added

- **HEIC/HEIF upload support**: iPhone photos arrive as HEIC by default and Chrome/Firefox cannot render HEIC natively. New `backend/image_utils.py` registers `pillow-heif` at import time and exposes `normalize_to_jpeg()`, which is a no-op for non-HEIC inputs and otherwise converts in-place to a sibling `.jpg` (quality 95, EXIF preserved — including `DateTimeOriginal` for future history-date aggregation — EXIF rotation applied). Called immediately after every `file.save()` in `routes/upload.py`, `routes/review.py`, and `routes/turtles.py` (5 call sites). `heic`/`heif` added to `config.ALLOWED_EXTENSIONS`; `pillow-heif>=0.16.0` added to `backend/requirements.txt`. Frontend `fileValidation.ts` accepts `image/heic` / `image/heif` with an extension fallback (Chrome/Firefox leave `file.type` blank for HEIC), `HomePage.tsx` Dropzone accept list and user-facing "Supported formats" text updated to include HEIC.

### Testing

- **`backend/tests/test_image_lookup.py` (32 tests)**: Regression coverage for the case-insensitive lookup. Parametrised across `.jpg`/`.JPG`/`.jpeg`/`.JPEG`/`.png`/`.PNG`/`.Jpg`/`.JPg` against all three helpers, plus passthrough / missing-sibling / missing-directory / unrelated-file / alias contract cases.
- **`backend/tests/test_image_utils.py` (13 tests)**: HEIC normalization coverage. Generates HEIC fixtures programmatically via pillow-heif's bundled encoder to exercise real encode → decode round-trips. Verifies sibling `.jpg` creation, original-file deletion, uppercase `.HEIC` / `.heif` handling, EXIF `DateTimeOriginal` preservation, and multi-tag EXIF round-trip.

## [1.2.5] - 2026-04-13 — Admin offline backup URL (Flask vs Express)

### Fixed

- **Admin offline backup (ZIP)**: Endpoint moved from `GET /api/admin/backup/archive` to `GET /api/backup/archive`. The Express auth backend mounts `/api/admin/*`, so requests to the old path never reached Flask and returned **404** in production; the download handler remains admin-only on Flask.

## [1.2.4] - 2026-04-13 — PyTorch cu128 for NVIDIA Blackwell (RTX 5080 / sm_120)

### Fixed

- **RTX 50-series (Blackwell, sm_120)**: Official cu121 wheels only ship GPU archs through **sm_90**, so PyTorch warned and could misbehave on e.g. RTX 5080. CUDA backend image is now **`nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`** with **torch / torchvision from `https://download.pytorch.org/whl/cu128`** (**torch ≥ 2.7**, **torchvision ≥ 0.22**) so sm_120 is supported.

## [1.2.3] - 2026-04-13 — GPU visible to PyTorch (CUDA_VISIBLE_DEVICES)

### Fixed

- **`docker-compose.gpu.yml`**: Removed default `CUDA_VISIBLE_DEVICES=all`. That variable is **not** the same as `NVIDIA_VISIBLE_DEVICES`: CUDA expects numeric GPU indices (`0`, `1`, …). The value `all` is invalid for `CUDA_VISIBLE_DEVICES` and commonly yields `torch.cuda.is_available() == False` even with a correct CUDA PyTorch build (`torch.version.cuda` still set). Optional pin via `.env` only (e.g. `CUDA_VISIBLE_DEVICES=0`).
- **GPU reservation**: Added `deploy.resources.reservations.devices` (NVIDIA, `capabilities: [gpu]`) alongside `gpus: all` for Compose setups where device requests need the explicit block.

## [1.2.2] - 2026-04-13 — CUDA PyTorch not overwritten by pip; clearer GPU diagnostics

### Fixed

- **CUDA PyTorch after `pip install -r`**: `kornia` and other deps can pull `torch` from PyPI and replace the cu121 wheels with a **CPU-only** build. `Dockerfile.cuda` now force-reinstalls `torch` / `torchvision` from the PyTorch CUDA index after all other packages and fails the image build if `torch.version.cuda` is unset.
- **Compose GPU env**: `docker-compose.gpu.yml` sets `NVIDIA_VISIBLE_DEVICES` and `NVIDIA_DRIVER_CAPABILITIES` so the NVIDIA Container Toolkit passes driver capabilities into the backend container.

### Changed

- **Logs when GPU missing**: `TurtleBrain` logs `torch.__version__` and `torch.version.cuda` to distinguish “CPU-only wheel in image” vs “CUDA build but no device / toolkit”.

## [1.2.1] - 2026-04-13 — Production GPU deploy (CUDA PyTorch + Compose)

### Fixed

- **Production deploy uses GPU stack**: GitHub Release deploy (`.github/workflows/deploy-release.yml`) now runs `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d` so the backend image is built from `Dockerfile.cuda` and receives `gpus: all`. Previously the workflow only used the default Compose file, which builds the CPU-only backend (`Dockerfile`).
- **CUDA image installs PyTorch with CUDA**: `backend/Dockerfile.cuda` installs `torch` / `torchvision` from the PyTorch CUDA 12.1 wheel index (`cu121`); remaining dependencies use `backend/requirements-docker-cuda.txt` so pip does not pull CPU-only PyPI wheels. Added `python-is-python3` for healthchecks that invoke `python`.

## [1.2.0] - 2026-04-13 — PicTur branding, US date fields, admin ZIP backup, favicon

### Added

- **Favicon & attribution**: Turtle favicon (`frontend/public/favicon.png`) with `rel="icon"` and `apple-touch-icon` in `index.html`; global footer with Freepik / Flaticon links and a link to the icon asset for compliance.
- **Admin offline backup (ZIP)**: `GET /api/admin/backup/archive` (`scope=all` or `scope=sheet&sheet=…`) returns a ZIP of `data/` plus Google Sheets CSV/JSON exports (admin-only, not staff). **Google Sheets Browser** adds “Offline backup (ZIP)” (full archive or current tab). Client: `downloadAdminBackupArchive`, `isAdminRole`.

### Changed

- **Branding & document title**: App and docs use **PicTur** (renamed from TurtleTracker / Turtle Project); npm packages `picturfrontend`, `pictur-auth-backend`; example paths `pictur`; GitHub repo [`Lxkasmehl/PicTur`](https://github.com/Lxkasmehl/PicTur). Default browser tab title **PicTur**.
- **Frontend dates**: Turtle date fields in Google Sheets forms (first found, last assay, dates refound, transmitter/radio/iButton, etc.) normalize to **MM/DD/YYYY** on load and before save; placeholders match. Photo card/modal timestamps use US date + 12-hour time (not `toLocaleString()`). Sheets browser titles for microhabitat/condition photos use US folder dates.

### Fixed

- **PhotoCard**: Removed unused `onPhotoClick` prop (ESLint).
- **Dates refound**: Space-separated refound dates (e.g. two ISO dates without commas) normalize every value to US format; previously only the first date was kept on load/save.

### Testing

- Playwright: `tests/e2e/us-date-format.spec.ts` — Turtle Match fields show **MM/DD/YYYY** when the mocked sheet API returns ISO date strings.

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

## [0.1.0] - 2026-02-27 — First release: community turtle ID and review workflow

### Added

- **Authentication**: User registration, login, and Google OAuth via auth backend (Node.js/Express). JWT-based sessions and role-based access (admin vs community).
- **Photo upload and matching**: Admins and community users can upload turtle photos; system returns top matches. Community uploads go to a review queue for admin approval.
- **Admin features**: Review queue for community uploads with suggested matches; admin can confirm match or create new turtle. Photo upload with immediate top-5 match selection.
- **Turtle records / data**: Turtle data management with optional Google Sheets integration (service account); auto-generated biology IDs and configurable fields.
- **Frontend**: React (TypeScript) app with Mantine UI, Tailwind, Leaflet maps; configured for auth and PicTur API backends.
- **Backend**: Flask API (Python) for photo processing and matching; auth backend for user and session management.
- **Deployment**: Docker Compose setup for frontend, auth-backend, and backend; persistent volumes for DB, uploads, and review state.
- **Testing**: Playwright E2E tests (Docker-based) and backend integration tests (pytest); CI workflows for main/develop.
- **Documentation**: README with quick start (Docker and local), functionality overview, and versioning guide in `docs/VERSION_AND_RELEASES.md`.
- Version control and release process: `CHANGELOG.md`, version in `frontend/package.json`, and guide in `docs/VERSION_AND_RELEASES.md`.

[Unreleased]: https://github.com/Lxkasmehl/PicTur/compare/v1.2.21...HEAD
[1.2.21]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.21
[1.2.20]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.20
[1.2.19]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.19
[1.2.18]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.18
[1.2.17]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.17
[1.2.16]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.16
[1.2.15]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.15
[1.2.14]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.14
[1.2.13]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.13
[1.2.12]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.12
[1.2.11]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.11
[1.2.10]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.10
[1.2.9]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.9
[1.2.8]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.8
[1.2.7]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.7
[1.2.6]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.6
[1.2.5]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.5
[1.2.4]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.4
[1.2.3]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.3
[1.2.2]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.2
[1.2.1]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.1
[1.2.0]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.2.0
[1.1.0]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.1.0
[1.0.0]: https://github.com/Lxkasmehl/PicTur/releases/tag/v1.0.0
[0.2.0]: https://github.com/Lxkasmehl/PicTur/releases/tag/v0.2.0
[0.1.0]: https://github.com/Lxkasmehl/PicTur/releases/tag/v0.1.0
