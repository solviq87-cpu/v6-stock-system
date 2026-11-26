'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createRuntimeAcceptance,evaluateRuntimeQuality,RUNTIME_QUALITY_POPULATION}=require('../src/core/runtime-acceptance');
const day='2026-11-23',revision='a'.repeat(40),calendarHash='b'.repeat(64),start=Date.parse(day+'T09:30:00+08:00');
const iso=n=>new Date(n).toISOString();
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-acceptance-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=start,alter=null,delay=0;
 const ops=createRuntimeAcceptance({root,clock:()=>now,canWrite:()=>true,liveCollector:true,env:{NODE_ENV:'production'},
  calendar:()=>({status:'available',tradeDates:[day],metadata:{source:'boundary-calendar',runtimeEligible:true,sha256:calendarHash,from:day,to:day}}),
  release:()=>({verifiedInstalled:true,sourceSha:revision}),collect:async()=>{
   const q={code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now};
   const result={mode:'live',market:{expectedSymbols:2,attempts:1,successes:1,quotes:[q,{...q,code:'000001',...alter}]}};
   now+=delay;return result;
  }});
 const input={revision,asOf:iso(start+20*60000),window:{start:iso(start),end:iso(start+60000)},scope:{kind:'real-market-paper',population:RUNTIME_QUALITY_POPULATION},plan:{version:'boundaries-v1',registeredAt:iso(start-60000),criteria:{'operation-failure':{operator:'lte',threshold:0,minimumSamples:1}},runtimeSchedule:{calendarSource:'boundary-calendar',calendarHash,tradeDates:[day]}}};
 return {root,ops,input,alter:v=>alter=v,delay:v=>delay=v,setNow:v=>now=v};
}
const row=(r,id)=>r.dimensions.flatMap(d=>d.metrics).find(m=>m.id===id);
test('a mixed fresh and future/invalid-price population cannot earn a live slot',async t=>{
 for(const [reason,alter] of [['future-original-quote-time',{quoteAt:start+1}],['future-original-quote-time',{receivedAt:start+1}],['future-original-quote-time',{receivedAt:start-2000}],['invalid-original-quote-price',{price:0}]]){
  const f=fixture(t);f.alter(alter);const receipt=await f.ops.tick();
  assert.equal(receipt.recorded,true);assert.equal(receipt.liveEligible,false,reason);assert.ok(receipt.exclusions.includes(reason));
  const d=(await f.ops.report()).days[0];assert.equal(d.liveSamples,0);assert.equal(d.attemptSamples,1);assert.ok(d.failures.includes(reason));assert.equal(d.latest.market.freshQuotes,1);
  const quality=evaluateRuntimeQuality({root:f.root,input:f.input,now:start+20*60000});const metric=row(quality,'operation-failure');assert.deepEqual([metric.numerator,metric.denominator,metric.sampleCount,metric.status],[1,1,1,'fail']);
 }
});
test('legacy live flag with recorded future quotes cannot earn a live slot but its attempt survives',async t=>{
 const f=fixture(t);f.alter({quoteAt:start+1});await f.ops.tick();
 const file=path.join(f.root,day+'.jsonl'),record=JSON.parse(fs.readFileSync(file,'utf8'));
 // Test-only recreation of a historical pre-fix row, not a production migration.
 const {fingerprint,...body}=record;body.liveEligible=true;body.exclusions=[];
 fs.writeFileSync(file,JSON.stringify({...body,fingerprint:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')})+'\n');
 const before=fs.readFileSync(file),d=(await f.ops.report()).days[0];assert.equal(d.liveSamples,0);assert.equal(d.attemptSamples,1);assert.ok(d.failures.includes('future-original-quote-time'));assert.deepEqual(fs.readFileSync(file),before);
});
test('a late attempt explicitly blocks the day even when other live slots cover the whole session',async t=>{
 const f=fixture(t);for(const [hour,first,last]of [[9,30,60],[10,0,60],[11,0,30],[13,0,60],[14,0,60]])for(let m=first;m<last;m+=5){f.setNow(Date.parse(day+'T'+String(hour).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00+08:00'));assert.equal((await f.ops.tick()).liveEligible,true);}
 f.setNow(Date.parse(day+'T14:56:00+08:00'));f.delay(15001);const late=await f.ops.tick();assert.equal(late.recorded,true);assert.ok(late.exclusions.includes('collection-window-exceeded'));
 f.setNow(Date.parse(day+'T16:00:00+08:00'));const d=(await f.ops.report()).days[0];assert.equal(d.completeObservation,true);assert.equal(d.liveSamples,48);assert.equal(d.attemptSamples,49);assert.ok(d.failures.includes('collection-window-exceeded'));assert.equal(d.status,'observed-with-failures');
});
