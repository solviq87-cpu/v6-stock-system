[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Initialize', 'Smoke', 'Start', 'Stop', 'Status', 'Open')]
    [string]$Action = 'Menu',
    [string]$Distribution = 'Ubuntu-24.04'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-HostAction([string]$Selected) {
    $wsl = (Get-Command wsl.exe -ErrorAction Stop).Source
    if ($Distribution -notmatch '^Ubuntu(?:-[0-9.]+)?$') { throw 'Use an explicitly installed Ubuntu WSL distribution.' }
    $linuxPath = & $wsl --distribution $Distribution --exec wslpath -a -u $PSScriptRoot
    if ($LASTEXITCODE -ne 0 -or @($linuxPath).Count -ne 1 -or [string]$linuxPath -notmatch '^/' -or [string]$linuxPath -match "[\r\n]") {
        throw 'WSL Ubuntu is unavailable. See README.zh-CN.md; no installation or system setting was changed.'
    }
    $bundle = ([string]$linuxPath).Trim()
    $script = @{ Initialize = 'init.sh'; Smoke = 'start.sh'; Start = 'start.sh'; Stop = 'stop.sh'; Status = 'check.sh' }[$Selected]
    if (-not $script) { throw 'Invalid action.' }
    $scriptArgs = @('--distribution', $Distribution, '--exec', 'bash', "$bundle/$script")
    if ($Selected -eq 'Initialize') { $scriptArgs += @('--bundle', $bundle) }
    if ($Selected -eq 'Smoke') { $scriptArgs += '--smoke' }
    & $wsl @scriptArgs
    if ($LASTEXITCODE -ne 0) { throw "WSL action did not pass (exit $LASTEXITCODE). Read its result; do not overwrite the private app directory." }
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
        $choice = Read-Host 'Choose 1-6'
        $Action = @{ '1' = 'Initialize'; '2' = 'Smoke'; '3' = 'Start'; '4' = 'Status'; '5' = 'Stop'; '6' = 'Open' }[$choice]
        if (-not $Action) { throw 'No action selected.' }
    }
    if ($Action -eq 'Open') {
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
