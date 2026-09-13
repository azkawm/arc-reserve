# Deploying the frontend (demo host)

Hackathon demo deployment, not a production release process. This deploys the concept landing
page container in `frontend/` to a single VPS behind host nginx with a Let's Encrypt certificate.
It does not deploy `contracts/` or `backend/`.

**Target:** `ubuntu@52.77.221.104`, repo checked out at `~/arc-reserve`, public domain
`https://arc-reserve.talentor.tech`.

## Architecture

```text
Browser --https--> host nginx (443, Let's Encrypt) --http--> 127.0.0.1:3000 --> Docker container
                     also: 80 -> 301 redirect to https        (nginx:alpine, static bundle, D-035/D-036)
```

The container is `frontend/docker-compose.yml`'s `frontend` service: a multi-stage build that
typechecks, bundles with Vite, and serves the static output from an nginx:alpine image on
container port 8080, published only to `127.0.0.1:3000` on the host. Host nginx is the only thing
with a public listener; it terminates TLS and reverse-proxies to that loopback port.

## Prerequisites to check on this host

Not yet verified on `ubuntu@52.77.221.104` — confirm these before or during the first deploy
rather than assuming them (they were true of a previous, since-replaced target host, but this is a
different machine):

- Docker + the `docker compose` v2 plugin are installed; `ubuntu` is in the `docker` group, so
  `docker`/`docker compose` need no `sudo` (`groups` to check; `sudo usermod -aG docker ubuntu`
  plus a re-login if not).
- `certbot` (nginx plugin) and `nginx` are installed (`certbot --version`, `nginx -v`; on Ubuntu:
  `sudo apt-get install -y nginx certbot python3-certbot-nginx` if missing).
- This machine's SSH public key is authorized for `ubuntu@52.77.221.104`.
- DNS for `arc-reserve.talentor.tech` resolves to `52.77.221.104` (it previously pointed at the
  old host — update the A record if it hasn't been repointed yet).
- `~/arc-reserve` on the server is a clone of `github.com/azkawm/arc-reserve`, on `main`. If it
  doesn't exist yet: `git clone https://github.com/azkawm/arc-reserve ~/arc-reserve`.
- Host port `3000` is free (`ss -tln | grep 3000`); `80`/`443` are free for host nginx to bind.
- Available disk space (`df -h /`). This project's `node_modules` is large (~800MB, mostly wagmi
  connector dependencies), and the Dockerfile's multi-stage build copies it more than once during
  the build — budget at least **2-3GB free** before building, or `npm ci`/the build's `COPY
  --from=deps` step can fail with `ENOSPC` partway through. If space is tight, `docker system df`
  and `docker image prune -a -f` / `docker builder prune -a -f` show and reclaim what Docker can
  give back — but check what you're removing first if the host runs other projects too.
- Whether `sudo` needs an interactive password on this host. If it does, the nginx vhost + certbot
  step below needs a human at a real terminal, not a non-interactive SSH one-liner.

## One-time setup (nginx + TLS)

Only needed once per host, before the first deploy makes the site reachable publicly. Run this
interactively as `ubuntu` on the server (`ssh ubuntu@52.77.221.104`), from `~/arc-reserve`:

```bash
./frontend/deploy/setup-nginx-tls.sh
```

It's interactive by design (certbot's ACME flow and, on hosts without passwordless sudo, the
`sudo` prompts need a real terminal), so this is not something to script over a non-interactive
SSH session. It defaults to `arc-reserve.talentor.tech` proxying to `127.0.0.1:3000`; pass a
different domain and/or port as arguments if needed (`./frontend/deploy/setup-nginx-tls.sh
other.domain 3001`). It's idempotent — safe to re-run if a step fails partway, e.g. if certbot
can't reach the ACME challenge because DNS isn't pointed at this host yet.

What it does, in order: installs `frontend/deploy/nginx.arc-reserve.talentor.tech.conf` to
`/etc/nginx/sites-available/<domain>` (skipped if that file already exists — it assumes certbot
already owns it), symlinks it into `sites-enabled`, `nginx -t` + reload, then `sudo certbot
--nginx -d <domain>`, which obtains the certificate and rewrites the site file in place to add the
301-to-HTTPS redirect and the `443 ssl` server block — don't hand-edit that file afterwards, let
certbot own it. It finishes by checking a renewal timer is active.

Do this **after** the container is up at least once (next section), since the container doesn't
need to exist for certbot to succeed, but there's no point serving TLS for a backend that isn't
listening yet.

## First deploy / every redeploy

`frontend/deploy/deploy.sh` runs on the server and is the one script for both: first deploy and
every later redeploy. It's self-contained — it pulls the repo itself, then rebuilds and restarts
only the `frontend/` compose project.

```bash
ssh ubuntu@52.77.221.104
~/arc-reserve/frontend/deploy/deploy.sh
```

What it does, in order: `git pull` at the repo root, `cd frontend`, `docker compose down`,
`docker compose up -d --build --remove-orphans`, then prints `docker compose ps`. `contracts/` and
`backend/` in the same checkout are untouched even though `git pull` updates the whole repo.

This is `down` then `up`, not a rolling recreate — the container is briefly unavailable during
each redeploy (a few seconds for a static-file image). Acceptable for a hackathon demo; not a
zero-downtime deploy.

## Redeploying from your laptop

Day to day, don't SSH in by hand — run this from your local machine instead:

```bash
./frontend/deploy/remote-redeploy.sh
```

It SSHes in and runs `frontend/deploy/deploy.sh` on the server (which does the `git pull` and the
rebuild). Override the target if needed: `ARC_DEPLOY_HOST=user@host ARC_DEPLOY_PATH=~/other-path
./frontend/deploy/remote-redeploy.sh`.

## Configuration (VITE_* build args)

Vite inlines `VITE_*` variables into the bundle at **build** time (`docker-compose.yml` passes
them as build args) — see `frontend/README.md`'s Environment section. `docker compose` reads a
`.env` file from `frontend/` automatically if one exists there.

The current concept landing page (D-035/D-036) calls the backend nowhere, so **no `.env` file is
needed for this deploy** — every `VITE_*` build arg defaults to empty, same as local dev without
`.env.local`. If a later change wires the page to a live backend/contracts, create
`frontend/.env` on the server (already covered by `frontend/.env` in `.gitignore` — never commit
it) with the values from `frontend/.env.example`, then redeploy to rebuild the image.

## Rollback

There's no image versioning here (`docker-compose.yml` always builds `arcreserve-frontend:local`
from the current checkout) — a hackathon-scope limitation. To roll back:

```bash
ssh ubuntu@52.77.221.104
cd ~/arc-reserve
git checkout <previous-sha>
cd frontend && ./deploy/deploy.sh
```

## Troubleshooting

```bash
# Container logs
docker compose -f ~/arc-reserve/frontend/docker-compose.yml logs -f frontend

# Is the app healthy on the host loopback?
curl -i http://127.0.0.1:3000/healthz

# Is host nginx proxying it correctly?
sudo nginx -t
curl -i https://arc-reserve.talentor.tech/healthz

# Certificate status / manual renewal check
sudo certbot certificates
sudo certbot renew --dry-run
```

A blank/white page with no errors in `docker compose logs` is a frontend rendering bug, not a
deploy problem — check the browser console first.
