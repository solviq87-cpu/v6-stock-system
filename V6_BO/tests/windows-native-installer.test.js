'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../deploy/windows-host');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const wizard=source('TianShu-FirstRun.ps1');
const manager=source('TianShu-Desktop.ps1');
const iss=fs.readFileSync(path.resolve(__dirname,'../deploy/windows-installer/TianShuV6.iss'),'utf8');
const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build-windows-host-bundle.py'),'utf8');
test('native installer has one executable GUI and a version-pinned complete source bundle',()=>{
 assert.ok(iss.startsWith('\uFEFF'),'Inno Chinese UI needs UTF8 BOM');
 assert.match(iss,/\bPrivilegesRequired=lowest\b/);
 assert.match(iss,/\bArchitecturesAllowed=x64compatible\b/);
 assert.match(iss,/Source: "\{#SourceRoot\}\\\*"/);
 assert.match(iss,/TianShu-FirstRun\.ps1/);
 assert.match(iss,/postinstall skipifsilent/);
 assert.doesNotMatch(iss,/\b(PrivilegesRequired=admin|UninstallDelete|RestartIfNeededByRun|wsl --install)\b/i);
 for(const filename of ['TianShu-Install.cmd','TianShu-Install.ps1','TianShu-Desktop.ps1',
   'TianShu-FirstRun.ps1','manifest.json','source.json']) {
   assert.ok(iss.includes('runtime') || builder.includes(filename),filename);
 }
 assert.match(builder,/required\.add\('TianShu-FirstRun\.ps1'\)/);
});
test('first-run wizard stages verified package and only initializes with fresh explicit consent',()=>{
 assert.ok(wizard.startsWith('\uFEFF'),'Chinese first-run needs BOM');
 assert.match(wizard,/Mode='Setup'/);
 assert.match(wizard,/Mode -eq 'Probe'/);
 assert.match(wizard,/Mode -eq 'Verify'/);
 assert.match(wizard,/Mode StageOnly/);
 assert.match(wizard,/Verify-Archive/);
 assert.match(wizard,/WSLDistribution\.txt/);
 assert.match(wizard,/oldLocations\.Count -gt 1/);
 assert.match(wizard,/if\(\$status\.code -eq 'not-initialized'\) \{/);
 assert.match(wizard,/if\(-not \(Consent '没有发现本程序/);
 assert.match(wizard,/Run-Control 'Initialize'/);
 assert.match(wizard,/Run-Control 'Smoke'/);
 assert.match(wizard,/Run-Control 'Stop'/);
 assert.match(wizard,/Run-Control 'Start'/);
 assert.match(wizard,/sourceSha|source\.json/);
 assert.match(wizard,/fayo-root/);
 assert.doesNotMatch(wizard,/\b(Invoke-Expression|Set-ExecutionPolicy|tailscale funnel|Remove-Item|git pull|git clone)\b/i);
});
test('desktop UI can resume setup without altering existing auto-update/autorun safety',()=>{
 assert.match(manager,/WSLDistribution\.txt/);
 assert.match(manager,/TianShu-FirstRun\.ps1/);
 assert.match(manager,/Mode Setup/);
 assert.match(manager,/Mode AutoStart/);
 assert.match(manager,/Run-Host 'Start'/);
 assert.match(manager,/检查更新（不安装）/);
 assert.doesNotMatch(manager,/\b(Set-ExecutionPolicy|Run-Host 'ApplyUpdate'|Invoke-Expression)\b/i);
});
