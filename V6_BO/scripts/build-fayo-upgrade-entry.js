#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const FILES=['host-runtime.js','safe-updater.js','fayo-upgrade.js','fayo-model-tools.js','fayo-network.js'];
function build({sha,installationName,output,readSource}={}){
 if(!/^[a-f0-9]{40}$/.test(sha||'')||!/^\.tian-shu-[a-z0-9-]{1,60}$/.test(installationName||''))throw Error('invalid-entry-target');
 const read=readSource||((name)=>execFileSync('git',['show',sha+':V6_BO/deploy/windows-host/'+name],{cwd:ROOT,maxBuffer:1024*1024}));
 const assets=FILES.map(name=>{const bytes=Buffer.from(read(name));if(!bytes.length||bytes.length>512*1024)throw Error('invalid-entry-source');return {name,sha256:hash(bytes),data:bytes.toString('base64')};});
 const bootstrap='#!/bin/sh\nset -eu\nunset NODE_OPTIONS NODE_PATH\nPATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"\nexport PATH\ncd -- "$(dirname -- "$0")"\nexec node ./fayo-upgrade.js --expected-sha '+sha+' --installation-name '+installationName+'\n';
 assets.push({name:'bootstrap.sh',sha256:hash(bootstrap),data:Buffer.from(bootstrap).toString('base64')});
 // Keep this Windows 5.1 compatible. Embedded source is decoded to UTF-8 bytes;
 // Linux receives file paths as arguments, never shell commands or stdin text.
 const ps=`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$work = $null
$ok = $false
try {
    if ($env:OS -ne 'Windows_NT') { throw '请在你的 Windows 电脑上打开此文件。' }
    Write-Host '绯曜：正在保留原账户升级，请保持窗口打开。'
    $assets = '${JSON.stringify(assets)}' | ConvertFrom-Json
    $work = Join-Path ([IO.Path]::GetTempPath()) ('fayo-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $work
    foreach ($asset in $assets) {
        $bytes = [Convert]::FromBase64String($asset.data)
        $digest = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($digest.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $digest.Dispose() }
        if ($actual -ne $asset.sha256) { throw '入口校验未通过，尚未开始升级。' }
        [IO.File]::WriteAllBytes((Join-Path $work $asset.name), $bytes)
    }
    $wsl = (Get-Command wsl.exe -ErrorAction Stop).Source
    $linuxPath = & $wsl --distribution Ubuntu-24.04 --exec wslpath -a -u (Join-Path $work 'bootstrap.sh')
    if ($LASTEXITCODE -ne 0 -or @($linuxPath).Count -ne 1 -or ([string]$linuxPath) -notmatch '^/') { throw '未能连接 Ubuntu-24.04，没有新建或覆盖安装。' }
    & $wsl --distribution Ubuntu-24.04 --exec bash ([string]$linuxPath).Trim()
    if ($LASTEXITCODE -ne 0) { throw '升级未完成，请保留窗口最后的结果，不要手动覆盖原目录。' }
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/' -TimeoutSec 10
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'fayo-root') { throw '后台已返回结果，但 Windows 尚未连通新页面，安装与备份已保留。' }
    Start-Process 'http://127.0.0.1:8787/'
    Write-Host '绯曜已启动，正在打开页面。使用原口令登录，手机连接另行设置。'
    $ok = $true
} catch {
    Write-Host ('未完成：' + $_.Exception.Message)
} finally {
    if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force }
}
if (-not $ok) { exit 1 }
`;
 const marker=':FAYO_POWERSHELL_PAYLOAD';
 const cmd='@echo off\r\nsetlocal\r\nset "FAYO_ENTRY_SELF=%~f0"\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:FAYO_ENTRY_SELF); $mark=\''+marker+'\'; $payload=$raw.Substring($raw.LastIndexOf($mark)+$mark.Length); & ([ScriptBlock]::Create($payload))"\r\nset "fayo_result=%ERRORLEVEL%"\r\npause\r\nexit /b %fayo_result%\r\n'+marker+'\r\n'+ps.replace(/\r?\n/g,'\r\n');
 if(output){const target=path.resolve(output);if(target.startsWith(ROOT+path.sep))throw Error('entry-output-must-be-outside-source');fs.writeFileSync(target,cmd,{flag:'wx',mode:0o600});}
 return {cmd,ps,sha,installationName,sizeBytes:Buffer.byteLength(cmd),sha256:hash(cmd)};
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==6||args[0]!=='--sha'||args[2]!=='--installation-name'||args[4]!=='--output')throw Error('usage');const {cmd,ps,...metadata}=build({sha:args[1],installationName:args[3],output:args[5]});console.log(JSON.stringify(metadata));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build};
