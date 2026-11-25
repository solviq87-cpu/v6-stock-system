'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../src/core/advanced-portfolio-evidence');
const equal=assert.equal,ok=assert.ok,throws=assert.throws;
test("capacity bounded and nonlinear, late prior rejected",()=>{
  const asOf=Date.parse("2026-11-25T10:00:00+08:00"),prior={date:"2026-11-24",source:"provider",dataVersion:"v1",availableAt:asOf-3600000,priceBasis:"unadjusted",evidenceKind:"historical",amount:1000000,volume:100000,volumeUnit:"shares"};
  const input={asOf,prior,price:10,lotSize:100,capitalLevels:[10000,1000000],targetWeight:1,maxParticipationPct:5,feeBps:5,impactBpsAtLimit:50};
  const a=api.capacityScenarios(input);equal(a.rows[0].estimatedShares,1000);equal(a.rows[1].estimatedShares,5000);ok(a.rows[1].assumedImpactBps>a.rows[0].assumedImpactBps);equal(a.rows[1].estimatedNetReturn,null);equal(a.canTrade,false);
  equal(api.capacityScenarios({...input,prior:{...prior,availableAt:asOf+1}}).status,"unknown");equal(api.capacityScenarios({...input,prior:{...prior,volumeUnit:"lots"}}).status,"unknown");
 });
test("exit locked and stale cannot predict fill",()=>{
  const now=Date.parse("2026-11-25T10:00:00+08:00"),position={symbol:"600000",quantity:300,sellable:100},quote={code:"600000",price:10,quoteAt:now-16000,receivedAt:now,quoteSource:"provider",canTrade:true};
  const x=api.exitRisk({position,quote,now,limitDown:true,suspended:false});equal(x.sellable,100);equal(x.conditionalSessions,null);equal(x.estimatedExitCost,null);equal(x.guaranteedFill,false);ok(x.alerts.some(a=>a.code==="QUOTE_INELIGIBLE"));ok(x.alerts.some(a=>a.code==="LIMIT_DOWN"));
  equal(api.exitRisk({position:{...position,sellable:400},quote,now}).status,"unknown");
 });
test("external deposits not profit and invalid boundary blocked",()=>{
  const initialAt=Date.parse("2025-01-01T00:00:00Z"),at=initialAt+365*86400000,rows=[{at,equityBeforeFlow:110,externalFlow:100,equityAfterFlow:210,evidenceRef:"ledger1"}];
  const x=api.cashFlowPerformance({initialAt,initialEquity:100,rows});equal(x.investmentPnl,10);equal(x.externalNetFlow,100);equal(x.timeWeightedReturn,.1);equal(x.moneyWeightedAnnualReturn,.1);equal(x.benchmarkReturn,null);equal(x.canTrade,false);
  equal(api.cashFlowPerformance({initialAt,initialEquity:100,rows:[{...rows[0],equityAfterFlow:220}]}).status,"unknown");
 });
test("tail insufficient and complete contributions reconcile",()=>{
  const start=Date.parse("2025-01-01T00:00:00Z"),observations=Array.from({length:220},(_,i)=>{const t=start+i*86400000;return {date:new Date(t).toISOString().slice(0,10),availableAt:t+86400000,source:"p",dataVersion:"v1",evidenceKind:"historical",returnBasis:"total-return",returns:{"600000":i%2?.01:-.02,"600001":i%2?-.005:.004}};});
  const assets=[{symbol:"600000",weight:.5,industry:"bank"},{symbol:"600001",weight:.3,industry:"other"}],asOf=start+221*86400000;
  const x=api.tailRisk({assets,observations,asOf});ok(Math.abs(x.contributions.reduce((s,c)=>s+c.volatilityContribution,0)-x.dailyVolatility)<1e-7);ok(Math.abs(x.contributions.reduce((s,c)=>s+c.tailLossContribution,0)-x.historicalES)<1e-7);equal(x.tailCount,11);equal(x.correlations[0].recent30,-1);equal(api.tailRisk({assets,observations:observations.slice(0,60),asOf}).historicalES,null);equal(api.tailRisk({assets,observations:[...observations.slice(0,-1),{...observations.at(-1),availableAt:asOf+1}],asOf}).status,"unknown");
 });
test("preview fails closed, cash and classifications do not mutate source",()=>{
  const snapshot={evidenceRef:"ledger1",equity:1000,cash:600,availableCash:500,positions:[{symbol:"600000",marketValue:400,industry:"bank"}]},plan={symbol:"600001",price:10,quantity:30,fee:1,evidenceRef:"plan1",industry:"bank"};
  const x=api.previewPosition({snapshot,plan,gate:{status:"allowed",evidenceRef:"gate1"}});equal(x.cashAfter,299);equal(x.availableCashAfter,199);equal(x.previewBlocked,false);equal(x.canTrade,false);equal(snapshot.positions.length,1);equal(x.industry.length,1);
  equal(api.previewPosition({snapshot,plan}).previewBlocked,true);equal(api.previewPosition({snapshot,plan:{...plan,quantity:60},gate:{status:"allowed",evidenceRef:"gate1"}}).previewBlocked,true);equal(api.previewPosition({snapshot:{...snapshot,equity:1001},plan}).status,"unknown");
 });
test("late revisions do not overwrite historical as-of and duplicate conflicts fail",()=>{
  const a={source:"p",id:"security-field",dataVersion:"v1",factorVersion:"f1",version:1,eventAt:1000,originalAt:2000,receivedAt:3000,firstAvailableAt:4000,revisedAt:null,payloadHash:"a".repeat(64)};
  const b={...a,version:2,dataVersion:"v2",receivedAt:6000,firstAvailableAt:7000,revisedAt:5000,payloadHash:"b".repeat(64)};
  const q=decisionAt=>({source:"p",id:a.id,eventThrough:1000,decisionAt});
  equal(api.pointInTimeVersion([a,b],q(3500)).status,"unknown");equal(api.pointInTimeVersion([a,b],q(5000)).record.version,1);equal(api.pointInTimeVersion([a,b],q(7000)).record.version,2);
  throws(()=>api.pointInTimeVersion([a,b,{...b,payloadHash:"c".repeat(64)}],q(7000)));throws(()=>api.pointInTimeVersion([a,{...b,firstAvailableAt:3000}],q(7000)));
 });
