#!/usr/bin/env bash
set -euo pipefail

# Redeploy the ArcReserve frontend from your local machine.
#
# SSHes into the demo server and runs deploy.sh there, which pulls the repo and rebuilds+restarts
# only the frontend/ compose project -- contracts/ and backend/ in that checkout are untouched.
#
# Usage: ./frontend/deploy/remote-redeploy.sh
# Override target with: ARC_DEPLOY_HOST=user@host ARC_DEPLOY_PATH=~/other-path ./frontend/deploy/remote-redeploy.sh

REMOTE="${ARC_DEPLOY_HOST:-ubuntu@52.77.221.104}"
REMOTE_REPO="${ARC_DEPLOY_PATH:-~/arc-reserve}"

ssh "$REMOTE" "$REMOTE_REPO/frontend/deploy/deploy.sh"

echo "==> Done: https://arc-reserve.talentor.tech"
