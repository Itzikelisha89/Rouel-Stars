# Move the WEBTOP bot to the parent's home computer

The WEBTOP site blocks cloud servers, so the bot will run from **this Windows computer**, which the parent leaves on. The setup copies **all settings from the Oracle server**: bot token, the three children, their passwords, allowed chats, and what was already sent. The parent types nothing. The Telegram bot stays the same.

Speak to the parent in Hebrew. Do not open, print or show any `.env` file or password.

## Step 1: Run the setup
Open **Windows PowerShell** (normal, not admin) and run these two lines:
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/itzikelisha89/rouel-stars/0b09938b6a271193d0e64c6c0d130c662d720832/webtop-bot-home/setup.ps1 -OutFile $env:TEMP\webtop-setup.ps1 -UseBasicParsing
powershell -ExecutionPolicy Bypass -File $env:TEMP\webtop-setup.ps1 -ServerIp 151.145.88.149
```
- It uses the `ssh-key-*.key` file in Downloads. If the key is elsewhere, add `-KeyFile "<full path>"` to the second line.
- If Windows asks to allow Python or winget, click **Yes / Allow**.
- It takes about 5–10 minutes. Wait until it prints **Done** in green.

The setup:
1. installs Python if it is missing;
2. downloads the bot;
3. copies the settings from the server;
4. **stops the bot on the server** (one Telegram bot can only run in one place);
5. creates three files on the Desktop (`WEBTOP-start`, `WEBTOP-fix`, `WEBTOP-status`);
6. makes the bot start automatically at login, and turns off sleep while plugged in;
7. starts the bot and opens a status report in Notepad.

If it stops with a red error, copy the whole PowerShell window text and show the parent. Do not try to fix it in other ways.

## Step 2: Check the status report
Notepad opens `webtop-status.txt`. Check that:
- `Runner running: True`;
- `router`, `kid1`, `kid2` and `kid3` all show `running=True`;
- each kid log ends with `<child name>: running, sending alerts only`.

If anything is different, show the parent the report.

## Step 3: Check one child's sign-in
This is the only step that signs in to WEBTOP now. It runs once per child:
```powershell
& "$env:LOCALAPPDATA\webtop-bot\venv\Scripts\python.exe" "$env:LOCALAPPDATA\webtop-bot\lib\control.py" check
```
- `OK: signed in as ...` for all three means everything works from home.
- `BLOCKED` means even the home internet is blocked. Stop, and show the parent the output.
- `REFUSED` means that child's password changed. Show the parent the output.

## Step 4: Test in Telegram
In Telegram Web, open the bot and send **`שלום`**. It should list the three children and show two buttons:
- **📋 סיכום היום**
- **🗓️ מה יש מחר**

Then send **`מה יש מחר?`**. Within about 3 minutes, one answer per child should arrive, each starting with 🎒 and the child's name.

## Step 5: Tell the parent, in Hebrew
- The bot now runs from this computer. Leave it **on and connected to power**. The screen can turn off, but the computer must not sleep or shut down.
- After a restart, the bot starts by itself once the parent logs in to Windows.
- Automatic checks run at 8:00, 10:00, 12:00 and 14:00, Sunday to Friday.
- In Telegram they can ask, for example: "מה היה היום?", "שיעורי בית של <name>", "מה יש ל<name> מחר?", or use the buttons.
- If something does not work:
  1. Double-click **WEBTOP-fix** on the Desktop.
  2. If it still does not work after 2 minutes, double-click **WEBTOP-status**.
  3. In the Notepad window that opens, press **Ctrl+A**, then **Ctrl+C**, and paste the text to the engineer.
