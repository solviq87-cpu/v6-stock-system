'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Isolate only the projection with the original observer/authority contracts;
// the existing server contract tests exercise the full real producer path.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/core/paper-plan-notice-review.js'),'utf8');
const now=Date.parse('2026-11-27T10:00:00+08:00'),day='2026-11-27',epoch='b'.repeat(64),decisionId='d'.repeat(64),fingerprint='f'.repeat(64);
const crypto=require('node:crypto'),observer=require('../src/core/paper-plan-observer');
function seal(record){
 const {fingerprint,...body}=record;
 return {...body,fingerprint:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
function fixture(kind='entry'){
 const plan={id:'plan-00000000-0000-4000-8000-000000000001',decisionAuthority:'fayo-decision-center',decisionId,code:'600000',
  intendedDate:kind==='entry'?day:'2026-11-26',frozenAt:'2026-11-26T09:00:00+08:00',
  entryMin:9,entryMax:11,stop:8,target:14,maxPosition:10};
 const planId=plan.id,planVersion=observer.planVersion(plan),held=kind!=='entry';
 const payload={schemaVersion:1,kind:'paper-plan-observation',account:'pool',planId,planVersion,decisionId,
  code:plan.code,name:'样例',day,intendedDate:plan.intendedDate,frozenAt:plan.frozenAt,inputProvenanceFingerprint:fingerprint,
  quoteAt:now-2000,receivedAt:now-1900,observedAt:now-1800,price:held?7.9:10,source:'eastmoney',mode:'public-live-unverified',
  entryMin:9,entryMax:11,stop:8,target:14,volume:100000,volumeUnit:'shares',lowerLimit:7,upperLimit:15,
  suspended:false,tradable:true,statusDefaulted:false,entryEventId:held?'original-lot':null,remainingQuantity:held?200:0,
  scope:observer.SCOPE,canTrade:false,accountMutated:false};
 const prepare=raw=>{
  const r=seal({...raw,entry:{allowed:!held,reason:'原入场预检',checkedAt:raw.observedAt},
   exit:{allowed:held&&raw.remainingQuantity>0&&raw.remainingQuantity%100===0,reason:raw.remainingQuantity%100?'原整手限制':'原退出预检',
    quantity:raw.remainingQuantity,participationPct:1,originalAllowed:held,fee:held?5:null,feeVersion:held?'original-v1':null,
    reservedQuantity:held?0:null,usedVolume:held?0:null}});
  observer.validateObservation(r,{now:r.observedAt,day,plan});return r;
 };
 const record=prepare(payload),alert=observer.alertsForRecord(record).find(a=>a.kind===kind);
 const point={...payload,quoteAt:now-1000,receivedAt:now-500,observedAt:now-250};
 const ref={deliveryId:'1'.repeat(64),accountEpoch:epoch,observationId:record.fingerprint,alertId:alert.id,code:record.code,kind,quoteAt:record.quoteAt};
 const mod={exports:{}};
 let allowed=true,continuous=true,currentClock=now,afterObserve=null;
 const ctx={module:mod,exports:mod.exports,require:n=>n==='./a-share-calendar'?require('../src/core/a-share-calendar'):
  n==='./account-equity-evidence'?{accountEpochOf:()=>epoch}:n==='./paper-plan-observer'?{...observer,observePaperPlans:()=>{
   const current=prepare(point);if(afterObserve)afterObserve();return {records:[current]};
  }}:null};
 vm.runInNewContext(source,ctx);
 const options={clock:()=>currentClock,canRead:()=>allowed,available:()=>allowed,
  session:at=>({day,continuous:continuous&&observer.sessions(day).some(([a,b])=>at>=a&&at<b)}),
  store:{read:async()=>({records:[record],alerts:[alert]})},readArchive:async()=>({ok:true,state:{plans:[plan]}}),
  readContext:async()=>({book:{},now:now-250})};
 return {record,point,ref,options,review:()=>mod.exports.reviewPlanNotice(ref,options),
  revoke:()=>{allowed=false;},close:()=>{continuous=false;},afterObserve:fn=>{afterObserve=fn;},advance:ms=>{currentClock+=ms;}};
}
test('F38.2 original validity and provenance remain available in a historical private card',async()=>{const f=fixture();f.close();const r=await f.review();assert.equal(r.status,'historical');assert.equal(r.original.actionWindow,'original-entry-trading-day-only');assert.equal(r.original.observationId,f.ref.observationId);assert.equal(r.original.alertId,f.ref.alertId);assert.equal(r.original.inputProvenanceFingerprint,fingerprint);assert.equal(r.original.originalQuoteValidUntil,f.record.quoteAt+15000);assert.equal(r.current,null);assert.equal(r.canTrade,false);});
test('F38.2 current same-lot remaining quantity is distinct from archived observation',async()=>{const f=fixture('stop');f.point.remainingQuantity=100;const r=await f.review();assert.equal(r.status,'observed');assert.equal(r.original.actionWindow,'original-held-lot-only');assert.equal(r.original.remainingQuantity,200);assert.equal(r.current.remainingQuantity,100);assert.equal(r.current.sameOriginalContext,true);assert.equal(r.current.validUntil,f.point.quoteAt+15000);assert.equal(r.accountMutated,false);});
test('F38.2 other holding lot cannot lend permission or quantity to original alert',async()=>{const f=fixture('stop');f.point.entryEventId='other-lot';f.point.remainingQuantity=300;const r=await f.review();assert.equal(r.status,'waiting');assert.equal(r.current.gate,null);assert.equal(r.current.remainingQuantity,null);assert.equal(r.current.sameOriginalContext,false);assert.equal(r.original.remainingQuantity,200);});
test('F38.2 revoked private read suppresses all historical and current evidence',async()=>{const f=fixture();f.options.readContext=async()=>{f.revoke();return {book:{},now};};const r=await f.review();assert.equal(r.status,'unavailable');assert.equal(r.original,null);assert.equal(r.current,null);assert.equal(r.canTrade,false);});

test('F38.2 real archived sample is preserved and not described as an official intraday path',async()=>{
 const f=fixture(),r=await f.review();assert.equal(r.status,'observed');
 assert.equal(r.original.sampledPath.status,'descriptive-only');assert.equal(r.original.sampledPath.sampleCount,1);
 assert.equal(r.original.sampledPath.originalOpen,null);assert.equal(r.original.sampledPath.completeIntradayPath,false);
 assert.equal(r.current.conditionObserved,true);assert.equal(r.canTrade,false);
});
test('F38.2 remaining odd lot keeps its quantity but cannot obtain an automatic exit gate',async()=>{
 const f=fixture('stop');f.point.remainingQuantity=40;const r=await f.review();assert.equal(r.status,'blocked');
 assert.equal(r.original.remainingQuantity,200);assert.equal(r.current.remainingQuantity,40);assert.equal(r.current.gate,false);
});
test('F38.2 returned quote is valid at exactly fifteen seconds and historical after one extra millisecond',async()=>{
 for(const [delay,expected] of [[14000,'observed'],[14001,'historical']]){
  const f=fixture();f.afterObserve(()=>f.advance(delay));const r=await f.review();
  assert.equal(r.status,expected);assert.equal(r.original.observationId,f.ref.observationId);
  assert.equal(r.current===null,expected==='historical');
 }
});
test('F38.2 permission revoked after current observation removes both original and current evidence',async()=>{
 const f=fixture();f.afterObserve(f.revoke);const r=await f.review();assert.equal(r.status,'unavailable');
 assert.equal(r.original,null);assert.equal(r.current,null);assert.equal(r.accountMutated,false);
});
