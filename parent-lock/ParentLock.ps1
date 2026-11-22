# ParentLock agent - runs as SYSTEM in the background (scheduled task).
# Receives commands from the parent's Telegram bot and:
#   * locks the computer by DISABLING the kids' Windows accounts and logging them off
#     (so knowing the password does not help),
#   * blocks the internet (everything except Telegram) with Windows Firewall rules,
#   * enforces time limits ("open for 1 hour, then lock").
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
$Base       = 'C:\ProgramData\ParentLock'
$ConfigPath = Join-Path $Base 'config.json'
$StatePath  = Join-Path $Base 'state.json'
$LogPath    = Join-Path $Base 'log.txt'
$FwGroup    = 'ParentLock'

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- single instance
$createdNew = $false
$script:Mutex = [System.Threading.Mutex]::new($true, 'Global\ParentLockAgent', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

# ---------------------------------------------------------------- logging
function Write-Log([string]$msg) {
    try {
        if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 1MB) {
            Move-Item $LogPath "$LogPath.old" -Force
        }
        Add-Content -Path $LogPath -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg) -Encoding UTF8
    } catch {}
}

# ---------------------------------------------------------------- Windows sessions (WTS API)
if (-not ('PlWts' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PlSession { public int Id; public string User; public int State; }
public static class PlWts {
    [StructLayout(LayoutKind.Sequential)]
    struct WTS_SESSION_INFO { public int SessionId; public IntPtr pWinStationName; public int State; }
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSEnumerateSessions(IntPtr h, int reserved, int version, out IntPtr pp, out int count);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSQuerySessionInformation(IntPtr h, int id, int infoClass, out IntPtr buf, out int bytes);
    [DllImport("wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr p);
    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSLogoffSession(IntPtr h, int id, bool wait);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSSendMessage(IntPtr h, int id, string title, int titleLen, string msg, int msgLen,
                                      int style, int timeout, out int response, bool wait);

    public static PlSession[] GetSessions() {
        var list = new List<PlSession>();
        IntPtr p; int count;
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out p, out count)) return list.ToArray();
        int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
        for (int i = 0; i < count; i++) {
            var si = (WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + (long)i * size), typeof(WTS_SESSION_INFO));
            IntPtr b; int n; string user = null;
            if (WTSQuerySessionInformation(IntPtr.Zero, si.SessionId, 5 /* WTSUserName */, out b, out n)) {
                user = Marshal.PtrToStringUni(b);
                WTSFreeMemory(b);
            }
            if (!string.IsNullOrEmpty(user)) list.Add(new PlSession { Id = si.SessionId, User = user, State = si.State });
        }
        WTSFreeMemory(p);
        return list.ToArray();
    }
    public static bool Logoff(int id) { return WTSLogoffSession(IntPtr.Zero, id, false); }
    public static void Message(int id, string title, string text, int timeoutSec) {
        int r;
        // MB_ICONWARNING | MB_SYSTEMMODAL | MB_TOPMOST | MB_RIGHT | MB_RTLREADING
        int style = 0x30 | 0x1000 | 0x40000 | 0x80000 | 0x100000;
        WTSSendMessage(IntPtr.Zero, id, title, title.Length * 2, text, text.Length * 2, style, timeoutSec, out r, false);
    }
}
'@
}

# ---------------------------------------------------------------- config & state
$Config = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Token  = [string]$Config.token
$PcName = [string]$Config.pcName
$Kids   = @($Config.kidAccounts | ForEach-Object { [string]$_ })
$AllowedChats = @($Config.chatIds | ForEach-Object { [string]$_ })

