# Deploying the backend (demo host)

Hackathon demo deployment, not a production release process. This deploys the ArcReserve backend
(indexer + `/v1` read API) in `backend/` to the same single VPS as the frontend, behind host nginx
with a Let's Encrypt certificate, on its own subdomain.

**Target:** `ubuntu@52.77.221.104`, repo checked out at `~/arc-reserve`, intended public domain
`https://arc-reserve-backend.talentor.tech`.

## Why this deploy does not `git pull` (read this before changing deploy.sh)

`frontend/deploy/deploy.sh` starts with `git pull`. This backend's `deploy.sh` deliberately does
**not**, and `remote-redeploy.sh` ships the local working tree via `tar` + `scp` instead. As of
2026-09-13, `origin/main`'s `backend/` predates D-036 and D-039: it still calls three
`AssetMarketManager` getters (`twapWindow`, `maxSpotTwapDeviationBps`, `maxMarketNAVDeviationBps`)
that no longer exist on the LIVE Hedera and Arc contracts. A `git pull`-based deploy would build a
backend whose every `/v1/assets` read reverts. `origin/main`'s `config.ts` also has no entry for
Arc testnet (5042002) at all.

**Once the local backend fixes are committed and pushed**, switch `deploy.sh` back to the
`git pull` pattern (copy `frontend/deploy/deploy.sh`) and retire `remote-redeploy.sh`. Until then,
redeploying means running `remote-redeploy.sh` from a checkout that has the working fixes, not
just pushing to GitHub and pulling.

## Architecture

```text
Browser --https--> host nginx (443, Let's Encrypt) --http--> 127.0.0.1:4000 --> `api` container
                     also: 80 -> 301 redirect to https         (indexes Hedera 296; ALSO holds an
                                                                  RPC for Arc 5042002 so it can
                                                                  serve LIVE reads for Arc without
                                                                  indexing its events -- Boundary C)

                                                              `arc-indexer` container
                                                                (indexes Arc 5042002 into the SAME
                                                                 database; no public port -- nginx
                                                                 never points at it; reachable only
                                                                 as 127.0.0.1:4001 on the host, for
                                                                 debugging)

                                                              `postgres` (D-030: one shared database,
                                                                internal compose network only, not
                                                                published to the host at all)
```

This mirrors the two-process pattern used during local development tonight: one process is the
public API and also answers live reads for a chain it does not index (`RPC_HTTP_URL_<chainId>`,
Boundary C in `docs/stacks/CONTRACTS_TO_BACKEND.md`); a second process's only job is indexing that
other chain's events into the shared database.

Base Sepolia (84532) is parked (owner decision, 2026-09-12) and not deployed here. Anvil (31337)
is a local dev chain and has no place on this host.

## Prerequisites (confirmed on this host, 2026-09-13)

- Docker 29.6.0 + Compose v5.2.0 plugin; `ubuntu` is in the `docker` group (no `sudo` needed for
  `docker`/`docker compose`).
