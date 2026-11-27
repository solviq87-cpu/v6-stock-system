'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const {spawnSync}=require('node:child_process');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=Date.parse('2026-11-27T16:00:00+08:00'),day='2026-11-27';
const completed=()=>({status:'research-cycle-completed-not-certified',canTrade:false,productionWeightsChanged:false,applied:true,stages:[{stage:'independent-shadow-model',status:'skipped-model-no-change'}]});
const stopped=/stopped-check-private/,failed='failed-stop-and-audit-before-retry',pendingName='.factor-agent-pending.json';
// Real temporary files and agent. The writer fixture mirrors exclusive publication
// with fsync; providers, capture, preregistration and daily cycle are injected.
function writeFixture(file,value){
 const dir=path.dirname(file),stage=fs.mkdtempSync(path.join(dir,'.fixture-'));
 try{const temp=path.join(stage,'entry.json'),fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.linkSync(temp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function loadAgent(id,{cycle,write=writeFixture,ready=true}){
 const mock={
  './forward-tracking-store':{readJson:f=>JSON.parse(fs.readFileSync(f,'utf8'))},
  './factor-daily-research-cycle':{validatePaths:()=>{},checkSource:()=>({status:ready?'ready':'needs-data',asOf:day}),runDailyCycle:cycle},
  './factor-maturity-manifest':{discoverCaptures:()=>[]},
  './factor-candidate-prereg':{currentResearchCodeFingerprint:()=> 'a'.repeat(64),verifySeedRegistrationMetadata:()=>{},SEED_MODE:'seed'},
  '../../scripts/factor-shadow-evolution':{safeNew:f=>path.resolve(f),writeNew:write}
 };
 const old=Module._load;delete require.cache[id];Module._load=function(name,parent,...rest){return parent?.filename===id&&Object.hasOwn(mock,name)?mock[name]:old.call(this,name,parent,...rest);};
 try{return require(id);}finally{Module._load=old;delete require.cache[id];}
}
function setup(t,{cycle=completed,write=writeFixture,ready=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'a23-agent-'));let calls=0;
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={schemaVersion:1,mode:'v6-factor-research-agent',researchOnly:true,canTrade:false,outputDir:path.join(root,'agent'),cycle:{}};
 for(const k of ['historyFile','picksFile','factorsFile','captureDir','trackingDir','modelDir'])config.cycle[k]=path.join(root,k);
 const id=require.resolve('../src/core/factor-research-agent');
 const reload=()=>loadAgent(id,{ready,write,cycle:()=>{calls++;return cycle();}});
 const dir=config.outputDir,entries=()=>fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.startsWith('event-')).sort():[];
 return {config,dir,id,agent:reload(),reload,entries,pending:path.join(dir,pendingName),lock:path.join(dir,'.factor-agent.lock'),calls:()=>calls};
}
const invoke=(a,options={})=>a.agent.runAgent(a.config,{apply:true,now,...options});
function change(a,v){fs.writeFileSync(a.config.cycle.historyFile,JSON.stringify(v));}
function read(file){return JSON.parse(fs.readFileSync(file));}
function reseal(v){delete v.fingerprint;v.fingerprint=hash(v);return v;}
function interrupted(t,{after=false}={}){
 let fault=true;const a=setup(t,{write:(file,v)=>{
  if(path.basename(file).startsWith('event-')&&fault){if(after)writeFixture(file,v);throw Error('injected uncertain journal write');}writeFixture(file,v);
 }});
 assert.throws(()=>invoke(a),stopped);fault=false;return a;
}
test('intent is sealed and present before worker, disappears only after committed event',t=>{
 let a;a=setup(t,{cycle:()=>{assert.ok(fs.existsSync(a.pending));const v=read(a.pending);assert.equal(v.outcome,'failed');assert.equal(v.sequence,1);assert.equal(v.settledFingerprint,v.inputFingerprint);assert.equal(a.agent.readAgentStatus(a.dir).status,failed);return completed();}});
 const r=invoke(a);assert.equal(r.status,'research-cycle-completed-not-certified');assert.equal(fs.existsSync(a.pending),false);assert.equal(a.entries().length,1);assert.equal(a.calls(),1);
});
test('failed intent publication never dispatches a worker',t=>{
 const a=setup(t,{write:(f,v)=>{if(path.basename(f)===pendingName)throw Error('disk full');writeFixture(f,v);}});
 assert.throws(()=>invoke(a),stopped);assert.equal(a.calls(),0);assert.equal(a.entries().length,0);
});
test('journal write failure retains pending and restart cannot silently rerun',t=>{
 const a=interrupted(t);assert.ok(fs.existsSync(a.pending));assert.equal(a.entries().length,0);a.agent=a.reload();
 const before=fs.readFileSync(a.pending);const preview=a.agent.runAgent(a.config,{now:now+1});assert.equal(preview.status,failed);assert.equal(preview.eventFingerprint,null);assert.deepEqual(fs.readFileSync(a.pending),before);assert.equal(a.agent.readAgentStatus(a.dir).status,failed);
 const r=invoke(a,{now:now+2});assert.equal(r.status,failed);assert.equal(r.eventFingerprint,JSON.parse(before).fingerprint);assert.equal(a.calls(),1);assert.equal(fs.existsSync(a.pending),false);assert.equal(a.entries().length,1);
 assert.equal(invoke(a,{now:now+3}).status,failed);assert.equal(a.calls(),1);
 assert.equal(invoke(a,{now:now+4,ackFailure:r.eventFingerprint}).status,'research-cycle-completed-not-certified');assert.equal(a.calls(),2);
});
test('commit published before writer error reconciles original receipt without reexecution',t=>{
 const a=interrupted(t,{after:true});assert.equal(a.entries().length,1);assert.ok(fs.existsSync(a.pending));const f=path.join(a.dir,a.entries()[0]),bytes=fs.readFileSync(f);a.agent=a.reload();
 assert.equal(a.agent.readAgentStatus(a.dir).status,failed);assert.equal(a.agent.readAgentStatus(a.dir).eventFingerprint,null);
 const r=invoke(a,{now:now+1});assert.equal(r.status,'research-cycle-completed-not-certified');assert.equal(r.eventFingerprint,JSON.parse(bytes).fingerprint);assert.equal(a.calls(),1);assert.deepEqual(fs.readFileSync(f),bytes);assert.equal(fs.existsSync(a.pending),false);
 assert.equal(invoke(a,{now:now+2}).status,'unchanged');assert.equal(a.calls(),1);
});
test('pending recovery rejects rollback and premature acknowledgement',t=>{
 const a=interrupted(t);const v=read(a.pending);assert.throws(()=>invoke(a,{now:now-1}),stopped);assert.throws(()=>a.agent.runAgent(a.config,{now:now-1}),stopped);assert.throws(()=>invoke(a,{now:now+1,ackFailure:v.fingerprint}),stopped);assert.equal(a.calls(),1);assert.ok(fs.existsSync(a.pending));
});
test('tampered pending cannot become failure acknowledgement or start another run',t=>{
 const a=interrupted(t);const v=read(a.pending);v.action='observe';fs.writeFileSync(a.pending,JSON.stringify(reseal(v)));assert.equal(a.agent.readAgentStatus(a.dir).status,'blocked-invalid-agent-journal');assert.throws(()=>invoke(a,{now:now+1}),stopped);assert.equal(a.calls(),1);
});
test('pending and committed event must share attempt identity',t=>{
 const a=interrupted(t,{after:true}),v=read(a.pending);v.inputFingerprint='b'.repeat(64);v.settledFingerprint=v.inputFingerprint;fs.writeFileSync(a.pending,JSON.stringify(reseal(v)));assert.equal(a.agent.readAgentStatus(a.dir).status,'blocked-invalid-agent-journal');assert.throws(()=>invoke(a,{now:now+1}),stopped);assert.equal(a.calls(),1);
});
test('nonadjacent completed input replay is rejected without a third worker',t=>{
 const a=setup(t);change(a,{version:1});invoke(a);change(a,{version:2});invoke(a,{now:now+1});change(a,{version:1});assert.throws(()=>invoke(a,{now:now+2}),stopped);assert.throws(()=>a.agent.runAgent(a.config,{now:now+2}),stopped);assert.equal(a.calls(),2);assert.equal(a.entries().length,2);
});
test('a failed last event acknowledgement does not authorize older completed replay',t=>{
 let good=true;const a=setup(t,{cycle:()=>good?completed():null});change(a,{version:1});invoke(a);change(a,{version:2});good=false;const f=invoke(a,{now:now+1});good=true;change(a,{version:1});assert.throws(()=>invoke(a,{now:now+2,ackFailure:f.eventFingerprint}),stopped);assert.equal(a.calls(),2);
});
test('async completion detects journal deletion and leaves original intent for audit',async t=>{
 let resolve,delay=false;const a=setup(t,{cycle:()=>delay?new Promise(r=>{resolve=r;}):completed()});invoke(a);change(a,{version:2});delay=true;const p=invoke(a,{now:now+1});fs.unlinkSync(path.join(a.dir,a.entries()[0]));resolve(completed());await assert.rejects(p,stopped);assert.ok(fs.existsSync(a.pending));assert.equal(a.entries().length,0);assert.equal(a.agent.readAgentStatus(a.dir).status,'blocked-invalid-agent-journal');assert.throws(()=>invoke(a,{now:now+2}),stopped);assert.equal(a.calls(),2);
});
test('async completion detects a resealed valid historical replacement',async t=>{
 let resolve,delay=false;const a=setup(t,{cycle:()=>delay?new Promise(r=>{resolve=r;}):completed()});invoke(a);change(a,{version:2});delay=true;const p=invoke(a,{now:now+1}),f=path.join(a.dir,a.entries()[0]),v=read(f);v.summary.captureDays=1;reseal(v);fs.unlinkSync(f);writeFixture(path.join(a.dir,'event-00000001-'+v.fingerprint.slice(0,12)+'.json'),v);resolve(completed());await assert.rejects(p,stopped);assert.ok(fs.existsSync(a.pending));assert.equal(a.entries().length,1);assert.throws(()=>invoke(a,{now:now+2}),stopped);
});
test('async completion detects replaced lock before event publication',async t=>{
 let resolve;const a=setup(t,{cycle:()=>new Promise(r=>{resolve=r;})});const p=invoke(a);fs.renameSync(a.lock,a.lock+'.old');fs.writeFileSync(a.lock,'other owner',{mode:0o600});resolve(completed());await assert.rejects(p,stopped);assert.ok(fs.existsSync(a.pending));assert.equal(a.entries().length,0);assert.equal(fs.readFileSync(a.lock,'utf8'),'other owner');
});
test('throwing then getter becomes a durable failed event rather than a retry loophole',t=>{
 const a=setup(t,{cycle:()=>Object.defineProperty({},'then',{get(){throw Error('private worker error');}})});const r=invoke(a);assert.equal(r.status,failed);assert.equal(a.entries().length,1);assert.equal(fs.existsSync(a.pending),false);assert.equal(invoke(a,{now:now+1}).status,failed);assert.equal(a.calls(),1);
});
test('actual child process exit during worker leaves lock and intent; reviewed recovery never reruns',t=>{
 const a=setup(t);const source="const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');const day="+JSON.stringify(day)+";"+writeFixture.toString()+";"+loadAgent.toString()+";const a=loadAgent("+JSON.stringify(a.id)+",{cycle:()=>process.exit(73)});a.runAgent("+JSON.stringify(a.config)+",{apply:true,now:"+now+"});";
 const child=spawnSync(process.execPath,['-e',source],{timeout:5000,encoding:'utf8'});assert.equal(child.status,73,child.stderr);assert.ok(fs.existsSync(a.lock));assert.ok(fs.existsSync(a.pending));assert.equal(a.entries().length,0);assert.throws(()=>invoke(a,{now:now+1}),stopped);
 // Test owner has confirmed its child exited. Production never removes stale locks automatically.
 assert.equal(fs.readFileSync(a.lock,'utf8'),String(child.pid));fs.unlinkSync(a.lock);a.agent=a.reload();const r=invoke(a,{now:now+2});assert.equal(r.status,failed);assert.equal(a.calls(),0);assert.equal(a.entries().length,1);
});
test('missing data creates no worker intent and ordinary idempotency stays compatible',t=>{
 const a=setup(t,{ready:false});assert.equal(invoke(a).status,'needs-data');assert.equal(fs.existsSync(a.pending),false);assert.equal(a.calls(),0);assert.equal(invoke(a,{now:now+1}).status,'unchanged');
});
