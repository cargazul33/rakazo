#!/usr/bin/env bash
set -euo pipefail

export API_PORT="${PORT:-${API_PORT:-8080}}"
export DATA_DIR="${DATA_DIR:-/tmp/rakazo-data}"
export SANDBOX_PROVIDER="${SANDBOX_PROVIDER:-desktop}"
export AGENT_RUNTIME="${AGENT_RUNTIME:-pi}"
export WAKEUP_DRIVER="${WAKEUP_DRIVER:-memory}"
export SIGNUPS_ENABLED="${SIGNUPS_ENABLED:-true}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=160}"

mkdir -p "$DATA_DIR"

required=(DATABASE_URL BETTER_AUTH_SECRET ENCRYPTION_KEY SIGNUP_ALLOWLIST)
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    echo "$key is required"
    exit 1
  fi
done

pnpm --filter @rakazo/db exec prisma migrate deploy

# Prebundled at image-build time: avoids the runtime memory cost of tsx.
exec node dist/back4app.mjs
