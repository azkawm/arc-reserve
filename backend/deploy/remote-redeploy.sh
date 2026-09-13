#!/usr/bin/env bash
set -euo pipefail

# Run this FROM YOUR LAPTOP (git-bash / WSL / any POSIX shell with tar+scp+ssh) to ship the
# current local backend/ source to the demo host and redeploy it, without going through git.
#
# Why not git: as of 2026-09-13 the fixes this backend needs to work against the LIVE Hedera and
# Arc contracts (D-036/D-039 getter removal, the indexer completeness/backfill fixes, Arc chain
# support) are committed locally but not pushed to `origin/main` yet -- that push is a separate
# decision. This script packages the WORKING TREE directly instead of waiting on it. Once that
# work is pushed, switch to a git-pull-based deploy.sh (see frontend/deploy/deploy.sh for the
# pattern) and retire this script.
#
# What it does: tars backend/ (excluding node_modules, dist, coverage, build artifacts, and every
# real `.env*` file -- the server's own `.env.hedera`/`.env.arc` are provisioned once and must
# never be overwritten by a redeploy), scp's the tarball up, extracts it over ~/arc-reserve/backend
# on the server, then runs deploy.sh there.
#
# Usage (from the backend/ directory):
#   ./deploy/remote-redeploy.sh
# Override the target if needed:
#   ARC_DEPLOY_HOST=ubuntu@other-ip ARC_DEPLOY_KEY=~/.ssh/other-key ./deploy/remote-redeploy.sh

HOST="${ARC_DEPLOY_HOST:-ubuntu@52.77.221.104}"
KEY="${ARC_DEPLOY_KEY:-/c/Users/willi/heketon/hafid-aws}"
REMOTE_PATH="${ARC_DEPLOY_PATH:-~/arc-reserve/backend}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_TAR="$(mktemp -t arcreserve-backend-XXXXXX.tar.gz)"
trap 'rm -f "$TMP_TAR"' EXIT

echo "==> Packaging $BACKEND_DIR"
tar -C "$BACKEND_DIR" \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='coverage' \
  --exclude='*.tsbuildinfo' \
  --exclude='.env' \
  --exclude='.env.hedera' \
  --exclude='.env.arc' \
  -czf "$TMP_TAR" .

SIZE="$(du -h "$TMP_TAR" | cut -f1)"
echo "==> $SIZE tarball built"

echo "==> Copying to $HOST:/tmp/"
scp -i "$KEY" -o ConnectTimeout=15 "$TMP_TAR" "$HOST:/tmp/arcreserve-backend.tar.gz"

echo "==> Extracting on server and redeploying"
ssh -i "$KEY" -o ConnectTimeout=15 "$HOST" bash -s <<REMOTE
set -euo pipefail
mkdir -p $REMOTE_PATH
tar -C $REMOTE_PATH -xzf /tmp/arcreserve-backend.tar.gz
rm -f /tmp/arcreserve-backend.tar.gz
chmod +x $REMOTE_PATH/deploy/*.sh $REMOTE_PATH/docker-entrypoint.sh
$REMOTE_PATH/deploy/deploy.sh
REMOTE
