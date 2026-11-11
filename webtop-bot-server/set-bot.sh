#!/usr/bin/env bash
# Sets the one Telegram bot that all children share, and starts it.
#   sudo set-bot
set -euo pipefail
BASE=/opt/webtop-bot
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[ -f "$BASE/INSTALL_DONE" ] || { echo "Installation has not finished yet"; exit 1; }

read -rp "Telegram bot token (from @BotFather): " TOKEN
[[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || { echo "That does not look like a bot token"; exit 1; }
OLD_IDS=""
[ -f "$BASE/shared.env" ] && OLD_IDS=$(sed -n 's/^ALLOWED_CHAT_IDS=//p' "$BASE/shared.env")

umask 077
printf 'TELEGRAM_TOKEN=%s\nALLOWED_CHAT_IDS=%s\n' "$TOKEN" "$OLD_IDS" > "$BASE/shared.env"
chown webtop:webtop "$BASE/shared.env"; chmod 600 "$BASE/shared.env"

for ENV_FILE in "$BASE"/kids/*/.env; do
  [ -f "$ENV_FILE" ] || continue
  sed -i "s/^TELEGRAM_TOKEN=.*/TELEGRAM_TOKEN=$TOKEN/" "$ENV_FILE"
  systemctl restart "webtop-bot@$(basename "$(dirname "$ENV_FILE")")"
done

systemctl enable --now webtop-router
systemctl restart webtop-router
sleep 3
systemctl is-active webtop-router
echo "Now open the bot in Telegram and send /start - it replies with your chat ID."
