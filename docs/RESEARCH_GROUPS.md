# Research groups (multi-tenancy)

PicTur can host several independent research groups on the same server and code base. **Every group
uses exactly the same pages, workflow and turtle columns** as the original group (PicTur Research);
only the storage behind them differs.

| | Main group (original) | Additional groups |
| --- | --- | --- |
| Turtle records | Google Sheets (research + community spreadsheet) | PicTur database (PostgreSQL), same tabs and the same 40 columns |
| Photos / folders | `backend/data/` | `ORG_DATA_DIR/<org_id>/data/` (same folder layout) |
| Photo type | plastron (+ carapace) | carapace |
| Roles | account role (`users.role`) | per-group membership (staff / admin) |
| Locations | Locations page (seeded programs) | Locations page (starts empty; the group defines its own tabs + General Locations) |

The groups are fully isolated from each other and from the main group: records, photos, matching
caches, locations catalog and permissions are all per group. Nothing about the main group changes.

## Roles

- **Super admin** (platform level): creates research groups and assigns their first admin, and acts as
  admin in every group. Grant with `SUPER_ADMIN_EMAILS=a@x.org,b@y.org` (applied on start) or
  `npm run set-super-admin -- you@example.org` in `auth-backend/` (the account must exist).
  Being admin of the main group does **not** make someone a super admin.
- **Group admin / staff**: the same rights as admin / staff in the main group, but only inside their group.
  "User Management" shows the group's members (invite by email, change role, remove) and whether
  the group accepts community uploads.
- **Community / visitors**: pick a group that accepts community uploads in the group picker on the
  upload page and send photos (with or without an account), exactly like for the main group.

A user can belong to several groups; the group switcher (header, upload page) changes the active
group and reloads every page for it. Roles are resolved live from the auth backend on every request
(never from the JWT), so membership changes apply immediately.

## Getting a group started

1. Super admin: **Research Groups** (`/platform/groups`) → create the group (name, URL name, first admin email).
2. The admin receives an email (existing accounts are added directly; new addresses get an invitation
   link to `/accept-invite`, which creates the account with a verified email).
3. In the group: create the first tab (e.g. a state or program) in the "Create New Turtle" form or the
   Sheets browser, and General Locations on the **Locations** page — the same as in the main group.
4. From then on: upload → match page → confirm a match or "Create New Turtle", review queue, turtle
   records, release — all the familiar pages.

## How it works

- **Request context** (`backend/tenant.py`): the frontend sends `X-Org-Slug` with every Flask request
  (`services/api/orgContext.ts` wraps `fetch`; image and download URLs carry `?org=`). A
  `before_request` hook resolves the group and the user's role in it and stores them in a ContextVar.
  Without the header (or for `main`) nothing is set and the main group runs exactly as before.
  Background threads must use `tenant.spawn` to keep the group.
- **Per-group services** (`backend/services/manager_service.py`): `manager`, `manager_ready`,
  `get_sheets_service()`, `get_community_sheets_service()` and `call_sheets_with_retry` return the
  active group's instances — a `TurtleManager` on the group's data dir with its own matching caches
  (`BrainView`, sharing the SuperPoint/LightGlue models), and database-backed Sheets services.
- **Sheets in the database** (`backend/orgs/sheets_store.py`): `DbSheetsApi` implements precisely the
  Google Sheets v4 calls the app makes (values get/update/batchUpdate, addSheet, insert/deleteDimension)
  with Google's semantics. All existing Sheets code (`sheets/*.py`, `GoogleSheetsService`) therefore
  runs unchanged for research groups. Tables: `sheet_tabs`, `sheet_rows` (Alembic migrations run on start).
- **Roles** (`backend/auth.py`): the existing decorators replace the JWT `role` with the role in the
  active group. Backup download tokens are bound to their group.
- **Frontend**: `store/slices/orgSlice.ts`, `hooks/useActiveOrg.ts` (role in the active group; pages
  wait for `ready`), `components/OrgSwitcher.tsx`, `pages/PlatformGroupsPage.tsx`,
  `pages/AcceptInvitePage.tsx`, `pages/OrgMembersPage.tsx`.

## Operations

- Docker Compose runs `postgres:16-alpine` (volume `pg-data`); group photos live in volume `org-data`
  (`/app/org_data`). Set `POSTGRES_PASSWORD` in `.env` for production. Without `DATABASE_URL` (local
  `python app.py`) a SQLite file under `ORG_DATA_DIR` is used, so groups work out of the box.
- Reverse proxy: `/api/orgs` goes to the auth backend, everything else under `/api` to Flask (see `.env.docker.example`).
- Backups: `scripts/daily-backup.sh` also runs `scripts/backup-org-data.sh` (`pg_dump` + `org_data` copy
  into `backups/orgs/YYYY-MM-DD/`), see [BACKUP.md](BACKUP.md). The admin "Offline backup (ZIP)" works per group.
- Tests: `python -m pytest tests/test_org_sheets_store.py tests/test_tenant_routing.py` (SQLite; set
  `ORGS_TEST_DATABASE_URL` for PostgreSQL), `tests/integration/test_orgs_routes.py`, Playwright
  `tests/e2e/research-groups.spec.ts`.
