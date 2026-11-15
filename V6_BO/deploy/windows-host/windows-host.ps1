[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Initialize', 'Smoke', 'Start', 'Stop', 'Status', 'Open', 'Update', 'ApplyUpdate', 'UpdateStatus', 'PauseUpdates', 'ResumeUpdates', 'WatchUpdates', 'Audit', 'NetworkStatus')]
    [string]$Action = 'Menu',
    [string]$Distribution = 'Ubuntu-24.04',
    [string]$InstallationHome = '',
    [ValidatePattern('^$|^[a-f0-9]{40}$')]
    [string]$ApproveSensitive = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-HostAction([string]$Selected, [string]$InputJson = '') {
    $wsl = (Get-Command wsl.exe -ErrorAction Stop).Source
    if ($Distribution -notmatch '^Ubuntu(?:-[0-9.]+)?$') { throw 'Use an explicitly installed Ubuntu WSL distribution.' }
    $linuxPath = & $wsl --distribution $Distribution --exec wslpath -a -u $PSScriptRoot
    if ($LASTEXITCODE -ne 0 -or @($linuxPath).Count -ne 1 -or [string]$linuxPath -notmatch '^/' -or [string]$linuxPath -match "[\r\n]") {
        throw 'WSL Ubuntu is unavailable. See README.zh-CN.md; no installation or system setting was changed.'
    }
    $bundle = ([string]$linuxPath).Trim()
    $script = @{ Initialize = 'init.sh'; Smoke = 'start.sh'; Start = 'start.sh'; Stop = 'stop.sh'; Status = 'check.sh'; Update = 'update.sh'; ApplyUpdate = 'update.sh'; UpdateStatus = 'update.sh'; PauseUpdates = 'update.sh'; ResumeUpdates = 'update.sh'; WatchUpdates = 'watch-updates.sh'; Audit = 'host-audit.sh'; NetworkStatus = 'network-check.sh' }[$Selected]
    if (-not $script) { throw 'Invalid action.' }
    $scriptArgs = @('--distribution', $Distribution, '--exec', 'bash', "$bundle/$script")
    $updateAction = @{ Update = 'check'; ApplyUpdate = 'apply'; UpdateStatus = 'status'; PauseUpdates = 'pause'; ResumeUpdates = 'resume' }[$Selected]
    if ($updateAction) { $scriptArgs += $updateAction }
    if ($InstallationHome) {
        if ($InstallationHome -notmatch '^/' -or $InstallationHome -match "[\r\n]") { throw 'InstallationHome must be an absolute WSL Linux path.' }
        if ($Selected -in @('Audit', 'NetworkStatus')) { throw 'This read-only check does not accept InstallationHome.' }
        $scriptArgs += @('--home', $InstallationHome)
    }
    if ($Selected -eq 'Initialize') { $scriptArgs += @('--bundle', $bundle) }
    if ($Selected -eq 'Smoke') { $scriptArgs += '--smoke' }
    if ($ApproveSensitive) {
        if ($Selected -ne 'ApplyUpdate') { throw 'ApproveSensitive is only valid for an explicit ApplyUpdate.' }
        $scriptArgs += @('--approve-sensitive', $ApproveSensitive)
    }
    if ($Selected -eq 'NetworkStatus') { $InputJson | & $wsl @scriptArgs }
    else { & $wsl @scriptArgs }
    if ($LASTEXITCODE -ne 0) { throw "WSL action did not pass (exit $LASTEXITCODE). Read its result; do not overwrite the private app directory." }
}

function Show-HostAudit {
    # Show no task arguments: existing command lines may contain private tokens.
    $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
        $_.TaskName -match '(?i)tian.?shu|v6|stock' -or $_.TaskPath -match '(?i)tian.?shu|v6|stock' -or
        @($_.Actions | Where-Object { $_.Execute -match '(?i)tian.?shu|v6.stock|safe-updater|watch-updates' -or $_.Arguments -match '(?i)tian.?shu|v6.stock|safe-updater|watch-updates' }).Count -gt 0
    })
    [pscustomobject]@{ scope = 'Windows scheduled tasks'; matchingTasks = $tasks.Count; changed = $false }
    $tasks | Select-Object TaskName, State
    Invoke-HostAction 'Audit'
    Write-Host 'Audit only. No task, service, firewall, VPN or power setting was changed. Review existing writers before enabling one watcher.'
}

