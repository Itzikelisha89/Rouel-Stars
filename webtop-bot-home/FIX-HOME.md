# Fix: children crash with "ALLOWED_CHAT_IDS must contain only comma-separated numbers"

The status report showed no clashing Windows variables, so the problem is the value copied from the server. Most likely it contains hidden characters, such as the invisible direction marks that Telegram's Hebrew interface adds to copied text, or quotes, spaces, or a group ID (a negative number). The new version cleans the value by itself and writes to the log **which characters** it removed, never the numbers.

Do not open or show any `.env` file. Speak to the parent in Hebrew.

## Step 1: Run the setup again (new version)
In Windows PowerShell (normal, not admin):
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/itzikelisha89/rouel-stars/b8114ece46c39e81e96c5c4396142cc1fb77198d/webtop-bot-home/setup.ps1 -OutFile $env:TEMP\webtop-setup.ps1 -UseBasicParsing
powershell -ExecutionPolicy Bypass -File $env:TEMP\webtop-setup.ps1 -ServerIp 151.145.88.149 -KeyFile "<full path to webtop-bot-ssh.key>"
```
Wait for **Done** in green. The status report opens in Notepad.

## Step 2: Check the status report
- `router`, `kid1`, `kid2` and `kid3` all show `running=True`. If not, wait 1 minute and double-click **WEBTOP-status** again.
- In each kid log, look for a line starting with `note: ALLOWED_CHAT_IDS cleaned`. It says what was removed. That is expected and fine.
- If you see `WARNING: no usable chat ID left`, go to step 3. Otherwise go to step 4.
- If the kids still crash, show the parent the whole report.

## Step 3 (only on WARNING): Set the parent's chat ID again
1. In Telegram Web, open the **WEBTOP bot** and send `שלום`. It replies `המספר שלך: <number>`.
2. Type the number yourself, digits only. Do not copy it, because copying from the Hebrew interface adds hidden marks. Use it in this command:
```powershell
$ids = "<number>"     # two parents: "<number1>,<number2>"
foreach ($f in @("$env:LOCALAPPDATA\webtop-bot\shared.env") + (Get-ChildItem "$env:LOCALAPPDATA\webtop-bot\kids\*\.env").FullName) {
  $t = [IO.File]::ReadAllText($f) -replace '(?m)^ALLOWED_CHAT_IDS=.*$', "ALLOWED_CHAT_IDS=$ids"
  [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding $false))
}
& "$env:LOCALAPPDATA\webtop-bot\venv\Scripts\python.exe" "$env:LOCALAPPDATA\webtop-bot\lib\control.py" restart
```
Then double-click **WEBTOP-status** and confirm that all four parts show `running=True`.

## Step 4: Continue with steps 3–5 of HOME-AGENT.md
https://github.com/itzikelisha89/rouel-stars/blob/claude/modest-archimedes-ir7bm6/webtop-bot-home/HOME-AGENT.md

1. Run `control.py check` once. It signs in once per child and should show `OK`.
2. In Telegram, send `שלום` to the **WEBTOP bot** (not the parent's other bot), then send `מה יש מחר?`.
3. Report to the parent, including the `note: ALLOWED_CHAT_IDS cleaned` line if there was one.
