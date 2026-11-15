[CmdletBinding()]
param([ValidateSet('Install','Verify','StageOnly')][string]$Mode='Install')
# Copies an already hash-verified runtime bundle to a stable per-user directory.
# Never writes WSL account state, initializes services, or edits Windows network settings.
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$base=Join-Path $env:LOCALAPPDATA 'TianShuV6'
$target=Join-Path $base 'current'
$desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) '天枢智策 V6（本机服务器）.lnk'
$exe=Join-Path $PSHOME 'powershell.exe'
function Verify-Package([string]$Root) {
    $sumFile=Join-Path $Root 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $sumFile -PathType Leaf)) { throw '安装包没有 SHA256SUMS.txt，拒绝安装。' }
    $found=@{}
    foreach($line in [IO.File]::ReadAllLines($sumFile)) {
        if ($line -cnotmatch '^([0-9a-f]{64})  (.+)$') { throw '文件清单不合法。' }
        $digest=$matches[1]; $name=$matches[2]
        if ($name -match '(^[/\\]|\\|:|(^|/)\.\.?(/|$))' -or $found.ContainsKey($name)) { throw '安装文件路径不安全。' }
        $found[$name]=$true
        $full=[IO.Path]::GetFullPath((Join-Path $Root ($name.Replace('/',[IO.Path]::DirectorySeparatorChar))))
        if (-not $full.StartsWith($Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw '安装文件越界。' }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw '安装文件缺失：'+$name }
        $part=$full
        while($part.Length -gt $Root.Length) {
            $item=Get-Item -LiteralPath $part -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '不允许符号链接。' }
            $part=Split-Path -Path $part -Parent
        }
        if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) { throw '文件校验失败：'+$name }
    }
    foreach($name in @('TianShu-Desktop.ps1','TianShu-Install.ps1','TianShu-Install.cmd','windows-host.ps1','host-runtime.js','manifest.json','source.json')) {
        if (-not $found.ContainsKey($name)) { throw '缺少启动模块：'+$name }
    }
    $files=@(Get-ChildItem -LiteralPath $Root -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($Root.Length+1).Replace('\','/') } | Where-Object { $_ -ne 'SHA256SUMS.txt' })
    if ($files.Count -ne $found.Count -or @($files | Where-Object { -not $found.ContainsKey($_) }).Count -gt 0) { throw '发现不在校验清单中的文件。' }
    $identity=Get-Content -LiteralPath (Join-Path $Root 'source.json') -Raw | ConvertFrom-Json
    if ([string]$identity.sourceSha -cnotmatch '^[0-9a-f]{40}$' -or $identity.sourceSha -cne $identity.controlsSourceSha) { throw '应用和控制器版本不一致。' }
    return [string]$identity.sourceSha
}
function Install-Shortcut {
    $desktopFolder=Split-Path -Path $desktop -Parent
    if (-not (Test-Path -LiteralPath $desktopFolder -PathType Container)) {
        New-Item -ItemType Directory -Path $desktopFolder -Force | Out-Null
    }
    $arguments='-NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $target 'TianShu-Desktop.ps1')+'" -Mode Gui'
    $shell=New-Object -ComObject WScript.Shell
    if(Test-Path -LiteralPath $desktop -PathType Leaf) {
        $old=$shell.CreateShortcut($desktop)
        if (-not $old.TargetPath -or [IO.Path]::GetFullPath($old.TargetPath) -ine [IO.Path]::GetFullPath($exe) -or $old.Arguments -cne $arguments) {
            throw '桌面已有同名但不同内容的快捷方式，拒绝覆盖。'
        }
    }
    $link=$shell.CreateShortcut($desktop)
    $link.TargetPath=$exe
    $link.Arguments=$arguments
    $link.WorkingDirectory=$target
    $link.Description='天枢智策 V6 一键管理现有 Windows/WSL 后台'
    $link.Save()
}
try {
    if($env:OS -ne 'Windows_NT') { throw '请使用 Windows 电脑。' }
    $sha=Verify-Package $source
    if($Mode -eq 'Verify') { Write-Output ('PACKAGE_VERIFIED:'+$sha); exit 0 }
    Add-Type -AssemblyName System.Windows.Forms
    if(-not (Test-Path -LiteralPath $base)) { New-Item -ItemType Directory -Path $base | Out-Null }
    if($source -ine [IO.Path]::GetFullPath($target).TrimEnd('\')) {
        $stage=Join-Path $base ('staging-'+[Guid]::NewGuid().ToString('N'))
        $previous=Join-Path $base ('previous-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
        New-Item -ItemType Directory -Path $stage | Out-Null
        try {
            foreach($entry in Get-ChildItem -LiteralPath $source -Force) { Copy-Item -LiteralPath $entry.FullName -Destination $stage -Recurse -Force }
            $null=Verify-Package $stage
            if(Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $previous }
            try { Move-Item -LiteralPath $stage -Destination $target }
            catch {
                if(-not (Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $previous)) { Move-Item -LiteralPath $previous -Destination $target }
                throw
            }
        } finally {
            if(Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        }
    }
    Install-Shortcut
    if ($Mode -eq 'StageOnly') { Write-Output ('STAGED:'+$sha); exit 0 }
    [Windows.Forms.MessageBox]::Show('安装完成：桌面出现“天枢智策 V6（本机服务器）”。原账户、持仓、历史与网络设置没有被更改。','天枢智策 V6','OK','Information') | Out-Null
    & $exe -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $target 'TianShu-Desktop.ps1') -Mode Gui
    exit $LASTEXITCODE
} catch {
    if($Mode -eq 'Install') {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show('安装未完成：'+$_.Exception.Message+'。原账户和服务器没有被覆盖。','天枢智策 V6','OK','Error') | Out-Null
    } elseif ($Mode -eq 'StageOnly') { Write-Error ('PACKAGE_STAGING_FAILED: '+$_.Exception.Message) } else { Write-Error 'PACKAGE_VERIFICATION_FAILED' }
    exit 1
}
