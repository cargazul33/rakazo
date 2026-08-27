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

echo "=== HOST ==="
printf 'Load: '; uptime | sed 's/.*load average: //'
free -h
df -h /
echo
echo "=== STACK ==="
compose --env-file .env -f infra/production/docker-compose.agent-army.yml ps
echo
echo "=== COMPUTER CONTAINERS ==="
docker ps --format '{{.Names}}' | grep -E '^rakazo-computer-|computer' | wc -l | awk '{print "active=" $1}'
echo
echo "=== API ==="
curl -fsS http://127.0.0.1:3100/health || true
echo
echo
echo "=== WEB ==="
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5173/ || true
echo
echo "=== CLOUDFLARE ==="
docker ps --filter name=rakazo-cloudflared --format '{{.Names}} {{.Status}}' || true
echo
echo "=== RECENT WORKER ERRORS ==="
compose --env-file .env -f infra/production/docker-compose.agent-army.yml logs --since=15m worker 2>&1 | grep -Ei 'error|failed|timeout|429|signal|oom|killed' | tail -40 || true
