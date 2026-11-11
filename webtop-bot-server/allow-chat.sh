#!/usr/bin/env bash
# Sets who may use a child's bot, then restarts it.
#   sudo allow-chat kid1 123456789,987654321
set -euo pipefail
NAME="${1:-}"; IDS="${2:-}"
ENV_FILE="/opt/webtop-bot/kids/$NAME/.env"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ && -f "$ENV_FILE" ]] || { echo "Unknown child: $NAME"; exit 1; }
[[ "$IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "Usage: sudo allow-chat <name> <id>[,<id>...]"; exit 1; }
sed -i "s/^ALLOWED_CHAT_IDS=.*/ALLOWED_CHAT_IDS=$IDS/" "$ENV_FILE"
systemctl restart "webtop-bot@$NAME"
echo "$NAME now answers: $IDS"