function Test-PrivateNetwork {
    $status = Test-WindowsEndpoint
    if (-not $status.hasPassword) { throw 'Set the developer password before testing remote access.' }
    $tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
    $serve = & $tailscale serve status --json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve configuration is unavailable; no network setting was changed.' }
    # Parse in the shared, bounded validator; it emits no Tailnet address or auth data.
    Invoke-HostAction -Selected 'NetworkStatus' -InputJson ($serve -join "`n")
    Write-Host 'A valid Serve configuration does not prove a phone connected. Verify the same account and holdings through your private HTTPS URL on the phone.'
}

function Test-WindowsEndpoint {
    # A Linux loopback check does not establish Windows-to-WSL forwarding.
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/lock/status' -TimeoutSec 5
    $status = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -ne 200 -or $null -eq $status.hasPassword -or $status.local -ne $false) {
        throw 'The expected authenticated V6 service was not verified through Windows loopback.'
    }
    Write-Host 'Windows -> WSL HTTP check passed. This does not verify phone connectivity.'
    if (-not $status.hasPassword) { Write-Host 'Set the developer password in the local page BEFORE enabling remote access.' }
    return $status
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Run this entrypoint on Windows; Linux users can run the shell entrypoints directly.' }
    if ($Action -eq 'Menu') {
        Write-Host 'Tian Shu local host (WSL Ubuntu, no paid server)'
        Write-Host '1 Initialize a NEW private installation'
        Write-Host '2 Smoke start (no collection)'
        Write-Host '3 Start local research service'
        Write-Host '4 Check status'
        Write-Host '5 Stop this installation'
        Write-Host '6 Open local page'
        Write-Host '7 Check GitHub update (dry-run, keep running service)'
        Write-Host '8 Update status'
        Write-Host '9 Pause update checks'
        Write-Host '10 Resume update checks'
        Write-Host '11 Audit existing Windows/WSL tasks (read-only)'
        Write-Host '12 Check private HTTPS configuration (read-only)'
        Write-Host '13 Watch for updates every 15 min (dry-run, Ctrl+C to stop)'
        $choice = Read-Host 'Choose 1-13'
        $Action = @{ '1' = 'Initialize'; '2' = 'Smoke'; '3' = 'Start'; '4' = 'Status'; '5' = 'Stop'; '6' = 'Open'; '7' = 'Update'; '8' = 'UpdateStatus'; '9' = 'PauseUpdates'; '10' = 'ResumeUpdates'; '11' = 'Audit'; '12' = 'NetworkStatus'; '13' = 'WatchUpdates' }[$choice]
        if (-not $Action) { throw 'No action selected.' }
    }
    if ($Action -eq 'Audit') {
        Show-HostAudit
    } elseif ($Action -eq 'NetworkStatus') {
        Test-PrivateNetwork
    } elseif ($Action -eq 'Open') {
        $null = Test-WindowsEndpoint
        Start-Process 'http://127.0.0.1:8787/'
    } else {
        Invoke-HostAction $Action
        if ($Action -in @('Smoke', 'Start')) { $null = Test-WindowsEndpoint }
        if ($Action -eq 'Start') { Write-Host 'For the first test, keep an Ubuntu window open. WSL survival and automatic restart are not yet verified on this PC.' }
    }
    exit 0
} catch {
    # Fixed local errors only; never dump environment variables, config or account responses.
    Write-Host ('Not completed: ' + $_.Exception.Message)
    exit 1
}
