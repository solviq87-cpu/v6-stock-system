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
test("same-symbol additions preserve each strategy's actual projected capital",()=>{
  const snapshot={evidenceRef:"original-book",equity:10000,cash:6000,availableCash:6000,positions:[{symbol:"600000",marketValue:4000,strategy:"first",industry:"bank"}]};
  const plan={evidenceRef:"plan",symbol:"600000",price:10,quantity:100,fee:5,strategy:"second",industry:"bank"};
  const input={snapshot,plan,gate:{status:"allowed",evidenceRef:"original-gate"}},before=JSON.stringify(input);
  const result=api.previewPosition(input),strategies=new Map(result.strategy.map(x=>[x.group,x.weight]));
  equal(strategies.size,2);ok(Math.abs(strategies.get("first")-4000/9995)<1e-8);ok(Math.abs(strategies.get("second")-1000/9995)<1e-8);
  ok(Math.abs(result.strategy.reduce((n,x)=>n+x.weight,0)-result.totalWeight)<2e-8);
  equal(result.industry.length,1);equal(result.previewBlocked,false);equal(JSON.stringify(input),before);
  const unknown=api.previewPosition({...input,snapshot:{...snapshot,positions:[{...snapshot.positions[0],strategy:null}]}});
  equal(unknown.strategy.find(x=>x.group==="未分类").weight,Math.round(4000/9995*1e8)/1e8);
  equal(unknown.strategy.find(x=>x.group==="second").weight,Math.round(1000/9995*1e8)/1e8);
 });
test("an allowed original receipt does not hide rejected or unverified current risk budgets",()=>{
  const input={snapshot:{evidenceRef:"book",equity:10000,cash:6000,availableCash:6000,positions:[{symbol:"600000",marketValue:4000}]},plan:{evidenceRef:"plan",symbol:"600001",price:10,quantity:100,fee:5},gate:{status:"allowed",evidenceRef:"original-gate"}};
  const blocked=api.previewPosition({...input,riskContext:{evidenceRef:"risk",policy:{version:"v1",maxGrossExposurePct:45}}});
  equal(blocked.riskBudgetAfter.estimatedConstraintsSatisfied,false);ok(blocked.riskBudgetAfter.reasonCodes.includes("GROSS_EXPOSURE_LIMIT"));equal(blocked.previewBlocked,true);equal(blocked.originalGateStatus,"allowed");equal(blocked.canTrade,false);
  const unverified=api.previewPosition({...input,riskContext:{evidenceRef:"risk",policy:{version:"v2",maxDailyLossPausePct:5}}});
  ok(unverified.riskBudgetAfter.reasonCodes.includes("MISSING_PRIOR_CLOSE_EVIDENCE"));equal(unverified.previewBlocked,true);
  const invalid=api.previewPosition({...input,riskContext:{evidenceRef:"risk",policy:{version:"v3",maxGrossExposurePct:101}}});
  equal(invalid.riskBudgetAfter.status,"unknown");equal(invalid.previewBlocked,true);
  equal(api.previewPosition({...input,riskContext:{evidenceRef:"risk",policy:{version:"v4",maxGrossExposurePct:60}}}).previewBlocked,false);
 });
test("late revisions do not overwrite historical as-of and duplicate conflicts fail",()=>{
  const a={source:"p",id:"security-field",dataVersion:"v1",factorVersion:"f1",version:1,eventAt:1000,originalAt:2000,receivedAt:3000,firstAvailableAt:4000,revisedAt:null,payloadHash:"a".repeat(64)};
  const b={...a,version:2,dataVersion:"v2",receivedAt:6000,firstAvailableAt:7000,revisedAt:5000,payloadHash:"b".repeat(64)};
  const q=decisionAt=>({source:"p",id:a.id,eventThrough:1000,decisionAt});
  equal(api.pointInTimeVersion([a,b],q(3500)).status,"unknown");equal(api.pointInTimeVersion([a,b],q(5000)).record.version,1);equal(api.pointInTimeVersion([a,b],q(7000)).record.version,2);
  throws(()=>api.pointInTimeVersion([a,b,{...b,payloadHash:"c".repeat(64)}],q(7000)));throws(()=>api.pointInTimeVersion([a,{...b,firstAvailableAt:3000}],q(7000)));
 });

