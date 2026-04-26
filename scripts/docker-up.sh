#!/usr/bin/env bash
set -euo pipefail

cpu_only=false
if [[ "${1:-}" == "--cpu-only" ]]; then
  cpu_only=true
fi

start_cpu() {
  echo "Starting PicTur in CPU mode..."
  docker compose -f docker-compose.yml up --build
}

if [[ "$cpu_only" == "true" ]]; then
  start_cpu
  exit $?
fi

if ! docker_info="$(docker info 2>/dev/null)"; then
  echo "Could not read Docker info. Falling back to CPU mode..."
  start_cpu
  exit $?
fi

if ! grep -qi "nvidia" <<<"$docker_info"; then
  echo "NVIDIA runtime not detected. Falling back to CPU mode..."
  start_cpu
  exit $?
fi

echo "NVIDIA runtime detected. Starting PicTur in GPU mode..."
if docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build; then
  exit 0
fi

echo "GPU compose startup failed. Retrying in CPU mode..."
start_cpu
