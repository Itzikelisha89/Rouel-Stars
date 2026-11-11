#!/usr/bin/env bash
# Sets which Telegram chats receive the alerts (for all children), then restarts.
#   sudo allow-chat 123456789,987654321
set -euo pipefail
BASE=/opt/webtop-bot
IDS="${1:-}"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[[ "$IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "Usage: sudo allow-chat <id>[,<id>...]"; exit 1; }
[ -f "$BASE/shared.env" ] || { echo "Run  sudo set-bot  first"; exit 1; }

sed -i "s/^ALLOWED_CHAT_IDS=.*/ALLOWED_CHAT_IDS=$IDS/" "$BASE/shared.env"
for ENV_FILE in "$BASE"/kids/*/.env; do
  [ -f "$ENV_FILE" ] || continue
  sed -i "s/^ALLOWED_CHAT_IDS=.*/ALLOWED_CHAT_IDS=$IDS/" "$ENV_FILE"
  systemctl restart "webtop-bot@$(basename "$(dirname "$ENV_FILE")")"
done
systemctl restart webtop-router
echo "Alerts now go to: $IDS"
