#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/control-plane"
DB_NAME="rakazo-agent-army"
R2_BUCKET="rakazo-agent-artifacts"
SECRETS_FILE="${HOME}/.rakazo-control-plane-secrets"
WRANGLER=(npx --yes wrangler@4.30.0)

for cmd in node npm npx jq sed openssl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done

cd "$APP_DIR"

echo "=== Cloudflare login ==="
"${WRANGLER[@]}" whoami >/dev/null 2>&1 || "${WRANGLER[@]}" login

echo "=== D1 ==="
if ! "${WRANGLER[@]}" d1 list --json | jq -e --arg name "$DB_NAME" '.[] | select(.name == $name)' >/dev/null; then
  "${WRANGLER[@]}" d1 create "$DB_NAME"
fi
DB_ID="$("${WRANGLER[@]}" d1 list --json | jq -r --arg name "$DB_NAME" '.[] | select(.name == $name) | (.uuid // .id // .database_id)' | head -1)"
if [[ -z "$DB_ID" || "$DB_ID" == "null" ]]; then
  echo "Could not resolve D1 database id." >&2
  exit 1
fi
sed -i -E "s/database_id = \"[^\"]+\"/database_id = \"${DB_ID}\"/" wrangler.toml

echo "=== R2 ==="
if ! "${WRANGLER[@]}" r2 bucket list 2>/dev/null | grep -q "$R2_BUCKET"; then
  "${WRANGLER[@]}" r2 bucket create "$R2_BUCKET"
fi

ADMIN_TOKEN="$(openssl rand -hex 32)"
WORKER_TOKEN="$(openssl rand -hex 32)"
umask 077
cat > "$SECRETS_FILE" <<EOF
ADMIN_TOKEN=${ADMIN_TOKEN}
WORKER_TOKEN=${WORKER_TOKEN}
EOF

printf '%s\n' "$ADMIN_TOKEN" | "${WRANGLER[@]}" secret put ADMIN_TOKEN >/dev/null
printf '%s\n' "$WORKER_TOKEN" | "${WRANGLER[@]}" secret put WORKER_TOKEN >/dev/null

echo "=== D1 migrations ==="
"${WRANGLER[@]}" d1 migrations apply "$DB_NAME" --remote

echo "=== Deploy ==="
"${WRANGLER[@]}" deploy

echo
echo "Control plane deployed."
echo "Secrets saved locally at: $SECRETS_FILE"
echo "Do not commit or share that file."
