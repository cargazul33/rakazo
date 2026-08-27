#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/rakazo}"
cd "${APP_DIR}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Repository has local changes; refusing to update." >&2
  exit 1
fi

git fetch origin main
git checkout main
git pull --ff-only origin main

docker build -t rakazo/computer:local infra/sandboxes/computer
compose --env-file .env -f infra/production/docker-compose.agent-army.yml up -d --build

sleep 5
bash infra/production/health-check.sh
