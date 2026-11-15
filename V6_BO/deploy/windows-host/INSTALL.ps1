[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-Message([string]$Message, [string]$Kind = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($Message, '天枢智策 V6 安装向导', 'OK', $Kind)
}
function Ask-Consent([string]$Message) {
    $answer = [System.Windows.Forms.MessageBox]::Show($Message, '天枢智策 V6 安装向导', 'YesNo', 'Question', 'Button2')
    return ($answer -eq [System.Windows.Forms.DialogResult]::Yes)
}
function Check-Bundle([string]$Folder) {
    $sums = Join-Path $Folder 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $sums -PathType Leaf)) { throw '安装包缺少 SHA256SUMS.txt，拒绝继续。' }
    $expected = @{}
    foreach ($line in (Get-Content -LiteralPath $sums -Encoding Ascii)) {
        if ($line -cnotmatch '^([a-f0-9]{64})  (.+)$') { throw '安装包校验表格式错误。' }
        $hash = $Matches[1]
        $relative = $Matches[2]
        if ($relative -match '(^/|\\|:|(^|/)\.\.?(/|$))' -or $expected.ContainsKey($relative)) {
            throw '安装包存在非法或重复路径。'
        }
        $expected[$relative] = $hash
        $file = Join-Path $Folder ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw '安装包文件缺失：' + $relative }
        $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $hash) { throw '安装包哈希不一致，拒绝安装：' + $relative }
    }
    $entries = @(Get-ChildItem -LiteralPath $Folder -Recurse -Force -ErrorAction Stop)
    if (@($entries | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count -gt 0) {
        throw '安装包包含链接路径，拒绝安装。'
    }
    $fileCount = @($entries | Where-Object { -not $_.PSIsContainer }).Count
    if ($expected.Count -lt 5 -or $fileCount -ne ($expected.Count + 1)) {
        throw '安装包文件集合不完整或含额外文件。'
    }
    $info = Get-Content -LiteralPath (Join-Path $Folder 'source.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath (Join-Path $Folder 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($info.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or
        $info.controlsSourceSha -cne $info.sourceSha -or
        $manifest.sourceSha -cne $info.sourceSha) {
        throw '安装包的源码版本与控制文件不一致。'
    }
    return [string]$info.sourceSha
}
function Get-HostStatus([string]$Folder, [string]$Distribution) {
    $controller = Join-Path $Folder 'windows-host.ps1'
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    $messages = @(& $powerShell -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File $controller -Action Status -Distribution $Distribution 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('无法检查已有安装：' + (($messages | Out-String).Trim())) }
    $jsonLine = @($messages | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
    if ($jsonLine.Count -ne 1) { throw '安装状态未知，停止以保护已有数据。' }
    $status = $jsonLine[0] | ConvertFrom-Json
    if ($status.code -notin @('not-initialized', 'running', 'stopped')) { throw '安装状态不可识别，停止以保护已有数据。' }
    return $status
}
function Run-HostAction([string]$Folder, [string]$Distribution, [string]$Action) {
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    & $powerShell -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $Folder 'windows-host.ps1') -Action $Action -Distribution $Distribution
    if ($LASTEXITCODE -ne 0) { throw ('安装阶段 ' + $Action + ' 未通过；已有数据不会重装或覆盖。') }
}
function Test-LinuxTools([string]$Distribution) {
    & wsl.exe --distribution $Distribution --exec bash -c 'for tool in python3 curl flock tar sha256sum mktemp; do command -v "$tool" >/dev/null 2>&1 || exit 2; done'
    return ($LASTEXITCODE -eq 0)
}
function Test-LinuxNode([string]$Distribution) {
    $version = @(& wsl.exe --distribution $Distribution --exec bash -c 'export PATH="$HOME/.local/bin:$PATH"; node --version' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $version.Count -ne 1) { return $false }
    if (([string]$version[0]) -notmatch '^v([0-9]+)\.([0-9]+)\.') { return $false }
    return (([int]$Matches[1] -gt 22) -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 6))
}
function Test-ExistingInstance([string]$Distribution) {
    # This probe requires only bash. Node may not have been installed yet.
    & wsl.exe --distribution $Distribution --exec bash -c 'test -e "$HOME/.tian-shu-local"'
    return ($LASTEXITCODE -eq 0)
}
function Install-LinuxTools([string]$Distribution) {
    if (-not (Ask-Consent 'Ubuntu 缺少基础运行依赖。是否允许通过 Ubuntu 官方 apt 软件源安装 Python、curl、文件锁等工具？不会修改 Windows 防火墙、VPN 或已有账户。')) {
        throw '基础工具尚未准备；未做系统修改。'
    }
    & wsl.exe --distribution $Distribution --user root --exec bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y python3 python3-venv curl util-linux ca-certificates tar xz-utils'
    if ($LASTEXITCODE -ne 0 -or -not (Test-LinuxTools $Distribution)) {
        throw 'Ubuntu 官方依赖安装失败，请检查网络与 WSL 状态。'
    }
}
function Install-LinuxNode([string]$Distribution, [string]$Folder) {
    if (-not (Ask-Consent '未检测到符合要求的 Linux Node.js（至少 22.6）。是否从 Node.js 官方下载固定版本并校验哈希后安装到 Ubuntu 当前用户目录？')) {
        throw 'Node.js 尚未准备；未做系统修改。'
    }
    $pathLines = @(& wsl.exe --distribution $Distribution --exec wslpath -a -u $Folder)
    if ($LASTEXITCODE -ne 0 -or $pathLines.Count -ne 1 -or ([string]$pathLines[0]) -notmatch '^/') {
        throw '无法安全转换安装包的 WSL 路径。'
    }
    $linuxPath = ([string]$pathLines[0]).TrimEnd('/')
    & wsl.exe --distribution $Distribution --exec bash ($linuxPath + '/install-node.sh')
    if ($LASTEXITCODE -ne 0 -or -not (Test-LinuxNode $Distribution)) {
        throw 'Linux Node.js 安装未通过校验，未替换现有程序。'
    }
}
function Stable-Copy([string]$Folder, [string]$SourceSha) {
    $parent = Join-Path $env:LOCALAPPDATA 'TianShuV6\bundles'
    $destination = Join-Path $parent $SourceSha
    if (Test-Path -LiteralPath $destination) {
        if ((Check-Bundle $destination) -cne $SourceSha) { throw '已保存版本与新安装包不一致，停止以保护现有文件。' }
        return $destination
    }
    [void](New-Item -ItemType Directory -Path $parent -Force)
    $stage = Join-Path $parent ('staging-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $stage)
    try {
        foreach ($item in (Get-ChildItem -LiteralPath $Folder -Force)) {
            Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse -ErrorAction Stop
        }
        if ((Check-Bundle $stage) -cne $SourceSha) { throw '暂存安装包校验失败。' }
        # Only after exact-file verification, remove ZIP download-zone marks
        # from this private versioned copy. Never change global execution policy.
        foreach ($control in @('windows-host.ps1', 'OPEN.ps1', 'INSTALL.ps1')) {
            Unblock-File -LiteralPath (Join-Path $stage $control) -ErrorAction Stop
        }
        Move-Item -LiteralPath $stage -Destination $destination -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
    return $destination
}
function Make-DesktopShortcut([string]$Folder, [string]$Distribution) {
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    if (-not $desktop) { throw '无法找到 Windows 桌面目录。' }
    $link = Join-Path $desktop '天枢智策 V6.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $shortcut.Arguments = ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' +
                           (Join-Path $Folder 'OPEN.ps1') + '" -Distribution ' + $Distribution)
    $shortcut.WorkingDirectory = $Folder
    $shortcut.Description = '天枢智策 V6：启动本机服务并打开网页'
    $shortcut.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',46'
    $shortcut.Save()
}
try {
    if ($env:OS -ne 'Windows_NT') { throw '此入口只能在 Windows 上使用。' }
    $source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    $sha = Check-Bundle $source
    if (-not (Ask-Consent '将检测你的 Windows/WSL 运行环境，复用已有安装；新安装保存在独立私有目录。不会清除旧账户、启用实盘交易或购买服务。是否继续？')) {
        exit 0
    }
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    $distroList = ''
    if ($null -ne $wsl) {
        $distroList = ((& wsl.exe --list --quiet 2>&1 | Out-String) -replace [char]0, '')
    }
    $distributions = @()
    if ($distroList.Contains('Ubuntu-24.04')) { $distributions += 'Ubuntu-24.04' }
    if ($distroList -match '(?m)(^|[\r\n])\s*\*?\s*Ubuntu\s*([\r\n]|$)') { $distributions += 'Ubuntu' }
    if ($distributions.Count -eq 0) {
        if (-not (Ask-Consent '未找到可用的 Ubuntu WSL。是否授权执行微软官方 WSL 安装？Windows 可能请求管理员批准和重启；完成后请再次双击 INSTALL.cmd。')) {
            throw '需要 Windows WSL2 和 Ubuntu；尚未执行安装。'
        }
        if ($null -eq $wsl) { throw '系统没有 wsl.exe，请先通过 Windows 更新启用微软官方 WSL。' }
        $install = Start-Process -FilePath $wsl.Source -ArgumentList @('--install', '-d', 'Ubuntu-24.04') -Verb RunAs -Wait -PassThru
        if ($install.ExitCode -ne 0) { throw '微软 WSL 安装命令未成功完成。' }
        Show-Message '微软 WSL 安装命令已完成。可能需要重启 Windows 并首次打开 Ubuntu 设置本机账号。完成后再次双击 INSTALL.cmd。'
        exit 0
    }
    $installed = @()
    foreach ($d in $distributions) {
        if (Test-ExistingInstance $d) { $installed += $d }
    }
    if ($installed.Count -gt 1) { throw '两个 Ubuntu 环境都有安装目录，拒绝自动选择，防止重复服务。' }
    $distribution = if ($installed.Count -eq 1) { $installed[0] } else { $distributions[0] }
    $detail = ((& wsl.exe --list --verbose 2>&1 | Out-String) -replace [char]0, '')
    if (-not ([regex]::IsMatch($detail, ('(?m)^\s*\*?\s*' + [regex]::Escape($distribution) + '\s+.+\s+2\s*$')))) {
        throw '未能确认 Ubuntu 为 WSL2。请先通过微软官方 WSL 管理界面确认版本，安装器不会自动改动其他发行版。'
    }
    if (-not (Test-LinuxTools $distribution)) { Install-LinuxTools $distribution }
    if (-not (Test-LinuxNode $distribution)) { Install-LinuxNode $distribution $source }
    $stable = Stable-Copy $source $sha
    $status = Get-HostStatus $stable $distribution
    if ($status.code -eq 'not-initialized') {
        Run-HostAction $stable $distribution 'Initialize'
        Run-HostAction $stable $distribution 'Smoke'
        Run-HostAction $stable $distribution 'Stop'
        Run-HostAction $stable $distribution 'Start'
    } elseif ($status.code -eq 'stopped') {
        Run-HostAction $stable $distribution 'Start'
    } elseif ($status.mode -eq 'smoke') {
        if (-not $status.health) { throw '现有试运行服务不健康，拒绝自动重置。' }
        Run-HostAction $stable $distribution 'Stop'
        Run-HostAction $stable $distribution 'Start'
    } elseif (-not $status.health) {
        throw '已有后台正在运行但健康检查失败；不重装、不覆盖、不强制关闭。'
    }
    $finalState = Get-HostStatus $stable $distribution
    if ($finalState.code -ne 'running' -or -not $finalState.health -or $finalState.mode -ne 'normal') {
        throw '后台未通过最终健康检查，暂不创建已完成快捷方式。'
    }
    Make-DesktopShortcut $stable $distribution
    Show-Message '本机安装及启动检查已通过，已创建桌面「天枢智策 V6」快捷方式。首次请在本机页面设置密码。手机互联、开机自启及自动应用更新尚需单独验收。'
    Run-HostAction $stable $distribution 'Open'
    exit 0
} catch {
    Show-Message ('安装尚未完成：' + [Environment]::NewLine + $_.Exception.Message +
        [Environment]::NewLine + '不会清除已有账户或自动重复初始化。请保留当前安装包以便检查。') 'Warning'
    exit 1
}
