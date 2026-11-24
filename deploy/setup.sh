#!/bin/bash
# Sets up (or re-sets up) the server. Safe to run again: each step checks before it acts.
#
#   cd ~/simple-log && sudo bash deploy/setup.sh log.example.com you@example.com
#
# The email is only for Let's Encrypt's certificate-expiry notices.
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash deploy/setup.sh $DOMAIN $EMAIL"; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "Usage: sudo bash deploy/setup.sh <domain> <email>"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
[ "$USER_NAME" != root ] || { echo "Run it as your own user with sudo, not as root, so the app doesn't run as root."; exit 1; }
step(){ echo; echo "== $*"; }

step "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx ufw curl ca-certificates openssl

step "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node --version

step "Firewall: only ssh, http and https"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

step "The app as a service"
sed -e "s|__USER__|$USER_NAME|g" -e "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/deploy/simple-log.service" > /etc/systemd/system/simple-log.service
systemctl daemon-reload
systemctl enable simple-log >/dev/null 2>&1
if [ -f "$APP_DIR/data/config.json" ]; then
  systemctl restart simple-log
  sleep 1
  systemctl is-active simple-log
else
  echo "No passphrase yet, so the app isn't started. Run: node bin/passphrase.js  (then this script again)"
fi

step "nginx"
sed -e "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/nginx-site.conf" > /etc/nginx/sites-available/simple-log
ln -sf /etc/nginx/sites-available/simple-log /etc/nginx/sites-enabled/simple-log
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

step "https (Let's Encrypt)"
THERE="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$THERE" ] && hostname -I | tr ' ' '\n' | grep -qx "$THERE"; then
  # keeps a certificate that isn't near expiry, and puts it back into the nginx site we just wrote
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect --keep-until-expiring
  systemctl reload nginx
else
  echo "$DOMAIN points at '${THERE:-nothing}', but this server is $(hostname -I | awk '{print $1}')."
  echo "Fix the DNS A record, wait a few minutes, then run this script again. Skipping https for now."
fi

step "Nightly backup at 3:17"
echo "17 3 * * * $USER_NAME $APP_DIR/deploy/backup.sh >> /home/$USER_NAME/backups/backup.log 2>&1" > /etc/cron.d/simple-log
sudo -u "$USER_NAME" mkdir -p "/home/$USER_NAME/backups"
chmod 644 /etc/cron.d/simple-log

step "Done. Checking:"
sudo -u "$USER_NAME" bash "$APP_DIR/deploy/health.sh" "$DOMAIN" || true
