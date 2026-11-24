#!/bin/bash
# A tar of the data folder (posts, pictures, config), one per day, the last 14 kept.
# Run nightly by cron (see setup.sh). The posts are append-only, so a copy taken mid-write
# can at worst end in half a line, which the app skips when it reads the file.
#
#   bash deploy/backup.sh                       -> ~/backups/simple-log-YYYY-MM-DD.tar.gz
#   BACKUP_DIR=/somewhere KEEP=30 bash deploy/backup.sh
#
# To restore: sudo systemctl stop simple-log; tar -xzf <file> -C ~/simple-log; sudo systemctl start simple-log
set -euo pipefail
umask 077   # the backup holds private posts and the config secret
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DEST"
FILE="$DEST/simple-log-$(date +%F).tar.gz"
tar -czf "$FILE.tmp" -C "$APP_DIR" --exclude=data/site data   # site/ is rebuilt from the posts
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
ls -1t "$DEST"/simple-log-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "$(date '+%F %T') backed up to $FILE ($(du -h "$FILE" | cut -f1))"
