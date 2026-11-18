[CmdletBinding()]
param([ValidateSet('Setup','Probe','Verify')][string]$Mode='Setup')
# Guided, per-user Windows first run. Never migrate, overwrite or promote an account.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$hostExe=Join-Path $PSHOME 'powershell.exe'
$installer=Join-Path $PSScriptRoot 'TianShu-Install.ps1'
$staged=Join-Path $env:LOCALAPPDATA 'TianShuV6\current'
$distributionFile=Join-Path $env:LOCALAPPDATA 'TianShuV6\WSLDistribution.txt'
function Check-Files {
    foreach($file in @('TianShu-Install.ps1','TianShu-Desktop.ps1','windows-host.ps1',
                        'install-node.sh','manifest.json','source.json','SHA256SUMS.txt')) {
        if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) {
            throw ('缺少安装文件：'+$file)
        }
    }
}
function Verify-Archive {
    & $hostExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -Mode Verify
    if($LASTEXITCODE -ne 0) { throw '完整性校验未通过。请勿使用来历不明或损坏的安装程序。' }
}
if($Mode -eq 'Probe') {
    Check-Files
    Write-Output 'NATIVE_FIRST_RUN_PROBE_OK'
    exit 0
}
try {
    if($env:OS -ne 'Windows_NT') { throw '只支持 Windows 电脑。' }
    Check-Files
    Verify-Archive
    if($Mode -eq 'Verify') { exit 0 }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.Application]::EnableVisualStyles()
    function Notice([string]$message,[string]$icon='Information') {
        [void][Windows.Forms.MessageBox]::Show($message,'天枢智策 V6 · 安装向导','OK',$icon)
    }
    function Consent([string]$message) {
        return ([Windows.Forms.MessageBox]::Show($message,'天枢智策 V6 · 安装向导',
            'YesNo','Question','Button2') -eq [Windows.Forms.DialogResult]::Yes)
    }
    # Stage a verified application/controller copy only. Previous WSL account is untouched.
    & $hostExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -Mode StageOnly
    if($LASTEXITCODE -ne 0) { throw '安装运行文件失败；已存在的账户没有被初始化或替换。' }
    $controller=Join-Path $staged 'windows-host.ps1'
    if(-not (Test-Path -LiteralPath $controller -PathType Leaf)) { throw '本地运行控制器未就绪。' }
    $wsl=Get-Command wsl.exe -ErrorAction SilentlyContinue
    if($null -eq $wsl) {
        Notice 'Windows 未找到微软 WSL。请更新 Windows 并启用 WSL2，然后重新打开桌面「天枢智策 V6」。' 'Warning'
        exit 2
    }
    $raw=(& $wsl.Source --list --quiet 2>&1 | Out-String) -replace [char]0,''
    $available=@()
    foreach($d in @('Ubuntu-24.04','Ubuntu')) {
        if($raw -match ('(?m)(^|[\r\n])\s*\*?\s*'+[regex]::Escape($d)+'\s*(?=[\r\n]|$)')) {
            $available+= $d
        }
    }
    if($available.Count -eq 0) {
        if(-not (Consent '此电脑还没有 Ubuntu WSL。是否允许执行微软官方 WSL 安装？Windows 可能要求管理员批准、重启以及第一次设置 Ubuntu 用户密码。')) {
            Notice '已保留桌面快捷方式。以后双击它，可继续检查环境；本次未安装 WSL。'
            exit 0
        }
        $p=Start-Process -FilePath $wsl.Source -ArgumentList @('--install','-d','Ubuntu-24.04') -Verb RunAs -Wait -PassThru
        if($p.ExitCode -ne 0) { throw '微软官方 WSL 安装未完成。' }
        Notice '已执行微软 WSL 安装。若提示需要重启，请先重启 Windows；然后打开 Ubuntu 完成首次本机用户设置，再双击桌面「天枢智策 V6」，选择「继续安装环境」。'
        exit 0
    }
    # Preserve an explicitly selected distro; never silently switch to another ledger.
    $preferred=$null
    if(Test-Path -LiteralPath $distributionFile -PathType Leaf) {
        $preferred=([IO.File]::ReadAllText($distributionFile)).Trim()
        if($preferred -notin @('Ubuntu-24.04','Ubuntu')) { throw '已保存的 Ubuntu 选择无效，拒绝自动修改账户位置。' }
        if($available -notcontains $preferred) { throw '上次安装使用的 Ubuntu 不可用；拒绝切换到另一个账户环境。' }
    }
    # WSL boots with the existing default user; never create a Linux user or reset a password.
    $oldLocations=@()
    foreach($d in $available) {
        $found=(& $wsl.Source --distribution $d --exec bash -c 'if [ -e "$HOME/.tian-shu-local" ]; then printf EXISTING; else printf NONE; fi' 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0) { throw ('无法检查 '+$d+' 的已有数据。请先从开始菜单打开 Ubuntu 完成首次设置。') }
        if($found -eq 'EXISTING') { $oldLocations+= $d }
        elseif($found -ne 'NONE') { throw ('无法确认 '+$d+' 的原安装目录。') }
    }
    if($oldLocations.Count -gt 1) { throw '发现多个 Ubuntu 账户目录。为了保护原有账本，不能自动选择。' }
    $chosen=if($preferred){$preferred}elseif($oldLocations.Count -eq 1){$oldLocations[0]}else{$available[0]}
    if($oldLocations.Count -eq 1 -and $oldLocations[0] -ne $chosen) {
        throw '发现已有账户与保存的 Ubuntu 位置不一致；拒绝自动新建第二账户。'
    }
    $details=((& $wsl.Source --list --verbose 2>&1 | Out-String) -replace [char]0,'')
    if(-not [regex]::IsMatch($details,'(?m)^\s*\*?\s*'+[regex]::Escape($chosen)+'\s+.+\s+2\s*$')) {
        throw ('无法确认 '+$chosen+' 是 WSL2；本程序不会自动转换旧发行版。')
    }
    function Tools-Ready([string]$d) {
        & $wsl.Source --distribution $d --exec bash -c 'for p in python3 curl flock tar sha256sum mktemp; do command -v "$p" >/dev/null || exit 7; done'
        return ($LASTEXITCODE -eq 0)
    }
    if(-not (Tools-Ready $chosen)) {
        if(-not (Consent 'Ubuntu 缺少必要工具。是否允许通过 Ubuntu 官方软件源安装 Python、curl、flock 等依赖？不会修改原有持仓、密码或交易配置。')) {
            Notice '未安装缺少的依赖。可通过桌面快捷方式继续安装。'
            exit 0
        }
        & $wsl.Source --distribution $chosen --user root --exec bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y python3 python3-venv curl util-linux ca-certificates tar xz-utils'
        if($LASTEXITCODE -ne 0 -or -not (Tools-Ready $chosen)) {
            throw '安装 Ubuntu 基础工具失败；请检查 Ubuntu 官方软件源的网络连通性。'
        }
    }
    function Node-Ready([string]$d) {
        $rawVersion=(& $wsl.Source --distribution $d --exec bash -c 'export PATH="$HOME/.local/bin:$PATH"; node --version' 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $rawVersion -notmatch '^v([0-9]+)\.([0-9]+)\.') { return $false }
        $major=[int]$Matches[1];$minor=[int]$Matches[2]
        return ($major -gt 22 -or ($major -eq 22 -and $minor -ge 6))
    }
    if(-not (Node-Ready $chosen)) {
        if(-not (Consent '没有检测到合格的 Linux Node.js。是否允许从 Node.js 官方网站下载固定版本，并在校验 SHA256 后安装到当前 Ubuntu 用户目录？')) {
            Notice '未安装 Linux Node.js。可在桌面快捷方式中继续。'
            exit 0
        }
        $linux=(& $wsl.Source --distribution $chosen --exec wslpath -a -u $staged | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or -not $linux.StartsWith('/')) { throw 'Windows 到 Ubuntu 的安装路径转换失败。' }
        & $wsl.Source --distribution $chosen --exec bash ($linux.TrimEnd('/')+'/install-node.sh')
        if($LASTEXITCODE -ne 0 -or -not (Node-Ready $chosen)) { throw 'Node.js 官方安装包的下载或校验失败；没有覆盖原版本。' }
    }
    # Store the selected Linux distribution only after it is unambiguous.
    if(-not $preferred) {
        [IO.File]::WriteAllText($distributionFile,$chosen,[Text.Encoding]::ASCII)
    }
    function Run-Control([string]$action) {
        $output=@(& $hostExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $controller -Action $action -Distribution $chosen 2>&1)
        $exitCode=$LASTEXITCODE
        if($exitCode -ne 0) { throw ('后台 '+$action+' 安全检查失败，原账户和文件未被重装。') }
        $line=@($output | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1)
        if($line.Count -ne 1) { throw ('无法可靠读取 '+$action+' 的后台状态。') }
        return ($line[0] | ConvertFrom-Json)
    }
    $status=Run-Control 'Status'
    if($status.code -eq 'not-initialized') {
        if(-not (Consent '没有发现本程序在当前 Ubuntu 用户目录的正式安装。是否建立全新的私有本机研究账户？模拟自动交易和外发通知保持关闭，不接管已有云端账户。')) {
            Notice '未新建本机账户。你随时可以在桌面程序里继续安装。'
            exit 0
        }
        $null=Run-Control 'Initialize'
        $null=Run-Control 'Smoke'
        $null=Run-Control 'Stop'
        $null=Run-Control 'Start'
    } elseif($status.code -eq 'stopped') {
        $null=Run-Control 'Start'
    } elseif($status.code -eq 'running' -and $status.health -eq $true -and $status.mode -eq 'smoke') {
        $null=Run-Control 'Stop'
        $null=Run-Control 'Start'
    } elseif($status.code -eq 'running' -and $status.health -eq $true -and $status.mode -eq 'normal') {
        # Reuse healthy installed backend; no implicit code/ledger update.
    } else {
        throw '原后台状态不明确，已停止以保护订单和账户；不允许重复初始化。'
    }
    $ready=Run-Control 'Status'
    if($ready.code -ne 'running' -or $ready.health -ne $true -or $ready.mode -ne 'normal') {
        throw '后台未通过本机健康检查。运行目录和备份保持原样。'
    }
    $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/' -TimeoutSec 8
    if($page.StatusCode -ne 200 -or ([string]$page.Content) -notmatch 'fayo-root') {
        throw '新版绯曜页面未通过验证，不会把历史旧 UI 冒充新系统。'
    }
    Start-Process 'http://127.0.0.1:8787/'
    Notice '安装并启动成功！以后双击桌面「天枢智策 V6」即可打开。首次请在本机设置密码；手机远程访问、云端联动与自动应用更新仍需单独验收。'
    exit 0
} catch {
    if($Mode -eq 'Setup') {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [void][Windows.Forms.MessageBox]::Show(('安装未完成：'+[Environment]::NewLine+$_.Exception.Message+
            [Environment]::NewLine+'原账户、订单和已有运行状态未被强制重建。'),'天枢智策 V6','OK','Warning')
    } else {
        Write-Error 'FIRST_RUN_VERIFICATION_FAILED'
    }
    exit 1
}
