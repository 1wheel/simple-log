#!/bin/bash
# Is everything working? Run on the server:   bash deploy/health.sh [domain]
# Prints one line per check; exits 1 if any failed.
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-$(node -p 'new URL(require(process.argv[1]).url).host' "$APP_DIR/data/config.json" 2>/dev/null)}"
FAILED=0
ok(){ echo "ok    $*"; }
bad(){ echo "FAIL  $*"; FAILED=1; }
warn(){ echo "warn  $*"; }

[ -f "$APP_DIR/data/config.json" ] && ok "passphrase is set" || bad "no passphrase: run node bin/passphrase.js"
[ "$(stat -c %a "$APP_DIR/data/config.json" 2>/dev/null)" = 600 ] && ok "config.json is readable by you only" || warn "config.json should be chmod 600"
systemctl is-active --quiet simple-log && ok "the app is running" || bad "the app isn't running: sudo journalctl -u simple-log -n 50"
systemctl is-enabled --quiet simple-log 2>/dev/null && ok "the app starts on boot" || bad "the app won't start on boot: sudo systemctl enable simple-log"
curl -fsS --max-time 5 http://127.0.0.1:8090/health >/dev/null && ok "the app answers on port 8090" || bad "the app doesn't answer on port 8090"
systemctl is-active --quiet nginx && ok "nginx is running" || bad "nginx isn't running: sudo nginx -t"

if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost:8090" ]; then
  curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null && ok "https://$DOMAIN answers" || bad "https://$DOMAIN doesn't answer"
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$DOMAIN/")" = 301 ] && ok "http:// sends people to https://" || warn "http:// doesn't redirect to https://"
  END="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$END" ]; then
    DAYS=$(( ($(date -d "$END" +%s) - $(date +%s)) / 86400 ))
    [ "$DAYS" -gt 14 ] && ok "certificate good for $DAYS more days (renews by itself)" || bad "certificate expires in $DAYS days: sudo certbot renew"
  else bad "no https certificate for $DOMAIN"; fi
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/posts")" = 401 ] && ok "the api is closed to strangers" || bad "the api answered a stranger"
fi

if command -v ufw >/dev/null && sudo -n true 2>/dev/null; then
  sudo -n ufw status | grep -q "Status: active" && ok "firewall is on" || bad "firewall is off: sudo ufw enable"
fi
FREE=$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')
[ "$FREE" -gt 1000 ] && ok "disk: ${FREE} MB free" || bad "disk almost full: ${FREE} MB free"
LAST="$(ls -1t "$HOME"/backups/simple-log-*.tar.gz 2>/dev/null | head -1)"
if [ -z "$LAST" ]; then warn "no backup yet (the first runs tonight; or now: bash deploy/backup.sh)"
elif [ $(( $(date +%s) - $(stat -c %Y "$LAST") )) -lt 172800 ]; then ok "last backup: $(basename "$LAST")"
else bad "last backup is old: $(basename "$LAST")"; fi
[ -f /etc/cron.d/simple-log ] && ok "nightly backup is scheduled" || bad "nightly backup isn't scheduled: run setup.sh again"

[ $FAILED = 0 ] && echo "All good." || echo "Something needs fixing (see FAIL above)."
exit $FAILED
