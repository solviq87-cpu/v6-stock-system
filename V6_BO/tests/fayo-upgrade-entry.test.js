'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {upgrade,parseArgs}=require('../deploy/windows-host/fayo-upgrade');
const {build}=require('../scripts/build-fayo-upgrade-entry');
const OLD='a'.repeat(40),NEW='b'.repeat(40);
function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-entry-')),name='.tian-shu-known',root=path.join(home,name);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'installation.json'),'{}');
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));let state={code:'stopped',sourceSha:OLD,health:false,mode:null};const calls=[],progress=[];
 const host={safeStartup:r=>{assert.equal(r,root);calls.push('private-validation');},checkHost:async()=>({...state}),stop:async()=>{calls.push('stop');state.code='stopped';},start:async({smoke})=>{calls.push('start:'+smoke);state={code:'running',sourceSha:NEW,health:true,mode:smoke?'smoke':'normal'};}};
 const updates={discover:async sha=>{calls.push('discover:'+sha);return{sha:NEW,changed:sha!==NEW,files:[],ciUrls:['test']};},update:async(options,deps)=>{calls.push('update');assert.equal(options.root,root);assert.equal(options.approveSensitive,NEW);await deps.discover(OLD);await deps.discover(OLD);await deps.step('stopped');await deps.step('before-switch');state.sourceSha=NEW;return{code:'local-update-installed',backupVerified:true};}};
 return {home,name,root,calls,host,updates,options:{expectedSha:NEW,installationName:name},deps:{home,runtime:host,updater:updates,progress:s=>progress.push(s)},progress,setState:s=>{state=s;}};
}
test('one action pins the exact release, validates the original private install and starts the normal service',async t=>{
 const f=fixture(t);const result=await upgrade(f.options,f.deps);assert.equal(result.code,'fayo-ready');assert.equal(result.backupVerified,true);assert.equal(result.phoneConnected,false);assert.equal(f.calls[0],'private-validation');assert.equal(f.calls.filter(c=>c==='update').length,1);assert.equal(f.calls.filter(c=>c.startsWith('discover:')).length,2,'preflight is reused once; pre-switch still rechecks source');assert.ok(f.calls.includes('start:false'));assert.deepEqual(f.progress,['checking','validating','backing-up','switching','starting']);
});
test('missing installation and a changed target cannot create a new account or invoke the updater',async t=>{
 const f=fixture(t);await assert.rejects(upgrade({...f.options,installationName:'.tian-shu-missing'},f.deps),{code:'existing-installation-not-found'});assert.equal(fs.existsSync(path.join(f.home,'.tian-shu-missing')),false);
 f.updates.discover=async()=>({sha:OLD});await assert.rejects(upgrade(f.options,f.deps),{code:'entry-target-changed'});assert.equal(f.calls.includes('update'),false);assert.equal(f.calls.includes('start:false'),false);
});
test('a rollback or blocked CI result never triggers a subsequent start',async t=>{
 const f=fixture(t);f.updates.update=async()=>({code:'candidate-ci-not-green',rollback:'restored-previous-executable'});const r=await upgrade(f.options,f.deps);assert.equal(r.code,'candidate-ci-not-green');assert.equal(f.calls.some(x=>x.startsWith('start:')),false);
});
test('an already current smoke instance is switched to normal operation without inventing a fresh backup receipt',async t=>{
 const f=fixture(t);f.setState({code:'running',health:true,sourceSha:NEW,mode:'smoke'});f.updates.update=async()=>({code:'no-update'});const r=await upgrade(f.options,f.deps);assert.equal(r.alreadyCurrent,true);assert.equal(r.backupVerified,false);assert.ok(f.calls.indexOf('stop')<f.calls.indexOf('start:false'));
});
test('unhealthy or mismatched post-start service is never reported ready',async t=>{
 const f=fixture(t);f.host.start=async()=>{f.setState({code:'running',health:false,sourceSha:NEW,mode:'normal'});};await assert.rejects(upgrade(f.options,f.deps),{code:'entry-start-not-ready'});
});
test('entry arguments reject paths, unknown options, shell fragments and floating release names',()=>{
 assert.deepEqual(parseArgs(['--expected-sha',NEW,'--installation-name','.tian-shu-known']),{expectedSha:NEW,installationName:'.tian-shu-known'});
 for(const name of ['../other','/home/x','.tian-shu-x;echo bad','.tian-shu-x/y'])assert.throws(()=>parseArgs(['--expected-sha',NEW,'--installation-name',name]));
 assert.throws(()=>parseArgs(['--expected-sha','dev','--installation-name','.tian-shu-known']));
});
test('the single-file Windows entry embeds exact hashed controls and passes paths as native arguments',()=>{
 const readSource=name=>fs.readFileSync(path.resolve(__dirname,'../deploy/windows-host',name));
 const a=build({sha:NEW,installationName:'.tian-shu-known',readSource}),b=build({sha:NEW,installationName:'.tian-shu-known',readSource});
 assert.equal(a.cmd,b.cmd);assert.ok(a.sizeBytes<150000);assert.match(a.ps,/--exec bash \(\[string\]\$linuxPath\)\.Trim\(\)/);assert.doesNotMatch(a.ps,/Set-ExecutionPolicy|Initialize|ApplyUpdate|Invoke-Expression/);
 const assets=JSON.parse(a.ps.match(/\$assets = '([^']+)'/)[1]);
 for(const asset of assets){const bytes=Buffer.from(asset.data,'base64');assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),asset.sha256);if(asset.name!=='bootstrap.sh')assert.deepEqual(bytes,readSource(asset.name));}
 const boot=Buffer.from(assets.find(a=>a.name==='bootstrap.sh').data,'base64').toString();assert.ok(boot.includes(NEW));assert.ok(boot.includes('--installation-name .tian-shu-known'));assert.match(boot,/unset NODE_OPTIONS NODE_PATH/);
 // The CMD stub must select the marker at its own label, not its quoted use.
 const marker=':FAYO_POWERSHELL_PAYLOAD';assert.equal(a.cmd.slice(a.cmd.lastIndexOf(marker)+marker.length).replace(/\r\n/g,'\n').trim(),a.ps.trim());
});