- `nginx` 1.24.0 and `certbot` (nginx plugin) are installed; `sudo` is passwordless on this host,
  so both `setup-nginx-tls.sh` and `deploy.sh` run fine over a non-interactive SSH session (unlike
  the frontend doc's caveat about needing a real terminal -- confirmed not to apply here). One
  caveat on the certbot step specifically: `certbot --nginx -d <domain>` with no
  `--non-interactive`/`--agree-tos`/`--email` flags WOULD prompt for an email and ToS agreement on
  a certbot account's first-ever use on a host, which a plain SSH one-liner can't answer. That
  does not apply here -- `sudo certbot certificates` confirms an account already exists (it issued
  and holds `arc-reserve.talentor.tech`'s certificate), and certbot reuses the existing account for
  a second domain rather than re-registering. Re-verify with `sudo certbot certificates` before
  assuming this holds on a different host, or if this account is ever deleted.
- `~/arc-reserve` exists, cloned from `github.com/azkawm/arc-reserve`. Its `origin` remote URL
  contains a GitHub personal access token in plain text (`git remote -v` on the host will show
  it) -- be careful not to paste that output anywhere it could leak further; rotating it is a
  housekeeping item, not urgent for the demo.
- Disk: 31GB free of 38GB at last check. Ports 4000, 4001, 5450 and 5432 were free before this
  deploy claimed 4000/4001 (5432 stays internal to the compose network, never published).
- **DNS for `arc-reserve-backend.talentor.tech` does NOT resolve yet** (checked 2026-09-13) --
  this is the one step that needs action outside this repo: add an A record pointing it at
  `52.77.221.104`, the same IP `arc-reserve.talentor.tech` already uses. Nobody running these
  scripts can do this themselves; it needs whoever controls the `talentor.tech` DNS zone.

## First deploy / every redeploy

From the `backend/` directory on your own machine (not the server):

```bash
./deploy/remote-redeploy.sh
```

Override the target if needed:
`ARC_DEPLOY_HOST=user@host ARC_DEPLOY_KEY=/path/to/key ./deploy/remote-redeploy.sh`

What it does: tars `backend/` (excluding `node_modules`, `dist`, `coverage`, and every real
`.env*` file -- see below), copies it to the server, extracts it over `~/arc-reserve/backend`,
then runs `deploy.sh` there, which does `docker compose -f docker-compose.deploy.yml down` then
`up -d --build --remove-orphans` and prints status plus a health check of both containers.

This is `down` then `up`, not a rolling recreate -- both containers are briefly unavailable during
each redeploy. The shared Postgres volume (`backend_arcreserve-pgdata`) is untouched by a normal
redeploy, so indexed history survives; only `docker compose down -v` would drop it.

## Configuration: two per-chain env files, provisioned once

Two files live only on the server, never in git (`backend/.gitignore` has `.env.*` with an
exception for `.env.example`): `backend/.env.hedera` (the `api` container) and `backend/.env.arc`
(the `arc-indexer` container). Templates are checked in as `.env.hedera.template` and
`.env.arc.template` -- copy and edit, then `chmod 600`:

```bash
cp backend/.env.hedera.template backend/.env.hedera
cp backend/.env.arc.template backend/.env.arc
chmod 600 backend/.env.hedera backend/.env.arc
```

`remote-redeploy.sh`'s tar explicitly excludes `.env.hedera` and `.env.arc`, so a redeploy never
overwrites the server's real values with whatever (if anything) exists in the local checkout.

Both templates document their own values inline (RPC URLs, `START_BLOCK`, `MAX_BLOCK_RANGE`,
`CONFIRMATIONS`, contract addresses) with the measured reasoning behind each -- read them before
changing anything, especially `MAX_BLOCK_RANGE`: Hashio (Hedera) silently caches empty
`eth_getLogs` results above ~350-400 blocks, and dRPC (Arc) hard-errors above ~100-200 and also
rejects JSON-RPC batches over 3. Both are measured, not guessed, and both cliffs move if the relay
changes -- re-measure before raising either.

`CORS_ORIGIN` on `.env.hedera` should list the deployed frontend's origin
(`https://arc-reserve.talentor.tech`); `.env.arc`'s CORS setting is irrelevant since that
container has no public port, but the field is required by config validation.

## One-time setup (nginx + TLS)

```bash
ssh ubuntu@52.77.221.104
~/arc-reserve/backend/deploy/setup-nginx-tls.sh
```

Same pattern as `frontend/deploy/setup-nginx-tls.sh`: installs the HTTP-only vhost, `nginx -t` +
reload, then `certbot --nginx -d arc-reserve-backend.talentor.tech`. Idempotent -- safe to re-run.

**As of 2026-09-13 this has been run through the nginx-install step only.** The vhost is live at
`http://arc-reserve-backend.talentor.tech` (verified working via `curl -H "Host: ..."
http://52.77.221.104/v1/health` -- proxying is correct, independent of DNS). The certbot step was
**not** run because DNS does not resolve yet; the script detected this, warned, and exited cleanly
without attempting the ACME challenge (which would have failed and possibly hit Let's Encrypt's
rate limits on repeated failures). **Once the DNS A record is added**, re-run this script to get
the certificate -- nothing else needs to change.

## Verifying a deploy

```bash
# Both containers, from the server
docker compose -f ~/arc-reserve/backend/docker-compose.deploy.yml ps
docker compose -f ~/arc-reserve/backend/docker-compose.deploy.yml logs -f api
docker compose -f ~/arc-reserve/backend/docker-compose.deploy.yml logs -f arc-indexer

# Health, from the server loopback (works before DNS/TLS)
curl -s http://127.0.0.1:4000/v1/health | jq .data.status
curl -s http://127.0.0.1:4001/v1/health | jq .data.status   # Arc indexer's own view; not public

# One-URL design: both chains through the SAME public port
curl -s http://127.0.0.1:4000/v1/assets?chainId=296
curl -s http://127.0.0.1:4000/v1/assets?chainId=5042002

# Once DNS + certbot are done
curl -s https://arc-reserve-backend.talentor.tech/v1/health
```

Read `/v1/health`'s `riskCoverage.computed` (should list both `296` and `5042002`),
`pendingBackfills` (should be `[]`), and `rollbacks` before trusting a deploy -- `status: healthy`
alone does not prove the indexers have finished catching up from `START_BLOCK`, only that nothing
is currently broken. Check `indexers[].lagBlocks` for how far behind each chain still is; a fresh
deploy against a chain that has been producing blocks for hours has a real backlog to work through
and this is expected, not a fault -- it clears on its own over the following minutes.

## A migration race, found and fixed on first deploy (2026-09-13)

Both containers run `npm run migrate` in `docker-entrypoint.sh` on every start, because either one
could be the first to see a fresh database. `node-pg-migrate` takes an advisory lock for its run,
but a **second** runner does not wait for it -- it fails immediately ("Another migration is
already running") rather than blocking. On the very first deploy this happened exactly once, and
only self-healed because Docker's `restart: unless-stopped` policy restarted the failed container
and the retry happened to land after the other's migration had already finished -- a lucky timing,
not a guarantee. Fixed the same day: the entrypoint now retries with a 3-second backoff (up to 10
attempts) instead of relying on the restart policy. If you see `migration attempt N failed,
retrying` in the logs, that is this working as intended, not a fault to chase.

## Rollback

No image versioning (`docker-compose.deploy.yml` always builds `arcreserve-backend:local` from
whatever `remote-redeploy.sh` most recently shipped) -- a hackathon-scope limitation, same as the
frontend. To roll back: check out the previous state locally, then
`ARC_DEPLOY_HOST=ubuntu@52.77.221.104 ./deploy/remote-redeploy.sh` again from that checkout.

## Troubleshooting

```bash
# Container logs
docker compose -f ~/arc-reserve/backend/docker-compose.deploy.yml logs -f

# nginx config test / reload
sudo nginx -t && sudo systemctl reload nginx

# Is nginx routing correctly, independent of DNS?
curl -s -H "Host: arc-reserve-backend.talentor.tech" http://127.0.0.1/v1/health

# Postgres data (only if you intend to actually discard indexed history)
docker compose -f ~/arc-reserve/backend/docker-compose.deploy.yml down -v
```

A `CHAIN_UNAVAILABLE` (503) response for `?chainId=5042002` from the `api` container means
`RPC_HTTP_URL_5042002` is missing or wrong in `.env.hedera` -- it is a *separate* setting from
`arc-indexer`'s primary `RPC_HTTP_URL`, both currently pointing at the same dRPC endpoint but
configured independently, so a typo in one does not surface in the other.
