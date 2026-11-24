#!/bin/bash
# Run on your own computer, not the server: copies the server's backups to this computer.
#
#   bash deploy/pull-backups.sh you@log.example.com            -> ~/simple-log-backups/
#
# To do it every day on a Mac or Linux laptop, copy this file to ~/simple-log-backups/ (cron on
# a Mac can't read ~/Desktop or ~/Documents) and add a line to your crontab:
#   (crontab -l 2>/dev/null; echo "0 12 * * * /bin/bash $HOME/simple-log-backups/pull-backups.sh log") | crontab -
set -euo pipefail
HOST="${1:?Usage: bash deploy/pull-backups.sh you@your-domain}"
DEST="${2:-$HOME/simple-log-backups}"
mkdir -p "$DEST"
rsync -av --timeout=60 -e "ssh -o ConnectTimeout=15" "$HOST:backups/simple-log-*.tar.gz" "$DEST/"
echo "Backups are in $DEST"
