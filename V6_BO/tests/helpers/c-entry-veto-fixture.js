'use strict';
// C20: original integration-candidate entry adapter acceptance evidence.
// Disposable objects only. The original buy callback is replaced by a sentinel;
// there is NO execution, persisted account, notification, or actual fill.
const {executeDecisionPlan,bindAuthoritativePlan,decisionPlanPayload}=require('../../src/core/paper-decision-plan');
const {evaluateEntryRisk}=require('../../src/core/common-entry-risk');
const {quoteUseEligibility}=require('../../src/core/quote-observation-view');
const model=Promise.all([import('../../src/core/decision-model.mjs'),import('../../public/nova/system-picks.mjs')]);
const now=Date.parse('2026-11-27T10:00:00+08:00'),day='2026-11-27',symbol='600000';
async function fixture(){
 const [m,p]=await model,account={enabled:true,cash:10000,equity:10000,maxPos:5,positions:[]};
 const original=m.decisionPlan({code:symbol,price:10,levels:{ma5:9.8,stop:9,t1:12}},account);
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:symbol,day,calculatedAt:now-5000,
  strategyAt:now-10000,quoteBasis:{code:symbol,source:'tencent',mode:'public-live-unverified',price:10,quoteAt:now-6000,receivedAt:now-5500},plan:original};
 const frozen=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',
  frozenAt:new Date(now-5000).toISOString(),...decisionPlanPayload(card)},card);
 return {input:{action:'executePlan',account:'pool',planId:frozen.id},plan:frozen,now,day,replica:false,continuous:true,
  candidate:{code:symbol,name:'隔离标的',score:100,canOpen:true,poolDay:day},eligiblePick:p.eligiblePick,systemPickDay:p.systemPickDay,poolDay:day,newsBlocked:false,
  account:{enabled:true,cash:10000,positions:{}},policy:{maxPos:5},equity:10000,
  quote:{symbol,price:10,quoteAt:now-1000,timestamp:now-1000,receivedAt:now-500,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',tradeDate:day,canTrade:true},
  authoritative:{...card,calculatedAt:now,quoteBasis:{...card.quoteBasis,quoteAt:now-1000,receivedAt:now-500}},
  readBook:()=>({account:{events:[]}})};
}
function probe(f){
 const sentinel=Symbol('reached-original-buy-callback');let count=0;
 try{const value=executeDecisionPlan({...f,buy:()=>{count++;throw sentinel;}});return {reached:count>0,status:value.status,reason:null};}
 catch(e){return {reached:count>0,status:e===sentinel?'callback-reached-not-executed':'rejected',reason:e===sentinel?null:String(e.message||e)};}
}
const baseRisk={policy:{version:'original',maxPositionPct:20,maxGrossExposurePct:40,maxSectorPct:30,maxStrategyPct:30},
 symbol,quantity:100,price:10,cash:10000,positions:[{symbol:'600001',quantity:100,strategyId:'s1'}],
 pending:[{symbol:'600002',quantity:100,price:10,strategyId:'s1'}],marks:{'600001':10},
 sectors:{'600000':'bank','600001':'bank','600002':'bank'},strategyId:'s1'};
module.exports={fixture,probe,model,now,day,symbol,baseRisk,evaluateEntryRisk,quoteUseEligibility};
