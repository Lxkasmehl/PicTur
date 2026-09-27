#!/usr/bin/env bash
# Back up the database-backed research groups (everything except the main Sheets group):
#   - PostgreSQL dump   -> BACKUP_OUTPUT_DIR/orgs/YYYY-MM-DD/pictur.sql.gz
#   - photos (org_data) -> BACKUP_OUTPUT_DIR/orgs/YYYY-MM-DD/org_data/
# Folder name uses the host's local calendar date, or BACKUP_DATE if set.
#
# Usage (from repo root on the server):
#   COMPOSE_DIR=/srv/pictur/TurtleTracker ./scripts/backup-org-data.sh
#
# Restore (sketch):
#   gunzip -c pictur.sql.gz | docker compose exec -T postgres psql -U pictur -d pictur
#   docker compose cp org_data/. backend:/app/org_data
#
# Cron-friendly: no TTY; requires docker compose v2 and a running stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${BACKUP_OUTPUT_DIR:-$COMPOSE_DIR/backups}"
DATE_LABEL="${BACKUP_DATE:-$(date +%Y-%m-%d)}"
DEST="$BACKUP_ROOT/orgs/$DATE_LABEL"

cd "$COMPOSE_DIR"
mkdir -p "$DEST/org_data"

# pg_dump runs inside the postgres container (matching server version); --clean makes the dump
# restorable over an existing database.
docker compose exec -T postgres pg_dump -U pictur -d pictur --clean --if-exists | gzip > "$DEST/pictur.sql.gz"

docker compose exec -T backend tar -cf - -C /app/org_data . | tar -xf - -C "$DEST/org_data"

echo "backup-org-data: wrote $DEST"
