'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=Date.parse('2026-11-27T16:00:00+08:00'),day='2026-11-27';
const completed=()=>({status:'research-cycle-completed-not-certified',canTrade:false,productionWeightsChanged:false,applied:true,stages:[{stage:'independent-shadow-model',status:'skipped-model-no-change'}]});
function setup(t,{ready=true,cycle=completed}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'a22-agent-'));let calls=0;
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={schemaVersion:1,mode:'v6-factor-research-agent',researchOnly:true,canTrade:false,outputDir:path.join(root,'agent'),cycle:{}};
 for(const k of ['historyFile','picksFile','factorsFile','captureDir','trackingDir','modelDir'])config.cycle[k]=path.join(root,k);
 // Isolated orchestration fixture: real fs, real journal and controller, no real market or model.
 const mock={
  './forward-tracking-store':{readJson:f=>JSON.parse(fs.readFileSync(f,'utf8'))},
  './factor-daily-research-cycle':{validatePaths:()=>{},checkSource:()=>({status:ready?'ready':'needs-data',asOf:day}),runDailyCycle:()=>{calls++;return cycle();}},
  './factor-maturity-manifest':{discoverCaptures:()=>[]},
  './factor-candidate-prereg':{currentResearchCodeFingerprint:()=> 'a'.repeat(64),verifySeedRegistrationMetadata:()=>{},SEED_MODE:'seed'},
  '../../scripts/factor-shadow-evolution':{safeNew:f=>path.resolve(f),writeNew:(f,v)=>fs.writeFileSync(f,JSON.stringify(v),{flag:'wx',mode:0o600})}
 };
 const id=require.resolve('../src/core/factor-research-agent'),old=Module._load;
 delete require.cache[id];Module._load=function(name,parent,...rest){return parent?.filename===id&&Object.hasOwn(mock,name)?mock[name]:old.call(this,name,parent,...rest);};
 let agent;try{agent=require(id);}finally{Module._load=old;delete require.cache[id];}
 const entries=()=>fs.existsSync(config.outputDir)?fs.readdirSync(config.outputDir).filter(n=>n.startsWith('event-')).sort():[];
 function rewrite(fn){const files=entries(),f=path.join(config.outputDir,files.at(-1));const v=JSON.parse(fs.readFileSync(f));fn(v);delete v.fingerprint;v.fingerprint=hash(v);fs.unlinkSync(f);fs.writeFileSync(path.join(config.outputDir,`event-${String(v.sequence).padStart(8,'0')}-${v.fingerprint.slice(0,12)}.json`),JSON.stringify(v),{mode:0o600});}
 return {config,agent,entries,rewrite,calls:()=>calls};
}
const stopped=/stopped-check-private/;
function blocked(a){assert.equal(a.agent.readAgentStatus(a.config.outputDir).status,'blocked-invalid-agent-journal');assert.throws(()=>a.agent.runAgent(a.config,{now}),stopped);}
async function malformed(t,cycle){const a=setup(t,{cycle});const v=await a.agent.runAgent(a.config,{apply:true,now});assert.equal(v.status,'failed-stop-and-audit-before-retry');assert.equal(a.entries().length,1);assert.equal(a.agent.readAgentStatus(a.config.outputDir).status,v.status);assert.equal((await a.agent.runAgent(a.config,{apply:true,now:now+1})).status,v.status);assert.equal(a.calls(),1);}
test('valid result preserves research-only state and repeat idempotency',t=>{const a=setup(t);const v=a.agent.runAgent(a.config,{apply:true,now});assert.equal(v.status,'research-cycle-completed-not-certified');assert.equal(v.canTrade,false);assert.equal(a.agent.runAgent(a.config,{apply:true,now:now+1}).status,'unchanged');assert.equal(a.calls(),1);assert.equal(a.entries().length,1);});
test('known failure latches until exact acknowledgement and preserves prior bytes',t=>{let fail=true;const a=setup(t,{cycle:()=>{if(fail)throw Error('private');return completed();}});const f=a.agent.runAgent(a.config,{apply:true,now});assert.equal(f.status,'failed-stop-and-audit-before-retry');assert.equal(a.agent.runAgent(a.config,{apply:true,now:now+1}).status,f.status);fail=false;assert.equal(a.agent.runAgent(a.config,{apply:true,now:now+2,ackFailure:f.eventFingerprint}).status,'research-cycle-completed-not-certified');assert.equal(a.entries().length,2);});
test('missing evidence remains needs-data and does not run worker',t=>{const a=setup(t,{ready:false});assert.equal(a.agent.runAgent(a.config,{apply:true,now}).status,'needs-data');assert.equal(a.calls(),0);assert.equal(a.agent.readAgentStatus(a.config.outputDir).status,'needs-data');});
test('unrepresentable clock rejects before creating journal directory',t=>{const a=setup(t);assert.throws(()=>a.agent.runAgent(a.config,{apply:true,now:8.64e15}),stopped);assert.equal(fs.existsSync(a.config.outputDir),false);});
test('persisted time high-water rejects backward preview and apply',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});assert.throws(()=>a.agent.runAgent(a.config,{now:now-1}),stopped);assert.throws(()=>a.agent.runAgent(a.config,{apply:true,now:now-1}),stopped);assert.equal(a.calls(),1);assert.equal(a.entries().length,1);});
test('rehashing mismatched status and outcome cannot fabricate completion',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.outcome='failed';});blocked(a);});
test('rehashing idle stage cannot masquerade as persisted reflection',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.summary.stage='idle';});blocked(a);});
test('rehashing impossible source date cannot be accepted',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.summary.sourceDay='2026-02-30';});blocked(a);});
test('rehashing future source day cannot be accepted',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.summary.sourceDay='2026-11-28';});blocked(a);});
test('rehashing invalid check time cannot be accepted',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.summary.checkTime=0;});blocked(a);});
test('rehashing arbitrary decision fingerprint cannot be accepted',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.decisionFingerprint='b'.repeat(64);});blocked(a);});
test('rehashing failure with wrong retry action cannot erase audit requirement',t=>{const a=setup(t,{cycle:()=>{throw Error('failed');}});a.agent.runAgent(a.config,{apply:true,now});a.rewrite(v=>{v.summary.nextAction='await-next-source-or-research-lineage';});blocked(a);});
test('rehashing second record with clock rollback cannot be accepted',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});fs.writeFileSync(a.config.cycle.historyFile,'{}');a.agent.runAgent(a.config,{apply:true,now:now+1});assert.equal(a.entries().length,2);a.rewrite(v=>{v.summary.checkTime=now-1;});blocked(a);});
test('null synchronous worker result records latched failure',t=>malformed(t,()=>null));
test('undefined synchronous worker result records latched failure',t=>malformed(t,()=>undefined));
test('malformed stages synchronous result records latched failure',t=>malformed(t,()=>({...completed(),stages:{}})));
test('duplicate independent model stages cannot claim successful cycle',t=>malformed(t,()=>({...completed(),stages:[...completed().stages,...completed().stages]})));
test('successful receipt cannot contradict explicit research-only authority',t=>malformed(t,()=>({...completed(),canTrade:true})));
test('successful receipt cannot contradict explicit application status',t=>malformed(t,()=>({...completed(),applied:false})));
test('successful receipt must contain an independent shadow-stage result',t=>malformed(t,()=>({...completed(),stages:[]})));
test('async invalid result records failure and releases lock',t=>malformed(t,async()=>({...completed(),stages:[null]})));
test('journal hardlink alias is rejected even with valid hash',t=>{const a=setup(t);a.agent.runAgent(a.config,{apply:true,now});const f=path.join(a.config.outputDir,a.entries()[0]);fs.linkSync(f,path.join(path.dirname(a.config.outputDir),'alias'));blocked(a);});
