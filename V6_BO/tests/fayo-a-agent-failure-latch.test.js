'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {runAgent,readAgentStatus}=require('../src/core/factor-research-agent');
const {inspectLearningRuntime}=require('../src/core/learning-runtime-preflight');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=Date.parse('2026-09-21T08:04:00Z'),failed='failed-stop-and-audit-before-retry',audit='audit-private-research-artifacts-before-retry',stopped=/stopped-check-private/;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a27-failed-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cycle={schemaVersion:1,mode:'v6-factor-daily-research-cycle',researchOnly:true,canTrade:false};
 for(const key of ['historyFile','picksFile','factorsFile','marketFile','captureDir','trackingDir','manifestFile','neutralDir','modelDir'])cycle[key]=path.join(dir,key);
 const config={schemaVersion:1,mode:'v6-factor-research-agent',researchOnly:true,canTrade:false,cycle,outputDir:path.join(dir,'memory')};
 const file=path.join(dir,'agent.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 assert.equal(runAgent(config,{apply:true,now}).status,'needs-data');
 const old=path.join(config.outputDir,fs.readdirSync(config.outputDir)[0]),{fingerprint,...event}=JSON.parse(fs.readFileSync(old));
 event.outcome='failed';event.summary.status=failed;event.summary.nextAction=audit;
 event.decisionFingerprint=hash({action:event.action,ready:true,nextAction:`run-${event.action}-research-cycle`});
 const id=hash(event),journal=path.join(config.outputDir,`event-00000001-${id.slice(0,12)}.json`);
 fs.unlinkSync(old);fs.writeFileSync(journal,JSON.stringify({...event,fingerprint:id}),{mode:0o600});
 assert.equal(readAgentStatus(config.outputDir).status,failed);
 fs.writeFileSync(cycle.historyFile,'corrupt new research input');
 return {config,env:{V6_FACTOR_AGENT_CONFIG_FILE:file},id,journal,bytes:fs.readFileSync(journal)};
}
function observeReads(t,a){
 const old=fs.openSync;let count=0;
 t.mock.method(fs,'openSync',function(file,...args){if(file===a.config.cycle.historyFile)count++;return old.call(fs,file,...args);});
 return ()=>count;
}
function unchanged(a){assert.deepEqual(fs.readFileSync(a.journal),a.bytes);assert.deepEqual(fs.readdirSync(a.config.outputDir),[path.basename(a.journal)]);}
function assertLatch(value,id){assert.equal(value.status,failed);assert.equal(value.stage,'idle');assert.equal(value.nextAction,audit);assert.equal(value.eventFingerprint,id);assert.equal(value.canTrade,false);}
test('valid historical failure blocks preview before opening corrupt new research inputs',t=>{
 const a=fixture(t),reads=observeReads(t,a);assertLatch(runAgent(a.config,{now:now+1}),a.id);assert.equal(reads(),0);unchanged(a);
});
test('unacknowledged apply preserves failed journal and does not open new evidence',t=>{
 const a=fixture(t),reads=observeReads(t,a);assertLatch(runAgent(a.config,{apply:true,now:now+1}),a.id);assert.equal(reads(),0);unchanged(a);
});
test('preflight keeps the original failure and read-only audit state without accessing corrupt evidence',async t=>{
 const a=fixture(t),reads=observeReads(t,a),r=await inspectLearningRuntime({env:a.env,now:now+1});assert.equal(r.overall,'blocked');assert.equal(r.current.status,'blocked');assert.equal(r.current.nextAction,audit);assert.equal(r.lastRun.eventFingerprint,a.id);assert.equal(r.current.captureDays,r.lastRun.captureDays);assert.equal(reads(),0);unchanged(a);
});
test('clock rollback or wrong acknowledgement never opens new evidence',t=>{
 const a=fixture(t),reads=observeReads(t,a);assert.throws(()=>runAgent(a.config,{now:now-1}),stopped);assert.throws(()=>runAgent(a.config,{apply:true,now:now+1,ackFailure:'f'.repeat(64)}),stopped);assert.equal(reads(),0);unchanged(a);
});
test('exact acknowledgement does not bypass corrupt source validation or erase failure',t=>{
 const a=fixture(t),reads=observeReads(t,a);assert.throws(()=>runAgent(a.config,{apply:true,now:now+1,ackFailure:a.id}),stopped);assert.ok(reads()>0);unchanged(a);assert.equal(readAgentStatus(a.config.outputDir).eventFingerprint,a.id);
});
