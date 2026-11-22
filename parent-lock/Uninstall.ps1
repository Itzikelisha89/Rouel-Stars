# ParentLock uninstaller - run via uninstall.bat (asks for administrator rights).
#Requires -Version 5.1
$ErrorActionPreference = 'Continue'
$Base = 'C:\ProgramData\ParentLock'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Please run uninstall.bat (it asks for administrator rights).' -ForegroundColor Red; exit 1
}

Stop-ScheduledTask -TaskName 'ParentLock' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*ParentLock.ps1*' } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Unregister-ScheduledTask -TaskName 'ParentLock' -Confirm:$false -ErrorAction SilentlyContinue

# give the kids' accounts and the internet back
$configPath = Join-Path $Base 'config.json'
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($u in @($config.kidAccounts)) {
        try { Enable-LocalUser -Name $u } catch { & net.exe user "$u" /active:yes | Out-Null }
    }
}
Get-NetFirewallRule -Group 'ParentLock' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

Set-Location $env:SystemRoot
Remove-Item -Path $Base -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'ParentLock was removed. The kids'' accounts and the internet are open.' -ForegroundColor Green
Write-Host '(Accounts whose admin rights were removed stay standard users.)' -ForegroundColor DarkGray
