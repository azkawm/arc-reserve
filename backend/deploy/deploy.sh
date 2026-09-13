#!/usr/bin/env bash
set -euo pipefail

# Runs ON THE SERVER, from an already-updated ~/arc-reserve/backend checkout.
#
# Unlike frontend/deploy/deploy.sh, this does NOT `git pull` -- as of 2026-09-13 the backend
# source on this host arrives via `remote-redeploy.sh` (tar + scp from a laptop checkout), not
# from `origin/main`. origin/main's backend still calls three AssetMarketManager getters
# (twapWindow, maxSpotTwapDeviationBps, maxMarketNAVDeviationBps) that D-036/D-039 removed from
# the LIVE Hedera and Arc contracts -- every /v1/assets read would revert against a `git pull`
# checkout. Switch this script back to a `git pull` once that backend work is committed and
# pushed; until then, source lands here some other way and this script only rebuilds/restarts.
#
# Usage (from ~/arc-reserve/backend on the server):
#   ./deploy/deploy.sh

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for f in .env.hedera .env.arc; do
  [[ -f "$f" ]] || {
    echo "Missing $f -- copy it from ${f}.template and fill in real values first." >&2
    exit 1
  }
done

echo "==> docker compose down (brief downtime while containers rebuild)"
docker compose -f docker-compose.deploy.yml down

echo "==> docker compose up -d --build"
docker compose -f docker-compose.deploy.yml up -d --build --remove-orphans

echo "==> Status"
docker compose -f docker-compose.deploy.yml ps

echo "==> Health (api / Hedera 296, public)"
curl -sS -m 10 http://127.0.0.1:4000/v1/health | head -c 2000 || echo "  (not answering yet -- give it a few seconds, migrations run on every start)"
echo
echo "==> Health (arc-indexer / Arc 5042002, host-loopback only)"
curl -sS -m 10 http://127.0.0.1:4001/v1/health | head -c 2000 || echo "  (not answering yet)"
echo
