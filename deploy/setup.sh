#!/bin/bash
# Sets up (or re-sets up) the server. Safe to run again: each step checks before it acts.
#
#   cd ~/simple-log && sudo bash deploy/setup.sh log.example.com
#   sudo KEEP=7 bash deploy/setup.sh log.example.com      keep 7 nightly backups instead of 14
#
# An email after the domain is optional; Let's Encrypt uses it only for account notices.
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"; KEEP="${KEEP:-14}"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash deploy/setup.sh $DOMAIN"; exit 1; }
[ -n "$DOMAIN" ] || { echo "Usage: sudo bash deploy/setup.sh <domain> [email]"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
[ "$USER_NAME" != root ] || { echo "Run it as your own user with sudo, not as root, so the app doesn't run as root."; exit 1; }
step(){ echo; echo "== $*"; }
# a new server is busy updating itself for its first few minutes; wait for it rather than fail
APT="apt-get -q -y -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"

step "Packages"
cloud-init status --wait >/dev/null 2>&1 || true
export DEBIAN_FRONTEND=noninteractive
$APT update
$APT install nginx certbot python3-certbot-nginx ufw curl ca-certificates openssl

step "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  $APT install nodejs
fi
NODE="$(command -v node)"
"$NODE" --version

step "Firewall: only ssh, http and https"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

step "Private folders: only $USER_NAME can read the posts and backups"
sudo -u "$USER_NAME" mkdir -p "$APP_DIR/data" "/home/$USER_NAME/backups"
chmod 700 "$APP_DIR/data" "/home/$USER_NAME/backups"

step "The app as a service"
sed -e "s|__USER__|$USER_NAME|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE|g" "$APP_DIR/deploy/simple-log.service" > /etc/systemd/system/simple-log.service
systemctl daemon-reload
systemctl enable simple-log >/dev/null 2>&1
if [ -f "$APP_DIR/data/config.json" ]; then
  systemctl restart simple-log
  sleep 1
  systemctl is-active simple-log
else
  echo "No passphrase yet, so the app isn't started. Run: node bin/passphrase.js  (then this script again)"
fi

step "Nightly backup at 3:17, keeping $KEEP"
echo "17 3 * * * $USER_NAME KEEP=$KEEP /bin/bash $APP_DIR/deploy/backup.sh >> /home/$USER_NAME/backups/backup.log 2>&1" > /etc/cron.d/simple-log
chmod 644 /etc/cron.d/simple-log

step "nginx"
sed -e "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/nginx-site.conf" > /etc/nginx/sites-available/simple-log
ln -sf /etc/nginx/sites-available/simple-log /etc/nginx/sites-enabled/simple-log
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

step "https (Let's Encrypt)"
HERE="$(hostname -I | tr ' ' '\n')"
V4="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
V6="$(getent ahostsv6 "$DOMAIN" | awk '$1 !~ /^::ffff:/{print $1; exit}' || true)"
DNS_OK=1
if [ -z "$V4" ] || ! echo "$HERE" | grep -qx "$V4"; then
  echo "$DOMAIN points at '${V4:-nothing}', but this server is $(hostname -I | awk '{print $1}')."
  echo "Fix the DNS A record, wait a few minutes, then run this script again."
  DNS_OK=0
fi
if [ -n "$V6" ] && ! echo "$HERE" | grep -qix "$V6"; then
  echo "There's an AAAA (IPv6) record for $DOMAIN pointing elsewhere ($V6): delete it at the registrar."
  DNS_OK=0
fi
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [ "$DNS_OK" = 1 ] || [ -f "$CERT" ]; then
  # keeps a certificate that isn't near expiry, and puts it back into the nginx site we just wrote
  if [ -n "$EMAIL" ]; then WHO=(-m "$EMAIL"); else WHO=(--register-unsafely-without-email); fi
  if certbot --nginx -d "$DOMAIN" "${WHO[@]}" --agree-tos --non-interactive --redirect --keep-until-expiring; then
    systemctl reload nginx
  else
    echo "certbot failed (see above). Run this script again later."
  fi
else
  echo "Skipping https for now."
fi

step "Done. Checking:"
sudo -u "$USER_NAME" bash "$APP_DIR/deploy/health.sh" "$DOMAIN" || true