function Get-Now { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

function Load-State {
    $s = @{ locked = $false; netBlocked = $false; graceUntil = 0; lockAt = 0; warned = $false; offset = 0 }
    if (Test-Path $StatePath) {
        try {
            $j = Get-Content -Path $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($k in @($s.Keys)) {
                if ($j.PSObject.Properties.Name -contains $k -and $null -ne $j.$k) { $s[$k] = $j.$k }
            }
        } catch { Write-Log "state.json unreadable, starting fresh: $_" }
    }
    $s
}
function Save-State {
    try { $script:State | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8 }
    catch { Write-Log "Save-State failed: $_" }
}
$script:State = Load-State

# ---------------------------------------------------------------- Telegram
function Invoke-Tg([string]$method, $params) {
    if ($null -eq $params) { $params = @{} }
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = [Text.Encoding]::UTF8
    $wc.Headers['Content-Type'] = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes(($params | ConvertTo-Json -Depth 10 -Compress))
    try {
        $resp = $wc.UploadData("https://api.telegram.org/bot$Token/$method", 'POST', $bytes)
    } finally { $wc.Dispose() }
    [Text.Encoding]::UTF8.GetString($resp) | ConvertFrom-Json
}

# Button labels (the reply keyboard shown on the phone)
$BTN_LOCK     = '🔒 נעל'
$BTN_UNLOCK   = '🔓 פתח'
$BTN_30       = '⏱ חצי שעה'
$BTN_60       = '⏱ שעה'
$BTN_ADD15    = '➕ 15 דקות'
$BTN_STATUS   = '📊 מצב'
$BTN_NET_OFF  = '🚫 חסום אינטרנט'
$BTN_NET_ON   = '🌐 החזר אינטרנט'
$BTN_LOCKNOW  = '⚡ נעל מיד'
$BTN_HELP     = '❓ עזרה'

# keys are stored without emoji variation selectors (U+FE0F), which phones sometimes add
function Get-ButtonKey([string]$t) { ($t -replace '\uFE0F', '').Trim() }
$ButtonCommands = @{}
foreach ($pair in @(
    @($BTN_LOCK, '/lock'), @($BTN_UNLOCK, '/unlock'), @($BTN_30, '/time 30'), @($BTN_60, '/time 60'),
    @($BTN_ADD15, '/add 15'), @($BTN_STATUS, '/status'), @($BTN_NET_OFF, '/netoff'), @($BTN_NET_ON, '/neton'),
    @($BTN_LOCKNOW, '/locknow'), @($BTN_HELP, '/help'))) {
    $ButtonCommands[(Get-ButtonKey $pair[0])] = $pair[1]
}
# every row has exactly 2 buttons (keeps ConvertTo-Json from flattening rows)
$Keyboard = @{
    keyboard = @(
        @($BTN_LOCK, $BTN_UNLOCK),
        @($BTN_30, $BTN_60),
        @($BTN_ADD15, $BTN_STATUS),
        @($BTN_NET_OFF, $BTN_NET_ON),
        @($BTN_LOCKNOW, $BTN_HELP)
    )
    resize_keyboard = $true
    is_persistent   = $true
}

function Send-To([string]$chatId, [string]$text) {
    try { [void](Invoke-Tg 'sendMessage' @{ chat_id = $chatId; text = $text; reply_markup = $Keyboard }) }
    catch { Write-Log "sendMessage to $chatId failed: $_" }
}
function Notify-All([string]$text) { foreach ($c in $AllowedChats) { Send-To $c $text } }

# ---------------------------------------------------------------- kids' accounts & sessions
function Set-KidsEnabled([bool]$enabled) {
    foreach ($u in $Kids) {
        try {
            if ($enabled) { Enable-LocalUser -Name $u } else { Disable-LocalUser -Name $u }
        } catch {
            $flag = if ($enabled) { 'yes' } else { 'no' }
            & net.exe user "$u" /active:$flag | Out-Null
        }
    }
}
function Test-AnyKidEnabled {
    foreach ($u in $Kids) {
        try { if ((Get-LocalUser -Name $u).Enabled) { return $true } } catch {}
    }
    $false
}
function Get-KidSessions { @([PlWts]::GetSessions() | Where-Object { $Kids -contains $_.User }) }
function Send-KidsPopup([string]$text, [int]$timeoutSec = 60) {
    foreach ($s in Get-KidSessions) {
        try { [PlWts]::Message($s.Id, 'הודעה מההורים', $text, $timeoutSec) } catch { Write-Log "popup failed: $_" }
    }
}

# ---------------------------------------------------------------- internet blocking (Windows Firewall)
# Outbound BLOCK rules override any allow rule. Left open: the home network (router, printers,
# DNS on the router), Telegram's servers (so the parent can still unlock), and DNS on port 53.
# IPv6 to the internet is blocked completely, so everything falls back to IPv4.
$TcpBlock = @('1.0.0.0-9.255.255.255','11.0.0.0-91.105.191.255','91.105.194.0-91.108.3.255',
    '91.108.24.0-91.108.55.255','91.108.60.0-95.161.63.255','95.161.80.0-126.255.255.255',
    '128.0.0.0-149.154.159.255','149.154.176.0-169.253.255.255','169.255.0.0-172.15.255.255',
    '172.32.0.0-185.76.150.255','185.76.152.0-192.167.255.255','192.169.0.0-223.255.255.255','2000::/3')
$UdpBlock = @('1.0.0.0-9.255.255.255','11.0.0.0-126.255.255.255','128.0.0.0-169.253.255.255',
    '169.255.0.0-172.15.255.255','172.32.0.0-192.167.255.255','192.169.0.0-223.255.255.255','2000::/3')

function Test-NetBlockRules { [bool](Get-NetFirewallRule -Group $FwGroup -ErrorAction SilentlyContinue) }
function Add-NetBlock {
    if (Test-NetBlockRules) { return }
    # Block rules only work while the firewall itself is on.
    try { Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True } catch { Write-Log "enable firewall failed: $_" }
    New-NetFirewallRule -DisplayName 'ParentLock - block internet (TCP)' -Group $FwGroup -Direction Outbound `
        -Action Block -Protocol TCP -RemoteAddress $TcpBlock -Profile Any | Out-Null
    New-NetFirewallRule -DisplayName 'ParentLock - block internet (UDP)' -Group $FwGroup -Direction Outbound `
        -Action Block -Protocol UDP -RemotePort '1-52','54-65535' -RemoteAddress $UdpBlock -Profile Any | Out-Null
    Write-Log 'internet blocked'
}
function Remove-NetBlock {
    Get-NetFirewallRule -Group $FwGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Log 'internet restored'
}

# ---------------------------------------------------------------- actions
function Format-Minutes([long]$seconds) {
    $m = [math]::Ceiling($seconds / 60)
    if ($m -ge 60) { '{0}:{1:00} שעות' -f [math]::Floor($m / 60), ($m % 60) } else { "$m דקות" }
}

function Do-Lock([int]$graceSec, [string]$reason) {
    $State.locked = $true; $State.netBlocked = $true
    $State.lockAt = 0; $State.warned = $false
    $State.graceUntil = (Get-Now) + $graceSec
    Save-State
    Set-KidsEnabled $false
    try { Add-NetBlock } catch { Write-Log "Add-NetBlock failed: $_" }
    $sessions = Get-KidSessions
    if ($graceSec -gt 0 -and $sessions.Count -gt 0) {
        Send-KidsPopup "המחשב יינעל בעוד $graceSec שניות.`nשמרו את מה שאתם עושים." $graceSec
    }
    Write-Log "LOCK ($reason), grace=$graceSec, sessions=$($sessions.Count)"
    $who = if ($sessions.Count -gt 0) {
        $names = ($sessions | ForEach-Object { $_.User }) -join ', '
        if ($graceSec -gt 0) { "`n$names יתנתקו בעוד $graceSec שניות." } else { "`n$names נותקו." }
    } else { '' }
    Notify-All "🔒 $PcName נעול$reason. האינטרנט חסום.$who"
    Enforce-Lock
}

function Do-Unlock([int]$minutes) {
    $State.locked = $false; $State.netBlocked = $false; $State.graceUntil = 0
    if ($minutes -gt 0) { $State.lockAt = (Get-Now) + $minutes * 60; $State.warned = $false }
    else { $State.lockAt = 0 }
    Save-State
    Set-KidsEnabled $true
    try { Remove-NetBlock } catch { Write-Log "Remove-NetBlock failed: $_" }
    Write-Log "UNLOCK minutes=$minutes"
    if ($minutes -gt 0) {
        Notify-All "🔓 $PcName פתוח ל-$(Format-Minutes ($minutes * 60)). אחר כך הוא יינעל לבד."
    } else {
        Notify-All "🔓 $PcName פתוח (ללא הגבלת זמן)."
    }
}

function Get-StatusText {
    $now = Get-Now
    $line = if ($State.locked) { '🔒 נעול' }
            elseif ($State.lockAt -gt 0) { "⏱ פתוח, נשארו $(Format-Minutes ($State.lockAt - $now))" }
            else { '🔓 פתוח (ללא הגבלה)' }
    $net = if ($State.netBlocked) { '🚫 חסום' } else { '🌐 פתוח' }
    $sessions = @([PlWts]::GetSessions())
    $who = if ($sessions.Count -gt 0) {
        ($sessions | ForEach-Object {
            $st = if ($_.State -eq 0) { 'פעיל' } else { 'ברקע' }
            "$($_.User) ($st)"
        }) -join ', '
    } else { 'אף אחד' }
    "📊 $PcName`nמצב: $line`nאינטרנט: $net`nמחוברים: $who"
}

$HelpText = @"
שליטה במחשב $PcName

🔒 נעל: מנתק את הילדים אחרי דקה, חוסם את החשבונות ואת האינטרנט
⚡ נעל מיד: אותו דבר, בלי דקת אזהרה
🔓 פתח: פותח את המחשב בלי הגבלת זמן
⏱ חצי שעה / שעה: פותח ונועל לבד בסוף הזמן (אזהרה 5 דקות לפני)
➕ 15 דקות: מוסיף זמן לטיימר
🚫 חסום אינטרנט: רק האינטרנט נחסם, המחשב ממשיך לעבוד
🌐 החזר אינטרנט: מחזיר את האינטרנט
📊 מצב: מי מחובר ומה המצב

פקודות טקסט:
/time 45 פותח ל-45 דקות
/add 10 מוסיף 10 דקות
/msg טקסט מקפיץ הודעה על המסך של הילדים
"@

function Handle-Message($msg) {
    $chatId = [string]$msg.chat.id
    if ($AllowedChats -notcontains $chatId) { Write-Log "ignored message from chat $chatId"; return }
    $text = ([string]$msg.text).Trim()
    if (-not $text) { return }
    $key = Get-ButtonKey $text
    if ($ButtonCommands.ContainsKey($key)) { $text = $ButtonCommands[$key] }
    if (-not $text.StartsWith('/')) { Send-To $chatId $HelpText; return }

    $parts = $text -split '\s+', 2
    $cmd = ($parts[0] -replace '@.*$', '').ToLower()
    $arg = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
    Write-Log "command from ${chatId}: $cmd $arg"

    switch ($cmd) {
        '/start'   { Send-To $chatId $HelpText }
        '/help'    { Send-To $chatId $HelpText }
        '/lock'    { Do-Lock 60 '' }
        '/locknow' { Do-Lock 0 '' }
        '/unlock'  { Do-Unlock 0 }
        '/time' {
            $n = 0
            if ([int]::TryParse($arg, [ref]$n) -and $n -ge 1 -and $n -le 720) { Do-Unlock $n }
            else { Send-To $chatId 'כתוב מספר דקות, למשל: /time 45' }
        }
        '/add' {
            $n = 0
            if (-not ([int]::TryParse($arg, [ref]$n) -and $n -ge 1 -and $n -le 720)) {
                Send-To $chatId 'כתוב מספר דקות, למשל: /add 10'; break
            }
            if ($State.locked -or $State.lockAt -le 0) { Do-Unlock $n }
            else {
                $State.lockAt += $n * 60
                if ($State.lockAt - (Get-Now) -gt 300) { $State.warned = $false }
                Save-State
                Send-KidsPopup "קיבלתם עוד $n דקות." 15
                Notify-All "➕ נוספו $n דקות. ב-$PcName נשארו $(Format-Minutes ($State.lockAt - (Get-Now)))."
            }
        }
        '/netoff' {
            $State.netBlocked = $true; Save-State
            try { Add-NetBlock; Notify-All "🚫 האינטרנט ב-$PcName חסום. המחשב עצמו ממשיך לעבוד." }
            catch { Write-Log "netoff failed: $_"; Send-To $chatId "שגיאה בחסימת האינטרנט: $_" }
        }
        '/neton' {
            if ($State.locked) { Send-To $chatId 'המחשב נעול. כדי להחזיר אינטרנט לחץ על 🔓 פתח.'; break }
            $State.netBlocked = $false; Save-State
            try { Remove-NetBlock; Notify-All "🌐 האינטרנט ב-$PcName חזר." }
            catch { Write-Log "neton failed: $_"; Send-To $chatId "שגיאה: $_" }
        }
        '/status'  { Send-To $chatId (Get-StatusText) }
        '/msg' {
            if (-not $arg) { Send-To $chatId 'כתוב: /msg ואחריו את ההודעה'; break }
            Send-KidsPopup $arg 120
            $n = (Get-KidSessions).Count
            Send-To $chatId $(if ($n -gt 0) { '✉️ ההודעה הוצגה על המסך.' } else { 'אף ילד לא מחובר כרגע.' })
        }
        default { Send-To $chatId $HelpText }
    }
}

# ---------------------------------------------------------------- enforcement (runs every loop)
$script:KnownKidSessions = @{}

function Enforce-Lock {
    if ($State.locked) {
        if (Test-AnyKidEnabled) { Set-KidsEnabled $false }
        if ((Get-Now) -ge $State.graceUntil) {
            foreach ($s in Get-KidSessions) {
                Write-Log "logoff $($s.User) (session $($s.Id))"
                [void][PlWts]::Logoff($s.Id)
            }
        }
    }
    if ($State.netBlocked -and -not (Test-NetBlockRules)) {
        try { Add-NetBlock } catch { Write-Log "re-add net block failed: $_" }
    }
}

function Check-Timer {
    if ($State.locked -or $State.lockAt -le 0) { return }
    $left = $State.lockAt - (Get-Now)
    if ($left -le 0) {
        Do-Lock 0 ' (הזמן נגמר)'
    } elseif ($left -le 300 -and -not $State.warned) {
        $State.warned = $true; Save-State
        Send-KidsPopup "נשארו עוד $(Format-Minutes $left) והמחשב יינעל." 60
        Notify-All "⏳ ב-$PcName נשארו $(Format-Minutes $left)."
    }
}

function Watch-Logons {
    # Tell the parent when a kid logs in (useful to know they sat down at the computer).
    $current = @{}
    foreach ($s in Get-KidSessions) {
        $key = "$($s.Id):$($s.User)"
        $current[$key] = $true
        if (-not $KnownKidSessions.ContainsKey($key)) {
            Notify-All "👤 $($s.User) נכנס/ה ל-$PcName."
        }
    }
    $script:KnownKidSessions = $current
}

# ---------------------------------------------------------------- main loop
Write-Log "agent started (pc=$PcName, kids=$($Kids -join ','))"
try { Enforce-Lock; Check-Timer } catch { Write-Log "startup enforce failed: $_" }
foreach ($s in Get-KidSessions) { $KnownKidSessions["$($s.Id):$($s.User)"] = $true }
Notify-All "💻 $PcName נדלק.`n$(Get-StatusText)"

while ($true) {
    try {
        $resp = Invoke-Tg 'getUpdates' @{ offset = [long]$State.offset; timeout = 20; allowed_updates = @('message') }
        foreach ($u in @($resp.result)) {
            if ($null -eq $u) { continue }
            $State.offset = [long]$u.update_id + 1
            Save-State
            # ignore stale commands (e.g. sent while the computer was off)
            if ($u.message -and ((Get-Now) - [long]$u.message.date) -lt 600) {
                try { Handle-Message $u.message } catch { Write-Log "handle failed: $_" }
            }
        }
    } catch {
        Write-Log "telegram poll failed: $_"
        Start-Sleep -Seconds 10
    }
    try { Check-Timer; Enforce-Lock; Watch-Logons } catch { Write-Log "enforce failed: $_" }
}
