'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFile,spawnSync}=require('node:child_process'),{promisify}=require('node:util');
const {build}=require('../scripts/build-fayo-network-check');
test('network probe contains only fixed public endpoints and read-only clients',()=>{
 const {ps,cmd}=build();assert.equal((ps.match(/Label=/g)||[]).length,3);assert.doesNotMatch(ps,/Initialize|ApplyUpdate|safe-updater|host-runtime|Remove-Item|Set-Item|Stop-Process|Invoke-Expression/);assert.ok(Buffer.byteLength(cmd)<8000);assert.match(ps,/curl=.*code/);assert.match(ps,/ErrorActionPreference = 'Continue'/);assert.match(ps,/http=\[0-9\]\{3\}/);
});
const pwsh=process.env.FAYO_TEST_PWSH||'pwsh';const available=!spawnSync(pwsh,['-NoProfile','-Command','exit 0'],{timeout:10000}).error;
test('real PowerShell reports Windows HTTP and WSL curl failures without leaking stderr',{skip:!available},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-readonly-probe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const server=http.createServer((q,r)=>{r.statusCode=q.url==='/release'?200:503;r.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 let {cmd}=build();let index=0;cmd=cmd.replace(/https:\/\/[^']+/g,()=>`http://127.0.0.1:${server.address().port}/${['release','checks','pip'][index++]}`);
 const entry=path.join(dir,'probe.cmd');fs.writeFileSync(entry,cmd);const script=path.join(dir,'run.ps1');fs.writeFileSync(script,`$raw=[IO.File]::ReadAllText('${entry}');$mark=':FAYO_NETWORK_CHECK_PAYLOAD'; & ([ScriptBlock]::Create($raw.Substring($raw.LastIndexOf($mark)+$mark.Length)))`);
 fs.writeFileSync(path.join(dir,'wsl.exe'),'#!/bin/sh\necho private-proxy-credential-must-not-print >&2\nprintf "http=000;tls=20"\nexit 60\n',{mode:0o700});
 const result=await promisify(execFile)(pwsh,['-NoProfile','-File',script],{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH},timeout:20000,maxBuffer:65536});
 assert.match(result.stdout,/Windows \| GitHub release \| HTTP 200/);assert.match(result.stdout,/Windows \| GitHub checks \| HTTP 503/);assert.equal((result.stdout.match(/curl=60 \| http=000;tls=20/g)||[]).length,3);assert.doesNotMatch(result.stdout+result.stderr,/private-proxy-credential/);assert.doesNotMatch(result.stdout,/check-unavailable/);
});
