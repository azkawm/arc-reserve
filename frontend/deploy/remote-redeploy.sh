#!/usr/bin/env bash
set -euo pipefail

# Redeploy the ArcReserve frontend from your local machine.
#
# SSHes into the demo server, fast-forwards the checkout there to origin/main, then runs
# deploy.sh scoped to frontend/ only -- it never touches contracts/ or backend/ on the server,
# and never force-pushes or resets: if the server's checkout has diverged (local commits or
# edits), `git merge --ff-only` refuses and this script stops instead of discarding them.
#
# Usage: ./frontend/deploy/remote-redeploy.sh
# Override target with: ARC_DEPLOY_HOST=user@host ARC_DEPLOY_PATH=~/other-path ./frontend/deploy/remote-redeploy.sh

REMOTE="${ARC_DEPLOY_HOST:-azka@202.10.42.3}"
REMOTE_REPO="${ARC_DEPLOY_PATH:-~/arc-reserve}"

echo "==> Pulling latest main on $REMOTE:$REMOTE_REPO"
ssh "$REMOTE" "cd $REMOTE_REPO && git fetch origin main && git merge --ff-only origin/main"

echo "==> Redeploying frontend"
ssh "$REMOTE" "cd $REMOTE_REPO/frontend && ./deploy/deploy.sh"

echo "==> Done: https://arc-reserve.talentor.tech"
