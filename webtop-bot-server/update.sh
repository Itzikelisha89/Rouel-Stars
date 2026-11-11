#!/usr/bin/env bash
# Pulls the latest webtop-bot and restarts everything.
#   sudo webtop-update
set -euo pipefail
BASE=/opt/webtop-bot
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

sudo -u webtop git -C "$BASE/src" pull --ff-only
sudo -u webtop "$BASE/venv/bin/pip" install -q -r "$BASE/src/requirements.txt"
for DIR in "$BASE"/kids/*/; do
  [ -d "$DIR" ] || continue
  NAME=$(basename "$DIR")
  sudo -u webtop git -C "$DIR" checkout -- bot.py
  sudo -u webtop git -C "$DIR" pull -q --ff-only
  sed -i "s|_IL = datetime.timezone(datetime.timedelta(hours=3))|from zoneinfo import ZoneInfo; _IL = ZoneInfo('Asia/Jerusalem')|" "$DIR/bot.py"
  systemctl restart "webtop-bot@$NAME"
  echo "updated $NAME"
done
systemctl restart webtop-router
