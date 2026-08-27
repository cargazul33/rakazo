#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Cloudflare Tunnel token: " CLOUDFLARE_TUNNEL_TOKEN
    echo
  else
    echo "Set CLOUDFLARE_TUNNEL_TOKEN before running this script." >&2
    exit 1
  fi
fi

docker rm -f rakazo-cloudflared >/dev/null 2>&1 || true

docker run -d \
  --name rakazo-cloudflared \
  --restart unless-stopped \
  --network host \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token "${CLOUDFLARE_TUNNEL_TOKEN}"

sleep 5

echo "=== CLOUDFLARED ==="
docker ps --filter name=rakazo-cloudflared --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo
echo "The Cloudflare public hostname should point to http://127.0.0.1:5173."