test("F33 capacity compares bounded participation rates without new source or trade authority",()=>{
 const asOf=Date.parse("2026-11-25T10:00:00+08:00"),prior={date:"2026-11-24",source:"provider",dataVersion:"v1",availableAt:asOf-3600000,priceBasis:"unadjusted",evidenceKind:"historical",amount:1000000,volume:100000,volumeUnit:"shares"};
 const x=api.capacityParticipationSensitivity({asOf,prior,price:10,lotSize:100,capitalLevels:[1000000],targetWeight:1,maxParticipationPct:4,feeBps:5,impactBpsAtLimit:50});
 equal(x.status,"estimated-unverified");equal(x.participationSensitivity.length,3);
 equal(x.participationSensitivity[0].participationPct,1);equal(x.participationSensitivity[2].participationPct,4);
 equal(x.participationSensitivity[0].rows[0].estimatedShares,1000);equal(x.participationSensitivity[2].rows[0].estimatedShares,4000);
 equal(x.actualFillVerified,false);equal(x.canTrade,false);
});

test("F34 marginal daily marking uses the same original account denominator, fees and gate",()=>{
 const start=Date.parse("2025-01-01T00:00:00Z"),asOf=start+61*86400000,observations=Array.from({length:60},(_,i)=>({date:new Date(start+i*86400000).toISOString().slice(0,10),availableAt:start+(i+1)*86400000,source:"p",dataVersion:"v1",evidenceKind:"historical",returnBasis:"total-return",returns:{"600000":.01,"600001":.02}}));
 const snapshot={evidenceRef:"book",equity:1000,cash:600,availableCash:500,positions:[{symbol:"600000",marketValue:400}]},plan={symbol:"600001",price:10,quantity:30,fee:1,evidenceRef:"plan"};
 const gate={status:"allowed",evidenceRef:"gate"},x=api.previewPosition({snapshot,plan,gate,observations,asOf});
 equal(x.marginalMarkedReturn.baselineMean,.004);equal(x.marginalMarkedReturn.candidateMeanAfterEntryFee,.009);equal(x.marginalMarkedReturn.difference,.005);equal(x.marginalMarkedReturn.exitCost,null);
 equal(api.previewPosition({snapshot,plan,gate:{...gate,status:"blocked"},observations,asOf}).marginalMarkedReturn,null);
 equal(api.previewPosition({snapshot,plan,gate,observations:observations.slice(0,59),asOf}).marginalMarkedReturn,null);
});
test("F30 stock grouping compares prior and recent windows without inventing causal links",()=>{
 const start=Date.parse("2025-01-01T00:00:00Z"),asOf=start+61*86400000,observations=Array.from({length:60},(_,i)=>{const x=i%2?.01:-.01;return {date:new Date(start+i*86400000).toISOString().slice(0,10),availableAt:start+(i+1)*86400000,source:"p",dataVersion:"v1",evidenceKind:"historical",returnBasis:"total-return",returns:{"600000":x,"600001":i<30?-x:x,"600002":-x}}});
 const assets=[{symbol:"600000",weight:.3,industry:"a"},{symbol:"600001",weight:.3,industry:"a"},{symbol:"600002",weight:.3,industry:"b"}];
 const r=api.tailRisk({assets,observations,asOf}).correlationClusters;
 equal(r.status,"descriptive-unverified");assert.deepEqual(r.recent,[["600000","600001"],["600002"]]);assert.deepEqual(r.previous,[["600000"],["600001","600002"]]);equal(r.pairAgreement,.33333333);equal(r.industryPairAgreement,1);equal(r.causalPropagationEstablished,false);
 const constant=observations.map(o=>({...o,returns:{...o.returns,"600002":0}}));equal(api.tailRisk({assets,observations:constant,asOf}).correlationClusters.status,"unknown");
});
