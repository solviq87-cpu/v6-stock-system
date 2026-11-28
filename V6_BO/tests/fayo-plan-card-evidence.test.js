'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Isolate only the projection with the original observer/authority contracts;
// the existing server contract tests exercise the full real producer path.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/core/paper-plan-notice-review.js'),'utf8');
const now=Date.parse('2026-11-27T10:00:00+08:00'),day='2026-11-27',id='a'.repeat(64),epoch='b'.repeat(64),planId='plan-id',version='c'.repeat(64),decisionId='d'.repeat(64),alertId='e'.repeat(64),fingerprint='f'.repeat(64);
function fixture(kind='entry'){
 const record={fingerprint:id,planId,planVersion:version,decisionId,code:'600000',day,intendedDate:kind==='entry'?day:'2026-11-26',
  frozenAt:'2026-11-26T16:00:00+08:00',inputProvenanceFingerprint:fingerprint,quoteAt:now-2000,receivedAt:now-1900,observedAt:now-1800,price:10,source:'original',entryMin:9,entryMax:11,stop:8,target:14,
  entryEventId:kind==='entry'?null:'original-lot',remainingQuantity:kind==='entry'?0:100};
 const alert={id:alertId,observationId:id,planId,planVersion:version,code:record.code,quoteAt:record.quoteAt,kind,entryEventId:record.entryEventId,availability:true,reason:'原预检'};
 const point={...record,quoteAt:now-1000,receivedAt:now-500,observedAt:now-250,entry:{allowed:true,reason:'原入场预检'},exit:{allowed:true,reason:'原退出预检'}};
 const ref={deliveryId:'1'.repeat(64),accountEpoch:epoch,observationId:id,alertId,code:record.code,kind,quoteAt:record.quoteAt};
 const plan={id:planId,decisionAuthority:'fayo-decision-center',decisionId,planVersion:version};
 const mod={exports:{}};
 const ctx={module:mod,exports:mod.exports,require:n=>n==='./a-share-calendar'?{aShareCalendarDate:()=>day}:n==='./account-equity-evidence'?{accountEpochOf:()=>epoch}:n==='./paper-plan-observer'?{planVersion:p=>p.planVersion,observePaperPlans:()=>({records:[point]}),alertsForRecord:p=>[{kind,entryEventId:p.entryEventId}]}:null};
 vm.runInNewContext(source,ctx);
 let allowed=true,continuous=true;
 const options={clock:()=>now,canRead:()=>allowed,available:()=>allowed,session:()=>({day,continuous}),store:{read:async()=>({records:[record],alerts:[alert]})},readArchive:async()=>({ok:true,state:{plans:[plan]}}),readContext:async()=>({book:{},now:now-250})};
 return {record,point,ref,options,review:()=>mod.exports.reviewPlanNotice(ref,options),revoke:()=>{allowed=false;},close:()=>{continuous=false;}};
}
test('F38.2 original validity and provenance remain available in a historical private card',async()=>{const f=fixture();f.close();const r=await f.review();assert.equal(r.status,'historical');assert.equal(r.original.actionWindow,'original-entry-trading-day-only');assert.equal(r.original.observationId,id);assert.equal(r.original.alertId,alertId);assert.equal(r.original.inputProvenanceFingerprint,fingerprint);assert.equal(r.original.originalQuoteValidUntil,f.record.quoteAt+15000);assert.equal(r.current,null);assert.equal(r.canTrade,false);});
test('F38.2 current same-lot remaining quantity is distinct from archived observation',async()=>{const f=fixture('stop');f.point.remainingQuantity=40;const r=await f.review();assert.equal(r.status,'observed');assert.equal(r.original.actionWindow,'original-held-lot-only');assert.equal(r.original.remainingQuantity,100);assert.equal(r.current.remainingQuantity,40);assert.equal(r.current.sameOriginalContext,true);assert.equal(r.current.validUntil,f.point.quoteAt+15000);assert.equal(r.accountMutated,false);});
test('F38.2 other holding lot cannot lend permission or quantity to original alert',async()=>{const f=fixture('stop');f.point.entryEventId='other-lot';f.point.remainingQuantity=300;const r=await f.review();assert.equal(r.status,'waiting');assert.equal(r.current.gate,null);assert.equal(r.current.remainingQuantity,null);assert.equal(r.current.sameOriginalContext,false);assert.equal(r.original.remainingQuantity,100);});
test('F38.2 revoked private read suppresses all historical and current evidence',async()=>{const f=fixture();f.options.readContext=async()=>{f.revoke();return {book:{},now};};const r=await f.review();assert.equal(r.status,'unavailable');assert.equal(r.original,null);assert.equal(r.current,null);assert.equal(r.canTrade,false);});
