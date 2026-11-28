'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {alertIdentityMatches,queuedPlanMatches}=require('../src/core/fayo-queued-plan-evidence');
const h=c=>c.repeat(64),at=1800000000000;
function fixture(kind='stop'){
 const entry=kind==='entry'?null:'buy-1',alert={id:h('a'),observationId:h('b'),planVersion:h('c'),planId:'p',code:'600000',kind,entryEventId:entry,quoteAt:at,price:9,private:true,canTrade:false};
 return {alert,risk:{status:'active',priceDependent:true,sourceAt:at,object:{id:'600000'},references:{planId:'p',observationId:alert.observationId,alertId:alert.id,kind,entryEventId:entry}},
  plan:{id:'p',code:'600000',decisionAuthority:'fayo-decision-center',version:h('c')},context:{current:true,ambiguous:null,entry:entry?{eventId:entry}:null,remaining:entry?100:0},
  quote:{quoteAt:at,price:9},versionOf:p=>p.version,queuedGeneration:2,currentGeneration:2,now:at+500};
}
test('F49.3 exact original held lot and version accepted only as private notification evidence',()=>assert.equal(queuedPlanMatches(fixture()),true));
test('F49.3 another alert observation, plan version, lot or account context cannot reuse old reminder',()=>{for(const change of [f=>f.risk.references.observationId=h('d'),f=>f.risk.references.alertId=h('d'),f=>f.plan.version=h('d'),f=>f.context.entry.eventId='buy-2',f=>f.context.current=false,f=>f.context.remaining=0,f=>f.context.ambiguous='unknown']){const f=fixture();change(f);assert.equal(queuedPlanMatches(f),false);}});
test('F49.3 invalidate while queued is not renewed by a successful later read',()=>{const f=fixture();f.currentGeneration++;assert.equal(queuedPlanMatches(f),false);});
test('F49.3 stale, future, backwards and conflicting same-timestamp quotes fail',()=>{for(const change of [f=>f.now=at+15001,f=>f.quote.quoteAt=at-1,f=>f.quote.quoteAt=f.now+1,f=>f.quote.price=8]){const f=fixture();change(f);assert.equal(queuedPlanMatches(f),false);}});
test('F49.3 entry alert cannot be sent after original purchase; no false lot association',()=>{const f=fixture('entry');assert.equal(queuedPlanMatches(f),true);f.context.entry={eventId:'buy-1'};assert.equal(queuedPlanMatches(f),false);});
test('F49.3 merged risk must match original persisted alert before reservation',()=>{const f=fixture();f.risk.sourceAt++;assert.equal(alertIdentityMatches(f.risk,f.alert,f.plan,f.versionOf),false);});
