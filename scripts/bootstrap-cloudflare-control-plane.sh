#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/control-plane"
DB_NAME="rakazo-agent-army"
R2_BUCKET="rakazo-agent-artifacts"
SECRETS_FILE="${HOME}/.rakazo-control-plane-secrets"

for cmd in node npm jq sed; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done

cd "$ROOT_DIR"
corepack enable >/dev/null 2>&1 || true
corepack pnpm install --filter @rakazo/control-plane...
cd "$APP_DIR"

echo "=== Cloudflare login ==="
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo "=== D1 ==="
if ! npx wrangler d1 list --json | jq -e --arg name "$DB_NAME" '.[] | select(.name == $name)' >/dev/null; then
  npx wrangler d1 create "$DB_NAME"
fi
DB_ID="$(npx wrangler d1 list --json | jq -r --arg name "$DB_NAME" '.[] | select(.name == $name) | (.uuid // .id // .database_id)' | head -1)"
if [[ -z "$DB_ID" || "$DB_ID" == "null" ]]; then
  echo "Could not resolve D1 database id." >&2
  exit 1
fi
sed -i -E "s/database_id = \"[^\"]+\"/database_id = \"${DB_ID}\"/" wrangler.toml

echo "=== R2 ==="
if ! npx wrangler r2 bucket list 2>/dev/null | grep -q "$R2_BUCKET"; then
  npx wrangler r2 bucket create "$R2_BUCKET"
fi

ADMIN_TOKEN="$(openssl rand -hex 32)"
WORKER_TOKEN="$(openssl rand -hex 32)"
umask 077
cat > "$SECRETS_FILE" <<EOF
ADMIN_TOKEN=${ADMIN_TOKEN}
WORKER_TOKEN=${WORKER_TOKEN}
EOF

echo "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN >/dev/null
echo "$WORKER_TOKEN" | npx wrangler secret put WORKER_TOKEN >/dev/null

echo "=== D1 migrations ==="
npx wrangler d1 migrations apply "$DB_NAME" --remote

echo "=== Deploy ==="
npx wrangler deploy

echo
echo "Control plane deployed."
echo "Secrets saved locally at: $SECRETS_FILE"
echo "Do not commit or share that file."
