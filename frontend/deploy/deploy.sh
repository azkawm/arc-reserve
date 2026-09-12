#!/usr/bin/env bash
set -euo pipefail

# ArcReserve frontend deploy / redeploy.
#
# Runs ON THE SERVER. Safe to run for both the first deploy and every redeploy after: it always
# operates on the frontend/ directory next to this script (not the caller's $PWD), and
# `docker compose up -d` only recreates the container when the built image actually changed.
#
# Usage: ./deploy/deploy.sh
# Triggered remotely by ./deploy/remote-redeploy.sh (see docs/DEPLOY_FRONTEND.md).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$FRONTEND_DIR"

trap 'echo "==> Deploy failed. Recent container logs:"; docker compose logs --tail=80 frontend || true' ERR

echo "==> Deploying ArcReserve frontend from $FRONTEND_DIR"
git -C "$FRONTEND_DIR/.." rev-parse --short HEAD 2>/dev/null | sed 's/^/==> commit /' || true

echo "==> docker compose build"
docker compose build

echo "==> docker compose up -d --wait"
docker compose up -d --wait --wait-timeout 90 --remove-orphans

echo "==> Health check"
curl -fsS http://127.0.0.1:3000/healthz && echo

echo "==> Pruning dangling images"
docker image prune -f >/dev/null

echo "==> Container status:"
docker compose ps

echo "==> Done. Public URL (once the one-time nginx+certbot setup is done; see"
echo "    docs/DEPLOY_FRONTEND.md): https://arc-reserve.talentor.tech"
