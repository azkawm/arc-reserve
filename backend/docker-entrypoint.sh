#!/bin/sh
# ArcReserve backend container entrypoint.
#
# node-pg-migrate's `migrate` script is written for local dev and reads its connection from a
# `.env` file via `--envPath .env` (see package.json). In a container, config arrives as real
# environment variables instead (docker-compose.deploy.yml's env_file), so this writes a minimal
# .env containing only DATABASE_URL -- just enough for that one script to find it -- rather than
# changing the script's invocation. Nothing else goes in that file; every other setting is read
# straight from process.env by the app itself.
#
# Multiple backend containers share ONE database (D-030: one row set, chain_id on every table),
# and both can start at once (a fresh `docker compose up`, a host reboot). node-pg-migrate takes
# an advisory lock for the run, but a SECOND runner does not wait for it -- it fails outright
# ("Another migration is already running") rather than blocking. Verified 2026-09-13: exactly
# this happened on first deploy and only self-healed because `restart: unless-stopped` happened
# to retry after the other container's migration had already finished -- a lucky timing, not a
# real guarantee. Retry with a short backoff instead of relying on that.
set -eu

echo "DATABASE_URL=${DATABASE_URL}" > .env
echo "==> running migrations"
attempt=1
until npm run migrate; do
  if [ "$attempt" -ge 10 ]; then
    echo "==> migrations still failing after $attempt attempts, giving up" >&2
    rm -f .env
    exit 1
  fi
  echo "==> migration attempt $attempt failed (likely lock contention with another container starting at the same time), retrying in 3s"
  attempt=$((attempt + 1))
  sleep 3
done
rm -f .env

echo "==> starting: $*"
exec "$@"
