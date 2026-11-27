'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildAdversePathEvidence:paths,buildPlanOddsEvidence:odds}=require('../src/core/portfolio-adverse-path-evidence');
const now=Date.parse('2026-11-27T10:00:00+08:00'),day='2026-11-27',fp='a'.repeat(64),epoch='b'.repeat(64),eid='c'.repeat(64);
const position=(symbol,quantity=100,sellableQuantity=quantity,price=10)=>({symbol,quantity,sellableQuantity,price,marketValue:quantity*price,evidenceStatus:'available',
 quote:{quoteAt:now,receivedAt:now,tradeDate:day,quoteSource:'provider',quoteStatus:'recent-unverified',missingReason:null}});
function fixture(positions=[position('600000',100,0),position('600001',200,100)]){
 const marketValue=positions.reduce((n,p)=>n+p.marketValue,0),cash=10000,equity=cash+marketValue;
 const e={protocol:'fayo-account-equity-evidence-v1',schemaVersion:1,accountId:'pool',accountEpoch:epoch,fingerprint:eid,observedAt:now,day,status:'complete',
  source:{kind:'authoritative-paper-account',snapshotFingerprint:fp,accountRevision:7},canTrade:false,canNotify:false,accountMutated:false,manualHoldingsIncluded:false,
  cashMovements:{status:'reconciled'},cash,marketValue,equity,positions};
 const bound={accountId:e.accountId,accountEpoch:epoch,authoritySnapshotFingerprint:fp,accountRevision:7,generatedAt:now,readOnly:true,canTrade:false};
 const r={...bound,policyVersion:'original-v1',occupancy:{heldValue:marketValue,equity,pendingBuyValue:2000,totalExposure:marketValue+2000,reservedCash:2005,availableCash:7995,pendingOrderCount:1,pendingOrderIds:['pending']},
  rules:[{id:'maxGrossExposurePct',enabled:true,configurationStatus:'active',evidenceStatus:'available',used:(marketValue+2000)/equity*100,limit:30,exceeded:(marketValue+2000)/equity*100>30}]};
 const stress={...bound,current:true,asOf:now,equityEvidenceId:eid,researchOnly:true,accountMutated:false,assumptions:{version:'original-assumptions',source:'original registered scenario',gapPct:10,themeRetreatPct:15},
  classifications:positions.map(p=>({symbol:p.symbol,status:'available',themes:['AI','机器人'],sourceRefs:[{knownAt:now-1,day,source:'provider'}]}))};
 return {equity:e,rules:r,stress,now};
}
function planFixture(heldPosition=false,mark=10){
 const f=fixture(),id='plan-00000000-0000-4000-8000-000000000001',symbol=heldPosition?'600000':'600002';
 const plan={id,code:symbol,intendedDate:day,decisionAuthority:'fayo-decision-center',decisionId:fp,frozenAt:new Date(now-2000).toISOString(),entryMin:9,entryMax:11,stop:8,target:14};
 const kind=heldPosition?(mark<=8?'stop':mark>=14?'target':null):null;
 const item={id:'risk-action:pool:'+id,planId:id,code:symbol,entryEventId:heldPosition?'original-fill':null,status:kind?'condition-triggered':'observing',
  constraints:{remainingQuantity:heldPosition?100:0,price:{current:mark,stop:8,target:14,quoteAt:now-1000,source:'provider'}},
  condition:{status:kind?'triggered':'not-triggered',kind,price:mark,source:'provider',quoteAt:now-1000,observedAt:now}};
 // Align held valuation to the same original quote used by its action.
 if(heldPosition){const p=f.equity.positions[0];p.price=mark;p.marketValue=p.quantity*mark;p.quote.quoteAt=now-1000;
  f.equity.marketValue=f.equity.positions.reduce((n,p)=>n+p.marketValue,0);f.equity.equity=f.equity.cash+f.equity.marketValue;}
 const actions={accountId:'pool',accountEpoch:epoch,authoritySnapshotFingerprint:fp,accountRevision:7,generatedAt:now,readOnly:true,canTrade:false,authorityStatus:'verified',items:[item]};
 return {equity:f.equity,actions,plans:[plan],now};
}

