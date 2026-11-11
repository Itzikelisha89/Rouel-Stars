#!/usr/bin/env bash
# Installs webtop-bot on an Ubuntu/Debian server. Run once, as root:
#   sudo bash install.sh
set -euo pipefail

BASE=/opt/webtop-bot
REPO=https://github.com/matana09/webtop-bot.git
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git python3 python3-venv tzdata
timedatectl set-timezone Asia/Jerusalem || true

id webtop >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin webtop
mkdir -p "$BASE/kids" "$BASE/lib"
chown webtop:webtop "$BASE" "$BASE/kids"

if [ -d "$BASE/src/.git" ]; then
  sudo -u webtop git -C "$BASE/src" pull --ff-only
else
  sudo -u webtop git clone "$REPO" "$BASE/src"
fi

[ -x "$BASE/venv/bin/python" ] || sudo -u webtop python3 -m venv "$BASE/venv"
sudo -u webtop "$BASE/venv/bin/pip" install -q --upgrade pip
sudo -u webtop "$BASE/venv/bin/pip" install -q -r "$BASE/src/requirements.txt"

# When run from the kit folder, copy its files; cloud-init has already placed them.
if [ -f "$HERE/lib/kid_worker.py" ]; then
  install -m 644 "$HERE/lib/kid_worker.py" "$HERE/lib/router.py" "$BASE/lib/"
  install -m 644 "$HERE/webtop-bot@.service" "$HERE/webtop-router.service" /etc/systemd/system/
  install -m 755 "$HERE/set-bot.sh" /usr/local/sbin/set-bot
  install -m 755 "$HERE/add-kid.sh" /usr/local/sbin/add-kid
  install -m 755 "$HERE/allow-chat.sh" /usr/local/sbin/allow-chat
  install -m 755 "$HERE/update.sh" /usr/local/sbin/webtop-update
fi
systemctl daemon-reload
touch "$BASE/INSTALL_DONE"

echo
echo "Installed. Next:  sudo set-bot   then   sudo add-kid <name>"
