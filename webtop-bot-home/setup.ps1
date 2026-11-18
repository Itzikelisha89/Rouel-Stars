# Moves the WEBTOP Telegram bot from the Oracle server to this Windows computer.
# Copies all settings from the server (bot token, children, passwords, allowed chats,
# what was already sent), installs everything, and starts the bot - nothing to type.
#
# Run in Windows PowerShell (not as admin):
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -ServerIp <server ip>
param(
    [Parameter(Mandatory = $true)][string]$ServerIp,
    [string]$KeyFile = ""
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$KitSha = "feae18cd76de3899d2ecf6ba2d86620eb4de0b2a"
$UpstreamSha = "f52680f785cd1c540ce6b1f465142341f2d8e394"
$Kit = "https://raw.githubusercontent.com/itzikelisha89/rouel-stars/$KitSha"
$Base = Join-Path $env:LOCALAPPDATA "webtop-bot"
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }

# ---- 1. SSH key and server -------------------------------------------------------
Step "Finding the server key"
if (-not $KeyFile) {
    $found = Get-ChildItem "$env:USERPROFILE\Downloads\ssh-key-*.key" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime | Select-Object -Last 1
    if (-not $found) { throw "No ssh-key-*.key file in Downloads. Pass -KeyFile <path>." }
    $KeyFile = $found.FullName
}
icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null
$Ssh = @("-i", $KeyFile, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", "ubuntu@$ServerIp")
& ssh @Ssh "test -f /opt/webtop-bot/shared.env && echo server-ok"
if ($LASTEXITCODE -ne 0) { throw "Cannot reach the server or it has no bot settings." }

# ---- 2. Python -------------------------------------------------------------------
Step "Checking Python"
function Find-Python {
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
                     "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
                     "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe")) {
        if (Test-Path $p) { return $p }
    }
    $cmd = Get-Command py -ErrorAction SilentlyContinue
    if ($cmd) {
        $p = (& py -3 -c "import sys; print(sys.executable)" 2>$null)
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}
$Py = Find-Python
if (-not $Py) {
    Write-Host "Installing Python 3.12 (one time)..."
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
    $Py = Find-Python
    if (-not $Py) { throw "Python install failed. Install Python 3.12 from python.org and run this again." }
}
Write-Host "Python: $Py"

# ---- 3. Code ---------------------------------------------------------------------
Step "Downloading the bot"
New-Item -ItemType Directory -Force -Path $Base, "$Base\lib", "$Base\kids", "$Base\logs" | Out-Null
$tmp = Join-Path $env:TEMP "webtop-bot-setup"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Invoke-WebRequest "https://github.com/matana09/webtop-bot/archive/$UpstreamSha.zip" -OutFile "$tmp\src.zip" -UseBasicParsing
Expand-Archive "$tmp\src.zip" -DestinationPath $tmp -Force
Remove-Item "$Base\src" -Recurse -Force -ErrorAction SilentlyContinue
Move-Item (Get-ChildItem $tmp -Directory | Where-Object Name -like "webtop-bot-*" | Select-Object -First 1).FullName "$Base\src"

foreach ($f in @("webtop-bot-server/lib/kid_worker.py", "webtop-bot-server/lib/router.py",
                 "webtop-bot-server/lib/check_login.py", "webtop-bot-server/lib/send_summary.py",
                 "webtop-bot-home/home_runner.py", "webtop-bot-home/control.py")) {
    Invoke-WebRequest "$Kit/$f" -OutFile (Join-Path "$Base\lib" (Split-Path $f -Leaf)) -UseBasicParsing
}

Step "Installing Python packages (a few minutes)"
if (-not (Test-Path "$Base\venv\Scripts\python.exe")) { & $Py -m venv "$Base\venv" }
$VPy = "$Base\venv\Scripts\python.exe"
& $VPy -m pip install -q --upgrade pip
& $VPy -m pip install -q -r "$Base\src\requirements.txt" tzdata
if ($LASTEXITCODE -ne 0) { throw "Package install failed." }

# ---- 4. Settings from the server --------------------------------------------------
Step "Copying settings from the server"
$remote = "sudo sh -c 'cd /opt/webtop-bot && tar -czf - shared.env kids/*/.env `$(ls kids/*/*.json 2>/dev/null)' | base64 -w0"
$b64 = (& ssh @Ssh $remote) -join ""
if ($LASTEXITCODE -ne 0 -or -not $b64) { throw "Could not copy the settings from the server." }
[IO.File]::WriteAllBytes("$tmp\settings.tgz", [Convert]::FromBase64String($b64))
tar -xzf "$tmp\settings.tgz" -C $Base
if (-not (Test-Path "$Base\shared.env")) { throw "Settings copy is incomplete." }

$kids = Get-ChildItem "$Base\kids" -Directory | Where-Object { Test-Path "$($_.FullName)\.env" }
foreach ($kid in $kids) {
    # fresh code next to the copied .env and state files
    robocopy "$Base\src" $kid.FullName /E /NFL /NDL /NJH /NJS /NP | Out-Null
    $botPy = "$($kid.FullName)\bot.py"
    $code = [IO.File]::ReadAllText($botPy)
    $code = $code.Replace("_IL = datetime.timezone(datetime.timedelta(hours=3))",
                          "from zoneinfo import ZoneInfo; _IL = ZoneInfo('Asia/Jerusalem')")
    [IO.File]::WriteAllText($botPy, $code, $Utf8)
    Write-Host "child ready: $($kid.Name)"
}
if ($kids.Count -eq 0) { throw "No children found in the server settings." }

# ---- 5. Stop the bot on the server (one bot can only run in one place) ----------
Step "Stopping the bot on the server"
& ssh @Ssh "sudo systemctl disable --now webtop-router 'webtop-bot@*' 2>/dev/null; sudo systemctl disable --now webtop-bot@kid1 webtop-bot@kid2 webtop-bot@kid3 webtop-bot@kid4 2>/dev/null; echo stopped"

# ---- 6. Shortcuts, autostart, no sleep --------------------------------------------
Step "Creating Desktop buttons and autostart"
$desktop = [Environment]::GetFolderPath("Desktop")
$ctl = "`"$VPy`" `"$Base\lib\control.py`""
[IO.File]::WriteAllText("$desktop\WEBTOP-start.bat", "@echo off`r`n$ctl start`r`ntimeout /t 5`r`n", $Utf8)
[IO.File]::WriteAllText("$desktop\WEBTOP-fix.bat", "@echo off`r`n$ctl restart`r`ntimeout /t 5`r`n", $Utf8)
[IO.File]::WriteAllText("$desktop\WEBTOP-status.bat", "@echo off`r`n$ctl status`r`n", $Utf8)
$pyw = "$Base\venv\Scripts\pythonw.exe"
$vbs = "CreateObject(""WScript.Shell"").Run """"""$pyw"""" """"$Base\lib\control.py"""" start"", 0, False"
[IO.File]::WriteAllText("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\webtop-bot.vbs", $vbs, $Utf8)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

# ---- 7. Start ----------------------------------------------------------------------
Step "Starting the bot"
& $VPy "$Base\lib\control.py" start
Start-Sleep -Seconds 20
& $VPy "$Base\lib\control.py" status
Write-Host ""
Write-Host "Done. The bot runs from this computer and starts by itself when you log in." -ForegroundColor Green
