#!/usr/bin/env bash
set -euo pipefail

export API_PORT="${PORT:-${API_PORT:-8080}}"
export DATA_DIR="${DATA_DIR:-/tmp/rakazo-data}"
export SANDBOX_PROVIDER="${SANDBOX_PROVIDER:-desktop}"
export AGENT_RUNTIME="${AGENT_RUNTIME:-pi}"
export WAKEUP_DRIVER="${WAKEUP_DRIVER:-memory}"
export SIGNUPS_ENABLED="${SIGNUPS_ENABLED:-true}"
# Keep the single Node process inside Back4App Free's 256 MB RAM budget.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=160}"

mkdir -p "$DATA_DIR"

required=(DATABASE_URL BETTER_AUTH_SECRET ENCRYPTION_KEY SIGNUP_ALLOWLIST)
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    echo "$key is required"
    exit 1
  fi
done

# Linux containers can use Prisma's normal migration engine (unlike Android/Termux).
pnpm --filter @rakazo/db exec prisma migrate deploy

# One process serves API + SPA and runs the in-memory job worker. This avoids
# three simultaneous Node runtimes on the 256 MB free container.
exec pnpm --filter @rakazo/api exec tsx src/back4app.ts
