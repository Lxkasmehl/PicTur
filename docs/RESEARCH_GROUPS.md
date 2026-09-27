# Research groups (multi-tenancy)

PicTur can host several independent research groups on the same server and code base.

| | Main group (original) | Additional groups |
| --- | --- | --- |
| Data | Google Sheets + `backend/data/` folders | PostgreSQL + `ORG_DATA_DIR/<org_id>/` |
| Photos | plastron + carapace | carapace only |
| Roles | `users.role` (community / staff / admin) | per-group membership (staff / admin) |
| API | classic routes (`/api/upload`, `/api/sheets/...`, ...) | `/api/v2/orgs/<slug>/...` |
| UI | existing pages | `/g/<slug>/...` |

Nothing about the main group changes: its users, roles, Sheets, folders and matching cache work
exactly as before. The groups are fully isolated from each other and from the main group
(database rows, photo storage, matching cache and API authorization are all scoped per group).

## Roles

- **Super admin** (platform level): creates research groups and assigns their first admin, and acts as
  admin in every group. Grant with `SUPER_ADMIN_EMAILS=a@x.org,b@y.org` (applied on start) or
  `npm run set-super-admin -- you@example.org` in `auth-backend/` (the account must exist).
  Being admin of the main group does **not** make someone a super admin.
- **Group admin**: manages the group's members (invite by email, change role, remove), regions and
  whether the group accepts community uploads; can delete turtles.
- **Group staff**: uploads and matches carapace photos, reviews submissions, edits turtle records.
- **Community / visitors**: pick a group that accepts community uploads on the upload page and send
  photos (with or without an account). Logged-in uploaders see the review status of their photos.

A user can belong to several groups; the header shows a group switcher when there is more than one
group to choose from. The role in each group is resolved live from the auth backend on every
request (never from the JWT), so membership changes apply immediately.

## Workflow in a group

1. Super admin: **Research Groups** page (`/platform/groups`) → create group (name, URL name, first admin email).
2. The admin receives an email (existing accounts are added directly; new addresses get an
   invitation link to `/accept-invite`, which creates the account with a verified email).
3. Admin: **Regions** (e.g. state → study sites) and **Members**.
4. Staff: **Home** → upload a carapace photo → review page with the best candidates →
   *This is the turtle* (adds a sighting, optionally makes the photo the new reference) or
   *Create new turtle* (gets the next biology ID: `F1`, `M1`, `U1`, ...) or *Reject*.
5. Community uploads land in the **Review Queue** (matched in the background) and are resolved the same way.

## Architecture

- **auth-backend**: `organizations`, `org_memberships`, `org_invitations`, `users.is_super_admin`
  (SQLite, migration in `src/db/database.ts`, logic in `src/db/orgsRepo.ts`, routes in
  `src/routes/orgs.ts`). `/api/auth/validate` returns the memberships (and, with `?org=<slug>`,
  the group's descriptor) — this is what Flask uses for authorization.
- **backend**: package `orgs/` — `db.py` (engine; Alembic migrations run on start),
  `models.py` (regions, turtles, sightings, images, submissions — every row carries `org_id`),
  `tenancy.py` (`org_route` decorator: the only place group authorization happens; `org_query`
  forces the group filter), `storage.py`, `media.py` (per-file signed image URLs), `matching.py`
  (per-group reference cache in `TurtleDeepMatcher.org_caches`), `service.py`.
  Routes: `routes/orgs_api.py`.
- **frontend**: `store/slices/orgSlice.ts`, `hooks/useActiveOrg.ts`, `components/OrgSwitcher.tsx`,
  pages in `pages/org/`, `pages/PlatformGroupsPage.tsx`, `pages/AcceptInvitePage.tsx`.

Without `DATABASE_URL` the backend still starts and serves the main group; the group API answers 503.

## Operations

- Docker Compose runs `postgres:16-alpine` (volume `pg-data`); photos live in volume `org-data`
  (`/app/org_data`). Set `POSTGRES_PASSWORD` in `.env` for production.
- Reverse proxy: `/api/orgs` goes to the auth backend, `/api/v2/orgs` to Flask (see `.env.docker.example`).
- Backups: `scripts/daily-backup.sh` also runs `scripts/backup-org-data.sh`
  (`pg_dump` + `org_data` copy into `backups/orgs/YYYY-MM-DD/`), see [BACKUP.md](BACKUP.md).
- Tests: `python -m pytest tests/test_orgs_api.py` (SQLite; set `ORGS_TEST_DATABASE_URL` to run against
  PostgreSQL), `tests/integration/test_orgs_routes.py`, Playwright `tests/e2e/research-groups.spec.ts`.
