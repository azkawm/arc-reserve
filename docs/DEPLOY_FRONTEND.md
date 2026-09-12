# Deploying the frontend (demo host)

Hackathon demo deployment, not a production release process. This deploys the concept landing
page container in `frontend/` to a single VPS behind host nginx with a Let's Encrypt certificate.
It does not deploy `contracts/` or `backend/`.

**Target:** `azka@202.10.42.3`, repo checked out at `~/arc-reserve`, public domain
`https://arc-reserve.talentor.tech`.

## Architecture

```text
Browser --https--> host nginx (443, Let's Encrypt) --http--> 127.0.0.1:3000 --> Docker container
                     also: 80 -> 301 redirect to https        (nginx:alpine, static bundle, D-035/D-036)
```

The container is `frontend/docker-compose.yml`'s `frontend` service: a multi-stage build that
typechecks, bundles with Vite, and serves the static output from an nginx:alpine image on
container port 8080, published only to `127.0.0.1:3000` on the host. Host nginx is the only thing
with a public listener; it terminates TLS and reverse-proxies to that loopback port. This mirrors
the other sites already running on this host (`hara-demo`, `azka`, etc.) — see
`/etc/nginx/sites-available/hara-demo` there for the pattern.

## What's already true on this host

Confirmed before writing this doc — skip re-checking these unless something changed:

- Docker + the `docker compose` v2 plugin are installed; `azka` is in the `docker` group, so
  `docker`/`docker compose` need no `sudo`.
- `certbot` (nginx plugin) and `nginx` are installed and already managing several other
  `server_name`s on this box.
- This machine's SSH public key is already authorized for `azka@202.10.42.3`.
- DNS for `arc-reserve.talentor.tech` already resolves to `202.10.42.3`.
- `~/arc-reserve` on the server is already a clone of `github.com/azkawm/arc-reserve`, on `main`.
- Host port `3000` is free; `80`/`443` are owned by the host nginx that fronts every site here.
- `sudo` on this host needs an interactive password — there is no passwordless sudo. That means
  the nginx vhost + certbot step below must be run by a human at a real terminal, not scripted
  over a non-interactive SSH session.

## One-time setup (nginx + TLS)

Only needed once per host, before the first deploy makes the site reachable publicly. Run these
as `azka` on the server (`ssh azka@202.10.42.3`), from `~/arc-reserve`:

```bash
sudo cp frontend/deploy/nginx.arc-reserve.talentor.tech.conf \
  /etc/nginx/sites-available/arc-reserve.talentor.tech
sudo ln -s /etc/nginx/sites-available/arc-reserve.talentor.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d arc-reserve.talentor.tech
```

`certbot --nginx` obtains the certificate and rewrites the site file in place to add the
301-to-HTTPS redirect and the `443 ssl` server block (backing up the pre-edit file as
`arc-reserve.talentor.tech.save`, the same pattern already used for the other sites on this box).
Renewal is already automatic — this host has both a `certbot.timer` and a
`snap.certbot.renew.timer` running.

Do this **after** the container is up at least once (next section), since the container doesn't
need to exist for certbot to succeed, but there's no point serving TLS for a backend that isn't
listening yet.

## First deploy / every redeploy

`frontend/deploy/deploy.sh` runs on the server and is the one script for both: first deploy and
every later redeploy. It always builds+starts from the `frontend/` directory next to itself
(never the caller's `$PWD`), so it can't be run against the wrong compose project by accident.

```bash
ssh azka@202.10.42.3
cd ~/arc-reserve/frontend
./deploy/deploy.sh
```

What it does, in order: `docker compose build`, `docker compose up -d --wait` (blocks until the
image's own `HEALTHCHECK` reports healthy, or fails loudly), a `curl` against `/healthz` to
confirm, `docker image prune -f` to drop the now-dangling previous image (this is a small demo
VPS shared with other projects — don't let old layers accumulate), then prints `docker compose ps`.
On failure it prints the last 80 lines of the container's logs before exiting non-zero.

## Redeploying from your laptop

Day to day, don't SSH in by hand — run this from your local machine instead:

```bash
./frontend/deploy/remote-redeploy.sh
```

It SSHes in, fast-forwards `~/arc-reserve` to `origin/main` (`git merge --ff-only`, so it refuses
rather than discarding anything if the server's checkout has diverged), then runs
`frontend/deploy/deploy.sh` on the server. It touches only the `frontend/` directory on the
server-side deploy step — `contracts/` and `backend/` there are untouched even though `git pull`
updates the whole checkout.

Override the target if needed: `ARC_DEPLOY_HOST=user@host ARC_DEPLOY_PATH=~/other-path
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
ssh azka@202.10.42.3
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
