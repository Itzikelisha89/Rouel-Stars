#!/usr/bin/env bash
# Adds one child (one WEBTOP account + one Telegram bot) and starts it.
#   sudo bash add-kid.sh noa
set -euo pipefail

BASE=/opt/webtop-bot
NAME="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: add-kid <name>  (English lowercase letters/digits)"; exit 1; }
[ -d "$BASE/src" ] || { echo "Run install.sh first"; exit 1; }

DIR="$BASE/kids/$NAME"
if [ ! -d "$DIR" ]; then
  sudo -u webtop git clone -q "$BASE/src" "$DIR"
fi

# Daily jobs in Israel time all year (upstream uses a fixed UTC+3).
sed -i "s|_IL = datetime.timezone(datetime.timedelta(hours=3))|from zoneinfo import ZoneInfo; _IL = ZoneInfo('Asia/Jerusalem')|" "$DIR/bot.py"

# Each bot needs its own signature port.
COUNT=$(find "$BASE/kids" -mindepth 1 -maxdepth 1 -type d | wc -l)
PORT=$((8764 + COUNT))

echo "Settings for $NAME (nothing you type here is shown or saved anywhere else):"
read -rp  "Telegram bot token (from @BotFather): " TOKEN
read -rp  "WEBTOP username: " USERNAME
read -rsp "WEBTOP password: " PASSWORD; echo
read -rp  "Allowed Telegram chat IDs, comma-separated (empty for now = only /myid works): " IDS

umask 077
cat > "$DIR/.env" <<ENV
TELEGRAM_TOKEN=$TOKEN
WEBTOP_USERNAME=$USERNAME
WEBTOP_PASSWORD=$PASSWORD
WEBTOP_DATA=
WEBTOP_BASE_URL=
ALLOWED_CHAT_IDS=$IDS
SIGNATURE_PUBLIC_URL=
SIGNATURE_HOST=127.0.0.1
SIGNATURE_PORT=$PORT
TELEGRAM_NOTIFICATIONS_ENABLED=true
ENV
chown webtop:webtop "$DIR/.env"
chmod 600 "$DIR/.env"

systemctl enable --now "webtop-bot@$NAME"
systemctl restart "webtop-bot@$NAME"
sleep 5
systemctl --no-pager status "webtop-bot@$NAME" | head -5
echo
echo "Logs:  journalctl -u webtop-bot@$NAME -f"
