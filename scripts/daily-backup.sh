#!/usr/bin/env bash
# Run Google Sheets export (CSV/JSON), folder-name backfill, and backend data/
# (images) backup in one shot.
#
# Intended for cron at 02:00 server time. Logs should be redirected by cron
# (see docs/BACKUP.md).
#
# Sequence:
#   1. Export sheets to CSV/JSON         — current Sheets state is authoritative.
#   2. backfill_folder_names.py --apply  — rename / rehome on-disk turtle folders
#      to match what the Sheets just exported (Sheets are read-only here; only
#      disk gets touched). Picks up bio-ID changes (e.g. misgender corrections).
#   3. Data backup                       — captures the post-backfill disk state
#      so the snapshot is internally consistent with the Sheets snapshot.
#   4. Restart backend ONLY if the backfill actually applied changes (exit 2).
#      Necessary because the running VRAM cache holds .pt paths that just got
#      renamed; restart triggers refresh_database_index.
#
# Usage:
#   COMPOSE_DIR=/absolute/path/to/TurtleTracker /path/to/scripts/daily-backup.sh
#
# Environment:
#   COMPOSE_DIR  – directory containing docker-compose.yml (default: parent of scripts/)
#   DOCKER       – docker binary (default: docker)
#   BACKUP_OUTPUT_DIR – passed implicitly: host path must match compose bind mount for ./backups

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DOCKER="${DOCKER:-docker}"

cd "$COMPOSE_DIR"

# One calendar date for both Sheets export and data/ copy (host TZ when run from cron on the server).
BACKUP_DATE="$(date +%Y-%m-%d)"
export BACKUP_DATE

echo "=== $(date -Iseconds) daily-backup: Sheets (CSV/JSON) ==="
$DOCKER compose exec -T -e "BACKUP_DATE=$BACKUP_DATE" backend python -m backup.run

echo "=== $(date -Iseconds) daily-backup: folder-name backfill (gender/bio-id sync) ==="
# Disable -e while we capture the exit code: 0 = no changes, 1 = errors, 2 = changes applied.
set +e
$DOCKER compose exec -T backend python backfill_folder_names.py --apply
backfill_code=$?
set -e
if [ "$backfill_code" -eq 1 ]; then
  echo "Backfill reported errors; continuing with data backup so the day is not lost." >&2
fi

echo "=== $(date -Iseconds) daily-backup: backend data/ (images) ==="
BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-$COMPOSE_DIR/backups}" \
  COMPOSE_DIR="$COMPOSE_DIR" \
  bash "$SCRIPT_DIR/backup-backend-data.sh"

if [ "$backfill_code" -eq 2 ]; then
  echo "=== $(date -Iseconds) daily-backup: backfill applied changes — restarting backend ==="
  $DOCKER compose restart backend
fi

echo "=== $(date -Iseconds) daily-backup: done ==="
