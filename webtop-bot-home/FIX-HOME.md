# Fix: children crash with "ALLOWED_CHAT_IDS must contain only comma-separated numbers"

**Cause:** another program on this computer (probably the parent's other Telegram bot) defined `ALLOWED_CHAT_IDS` and maybe `TELEGRAM_TOKEN` as Windows environment variables. Those took priority over the bot's own settings. The new version always uses the bot's own settings and ignores the computer's.

**Do not** delete or change the Windows environment variables, because the other bot may need them. Do not open or show any `.env` file.

Speak to the parent in Hebrew.

## Step 1: Run the setup again (same as before, new version)
In Windows PowerShell (normal, not admin):
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/itzikelisha89/rouel-stars/7881a0f6c18ebbab5344a7be52e8e472af0e176d/webtop-bot-home/setup.ps1 -OutFile $env:TEMP\webtop-setup.ps1 -UseBasicParsing
powershell -ExecutionPolicy Bypass -File $env:TEMP\webtop-setup.ps1 -ServerIp 151.145.88.149 -KeyFile "<full path to webtop-bot-ssh.key>"
```
Use the same `-KeyFile` path as last time. Wait for **Done** in green. It copies the settings again, restarts the bot, and opens the status report.

## Step 2: Check the status report
In the Notepad report, check:
- `Runner running: True`.
- The line `Computer environment also sets: ...` is expected to list `ALLOWED_CHAT_IDS` and maybe `TELEGRAM_TOKEN`, followed by `(ignored by the bot)`. That is fine.
- `router`, `kid1`, `kid2` and `kid3` all show `running=True`.
- No `ValueError` in the kid logs. Each one ends with `<name>: running, sending alerts only`.

If kids still show `running=False`, wait 1 minute, double-click **WEBTOP-status** on the Desktop again, and show the parent the new report.

## Step 3: Continue with steps 3–5 of HOME-AGENT.md
https://github.com/itzikelisha89/rouel-stars/blob/claude/modest-archimedes-ir7bm6/webtop-bot-home/HOME-AGENT.md

In short:
- Run `control.py check` once. It signs in once per child and should show `OK`.
- In Telegram, send `שלום` to the bot, then `מה יש מחר?`.
- Report to the parent.

**Important:** in Telegram, make sure you are talking to the **WEBTOP bot**, not the parent's other bot.
