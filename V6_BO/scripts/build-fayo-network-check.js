'use strict';
const fs=require('node:fs');
function build(){
 const ps=`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$targets = @(
    @{ Label='GitHub release'; Url='https://api.github.com/repos/solviq87-cpu/v6-stock-system/branches/dev' },
    @{ Label='GitHub checks'; Url='https://api.github.com/repos/solviq87-cpu/v6-stock-system/actions/runs?head_sha=2aada9876c9fbed1b42d001358c897587df12805&event=push&per_page=100' },
    @{ Label='Python bootstrap'; Url='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl' }
)
Write-Host '只读连接检查：不会安装、停止服务或修改代理设置。'
foreach ($target in $targets) {
    try {
        $request = [Net.HttpWebRequest]::Create($target.Url)
        $request.Method = 'HEAD'
        $request.UserAgent = 'fayo-network-check'
        $request.Timeout = 15000
        $request.ReadWriteTimeout = 15000
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        try { Write-Host ('Windows | ' + $target.Label + ' | HTTP ' + [int]$response.StatusCode) } finally { $response.Close() }
    } catch [Net.WebException] {
        $http = 0
        if ($_.Exception.Response) { $http = [int]$_.Exception.Response.StatusCode; $_.Exception.Response.Close() }
        Write-Host ('Windows | ' + $target.Label + ' | HTTP ' + $http + ' | ' + $_.Exception.Status)
    } catch { Write-Host ('Windows | ' + $target.Label + ' | request-failed') }
}
try {
    $wsl = (Get-Command wsl.exe -ErrorAction Stop).Source
    foreach ($target in $targets) {
        $nativePreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $lines = & $wsl --distribution Ubuntu-24.04 --exec curl --disable --silent --proto '=https' --connect-timeout 8 --max-time 15 --output /dev/null --write-out 'http=%{http_code};tls=%{ssl_verify_result}' --url $target.Url 2>$null
        $code = $LASTEXITCODE
        $ErrorActionPreference = $nativePreference
        $safe = (@($lines) -join '')
        if ($safe -notmatch '^http=[0-9]{3};tls=[0-9]+$') { $safe = 'no-status' }
        Write-Host ('Ubuntu | ' + $target.Label + ' | curl=' + $code + ' | ' + $safe)
    }
} catch { Write-Host 'Ubuntu | check-unavailable' }
Write-Host '检查结束。请拍最后六行结果，不需要拍任何账号或代理配置。'
`;
 const marker=':FAYO_NETWORK_CHECK_PAYLOAD';
 const cmd='@echo off\r\nsetlocal\r\nset "FAYO_CHECK_SELF=%~f0"\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:FAYO_CHECK_SELF); $mark=\''+marker+'\'; & ([ScriptBlock]::Create($raw.Substring($raw.LastIndexOf($mark)+$mark.Length)))"\r\npause\r\nexit /b\r\n'+marker+'\r\n'+ps.replace(/\r?\n/g,'\r\n');
 return{cmd,ps};
}
if(require.main===module){const out=process.argv[2];if(!out)throw Error('output path required');const {cmd}=build();fs.writeFileSync(out,cmd,{flag:'wx',mode:0o600});console.log('Read-only network probe created; no installer or user account operations included.');}
module.exports={build};
