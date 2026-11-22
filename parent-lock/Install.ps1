# ParentLock installer - run via install.bat (it asks for administrator rights).
# Console text is in English because the Windows console cannot show Hebrew correctly.
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Base     = 'C:\ProgramData\ParentLock'
$TaskName = 'ParentLock'
$SrcDir   = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say([string]$t, [string]$color = 'White') { Write-Host $t -ForegroundColor $color }
function Ask-YesNo([string]$q, [bool]$default) {
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $a = (Read-Host "$q $hint").Trim().ToLower()
        if ($a -eq '') { return $default }
        if ($a -in 'y', 'yes') { return $true }
        if ($a -in 'n', 'no') { return $false }
    }
}
function Tg([string]$token, [string]$method, $params) {
    if ($null -eq $params) { $params = @{} }
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = [Text.Encoding]::UTF8
    $wc.Headers['Content-Type'] = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes(($params | ConvertTo-Json -Depth 10 -Compress))
    try { $resp = $wc.UploadData("https://api.telegram.org/bot$token/$method", 'POST', $bytes) }
    finally { $wc.Dispose() }
    [Text.Encoding]::UTF8.GetString($resp) | ConvertFrom-Json
}
function Get-AdminNames {
    $grpName = (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate(
        [Security.Principal.NTAccount]).Value.Split('\')[-1]
    $grp = [ADSI]"WinNT://$env:COMPUTERNAME/$grpName,group"
    @($grp.psbase.Invoke('Members') | ForEach-Object { $_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null) })
}
function SecureToPlain($s) {
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Stop-Agent {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like '*ParentLock.ps1*' } |
        ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
}

# ------------------------------------------------------------------ checks
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Say 'Please run install.bat (it asks for administrator rights).' Red; exit 1
}
if (-not (Test-Path (Join-Path $SrcDir 'ParentLock.ps1'))) {
    Say 'ParentLock.ps1 is missing. Extract the whole ZIP folder first, then run install.bat from it.' Red; exit 1
}

Clear-Host
Say '==============================================' Cyan
Say '   ParentLock - lock this PC from your phone' Cyan
Say '==============================================' Cyan
Say ''

$configPath = Join-Path $Base 'config.json'
$keepConfig = $false
if (Test-Path $configPath) {
    Say 'ParentLock is already installed on this computer.' Yellow
    $keepConfig = Ask-YesNo 'Keep the current settings and only update the program?' $true
}

