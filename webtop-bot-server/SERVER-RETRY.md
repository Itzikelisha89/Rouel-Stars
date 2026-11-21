# Bring the Oracle server back and check whether the WEBTOP block is gone

The parent wants to know whether the block on the Oracle server was lifted. Move the bot back to the server, update it to the latest version, and check **one child, once**. Only if that works, start everything.

Speak to the parent in Hebrew. Do not open or show any `.env` file or password. **Do not change the server's IP address** and do not try other ways around a block.

Server IP: **151.145.88.149**. The SSH key is `webtop-bot-ssh.key` (same path as last time).

## Step 1: Stop the bot on this computer
One Telegram bot can only run in one place. In Windows PowerShell:
```powershell
& "$env:LOCALAPPDATA\webtop-bot\venv\Scripts\python.exe" "$env:LOCALAPPDATA\webtop-bot\lib\control.py" stop
$s = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\webtop-bot.vbs"
if (Test-Path $s) { Rename-Item $s "webtop-bot.vbs.off" -Force }
```
(The second part stops the home bot from starting at login. Step 7 explains how to undo it.)

## Step 2: Make sure the server is running
Open https://cloud.oracle.com, then go to **Compute → Instances → webtop-bot**.
- If the state is **Stopped**, click **Start** and wait until it shows **Running**.
- If you can't sign in, ask the parent. They may need to reset the Oracle password.

## Step 3: Connect and update the server to the latest version
```powershell
ssh -i "<full path to webtop-bot-ssh.key>" ubuntu@151.145.88.149
```
On the server:
```bash
R=https://raw.githubusercontent.com/itzikelisha89/rouel-stars/1c689151d6324e65269ebf6e2f7fdaa9b93a807f/webtop-bot-server
for f in kid_worker.py router.py check_login.py send_summary.py; do sudo curl -fsSL $R/lib/$f -o /opt/webtop-bot/lib/$f; done
for f in webtop-check webtop-summary allow-chat; do sudo curl -fsSL $R/$f.sh -o /usr/local/sbin/$f; sudo chmod 755 /usr/local/sbin/$f; done
grep -c "clean_allowed_chat_ids" /opt/webtop-bot/lib/kid_worker.py
```
The last line must print a number greater than 0.

This version:
- checks only at 8:00, 10:00, 12:00 and 14:00, Sunday to Friday;
- does not sign in when it starts;
- answers questions in Telegram;
- cleans hidden characters from the chat IDs.

## Step 4: Check one child, once
```bash
sudo webtop-check kid1
```
Note: this command restarts kid1 by itself if the sign-in works.

- **`OK: signed in as ...`**: the block is gone. Continue to step 5.
- **`BLOCKED`**: the block is still there. **Do not try again.** Run the commands below to stop everything on the server, then go to step 7 to return the bot to the home computer:
  ```bash
  sudo systemctl disable --now webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3 webtop-router
  ```
  Tell the parent: "השרת עדיין חסום. החזרתי את הבוט למחשב בבית."
- **`REFUSED`**: show the parent the output.

## Step 5: Connect the parent's Telegram (only after OK)
The server had no parent chat ID saved, only a group ID, which is not supported. Start the Telegram part:
```bash
sudo systemctl enable --now webtop-router
```
Ask the parent to open the **WEBTOP bot** in Telegram **on their phone** and send `שלום`. The bot replies `המספר שלך: <number>`. Ask the parent to **type** the number to you, digits only. If both parents should get updates, get both numbers.
```bash
sudo allow-chat <NUMBER>
```
For two parents: `sudo allow-chat <NUMBER1>,<NUMBER2>`. Type the digits; don't copy them.

## Step 6: Start the children, 5 minutes apart
```bash
sudo systemctl enable --now webtop-bot@kid1
```
Wait 5 minutes, then:
```bash
sudo webtop-check kid2 && sudo systemctl enable --now webtop-bot@kid2
```
Wait 5 minutes, then:
```bash
sudo webtop-check kid3 && sudo systemctl enable --now webtop-bot@kid3
```
Verify:
```bash
systemctl is-active webtop-router webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3
journalctl -u webtop-bot@kid1 -n 15 --no-pager -o cat
```
All four must say `active`, and the log must end with `<name>: running, sending alerts only`.

Ask the parent to send `שלום` to the bot, then `מה יש מחר?`. Within about 3 minutes, an answer per child should arrive, each starting with 🎒 and the child's name.

Type `exit`. Tell the parent, in Hebrew, that the bot runs from the server again and the home computer can be turned off.

## Step 7 (only if the server is still BLOCKED): Return to the home computer
In Windows PowerShell:
```powershell
$s = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\webtop-bot.vbs.off"
if (Test-Path $s) { Rename-Item $s "webtop-bot.vbs" -Force }
& "$env:LOCALAPPDATA\webtop-bot\venv\Scripts\python.exe" "$env:LOCALAPPDATA\webtop-bot\lib\control.py" start
```
Then continue with `FIX-HOME.md`, step 3, to set the parent's chat ID on the home computer:
https://github.com/itzikelisha89/rouel-stars/blob/claude/modest-archimedes-ir7bm6/webtop-bot-home/FIX-HOME.md
