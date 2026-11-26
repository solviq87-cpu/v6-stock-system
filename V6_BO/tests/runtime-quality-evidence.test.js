'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createRuntimeAcceptance,evaluateRuntimeQuality,RUNTIME_QUALITY_POPULATION}=require('../src/core/runtime-acceptance');
const {evaluateProductQuality}=require('../src/core/product-quality-evaluation');
const revision='a'.repeat(40),calendarHash='b'.repeat(64),day='2026-11-23';
const at=(d,m)=>Date.parse(d+'T09:30:00+08:00')+m*60000;
const iso=n=>new Date(n).toISOString();
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-runtime-quality-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=at(day,0),reconciled=true,failing=false,sha=revision,hash=calendarHash,mode='live';
 const ops=createRuntimeAcceptance({root,clock:()=>now,canWrite:()=>true,liveCollector:true,env:{NODE_ENV:'production'},
  calendar:()=>({status:'available',tradeDates:[day,'2026-11-24'],metadata:{source:'quality-calendar',runtimeEligible:true,sha256:hash,from:day,to:'2026-11-24'}}),
  release:()=>({verifiedInstalled:true,sourceSha:sha}),collect:async()=>{if(failing)throw Error('collection failed');
   return {mode,market:{expectedSymbols:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now}]},execution:{reconciled}};}});
 const input=(end=3)=>({revision,asOf:iso(at(day,20)),window:{start:iso(at(day,0)),end:iso(at(day,end))},scope:{kind:'real-market-paper',population:RUNTIME_QUALITY_POPULATION},
  plan:{version:'runtime-quality-fixture-v1',registeredAt:iso(at(day,-60)),criteria:{'operation-failure':{operator:'lte',threshold:.4,minimumSamples:1},
  'ledger-reconciliation':{operator:'gte',threshold:1,minimumSamples:1}},runtimeSchedule:{calendarSource:'quality-calendar',calendarHash,tradeDates:[day]}}});
 return {root,ops,input,review:x=>evaluateRuntimeQuality({root,input:x}),setNow:v=>now=v,setReconciled:v=>reconciled=v,setFailing:v=>failing=v,setSha:v=>sha=v,setHash:v=>hash=v,setMode:v=>mode=v};
}
const row=(r,id)=>r.dimensions.flatMap(d=>d.metrics).find(m=>m.id===id);
test('original journal feeds the existing 30-metric evaluator without losing missing minutes or failed account checks',async t=>{
 const f=fixture(t);assert.equal((await f.ops.tick()).liveEligible,true);f.setNow(at(day,1));f.setReconciled(false);assert.equal((await f.ops.tick()).recorded,true);
 const file=path.join(f.root,day+'.jsonl'),before=fs.readFileSync(file),r=f.review(f.input());
 assert.equal(r.coverage.total,30);assert.equal(r.criticalReview.state,'blocked');assert.deepEqual(r.criticalReview.failed,['ledger-reconciliation']);
 const ledger=row(r,'ledger-reconciliation'),operation=row(r,'operation-failure');
 assert.deepEqual([ledger.denominator,ledger.sampleCount,ledger.missingCount,ledger.status],[3,1,2,'fail']);
 assert.deepEqual([operation.denominator,operation.sampleCount,operation.missingCount,operation.status],[3,2,1,'unknown']);
 assert.equal(r.runtimeEvidence.unprovenJointAccountChecks,1);assert.equal(r.runtimeEvidence.expectedMinutes,3);assert.equal(r.runtimeEvidence.recordedMinutes,2);
 assert.equal(r.canDeploy,false);assert.equal(r.canTrade,false);assert.equal(r.continuousOperationCertified,false);assert.deepEqual(fs.readFileSync(file),before);
 assert.doesNotMatch(JSON.stringify(r),/600001|quality-runtime-|\/tmp\//);assert.match(r.runtimeEvidence.rowHashesFingerprint,/^[a-f0-9]{64}$/);
});
test('failed original collection is in the frozen full denominator rather than silently omitted',async t=>{
 const f=fixture(t);await f.ops.tick();f.setNow(at(day,1));f.setFailing(true);const receipt=await f.ops.tick();assert.equal(receipt.recorded,true);assert.equal(receipt.liveEligible,false);
 const r=f.review(f.input(2)),o=row(r,'operation-failure');assert.deepEqual([o.numerator,o.denominator,o.sampleCount,o.value,o.status],[1,2,2,.5,'fail']);
 assert.equal(row(r,'ledger-reconciliation').status,'unknown');assert.equal(row(r,'ledger-reconciliation').value,null);
});
test('missing journal is not a zero failure rate and cannot be confused with zero-quality score',t=>{
 const f=fixture(t),r=f.review(f.input());assert.equal(r.runtimeEvidence.recordedMinutes,0);assert.equal(r.coverage.unknown,30);assert.equal(r.overallScore,null);
 for(const id of ['ledger-reconciliation','operation-failure']){const x=row(r,id);assert.equal(x.value,null);assert.equal(x.denominator,3);assert.equal(x.sampleCount,0);assert.equal(x.missingCount,3);}
});
test('mixed version, calendar or simulated records cannot certify operation success',async t=>{
 const f=fixture(t);await f.ops.tick();f.setNow(at(day,1));f.setHash('c'.repeat(64));await f.ops.tick();f.setNow(at(day,2));f.setHash(calendarHash);f.setMode('isolated');await f.ops.tick();
 f.setNow(at(day,5));f.setMode('live');f.setSha('d'.repeat(40));await f.ops.tick();const r=f.review(f.input(6));
 assert.equal(r.runtimeEvidence.recordedMinutes,4);assert.equal(r.runtimeEvidence.incomparableMinutes,3);assert.equal(row(r,'operation-failure').sampleCount,1);assert.equal(row(r,'operation-failure').status,'unknown');
});
test('omitting a previously recorded qualified observation day or injecting observations is rejected',async t=>{
 const f=fixture(t);f.setReconciled(false);await f.ops.tick();const omitted=f.input();omitted.window.end=iso(at('2026-11-24',2));omitted.asOf=iso(at('2026-11-24',10));omitted.plan.runtimeSchedule.tradeDates=['2026-11-24'];
 assert.throws(()=>f.review(omitted),/schedule-omits-observation/);assert.throws(()=>f.review({...f.input(),observations:[]}),/plan-only/);
 const future=f.input();future.asOf='2099-01-01T00:00:00Z';assert.throws(()=>f.review(future),/window-invalid/);
 const invalid=f.input();invalid.plan.runtimeSchedule.calendarSource=null;assert.throws(()=>f.review(invalid),/schedule-invalid/);
});
test('CLI reads the private original journal read-only and returns exit 2 for known safety failure',async t=>{
 const f=fixture(t);f.setReconciled(false);await f.ops.tick();const plan=path.join(f.root,'quality-plan.json');fs.writeFileSync(plan,JSON.stringify(f.input()));
 const file=path.join(f.root,day+'.jsonl'),before=fs.readFileSync(file),script=path.resolve(__dirname,'../scripts/audit-product-quality.js');
 const result=spawnSync(process.execPath,[script,'--runtime-root',f.root,'--input',plan],{encoding:'utf8',timeout:5000});assert.equal(result.status,2,result.stderr);assert.equal(JSON.parse(result.stdout).criticalReview.state,'blocked');assert.deepEqual(fs.readFileSync(file),before);
 fs.appendFileSync(file,'{"incomplete":');const invalid=spawnSync(process.execPath,[script,'--runtime-root',f.root,'--input',plan],{encoding:'utf8',timeout:5000});assert.equal(invalid.status,1);assert.match(invalid.stderr,/incomplete-write/);
});
test('no evaluated rate samples retain a null value even with a known positive denominator',()=>{
 const scope={kind:'isolated-test',population:'no-observations'},window={start:'2026-11-01T00:00:00Z',end:'2026-11-02T00:00:00Z'},plan={version:'p',registeredAt:'2026-10-31T00:00:00Z',criteria:{'task-completion':{operator:'gte',threshold:1,minimumSamples:1}}};
 const r=evaluateProductQuality({revision,scope,window,plan,asOf:'2026-11-03T00:00:00Z',observations:[{metricId:'task-completion',revision,window,scopeKind:scope.kind,population:scope.population,unit:'ratio',evidenceRefs:[{id:'none',sha256:'b'.repeat(64)}],numerator:0,denominator:3,sampleCount:0}]});
 const x=row(r,'task-completion');assert.equal(x.status,'unknown');assert.equal(x.value,null);assert.equal(x.missingCount,3);
});
