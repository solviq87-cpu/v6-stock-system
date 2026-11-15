[CmdletBinding()]
param(
    [ValidateSet('Ubuntu-24.04', 'Ubuntu')]
    [string]$Distribution = 'Ubuntu-24.04'
)
$ErrorActionPreference = 'Stop'
try {
    if ($env:OS -ne 'Windows_NT') { throw '仅支持 Windows。' }
    $controller = Join-Path $PSScriptRoot 'windows-host.ps1'
    if (-not (Test-Path -LiteralPath $controller -PathType Leaf)) { throw '启动文件缺失，请重新下载正式安装包。' }
    $powershell = Join-Path $PSHOME 'powershell.exe'
    & $powershell -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File $controller -Action Start -Distribution $Distribution
    if ($LASTEXITCODE -ne 0) { throw '本机后台启动检查失败，现有账户和数据未被重装。' }
    & $powershell -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File $controller -Action Open -Distribution $Distribution
    if ($LASTEXITCODE -ne 0) { throw '浏览器打开检查失败，请确认 http://127.0.0.1:8787/ 是否可访问。' }
    exit 0
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
        ('天枢智策暂时无法启动。' + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine +
         '原有数据未被重置。请使用原安装包中的 INSTALL.cmd 检查环境。'),
        '天枢智策 V6', 'OK', 'Warning')
    exit 1
}
