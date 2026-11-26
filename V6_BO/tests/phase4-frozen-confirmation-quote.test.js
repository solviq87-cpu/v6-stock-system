'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executeDecisionPlan,decisionPlanPayload,bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const day='2026-11-16',at=s=>Date.parse(day+'T'+s+'+08:00'),now=at('14:00:00'),code='600000';
function fixture({quoteAt=now-1000,frozenAt=now,clock=now}={}){
 const quote={symbol:code,tradeDate:day,price:10.4,quoteAt,timestamp:quoteAt,receivedAt:quoteAt+500,
  quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',canTrade:true,
  volume:1000000,volumeUnit:'shares',lowerLimit:9,upperLimit:11,suspended:false,tradable:true};
 const basis={code,price:quote.price,quoteAt,receivedAt:quote.receivedAt,source:quote.quoteSource,mode:quote.mode,kind:'independent-current-original-row'};
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day,calculatedAt:frozenAt,
  strategyAt:now-5000,quoteBasis:{...basis},plan:{buyLow:10.2,buyHigh:10.4,stop:9.8,target:11,positionPct:20}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',
  frozenAt:new Date(frozenAt).toISOString(),...decisionPlanPayload(card)},card);
 // Use separate objects as the HTTP route does after persisting a plan.
 plan.decisionEvidence=JSON.parse(JSON.stringify(plan.decisionEvidence));
 const current={...card,calculatedAt:clock,quoteBasis:{...basis}};
 const book={account:{events:[],positions:{}}};
 return {input:{action:'executePlan',account:'pool',planId:plan.id},plan,now:clock,day,replica:false,continuous:true,
  quote,authoritative:current,candidate:{code},eligiblePick:()=>true,systemPickDay:()=>day,poolDay:day,newsBlocked:false,
  account:{enabled:true,cash:10000,positions:{}},policy:{maxPos:5},equity:10000,
  readBook:()=>book,buy(){throw Error('isolated-original-buy-reached');}};
}
test('immediate direct confirmation accepts the exact still-fresh frozen server quote without advancing its clock',()=>{
 const x=fixture(),before=JSON.stringify({plan:x.plan,quote:x.quote,card:x.authoritative});
 assert.ok(x.quote.quoteAt<Date.parse(x.plan.frozenAt));
 assert.throws(()=>executeDecisionPlan(x),/isolated-original-buy-reached/);
 assert.equal(JSON.stringify({plan:x.plan,quote:x.quote,card:x.authoritative}),before);
});
test('the exact frozen quote is accepted only through the unchanged fifteen-second boundary',()=>{
 assert.throws(()=>executeDecisionPlan(fixture({quoteAt:now-15000})),/isolated-original-buy-reached/);
 assert.throws(()=>executeDecisionPlan(fixture({quoteAt:now-15001})),/过期/);
});
test('unrelated earlier quotes or incomplete frozen/current bindings cannot reach direct confirmation',()=>{
 for(const mutate of [
  x=>x.quote.symbol='600001',x=>x.quote.price=10.3,x=>x.quote.receivedAt--,
  x=>{x.quote.quoteAt--;x.quote.timestamp--;},x=>x.quote.mode='public-other',
  x=>{x.quote.quoteSource='other';x.quote.provider='other';},
  x=>delete x.plan.decisionEvidence.quoteBasis.receivedAt,
  x=>delete x.plan.decisionEvidence.quoteBasis.code,x=>delete x.plan.decisionEvidence.quoteBasis.mode,
  x=>x.plan.decisionEvidence.calculatedAt=now+1,x=>x.plan.decisionEvidence.calculatedAt=x.quote.receivedAt-1,
  x=>x.authoritative.calculatedAt=now+1,x=>x.authoritative.quoteBasis.price=10.3,
  x=>x.authoritative.quoteBasis.receivedAt++,x=>x.authoritative.quoteBasis.quoteAt++,
  x=>x.authoritative.quoteBasis.code='600001'
 ]){
  const x=fixture();mutate(x);
  assert.throws(()=>executeDecisionPlan(x),/早于冻结计划/);
 }
});
test('matching frozen quote still cannot bypass session, freshness, source or read-only gates',()=>{
 const lunch=fixture({clock:at('11:30:00'),frozenAt:at('11:29:59'),quoteAt:at('11:29:58')});
 assert.throws(()=>executeDecisionPlan(lunch),/连续竞价时段/);
 const restart=fixture({clock:at('13:00:01'),frozenAt:at('12:59:59'),quoteAt:at('12:59:58')});
 assert.throws(()=>executeDecisionPlan(restart),/连续竞价时段/);
 for(const patch of [{canTrade:false},{readOnlyBackup:true},{sourceConflict:true},{provider:'other'},{timestamp:now-1001}]){
  const x=fixture();Object.assign(x.quote,patch);
  assert.throws(()=>executeDecisionPlan(x),/只读、来源冲突或时点不一致/);
 }
});
test('a new original post-freeze quote keeps the existing direct confirmation path',()=>{
 const x=fixture({frozenAt:now-2000});x.plan.decisionEvidence.quoteBasis={source:'tencent'};
 assert.throws(()=>executeDecisionPlan(x),/isolated-original-buy-reached/);
});
