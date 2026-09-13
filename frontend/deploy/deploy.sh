#!/usr/bin/env bash
set -euo pipefail

# ArcReserve frontend deploy / redeploy.
#
# Runs ON THE SERVER. Self-contained: pulls the repo, then rebuilds and restarts only the
# frontend/ compose project -- contracts/ and backend/ in the same checkout are untouched. Safe
# to run directly for the first deploy and every redeploy after (also triggered remotely by
# ./remote-redeploy.sh -- see docs/DEPLOY_FRONTEND.md).
#
# Usage: ./deploy/deploy.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$FRONTEND_DIR")"

echo "==> git pull in $REPO_DIR"
git -C "$REPO_DIR" pull

cd "$FRONTEND_DIR"
echo "==> Redeploying frontend from $FRONTEND_DIR (commit $(git -C "$REPO_DIR" rev-parse --short HEAD))"

docker compose down
docker compose up -d --build --remove-orphans

echo "==> Container status:"
docker compose ps

echo "==> Done. Public URL (once the one-time nginx+certbot setup is done; see"
echo "    docs/DEPLOY_FRONTEND.md): https://arc-reserve.talentor.tech"
