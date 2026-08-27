#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/srv/rakazo}"
REPO_URL="${REPO_URL:-https://github.com/cargazul33/rakazo.git}"
DOMAIN="${1:-rakazo.licitaradarpro.com}"
MODEL="${PI_DEFAULT_MODEL:-nvidia/nemotron-3-ultra-550b-a55b:free}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates openssl jq docker.io
if ! apt-get install -y docker-compose-plugin; then
  apt-get install -y docker-compose
fi
systemctl enable --now docker

if [[ ! -d "${APP_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch origin main
  git -C "${APP_DIR}" checkout main
  git -C "${APP_DIR}" pull --ff-only origin main
fi

cd "${APP_DIR}"
mkdir -p data

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "OpenRouter API key: " OPENROUTER_API_KEY
    echo
  else
    echo "Set OPENROUTER_API_KEY before running this script." >&2
    exit 1
  fi
fi

POSTGRES_PASSWORD="$(openssl rand -hex 24)"
BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
SANDBOX_SUPERVISOR_TOKEN="$(openssl rand -hex 32)"

if [[ -f .env ]]; then
  cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
fi

cat > .env <<EOF
NODE_ENV=production
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgres://rakazo:${POSTGRES_PASSWORD}@postgres:5432/rakazo
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=https://${DOMAIN}
API_URL=https://${DOMAIN}
WEB_ORIGIN=https://${DOMAIN}
RAKAZO_HOST=${DOMAIN}
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=
ENCRYPTION_KEY=${ENCRYPTION_KEY}
DATA_DIR=./data
SANDBOX_PROVIDER=docker
SANDBOX_SUPERVISOR_URL=http://supervisor:7091
SANDBOX_SUPERVISOR_TOKEN=${SANDBOX_SUPERVISOR_TOKEN}
SANDBOX_IDLE_MS=600000
SANDBOX_COMMAND_TIMEOUT_MS=1800000
MAX_TOOL_CALLS_PER_TURN=80
AGENT_RUNTIME=pi
WAKEUP_DRIVER=graphile
PI_DEFAULT_PROVIDER=openrouter
PI_DEFAULT_MODEL=${MODEL}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
RAKAZO_LOCAL_MODELS=
RAKAZO_LOCAL_MODELS_URL=http://127.0.0.1:11434/v1
RAKAZO_LOCAL_CONTEXT_WINDOW=32768
RAKAZO_LOCAL_MAX_TOKENS=4096
LOG_LEVEL=info
EOF
chmod 600 .env

# Build the reusable browser/computer image once, then start the production stack.
docker build -t rakazo/computer:local infra/sandboxes/computer
compose --env-file .env -f infra/production/docker-compose.agent-army.yml up -d --build

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo
echo "=== RAKAZO PRODUCTION ==="
compose --env-file .env -f infra/production/docker-compose.agent-army.yml ps
echo
echo "=== API HEALTH ==="
curl -fsS http://127.0.0.1:3100/health || true
echo
echo
echo "=== WEB ==="
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5173/ || true
echo
echo "Server bootstrap complete. Next: attach Cloudflare Tunnel to http://127.0.0.1:5173."
