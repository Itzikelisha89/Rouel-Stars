#!/usr/bin/env bash
# Adds one child (one WEBTOP account) to the shared bot and starts it.
#   sudo add-kid kid1
set -euo pipefail

BASE=/opt/webtop-bot
NAME="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: sudo add-kid <name>  (English lowercase letters/digits, e.g. kid1)"; exit 1; }
[ -f "$BASE/shared.env" ] || { echo "Run  sudo set-bot  first"; exit 1; }

TOKEN=$(sed -n 's/^TELEGRAM_TOKEN=//p' "$BASE/shared.env")
IDS=$(sed -n 's/^ALLOWED_CHAT_IDS=//p' "$BASE/shared.env")

DIR="$BASE/kids/$NAME"
if [ ! -d "$DIR" ]; then
  sudo -u webtop git clone -q "$BASE/src" "$DIR"
fi

# Daily jobs in Israel time all year (upstream uses a fixed UTC+3).
sed -i "s|_IL = datetime.timezone(datetime.timedelta(hours=3))|from zoneinfo import ZoneInfo; _IL = ZoneInfo('Asia/Jerusalem')|" "$DIR/bot.py"

# Each child needs its own local signature port; keep the old one when re-running.
PORT=$(sed -n 's/^SIGNATURE_PORT=//p' "$DIR/.env" 2>/dev/null || true)
if [ -z "$PORT" ]; then
  PORT=8765
  while grep -qs "^SIGNATURE_PORT=$PORT$" "$BASE"/kids/*/.env; do PORT=$((PORT + 1)); done
fi

echo "Settings for $NAME:"
read -rp  "Child's name as it should appear in messages (e.g. נועה): " LABEL
[[ -n "$LABEL" && "$LABEL" != *[\<\>\&\*_\`\[\]]* ]] || { echo "Name is empty or has < > & * _ \` [ ]"; exit 1; }
read -rp  "WEBTOP username: " USERNAME
read -rsp "WEBTOP password: " PASSWORD; echo
[[ -n "$USERNAME" && -n "$PASSWORD" ]] || { echo "Username and password are required"; exit 1; }

umask 077
cat > "$DIR/.env" <<ENV
KID_LABEL=$LABEL
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
sleep 8
systemctl is-active "webtop-bot@$NAME" || true
journalctl -u "webtop-bot@$NAME" -n 5 --no-pager -o cat || true
