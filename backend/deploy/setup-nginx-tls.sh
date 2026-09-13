#!/usr/bin/env bash
set -euo pipefail

# One-time nginx + certbot setup for the ArcReserve backend demo API.
#
# Run this ONCE per host, interactively, as a user with sudo -- certbot's ACME challenge and the
# nginx reload need a real sudo prompt on hosts without passwordless sudo. Idempotent: safe to
# re-run if a step failed partway, or to pick up a domain/port change -- it skips or updates
# what's already in place rather than duplicating it.
#
# This only wires up the reverse proxy + TLS. It does not build or start the backend containers
# -- run ./deploy/deploy.sh for that (before or after this script; certbot doesn't need the
# containers up, but there's no point serving TLS for a backend that isn't listening yet).
#
# Requires DNS for the domain to already resolve to this host before the certbot step, or its
# HTTP-01 challenge cannot reach it and this script will fail at that point (everything up to
# there -- installing the vhost, nginx -t, reload -- still succeeds and is safe to leave in place
# until DNS catches up; just re-run this script once it does).
#
# Usage: ./deploy/setup-nginx-tls.sh [domain] [proxy_port]
#   domain      default: arc-reserve-backend.talentor.tech
#   proxy_port  default: 4000 (must match docker-compose.deploy.yml's `api` host port)

DOMAIN="${1:-arc-reserve-backend.talentor.tech}"
PROXY_PORT="${2:-4000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_CONF_SRC="$SCRIPT_DIR/nginx.arc-reserve-backend.talentor.tech.conf"
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
  echo "Missing $SITE_CONF_SRC -- run this script from a checkout that has backend/deploy/." >&2
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
  if [[ "$PROXY_PORT" != "4000" ]]; then
    sudo sed -i "s/127\.0\.0\.1:4000/127.0.0.1:$PROXY_PORT/" "$SITE_AVAILABLE"
  fi
  if [[ "$DOMAIN" != "arc-reserve-backend.talentor.tech" ]]; then
    sudo sed -i "s/arc-reserve-backend\.talentor\.tech/$DOMAIN/g" "$SITE_AVAILABLE"
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

RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
THIS_HOST_IP="$(curl -s -4 https://ifconfig.me || true)"
if [[ -z "$RESOLVED" ]]; then
  echo "==> WARNING: $DOMAIN does not resolve yet. certbot's HTTP-01 challenge will fail until a"
  echo "    DNS A record points it at this host's public IP${THIS_HOST_IP:+ ($THIS_HOST_IP)}."
  echo "    The HTTP-only vhost above is installed and will start working once DNS propagates --"
  echo "    add the A record, wait for it to resolve, then re-run this script to get the cert."
  exit 0
elif [[ -n "$THIS_HOST_IP" && "$RESOLVED" != "$THIS_HOST_IP" ]]; then
  echo "==> WARNING: $DOMAIN resolves to $RESOLVED, not this host's IP ($THIS_HOST_IP)."
  echo "    certbot will likely fail its HTTP-01 challenge until that's corrected."
fi

echo "==> Requesting/renewing the certificate via certbot (interactive: it may ask for an email"
echo "    and ToS agreement on first run)"
sudo certbot --nginx -d "$DOMAIN"

echo "==> Confirming a renewal timer is active"
systemctl list-timers 2>/dev/null | grep -i certbot || \
  echo "    No certbot timer found running -- enable one: sudo systemctl enable --now certbot.timer"

echo "==> Done."
echo "    certbot rewrote $SITE_AVAILABLE in place to add the 301-to-https redirect and the 443"
echo "    ssl server block -- don't hand-edit that file going forward, let certbot own it."
echo "    Verify once the backend containers are running (./deploy/deploy.sh):"
echo "      curl -i https://$DOMAIN/v1/health"