if (-not $keepConfig) {
    # -------------------------------------------------------------- 1. computer name
    $pcName = (Read-Host "1) A name for this computer, as it will appear in Telegram (Enter = $env:COMPUTERNAME)").Trim()
    if (-not $pcName) { $pcName = $env:COMPUTERNAME }

    # -------------------------------------------------------------- 2. bot token
    Say ''
    Say '2) Each computer needs its OWN Telegram bot (create it with @BotFather).' Cyan
    do {
        $token = (Read-Host '   Paste the bot token here (looks like 123456789:ABC...)').Trim()
        $me = $null
        try { $me = Tg $token 'getMe' } catch {}
        if (-not ($me -and $me.ok)) { Say '   This token did not work. Check it and try again.' Red }
    } until ($me -and $me.ok)
    $botUser = $me.result.username
    Say "   OK - bot @$botUser" Green
    try { [void](Tg $token 'deleteWebhook' @{}) } catch {}

    # -------------------------------------------------------------- 3. who controls it
    Say ''
    Say "3) On your phone, open Telegram, search for @$botUser, open it and press START." Cyan
    Say '   (A second parent can do the same now, on their own phone.)' Cyan
    $chats = [ordered]@{}
    $lastUpdate = 0
    do {
        [void](Read-Host '   When done, press Enter here')
        $upd = Tg $token 'getUpdates' @{ timeout = 0 }
        foreach ($u in @($upd.result)) {
            if ($null -eq $u) { continue }
            if ([long]$u.update_id -gt $lastUpdate) { $lastUpdate = [long]$u.update_id }
            if ($u.message -and $u.message.chat.type -eq 'private') {
                $c = $u.message.chat
                $chats[[string]$c.id] = ("{0} {1}" -f $c.first_name, $c.last_name).Trim()
            }
        }
        if ($chats.Count -eq 0) { Say '   No message arrived yet. Press START in the bot (or send it "hi") and try again.' Yellow }
    } until ($chats.Count -gt 0)
    Say '   These Telegram users will control this computer:' Green
    foreach ($k in $chats.Keys) { Say "     - $($chats[$k])" Green }
    if (-not (Ask-YesNo '   Is that correct?' $true)) { Say 'Setup cancelled. Run install.bat again.' Red; exit 1 }
    # mark these messages as read
    [void](Tg $token 'getUpdates' @{ offset = $lastUpdate + 1; timeout = 0 })

    # -------------------------------------------------------------- 4. kids' accounts
    Say ''
    Say "4) Windows accounts on this computer:" Cyan
    $admins = Get-AdminNames
    $users = @(Get-LocalUser | Where-Object {
        [int]($_.SID.Value.Split('-')[-1]) -ge 1000 -and $_.Name -notlike 'defaultuser*' })
    for ($i = 0; $i -lt $users.Count; $i++) {
        $u = $users[$i]
        $tags = @()
        if ($admins -contains $u.Name) { $tags += 'administrator' }
        if (-not $u.Enabled) { $tags += 'disabled' }
        $t = if ($tags) { '  (' + ($tags -join ', ') + ')' } else { '' }
        Say ("   [{0}] {1}{2}" -f ($i + 1), $u.Name, $t)
    }
    do {
        $sel = Read-Host '   Type the numbers of the KIDS'' accounts, separated by commas (e.g. 2 or 2,3)'
        $kids = @()
        $okSel = $true
        foreach ($p in ($sel -split '[,\s]+' | Where-Object { $_ })) {
            $n = 0
            if ([int]::TryParse($p, [ref]$n) -and $n -ge 1 -and $n -le $users.Count) { $kids += $users[$n - 1].Name }
            else { $okSel = $false }
        }
        $kids = @($kids | Select-Object -Unique)
        if (-not $okSel -or $kids.Count -eq 0) { Say '   Please type numbers from the list.' Red; $okSel = $false }
    } until ($okSel)
    Say "   Kids' accounts: $($kids -join ', ')" Green

    # -------------------------------------------------------------- 5. administrator safety
    Say ''
    Say '5) Important: the lock DISABLES the kids'' accounts, so their password will not help them.' Cyan
    Say '   But the kids must NOT have administrator rights, and must NOT know the password of any' Cyan
    Say '   administrator account - otherwise they could remove this program.' Cyan
    $otherAdmins = @($users | Where-Object { $_.Enabled -and ($admins -contains $_.Name) -and ($kids -notcontains $_.Name) })
    $needParent = $otherAdmins.Count -eq 0
    if ($needParent) {
        Say '   There is no other administrator account, so we will create a secret PARENT account now.' Yellow
    } else {
        Say "   Other administrator accounts: $(($otherAdmins | ForEach-Object Name) -join ', ')"
        $needParent = Ask-YesNo '   Do the kids know the password of any of these accounts?' $true
    }

    $demote = @()
    if ($needParent) {
        $pname = (Read-Host '   Name for the new parent account (Enter = Parent)').Trim()
        if (-not $pname) { $pname = 'Parent' }
        while ($true) {
            $p1 = Read-Host "   New password for '$pname' (the kids must NOT know it)" -AsSecureString
            $p2 = Read-Host '   Type the password again' -AsSecureString
            $a = SecureToPlain $p1; $b = SecureToPlain $p2
            if ($a.Length -lt 4) { Say '   Use at least 4 characters.' Red; continue }
            if ($a -ne $b) { Say '   The passwords do not match. Try again.' Red; continue }
            break
        }
        if (Get-LocalUser -Name $pname -ErrorAction SilentlyContinue) {
            Set-LocalUser -Name $pname -Password $p1 -PasswordNeverExpires $true
            Enable-LocalUser -Name $pname
        } else {
            New-LocalUser -Name $pname -FullName $pname -Password $p1 -PasswordNeverExpires -AccountNeverExpires | Out-Null
        }
        try { Add-LocalGroupMember -SID 'S-1-5-32-544' -Member $pname } catch {}
        try { Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $pname } catch {}
        Say "   Created administrator account '$pname'. Use it from now on for anything that needs admin rights." Green

        foreach ($oa in $otherAdmins) {
            if ($oa.Name -eq $pname) { continue }
            if (Ask-YesNo "   Remove administrator rights from '$($oa.Name)' (the kids know its password)?" $true) {
                $demote += $oa.Name
            }
        }
    }

    # demote kids (and accounts the kids know the password of)
    $toDemote = @($kids | Where-Object { $admins -contains $_ }) + @($demote)
    foreach ($name in ($toDemote | Select-Object -Unique)) {
        try { Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $name } catch {}
        try { Remove-LocalGroupMember -SID 'S-1-5-32-544' -Member $name }
        catch {
            $grpName = (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate(
                [Security.Principal.NTAccount]).Value.Split('\')[-1]
            & net.exe localgroup "$grpName" "$name" /delete | Out-Null
        }
        Say "   '$name' is now a standard user (takes effect at next sign-in)." Green
    }

    $config = [ordered]@{
        pcName      = $pcName
        token       = $token
        chatIds     = @($chats.Keys)
        kidAccounts = @($kids)
    }
    $state = [ordered]@{ locked = $false; netBlocked = $false; graceUntil = 0; lockAt = 0; warned = $false; offset = $lastUpdate + 1 }
}

# ------------------------------------------------------------------ install files
Say ''
Say 'Installing...' Cyan
Stop-Agent
New-Item -ItemType Directory -Path $Base -Force | Out-Null
Copy-Item -Path (Join-Path $SrcDir 'ParentLock.ps1') -Destination (Join-Path $Base 'ParentLock.ps1') -Force
Copy-Item -Path (Join-Path $SrcDir 'Uninstall.ps1') -Destination (Join-Path $Base 'Uninstall.ps1') -Force -ErrorAction SilentlyContinue
if (-not $keepConfig) {
    $config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8
    $state  | ConvertTo-Json | Set-Content -Path (Join-Path $Base 'state.json') -Encoding UTF8
}
# Only SYSTEM and Administrators may read/change the folder (it holds the bot token).
& icacls.exe $Base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /Q | Out-Null

# ------------------------------------------------------------------ scheduled task (runs as SYSTEM)
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Base\ParentLock.ps1`""
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    # watchdog: if the agent ever stops, start it again within 5 minutes
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 3650))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Principal $taskPrincipal -Description 'ParentLock - remote lock from Telegram' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Say ''
Say 'Done! Within a few seconds you should get a message in Telegram that this computer is on.' Green
Say 'Buttons will appear at the bottom of the chat - use them to lock / unlock.' Green
Say "Log file: $Base\log.txt" DarkGray
