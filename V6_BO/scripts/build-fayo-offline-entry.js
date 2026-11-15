'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
function build({controlsSha,readSource,output}={}){
 if(!/^[a-f0-9]{40}$/.test(controlsSha||''))throw Error('exact-controls-sha-required');
 const read=readSource||(name=>execFileSync('git',['show',controlsSha+':V6_BO/deploy/windows-host/'+name],{cwd:ROOT,maxBuffer:1024*1024}));
 const sources=['host-runtime.js','safe-updater.js','offline-fayo-install.js'].map(name=>{const bytes=Buffer.from(read(name));return{name,data:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const ps=`$ErrorActionPreference='Stop'
$work=$null
$ok=$false
try {
    Write-Host '绯曜离线部署：使用已下载完整包，保留原账户和历史。'
    $bundle=Join-Path $env:USERPROFILE 'OneDrive\\1\\FAYO-Windows-cd3ad68\\tian-shu-windows-host'
    if (-not (Test-Path -LiteralPath (Join-Path $bundle 'manifest.json'))) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog=New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title='请选择已下载完整包中的 manifest.json，不要选择旧后台目录'
        $dialog.Filter='运行包清单|manifest.json'
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw '尚未选择完整包，没有修改原安装。' }
        $bundle=Split-Path -Parent $dialog.FileName
    }
    $assets='${JSON.stringify(sources)}' | ConvertFrom-Json
    $work=Join-Path ([IO.Path]::GetTempPath()) ('fayo-offline-'+[Guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Path $work
    foreach ($asset in $assets) {
        $bytes=[Convert]::FromBase64String($asset.data)
        $digest=[Security.Cryptography.SHA256]::Create()
        try { $sum=([BitConverter]::ToString($digest.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $digest.Dispose() }
        if ($sum -ne $asset.sha256) { throw '启动工具校验未通过。' }
        [IO.File]::WriteAllBytes((Join-Path $work $asset.name),$bytes)
    }
    $bootstrap='#!/bin/sh'+[char]10+'set -eu'+[char]10+'unset NODE_OPTIONS NODE_PATH'+[char]10+'PATH="$HOME/.local/bin:$PATH"'+[char]10+'export PATH'+[char]10+'cd -- "$(dirname -- "$0")"'+[char]10+'exec node ./offline-fayo-install.js --bundle "$1" --home "$HOME/.tian-shu-v278-test"'+[char]10
    [IO.File]::WriteAllBytes((Join-Path $work 'bootstrap.sh'),[Text.Encoding]::UTF8.GetBytes($bootstrap))
    $wsl=(Get-Command wsl.exe -ErrorAction Stop).Source
    $linuxScript=& $wsl --distribution Ubuntu-24.04 --exec wslpath -a -u (Join-Path $work 'bootstrap.sh')
    if ($LASTEXITCODE -ne 0 -or @($linuxScript).Count -ne 1 -or ([string]$linuxScript) -notmatch '^/') { throw '未能连接Ubuntu，没有修改原安装。' }
    $linuxBundle=& $wsl --distribution Ubuntu-24.04 --exec wslpath -a -u $bundle
    if ($LASTEXITCODE -ne 0 -or @($linuxBundle).Count -ne 1 -or ([string]$linuxBundle) -notmatch '^/') { throw '无法读取本地完整包，没有修改原安装。' }
    & $wsl --distribution Ubuntu-24.04 --exec bash ([string]$linuxScript).Trim() ([string]$linuxBundle).Trim()
    if ($LASTEXITCODE -ne 0) { throw '离线部署未完成，请保留窗口结果，不要手动覆盖目录。' }
    $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/' -TimeoutSec 10
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'fayo-root') { throw '后台已返回结果，但Windows尚未确认新页面。' }
    Start-Process 'http://127.0.0.1:8787/'
    Write-Host '新版绯曜已打开，请用原口令登录。手机连接尚未设置。'
    $ok=$true
} catch { Write-Host ('未完成：'+$_.Exception.Message) }
finally { if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force } }
if (-not $ok) { exit 1 }
`;
 const mark=':FAYO_OFFLINE_PAYLOAD';
 const cmd='@echo off\r\nsetlocal\r\nset "FAYO_OFFLINE_SELF=%~f0"\r\npowershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:FAYO_OFFLINE_SELF);$mark=\''+mark+'\';& ([ScriptBlock]::Create($raw.Substring($raw.LastIndexOf($mark)+$mark.Length)))"\r\nset "fayo_result=%ERRORLEVEL%"\r\npause\r\nexit /b %fayo_result%\r\n'+mark+'\r\n'+ps.replace(/\r?\n/g,'\r\n');
 if(output)fs.writeFileSync(output,cmd,{flag:'wx',mode:0o600});return{cmd,ps,controlsSha,sha256:crypto.createHash('sha256').update(cmd).digest('hex'),sizeBytes:Buffer.byteLength(cmd)};
}
module.exports={build};
