#!/usr/bin/env bash
set -euo pipefail

export WEB_PORT="${PORT:-${WEB_PORT:-8080}}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:3100}"
export DATA_DIR="${DATA_DIR:-/tmp/rakazo-data}"
export SANDBOX_PROVIDER="${SANDBOX_PROVIDER:-desktop}"
export AGENT_RUNTIME="${AGENT_RUNTIME:-pi}"
export WAKEUP_DRIVER="${WAKEUP_DRIVER:-graphile}"
export RAKAZO_HOST="${RAKAZO_HOST:-.b4a.run}"

mkdir -p "$DATA_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  echo "BETTER_AUTH_SECRET is required"
  exit 1
fi

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  echo "ENCRYPTION_KEY is required"
  exit 1
fi

pnpm --filter @rakazo/db exec prisma migrate deploy

pnpm --filter @rakazo/api start &
API_PID=$!

pnpm --filter @rakazo/worker start &
WORKER_PID=$!

cleanup() {
  kill "$API_PID" "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2

exec pnpm --filter @rakazo/web preview --host 0.0.0.0 --port "$WEB_PORT"