const row=f=>odds(f).rows[0];
test('C31.1 frozen entry price headroom and signed stop/target geometry are descriptive, not a new entry',()=>{
 const r=row(planFixture()),p=r.priceReview;
 assert.equal(p.frozenEntryMin,9);assert.equal(p.frozenEntryMax,11);assert.equal(p.entryRangeStatus,'inside-frozen-entry');
 assert.equal(p.remainingRiseToFrozenEntryCapPct,10);assert.equal(p.distanceAboveFrozenEntryFloorPct,10);
 assert.equal(p.signedDistanceToStopPct,20);assert.equal(p.signedDistanceToTargetPct,40);
 assert.equal(p.grossRatioAtFrozenEntryMin,5);assert.equal(p.grossRatioAtFrozenEntryMax,1);
 assert.equal(p.actualCostAdjustedRatio,null);assert.equal(p.proposedNewStop,null);assert.equal(p.canTrade,false);assert.equal(p.canReenter,false);
});
test('C31.1 expired price stays expired; equality is a geometry boundary not original permission',()=>{
 for(const [mark,status] of [[8.5,'below-frozen-entry'],[11.01,'above-frozen-entry']]){
  const r=row(planFixture(false,mark));assert.equal(r.status,'entry-range-expired');assert.equal(r.grossRewardRiskRatio,null);
  assert.equal(r.priceReview.entryRangeStatus,status);assert.equal(r.priceReview.canReenter,false);
 }
 const cap=row(planFixture(false,11));assert.equal(cap.priceReview.remainingRiseToFrozenEntryCapPct,0);
 assert.equal(cap.status,'price-geometry-only');assert.equal(cap.canTrade,false);
});
test('C31.2 held protection distances distinguish stop, target and price geometry without an entry cap',()=>{
 for(const [mark,status] of [[8,'stop-reached'],[14,'target-reached'],[12,'price-geometry-only']]){
  const r=row(planFixture(true,mark)),p=r.priceReview;assert.equal(r.status,status);assert.equal(p.entryRangeStatus,'not-applicable-held');
  assert.equal(p.remainingRiseToFrozenEntryCapPct,null);assert.equal(p.grossRatioAtFrozenEntryMax,null);assert.equal(p.proposedNewTarget,null);
  if(mark===8)assert.equal(p.signedDistanceToStopPct,0);if(mark===14)assert.equal(p.signedDistanceToTargetPct,0);
 }
});
test('C31.2 mismatched held original mark price, value, time, source or receipt cannot certify original odds',()=>{
 for(const edit of [p=>p.price=11,p=>p.marketValue++,p=>p.quote.quoteAt--,p=>p.quote.quoteSource='other',
  p=>p.quote.receivedAt=now+1,p=>p.quote.missingReason='conflict',p=>p.evidenceStatus='unknown']){
  const f=planFixture(true);edit(f.equity.positions[0]);const r=row(f);
  assert.equal(r.status,'unknown');assert.equal(r.priceReview,null);assert.equal(r.grossRewardRiskRatio,null);assert.equal(r.stagedDefense,null);
 }
});
test('C31.3 same holding cost and mark show profit giveback across original no-exit steps, not peak drawdown',()=>{
 const f=fixture(),p=f.equity.positions[0];p.costBasis=800;p.unrealizedPnl=200;
 const q=f.equity.positions[1];q.costBasis=2000;q.unrealizedPnl=0;
 const before=JSON.stringify(f),r=paths(f).heldProtection,a=r.rows[0];
 assert.equal(r.status,'observed-research');assert.equal(a.currentUnrealizedPnl,200);assert.equal(a.priceDeclineToErasePositivePnlPct,20);
 assert.equal(a.lossPerOnePct,10);assert.equal(a.currentSellableQuantity,0);assert.equal(a.currentlyRestrictedQuantity,100);
 assert.deepEqual(a.scenarios.map(x=>x.markLoss),[100,190,271]);assert.deepEqual(a.scenarios.map(x=>x.unrealizedPnlAfter),[100,10,-71]);
 assert.deepEqual(a.scenarios.map(x=>x.positivePnlErased),[false,false,true]);assert.equal(a.peakToCurrentDrawdownPct,null);
 assert.equal(a.profitReducesRisk,false);assert.equal(a.scenarios[2].realizedLoss,null);assert.equal(JSON.stringify(f),before);
});
test('C31.3 missing or inconsistent basis does not invent profit or erase known mark exposure',()=>{
 for(const [cost,pnl] of [[null,200],[800,null],[800,201],[-1,1001]]){
  const f=fixture(),p=f.equity.positions[0];Object.assign(p,{costBasis:cost,unrealizedPnl:pnl});
  const r=paths(f).heldProtection,a=r.rows[0];assert.equal(r.status,'partial');assert.equal(a.originalRemainingCostBasis,null);
  assert.equal(a.currentUnrealizedPnl,null);assert.equal(a.scenarios[0].unrealizedPnlAfter,null);assert.equal(a.scenarios[0].markLoss,100);
 }
});
test('C31.3 negative floating P&L stays signed, no positive-profit erase threshold',()=>{
 const f=fixture(),p=f.equity.positions[0];p.costBasis=1200;p.unrealizedPnl=-200;
 const a=paths(f).heldProtection.rows[0];assert.equal(a.currentUnrealizedPnl,-200);
 assert.equal(a.priceDeclineToErasePositivePnlPct,null);assert.equal(a.scenarios[0].unrealizedPnlAfter,-300);
 assert.equal(a.scenarios[0].positivePnlErased,null);assert.equal(a.canTrade,false);
});
function stageFixture(){
 const f=planFixture(true),p=f.equity.positions[0],i=f.actions.items[0],c=i.constraints;
 Object.assign(p,{quantity:300,marketValue:3000,sellableQuantity:300,todayBlockedQuantity:0,frozenQuantity:0});
 f.equity.marketValue=f.equity.positions.reduce((n,x)=>n+x.marketValue,0);f.equity.equity=f.equity.cash+f.equity.marketValue;
 Object.assign(c,{remainingQuantity:300,sellableQuantity:300,todayLockedQuantity:0,frozenQuantity:0,
  session:{day,calendarOpen:true,continuous:true,source:'original-calendar-and-continuous-session',checkedAt:now},
  liquidity:{participationPct:1,usedVolume:0,capacityQuantity:400,source:'original-paper-application-service'}});
 Object.assign(c.price,{upperLimit:11,lowerLimit:9});
 i.execution={allowed:true,evidenceStatus:'available',checkedAt:now};i.orders=[];
 return f;
}
test('C31.4 only an original full-exit check can produce separate same-mark whole-lot alternatives',()=>{
 const f=stageFixture(),before=JSON.stringify(f),a=row(f).stagedDefense;
 assert.equal(a.status,'estimated-unverified');assert.equal(a.originalExitAllowed,true);
 assert.equal(a.originalSellableQuantity,300);assert.equal(a.originalCapacityQuantity,400);
 assert.deepEqual(a.scenarios.map(x=>x.hypotheticalRemovedQuantity),[0,100,300]);
 assert.deepEqual(a.scenarios.map(x=>x.residualMarketValue),[3000,2000,0]);assert.deepEqual(a.scenarios.map(x=>x.lossPerOnePct),[30,20,0]);
 assert.ok(a.scenarios.every(x=>x.actualProceeds===null&&x.actualExecutionCost===null));
 assert.equal(a.canExecuteExit,false);assert.equal(a.guaranteedFill,false);assert.equal(JSON.stringify(f),before);
});
test('C31.4 partial T+1 and frozen quantity do not invent partial execution permission',()=>{
 const f=stageFixture(),p=f.equity.positions[0],i=f.actions.items[0];
 Object.assign(p,{sellableQuantity:100,todayBlockedQuantity:100,frozenQuantity:100});
 Object.assign(i.constraints,{sellableQuantity:100,todayLockedQuantity:100,frozenQuantity:100});
 i.execution.allowed=false;
 const a=row(f).stagedDefense;assert.equal(a.status,'original-full-exit-blocked');assert.equal(a.originalExitAllowed,false);
 assert.equal(a.originalSellableQuantity,100);assert.equal(a.scenarios.length,1);assert.equal(a.scenarios[0].residualQuantity,300);
});
test('C31.4 inconsistent receipt, capacity, session or pending sell cannot simulate reduction',()=>{
 for(const edit of [i=>i.execution.checkedAt--,i=>i.execution.evidenceStatus='missing',
  i=>i.constraints.session.continuous=false,i=>i.constraints.session.checkedAt--,i=>i.constraints.liquidity.capacityQuantity=200,
  i=>i.constraints.liquidity.participationPct=2,i=>i.constraints.sellableQuantity=200,i=>i.constraints.price.lowerLimit=10,
  i=>i.orders=[{status:'pending'}]]){
  const f=stageFixture();edit(f.actions.items[0]);const a=row(f).stagedDefense;
  assert.equal(a.status,'unknown');assert.equal(a.originalExitAllowed,null);assert.equal(a.scenarios.length,1);assert.equal(a.scenarios[0].residualMarketValue,3000);
 }
});
test('C31.4 two frozen plans claiming the same holding cannot create independent staged defense budgets',()=>{
 const f=stageFixture(),p=JSON.parse(JSON.stringify(f.plans[0])),i=JSON.parse(JSON.stringify(f.actions.items[0]));
 p.id+='-other';i.planId=p.id;i.id='risk-action:pool:'+p.id;f.plans.push(p);f.actions.items.push(i);
 const r=odds(f);assert.equal(r.rows.length,2);assert.ok(r.rows.every(x=>x.stagedDefense.status==='unknown'&&x.stagedDefense.scenarios.length===1));
});
test('C31.5 bound account identity and existing current quote rules remain authoritative',()=>{
 const f=stageFixture();f.actions.accountEpoch='d'.repeat(64);assert.equal(odds(f).rows.length,0);
 const q=planFixture();q.actions.items[0].constraints.price.quoteAt=now-15001;assert.equal(row(q).priceReview,null);
 const a=fixture();a.stress.equityEvidenceId='d'.repeat(64);assert.equal(paths(a).heldProtection,null);
});
