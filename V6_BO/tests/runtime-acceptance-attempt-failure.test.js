'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRuntimeAcceptance}=require('../src/core/runtime-acceptance');
const day='2026-11-23',revision='a'.repeat(40),calendarHash='b'.repeat(64);
const at=(hour,minute)=>Date.parse(day+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00');
const safetyFailures=['risk-false-negative-observed','notification-delay','recovery-not-verified','dual-client-mismatch'];
async function observe(t,mode){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-runtime-attempt-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let now=at(9,30),bad=false;
  const ops=createRuntimeAcceptance({root,clock:()=>now,canWrite:()=>true,liveCollector:true,env:{NODE_ENV:'production'},
    calendar:()=>({status:'available',tradeDates:[day],metadata:{source:'attempt-calendar',runtimeEligible:true,sha256:calendarHash,from:day,to:day}}),
    release:()=>({verifiedInstalled:true,sourceSha:revision}),collect:async()=>({
      mode:bad?mode:'live',market:{expectedSymbols:1,attempts:1,successes:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:now-(bad?16000:1000),receivedAt:now}]},
      risk:{falsePositives:0,falseNegatives:bad?1:0,delivered:1,deliveryDelayMs:bad?30001:200},
      execution:{recoveryVerified:!bad},
      clients:{desktopVersion:'v1',mobileVersion:bad?'v2':'v1',apiVersion:'v1',permissionsConsistent:!bad,featuresConsistent:!bad}
    })});
  for(const [hour,first,last] of [[9,30,60],[10,0,60],[11,0,30],[13,0,60],[14,0,60]])for(let minute=first;minute<last;minute+=5){
    now=at(hour,minute);assert.equal((await ops.tick()).liveEligible,true);
    if(hour===9&&minute===30){now=at(9,31);bad=true;const receipt=await ops.tick();assert.equal(receipt.recorded,true);assert.equal(receipt.liveEligible,false);bad=false;}
  }
  now=at(16,0);const file=path.join(root,day+'.jsonl'),before=fs.readFileSync(file),report=await ops.report();assert.deepEqual(fs.readFileSync(file),before);
  return report.days[0];
}
test('known negative safety evidence in a qualified failed-quote minute survives later healthy observations',async t=>{
  const d=await observe(t,'live');assert.equal(d.completeObservation,true);assert.equal(d.liveSamples,48);assert.equal(d.attemptSamples,49);
  assert.equal(d.latest.risk.falseNegatives,0);assert.equal(d.latest.execution.recoveryVerified,true);
  for(const failure of safetyFailures)assert.ok(d.failures.includes(failure),failure);
  assert.equal(d.status,'observed-with-failures');
});
test('an isolated replay does not introduce business safety failures or qualify as a real attempt',async t=>{
  const d=await observe(t,'replay');assert.equal(d.liveSamples,48);assert.equal(d.attemptSamples,48);
  for(const failure of safetyFailures)assert.ok(!d.failures.includes(failure),failure);
});
