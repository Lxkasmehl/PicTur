#!/usr/bin/env bash
# Copy backend turtle images and folder tree from Docker (/app/data) to the host backup tree.
# Writes to: BACKUP_OUTPUT_DIR/data/YYYY-MM-DD/ (same root as Google Sheets CSV/JSON backups).
#
# Usage (from repo root on the server):
#   COMPOSE_DIR=/srv/pictur/TurtleTracker ./scripts/backup-backend-data.sh
# Or rely on default: script lives in scripts/, repo root is one level up.
#
# Cron-friendly: no TTY; requires docker compose v2 and a reachable Docker daemon.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${BACKUP_OUTPUT_DIR:-$COMPOSE_DIR/backups}"
DATE_UTC="${BACKUP_DATE:-$(date -u +%Y-%m-%d)}"
DEST="$BACKUP_ROOT/data/$DATE_UTC"

cd "$COMPOSE_DIR"

mkdir -p "$DEST"

backend_data_volume() {
  local cid
  cid="$(docker compose ps -aq backend 2>/dev/null | head -1 || true)"
  if [[ -z "$cid" ]]; then
    return 1
  fi
  docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}'
}

copy_via_exec() {
  docker compose exec -T backend tar -cf - -C /app/data . | tar -xf - -C "$DEST"
}

copy_via_volume() {
  local vol="$1"
  docker run --rm -v "$vol:/source:ro" alpine:3.20 tar -cf - -C /source . | tar -xf - -C "$DEST"
}

if docker compose exec -T backend true 2>/dev/null; then
  copy_via_exec
else
  vol="${BACKEND_DATA_VOLUME:-}"
  if [[ -z "$vol" ]]; then
    vol="$(backend_data_volume || true)"
  fi
  if [[ -z "$vol" ]]; then
    vol="$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)backend-data$' | head -1 || true)"
  fi
  if [[ -z "$vol" ]]; then
    echo "backup-backend-data: backend container is not running and no backend-data volume found." >&2
    echo "Start the stack (docker compose up -d) or create the volume by running the backend once." >&2
    exit 1
  fi
  echo "backup-backend-data: backend not exec-able; copying from volume $vol" >&2
  copy_via_volume "$vol"
fi

echo "backup-backend-data: wrote $DEST"
