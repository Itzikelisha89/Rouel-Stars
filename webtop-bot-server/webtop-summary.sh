#!/usr/bin/env bash
# Sends today's summary to Telegram now, one child at a time (3 minutes apart).
#   sudo webtop-summary          (all children)
#   sudo webtop-summary kid1     (one child)
set -uo pipefail
BASE=/opt/webtop-bot
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
NAMES=("$@")
if [ ${#NAMES[@]} -eq 0 ]; then
  for d in "$BASE"/kids/*/; do [ -d "$d" ] && NAMES+=("$(basename "$d")"); done
fi
FIRST=1
for NAME in "${NAMES[@]}"; do
  DIR="$BASE/kids/$NAME"
  [ -f "$DIR/.env" ] || { echo "Unknown child: $NAME"; continue; }
  [ $FIRST -eq 1 ] || { echo "waiting 3 minutes before the next child..."; sleep 180; }
  FIRST=0
  (cd "$DIR" && sudo -u webtop TZ=Asia/Jerusalem PYTHONUNBUFFERED=1 "$BASE/venv/bin/python" "$BASE/lib/send_summary.py" 2>&1 | grep -E "summary (sent|failed)")
done
