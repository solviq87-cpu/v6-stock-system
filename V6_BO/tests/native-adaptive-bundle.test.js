'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {fixture}=require('./helpers/adaptive-fixture');
const {create,verify}=require('../scripts/native-adaptive-bundle');
const {createAdaptiveMonitor}=require('../src/core/adaptive-research-monitor');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-export-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const input=path.join(root,'source.json'),out=path.join(root,'bundle'),x=fixture(40);for(const s of x.stocks)for(const b of s.bars)delete b.originalRuleSignals;x.nativeEvidence={schemaVersion:1};fs.writeFileSync(input,JSON.stringify(x));return {root,input,out};}
test('offline export preserves source bytes, writes separate replay and deterministically verifies',t=>{
 const {input,out}=setup(t),before=fs.readFileSync(input);assert.equal(create(input,out).ok,true);assert.equal(verify(out).deterministicReplay,true);assert.deepEqual(fs.readFileSync(input),before);
 const report=JSON.parse(fs.readFileSync(path.join(out,'adaptive-report.json')));assert.equal(report.canTrade,false);assert.equal(report.nativeAdaptation.replay.canTrade,false);
});
test('export refuses existing directories without changing any retained files',t=>{
 const {input,out}=setup(t);create(input,out);const before=fs.readFileSync(path.join(out,'manifest.json'));assert.throws(()=>create(input,out),/拒绝覆盖/);assert.deepEqual(fs.readFileSync(path.join(out,'manifest.json')),before);
});
test('verification detects tampered report even if attacker rewrites its manifest hash',t=>{
 const {input,out}=setup(t);create(input,out);const file=path.join(out,'adaptive-report.json'),r=JSON.parse(fs.readFileSync(file));r.canTrade=true;const bytes=Buffer.from(JSON.stringify(r,null,2)+'\n');fs.writeFileSync(file,bytes);
 assert.throws(()=>verify(out),/指纹/);const mf=path.join(out,'manifest.json'),m=JSON.parse(fs.readFileSync(mf));m.files['adaptive-report.json']={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};fs.writeFileSync(mf,JSON.stringify(m));assert.throws(()=>verify(out),/确定性重放/);
});
test('incomplete export, extra file and symbolic link all fail closed',t=>{
 const {input,out,root}=setup(t);create(input,out);const f=path.join(out,'native-replay.json'),backup=fs.readFileSync(f);fs.unlinkSync(f);assert.throws(()=>verify(out),/缺失/);fs.writeFileSync(f,backup);
 fs.writeFileSync(path.join(out,'extra'),'x');assert.throws(()=>verify(out),/多出/);fs.unlinkSync(path.join(out,'extra'));
 const other=path.join(root,'other');fs.renameSync(f,other);fs.symlinkSync(other,f);assert.throws(()=>verify(out));
});
test('invalid native evidence leaves no completed output and input symlink is rejected',t=>{
 const {input,out,root}=setup(t);const x=JSON.parse(fs.readFileSync(input));x.nativeEvidence.schemaVersion=2;fs.writeFileSync(input,JSON.stringify(x));assert.throws(()=>create(input,out));assert.equal(fs.existsSync(out),false);
 const link=path.join(root,'input-link');fs.symlinkSync(input,link);assert.throws(()=>create(link,out));
});
test('real CLI export and verify return success; malformed mode exits nonzero',t=>{
 const {input,out}=setup(t),script=path.resolve(__dirname,'../scripts/native-adaptive-bundle.js');
 for(const args of [[input,out],['--verify',out]]){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);}
 const bad=spawnSync(process.execPath,[script,'--unknown',out],{encoding:'utf8'});assert.equal(bad.status,1);
});
test('existing worker and monitor automatically consume native evidence and preserve report history',async t=>{
 const {input,root}=setup(t),outputRoot=path.join(root,'runs');
 const monitor=createAdaptiveMonitor({inputFile:input,outputRoot});
 const r=await monitor.runOnce();assert.equal(r.status,'updated');
 const file=path.join(outputRoot,'reports',r.reportFile),before=fs.readFileSync(file),report=JSON.parse(before).result;
 assert.equal(report.nativeAdaptation.mode,'native-to-adaptive-research');assert.equal(report.nativeAdaptation.coverage.python.unknown,80);
 assert.equal((await monitor.runOnce()).status,'unchanged');assert.deepEqual(fs.readFileSync(file),before);assert.equal(monitor.verify().verified,true);
});
