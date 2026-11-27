'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectPaperPlanEntry}=require('../src/core/paper-plan-entry-check');
const {decisionPlanPayload,bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const now=Date.parse('2026-11-25T10:00:00+08:00'),day='2026-11-25';
function fixture(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,
  strategyAt:now-6000,quoteBasis:{source:'tencent'},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:20}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',
  frozenAt:new Date(now-5000).toISOString(),...decisionPlanPayload(card)},card);
 const wire={code:plan.code,name:'隔离测试',price:10,preClose:10,volume:100000,quoteAt:now-1000,
  receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true};
 const quote={symbol:plan.code,price:10,quoteAt:wire.quoteAt,timestamp:wire.quoteAt,receivedAt:wire.receivedAt,
  quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',tradeDate:day,volume:wire.volume*100,
  volumeUnit:'shares',upperLimit:11,lowerLimit:9,suspended:false,tradable:true,canTrade:wire.canTrade===true,
  inputProvenance:createAutomaticInputProvenance({stock:wire,observation:wire,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 return {input:{input:{action:'executePlan',account:'pool',planId:plan.id},plan,now,day,replica:false,continuous:true,
  candidate:wire,eligiblePick:()=>true,systemPickDay:()=>day,poolDay:day,newsBlocked:false,authoritative:card,
  account:{enabled:true,cash:10000,positions:{}},policy:{maxPos:5},equity:10000,quote,
  book:{revision:1,fingerprint:'b'.repeat(64),orders:{},account:{cash:10000,positions:{},events:[]}}},
  options:{sealedUp:false,heldCount:0,monitorCapacity:20,lot:100,feeFor:()=>5}};
}
test('read-only entry observation reuses the real plan checks and preserves all input state',()=>{
 const f=fixture(),before=JSON.stringify(f.input),result=inspectPaperPlanEntry(f.input,f.options);
 assert.equal(result.allowed,true);assert.equal(result.quantity,100);assert.equal(result.quoteAt,now-1000);
 assert.equal(JSON.stringify(f.input),before);assert.match(result.reason,/不代表真实盘口/);
});
test('original plan exclusions and account capacity cannot become buy opportunities',()=>{
 const cases=[input=>input.replica=true,input=>input.continuous=false,input=>input.newsBlocked=true,
  input=>input.plan.stop=8,input=>input.authoritative=null,input=>input.account.enabled=false,
  input=>input.account.cash=0,input=>input.quote.quoteAt=now-15001,
  input=>input.candidate.cap='空仓',input=>input.candidate.strategyId='t01',
  input=>input.account.positions={600001:{},600002:{},600003:{},600004:{},600005:{}}];
 for(const patch of cases){const f=fixture();patch(f.input);assert.equal(inspectPaperPlanEntry(f.input,f.options).allowed,false);}
 for(const patch of [{sealedUp:true},{heldCount:20}]){const f=fixture();assert.equal(inspectPaperPlanEntry(f.input,{...f.options,...patch}).allowed,false);}
});
test('risk policies, pending orders and malformed provenance remain unassessed, without bypassing original checks',()=>{
 for(const patch of [input=>input.book.riskPolicy={version:'custom'},
  input=>input.book.orders.pending={state:{terminal:false}},input=>input.quote.inputProvenance.fingerprint='bad']){
  const f=fixture();patch(f.input);assert.equal(inspectPaperPlanEntry(f.input,f.options).allowed,null);
 }
 const f=fixture();assert.equal(inspectPaperPlanEntry(f.input,{...f.options,feeFor:()=>NaN}).allowed,false);
});
test('suspension, limit lock, missing size and daily volume participation never certify a window',()=>{
 for(const patch of [{suspended:true},{tradable:false},{price:11},{price:9},{volume:undefined},{volume:9999}]){
  const f=fixture();Object.assign(f.input.quote,patch);assert.equal(inspectPaperPlanEntry(f.input,f.options).allowed,false);
 }
 const f=fixture();f.input.book.account.events.push({symbol:'600000',tradeDate:day,quantity:100000});
 assert.equal(inspectPaperPlanEntry(f.input,f.options).allowed,false);
});
