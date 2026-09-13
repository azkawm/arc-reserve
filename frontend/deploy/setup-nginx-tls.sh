#!/usr/bin/env bash
set -euo pipefail

# One-time nginx + certbot setup for the ArcReserve frontend demo host.
#
# Run this ONCE per host, interactively, as a user with sudo -- certbot's ACME challenge and the
# nginx reload need a real sudo prompt on hosts without passwordless sudo (see the "prerequisites
# to check" list in docs/DEPLOY_FRONTEND.md). Idempotent: safe to re-run if a step failed partway,
# or to pick up a domain/port change -- it skips or updates what's already in place rather than
# duplicating it.
#
# This only wires up the reverse proxy + TLS. It does not build or start the frontend container
# -- run ./deploy/deploy.sh for that (before or after this script; certbot doesn't need the
# container up, but there's no point serving TLS for a backend that isn't listening yet).
#
# Usage: ./deploy/setup-nginx-tls.sh [domain] [proxy_port]
#   domain      default: arc-reserve.talentor.tech
#   proxy_port  default: 3000 (must match docker-compose.yml's host port)

DOMAIN="${1:-arc-reserve.talentor.tech}"
PROXY_PORT="${2:-3000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_CONF_SRC="$SCRIPT_DIR/nginx.arc-reserve.talentor.tech.conf"
SITE_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
SITE_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

command -v nginx >/dev/null 2>&1 || {
  echo "nginx not found. Install it first: sudo apt-get install -y nginx" >&2
  exit 1
}
command -v certbot >/dev/null 2>&1 || {
  echo "certbot not found. Install it first: sudo apt-get install -y certbot python3-certbot-nginx" >&2
  exit 1
}
[[ -f "$SITE_CONF_SRC" ]] || {
  echo "Missing $SITE_CONF_SRC -- run this script from a checkout that has frontend/deploy/." >&2
  exit 1
}

echo "==> Domain: $DOMAIN"
echo "==> Proxy target: 127.0.0.1:$PROXY_PORT"

if [[ -e "$SITE_AVAILABLE" ]]; then
  echo "==> $SITE_AVAILABLE already exists -- leaving it as-is (it's likely already certbot-managed;"
  echo "    delete it first if you actually want to reinstall the pre-certbot template)."
else
  echo "==> Installing HTTP-only vhost at $SITE_AVAILABLE"
  sudo cp "$SITE_CONF_SRC" "$SITE_AVAILABLE"
  if [[ "$PROXY_PORT" != "3000" ]]; then
    sudo sed -i "s/127\.0\.0\.1:3000/127.0.0.1:$PROXY_PORT/" "$SITE_AVAILABLE"
  fi
  if [[ "$DOMAIN" != "arc-reserve.talentor.tech" ]]; then
    sudo sed -i "s/arc-reserve\.talentor\.tech/$DOMAIN/g" "$SITE_AVAILABLE"
  fi
fi

if [[ -e "$SITE_ENABLED" ]]; then
  echo "==> $SITE_ENABLED already enabled"
else
  echo "==> Enabling site"
  sudo ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
fi

echo "==> Testing nginx config"
sudo nginx -t

echo "==> Reloading nginx"
sudo systemctl reload nginx

echo "==> Requesting/renewing the certificate via certbot (interactive: it may ask for an email"
echo "    and ToS agreement on first run)"
sudo certbot --nginx -d "$DOMAIN"

echo "==> Confirming a renewal timer is active"
systemctl list-timers 2>/dev/null | grep -i certbot || \
  echo "    No certbot timer found running -- enable one: sudo systemctl enable --now certbot.timer"

echo "==> Done."
echo "    certbot rewrote $SITE_AVAILABLE in place to add the 301-to-https redirect and the 443"
echo "    ssl server block -- don't hand-edit that file going forward, let certbot own it."
echo "    Verify once the frontend container is running (./deploy/deploy.sh):"
echo "      curl -i https://$DOMAIN/healthz"
