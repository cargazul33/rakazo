# Rakazo Agent Army — production runbook

Target: a single strong x86 VPS running Rakazo, PostgreSQL and Docker computers, exposed only through Cloudflare Tunnel.

## Recommended baseline

- Debian 12 or Ubuntu 24.04
- 16 vCPU / 32 GB RAM class VPS
- 300+ GB SSD/NVMe
- Docker
- Cloudflare Tunnel
- OpenRouter as model provider

The default production compose binds PostgreSQL, API and Web only to `127.0.0.1`. Public access is expected to come through Cloudflare Tunnel.

## First deployment

1. Create the VPS and log in as root.
2. Run the bootstrap script from this repository with the public hostname as its first argument.
3. Enter the OpenRouter key only when prompted. Never commit it.
4. Verify API and Web health locally.
5. Create or move a remotely managed Cloudflare Tunnel whose public hostname points to `http://127.0.0.1:5173`.
6. Run `install-cloudflare-tunnel.sh` and enter the tunnel token when prompted.
7. Open `https://<hostname>/central` and create the base agent army.

## Production defaults

- Docker sandbox provider
- persistent PostgreSQL volume
- persistent Rakazo data directory
- 30 minute sandbox command timeout
- per-turn tool fuse of 80 calls
- containers restart automatically after host reboot
- API/Web/PostgreSQL are not directly exposed to the Internet
- Team Computer mode is used by the Command Center to reduce browser/container consumption

## Operations

Use `health-check.sh` to inspect host RAM, disk, containers, API/Web health, Cloudflare status and recent worker errors.

Use `update-production.sh` to fast-forward `main`, rebuild images and restart the production stack. It refuses to update when the checkout contains local changes.

## Human approval boundary

The command center can research, download, analyze, calculate, audit and prepare documents. Signature, definitive tender submission, purchase authorization and payment remain human approval steps.

## Migration note

If an existing Rakazo installation contains credentials, native skills, agents or work that must be preserved, migrate its PostgreSQL database and data directory rather than copying only the repository. Keep `.env` secrets private during migration, particularly `ENCRYPTION_KEY`, authentication secrets and provider keys.
