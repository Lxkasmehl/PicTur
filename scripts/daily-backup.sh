#!/usr/bin/env bash
# Run Google Sheets export (CSV/JSON) and backend data/ (images) backup in one shot.
# Intended for cron at 03:00 server time. Logs should be redirected by cron (see docs/BACKUP.md).
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

echo "=== $(date -u -Iseconds) daily-backup: Sheets (CSV/JSON) ==="
$DOCKER compose exec -T backend python -m backup.run

echo "=== $(date -u -Iseconds) daily-backup: backend data/ (images) ==="
BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-$COMPOSE_DIR/backups}" \
  COMPOSE_DIR="$COMPOSE_DIR" \
  "$SCRIPT_DIR/backup-backend-data.sh"

echo "=== $(date -u -Iseconds) daily-backup: done ==="
