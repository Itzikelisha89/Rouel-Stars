#!/usr/bin/env bash
# Installs webtop-bot on an Ubuntu/Debian server. Run once, as root:
#   sudo bash install.sh
set -euo pipefail

BASE=/opt/webtop-bot
REPO=https://github.com/matana09/webtop-bot.git


[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

apt-get update
apt-get install -y git python3 python3-venv tzdata
timedatectl set-timezone Asia/Jerusalem || true

id webtop >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin webtop
mkdir -p "$BASE/kids"
chown webtop:webtop "$BASE" "$BASE/kids"

if [ -d "$BASE/src/.git" ]; then
  sudo -u webtop git -C "$BASE/src" pull --ff-only
else
  sudo -u webtop git clone "$REPO" "$BASE/src"
fi

[ -x "$BASE/venv/bin/python" ] || sudo -u webtop python3 -m venv "$BASE/venv"
sudo -u webtop "$BASE/venv/bin/pip" install -q --upgrade pip
sudo -u webtop "$BASE/venv/bin/pip" install -q -r "$BASE/src/requirements.txt"

[ -f /etc/systemd/system/webtop-bot@.service ] || install -m 644 "$(dirname "$0")/webtop-bot@.service" /etc/systemd/system/webtop-bot@.service
systemctl daemon-reload

echo
echo "Installed. Now add a child:  sudo add-kid <name>   (or: sudo bash add-kid.sh <name>)"