const {spawnSync}=require('node:child_process');
const pwsh=process.env.FAYO_TEST_PWSH||'pwsh';
const hasPowerShell=!spawnSync(pwsh,['-NoProfile','-Command','exit 0'],{timeout:10000}).error;
test('actual PowerShell wrapper handles paths with spaces, opens only a verified page, and cleans temporary controls', {skip:!hasPowerShell},t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-powershell-')),temp=path.join(base,'temp with spaces');fs.mkdirSync(temp);
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const readSource=name=>fs.readFileSync(path.resolve(__dirname,'../deploy/windows-host',name));
 const built=build({sha:NEW,installationName:'.tian-shu-known',readSource});
 const log=path.join(base,'calls.jsonl'),opened=path.join(base,'browser.txt');
 const wsl=path.join(base,'wsl.exe');fs.writeFileSync(wsl,`#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:]
with open(os.environ['FAYO_TEST_CALLS'],'a') as f: f.write(json.dumps(args)+'\\n')
if 'wslpath' in args: print(args[-1])
elif 'bash' in args:
 p=pathlib.Path(args[-1]); assert p.is_file(); assert ' ' in str(p)
 assert (p.parent/'fayo-upgrade.js').is_file()
 if os.environ.get('FAYO_TEST_DENY')=='1': sys.exit(9)
 print('FAYO_READY')
else: sys.exit(8)
`,{mode:0o700});
 const header=`function Invoke-WebRequest { param([switch]$UseBasicParsing,[string]$Uri,[int]$TimeoutSec) if ($Uri -ne 'http://127.0.0.1:8787/') { throw 'unexpected external URL' }; return [pscustomobject]@{StatusCode=200;Content='<div id="fayo-root"></div>'} }
function Start-Process { param([string]$FilePath) [IO.File]::WriteAllText($env:FAYO_TEST_OPENED,$FilePath) }
`;
 const file=path.join(base,'wrapper.ps1');fs.writeFileSync(file,header+built.ps);
 const env={...process.env,PATH:base+path.delimiter+process.env.PATH,OS:'Windows_NT',TMPDIR:temp,FAYO_TEST_CALLS:log,FAYO_TEST_OPENED:opened};
 const success=spawnSync(pwsh,['-NoProfile','-File',file],{env,encoding:'utf8',timeout:15000,maxBuffer:65536});assert.equal(success.status,0,success.stdout+success.stderr);assert.equal(fs.readFileSync(opened,'utf8'),'http://127.0.0.1:8787/');
 const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);const last=calls.at(-1);assert.deepEqual(last.slice(0,4),['--distribution','Ubuntu-24.04','--exec','bash']);assert.equal(last.length,5,'one native path argument, even with spaces');assert.equal(fs.existsSync(path.dirname(last[4])),false,'temporary controls removed after success');
 fs.unlinkSync(opened);
 const failed=spawnSync(pwsh,['-NoProfile','-File',file],{env:{...env,FAYO_TEST_DENY:'1'},encoding:'utf8',timeout:15000,maxBuffer:65536});assert.equal(failed.status,1,failed.stdout+failed.stderr);assert.equal(fs.existsSync(opened),false,'failed upgrade never opens a misleading browser');assert.equal(fs.readdirSync(temp).length,0,'temporary controls removed after failure');
});
