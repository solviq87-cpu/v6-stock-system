[CmdletBinding()]
param([ValidateSet('Gui','AutoStart','Probe')][string]$Mode='Gui')
# Windows PowerShell 5.1; no implicit Initialize, migration, update apply or network exposure.
$ErrorActionPreference='Stop'
$control=Join-Path $PSScriptRoot 'windows-host.ps1'
$exe=Join-Path $PSHOME 'powershell.exe'
$installed=Join-Path $env:LOCALAPPDATA 'TianShuV6\current'
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'TianShuV6-LocalServer.lnk'

function Assert-Launcher {
    if ($env:OS -ne 'Windows_NT') { throw '只支持 Windows 电脑。' }
    if (-not (Test-Path -LiteralPath $control -PathType Leaf)) { throw '启动控制器缺失，请重新安装。' }
    if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ine [IO.Path]::GetFullPath($installed).TrimEnd('\')) {
        throw '请先双击 TianShu-Install.cmd 安装桌面入口。'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $installed 'source.json'))) { throw '安装来源清单缺失。' }
}
function Run-Host([ValidateSet('Start','Stop','Status','Open','Update','NetworkStatus')][string]$Action) {
    $distro='Ubuntu-24.04'
    $distroConfig=Join-Path $env:LOCALAPPDATA 'TianShuV6\WSLDistribution.txt'
    if(Test-Path -LiteralPath $distroConfig -PathType Leaf) {
        $distro=([IO.File]::ReadAllText($distroConfig)).Trim()
        if($distro -notin @('Ubuntu-24.04','Ubuntu')) { throw 'Ubuntu 安装位置记录无效，拒绝操作其他账户。' }
    }
    $output=@(& $exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $control -Action $Action -Distribution $distro 2>&1)
    $code=$LASTEXITCODE
    $row=@($output | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1)
    $result=$null
    if ($row.Count) { try { $result=$row[-1] | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{ ExitCode=$code; Result=$result }
}
function Get-State {
    try {
        $r=Run-Host 'Status'
        if ($null -eq $r.Result) { return [pscustomobject]@{ State='error'; Label='后台状态未验证'; Sha='' } }
        $s=[string]$r.Result.code
        $sha=[string]$r.Result.sourceSha
        if ($sha.Length -gt 12) { $sha=$sha.Substring(0,12) }
        if ($s -eq 'running' -and $r.Result.health -eq $true -and $r.ExitCode -eq 0) {
            return [pscustomobject]@{ State='running'; Label='服务器运行正常'; Sha=$sha }
        }
        if ($s -eq 'stopped' -and $r.ExitCode -eq 0) {
            return [pscustomobject]@{ State='stopped'; Label='服务器已安装，尚未启动'; Sha=$sha }
        }
        if ($s -eq 'not-initialized') {
            return [pscustomobject]@{ State='missing'; Label='尚未初始化，请使用完整安装包'; Sha='' }
        }
        return [pscustomobject]@{ State='error'; Label=('后台安全检查未通过：'+$s); Sha=$sha }
    } catch {
        return [pscustomobject]@{ State='error'; Label='无法验证后台状态'; Sha='' }
    }
}
function Startup-Arguments {
    return '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $installed 'TianShu-Desktop.ps1') + '" -Mode AutoStart'
}
function Startup-IsOurs {
    if (-not (Test-Path -LiteralPath $startup -PathType Leaf)) { return $false }
    try {
        $link=(New-Object -ComObject WScript.Shell).CreateShortcut($startup)
        return ($link.TargetPath -and [IO.Path]::GetFullPath($link.TargetPath) -ieq [IO.Path]::GetFullPath($exe) -and $link.Arguments -ceq (Startup-Arguments))
    } catch { return $false }
}
function Set-Startup([bool]$Enabled) {
    if (Test-Path -LiteralPath $startup -PathType Leaf) {
        if (-not (Startup-IsOurs)) { throw '发现同名但不属于本程序的启动项，拒绝修改。' }
        if (-not $Enabled) { Remove-Item -LiteralPath $startup -Force }
        return
    }
    if (-not $Enabled) { return }
    $link=(New-Object -ComObject WScript.Shell).CreateShortcut($startup)
    $link.TargetPath=$exe
    $link.Arguments=Startup-Arguments
    $link.WorkingDirectory=$installed
    $link.Description='Windows 登录后仅启动现有 V6 后台'
    $link.WindowStyle=7
    $link.Save()
    if (-not (Startup-IsOurs)) { throw '无法确认启动快捷方式。' }
}
if ($Mode -eq 'Probe') {
    if (-not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'missing-controller' }
    Write-Output 'DESKTOP_PROBE_OK'
    exit 0
}
Assert-Launcher
if ($Mode -eq 'AutoStart') {
    try {
        $r=Run-Host 'Start'
        if ($r.ExitCode -ne 0 -or (Get-State).State -ne 'running') { exit 2 }
        exit 0
    } catch { exit 3 }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form
$form.Text='天枢智策 V6 · 本机服务器'
$form.Size=New-Object Drawing.Size(550,545)
$form.MinimumSize=$form.Size
$form.MaximumSize=$form.Size
$form.StartPosition='CenterScreen'
$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$form.BackColor=[Drawing.Color]::FromArgb(247,246,251)
$title=New-Object Windows.Forms.Label
$title.Text='天枢智策 V6  ·  服务器管理'
$title.Font=New-Object Drawing.Font('Microsoft YaHei UI',17,[Drawing.FontStyle]::Bold)
$title.ForeColor=[Drawing.Color]::FromArgb(81,58,139)
$title.Location=New-Object Drawing.Point(22,20)
$title.Size=New-Object Drawing.Size(500,42)
$form.Controls.Add($title)
$status=New-Object Windows.Forms.Label
$status.Location=New-Object Drawing.Point(24,75)
$status.Size=New-Object Drawing.Size(490,32)
$form.Controls.Add($status)
$version=New-Object Windows.Forms.Label
$version.Location=New-Object Drawing.Point(24,108)
$version.Size=New-Object Drawing.Size(490,28)
$form.Controls.Add($version)
function Button([string]$text,[int]$x,[int]$y,[int]$w) {
    $b=New-Object Windows.Forms.Button
    $b.Text=$text
    $b.Location=New-Object Drawing.Point($x,$y)
    $b.Size=New-Object Drawing.Size($w,45)
    $b.BackColor=[Drawing.Color]::White
    $b.FlatStyle='Flat'
    $b.FlatAppearance.BorderColor=[Drawing.Color]::FromArgb(209,201,231)
    $form.Controls.Add($b)
    return $b
}
$start=Button '启动服务器' 24 150 155
$open=Button '打开应用' 192 150 155
$stop=Button '停止服务器' 360 150 155
$refresh=Button '检查运行状态' 24 207 239
$update=Button '检查更新（不安装）' 276 207 239
$setup=Button '首次安装 / 自动检测所需环境' 24 268 491
$auto=New-Object Windows.Forms.CheckBox
$auto.Text='登录 Windows 后自动启动（不需要再输入命令）'
$auto.Location=New-Object Drawing.Point(24,330)
$auto.Size=New-Object Drawing.Size(490,32)
$form.Controls.Add($auto)
$note=New-Object Windows.Forms.Label
$note.Text='不会自动更新、覆盖账户、启动模拟交易或暴露公网端口。'
$note.Location=New-Object Drawing.Point(24,389)
$note.Size=New-Object Drawing.Size(490,28)
$form.Controls.Add($note)
$foot=New-Object Windows.Forms.Label
$foot.Text='手机访问需另行配置私网 HTTPS；电脑关机后后台不可用。'
$foot.Location=New-Object Drawing.Point(24,435)
$foot.Size=New-Object Drawing.Size(490,28)
$form.Controls.Add($foot)
function Refresh-State {
    $state=Get-State
    $status.Text=$state.Label
    $status.ForeColor=if ($state.State -eq 'running') { [Drawing.Color]::ForestGreen } elseif ($state.State -eq 'stopped') { [Drawing.Color]::DarkOrange } else { [Drawing.Color]::Firebrick }
    $version.Text=if ($state.Sha) { 'Git 版本：'+$state.Sha } else { '尚未验证安装版本' }
    $start.Enabled=($state.State -eq 'stopped')
    $stop.Enabled=($state.State -eq 'running')
    $open.Enabled=($state.State -eq 'running')
    $setup.Enabled=(Test-Path -LiteralPath (Join-Path $installed 'TianShu-FirstRun.ps1') -PathType Leaf)
}
function Run-Button([string]$Action) {
    $form.UseWaitCursor=$true
    [Windows.Forms.Application]::DoEvents()
    try {
        $r=Run-Host $Action
        if ($r.ExitCode -ne 0) { throw '当前操作没有通过安全检查。' }
        return $true
    } catch {
        [Windows.Forms.MessageBox]::Show('操作未完成；请保留安装目录，原账户没有被覆盖。','天枢智策','OK','Warning') | Out-Null
        return $false
    } finally { $form.UseWaitCursor=$false }
}
$start.Add_Click({ if (Run-Button 'Start') { Refresh-State } })
$stop.Add_Click({ if (Run-Button 'Stop') { Refresh-State } })
$open.Add_Click({ $null=Run-Button 'Open' })
$refresh.Add_Click({ Refresh-State })
$update.Add_Click({
    if (Run-Button 'Update') {
        [Windows.Forms.MessageBox]::Show('只读更新检查完成，程序不会自动安装。','天枢智策','OK','Information') | Out-Null
    }
})
$setup.Add_Click({
    $wizard=Join-Path $installed 'TianShu-FirstRun.ps1'
    if(-not (Test-Path -LiteralPath $wizard -PathType Leaf)) {
        [Windows.Forms.MessageBox]::Show('安装助手文件缺失，原有数据不会重置。','天枢智策','OK','Warning') | Out-Null
        return
    }
    & $exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $wizard -Mode Setup
    Refresh-State
})
$auto.Checked=Startup-IsOurs
$auto.Add_CheckedChanged({
    try {
        if ($auto.Checked) {
            $answer=[Windows.Forms.MessageBox]::Show('确认登录 Windows 后自动启动现有本地后台？不会自动升级或修改账户。','开启自动启动','YesNo','Question')
            if ($answer -ne [Windows.Forms.DialogResult]::Yes) { $auto.Checked=$false; return }
        }
        Set-Startup $auto.Checked
    } catch {
        [Windows.Forms.MessageBox]::Show('自动启动项未更改。','天枢智策','OK','Warning') | Out-Null
        $auto.Checked=Startup-IsOurs
    }
})
Refresh-State
[void][Windows.Forms.Application]::Run($form)
