#!/usr/bin/env bash
# Tries one WEBTOP sign-in per child, explains failures, and on success clears
# the bot's retry wait (1-6 hours after a failure) and restarts that child.
#   sudo webtop-check          (all children)
#   sudo webtop-check kid1     (one child)
set -uo pipefail
BASE=/opt/webtop-bot
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
NAMES=("$@")
if [ ${#NAMES[@]} -eq 0 ]; then
  for d in "$BASE"/kids/*/; do [ -d "$d" ] && NAMES+=("$(basename "$d")"); done
fi
[ ${#NAMES[@]} -gt 0 ] || { echo "No children yet. Run: sudo add-kid kid1"; exit 1; }

for NAME in "${NAMES[@]}"; do
  DIR="$BASE/kids/$NAME"
  echo "=== $NAME ==="
  [ -f "$DIR/.env" ] || { echo "Unknown child: $NAME"; continue; }
  if (cd "$DIR" && sudo -u webtop TZ=Asia/Jerusalem "$BASE/venv/bin/python" "$BASE/lib/check_login.py"); then
    rm -f "$DIR/logs/webtop-login-retries.sqlite"
    systemctl restart "webtop-bot@$NAME"
    echo "Retry wait cleared, $NAME restarted."
  fi
  echo
done
