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
const held=f=>paths(f);
test('C8.1 overnight gap uses existing holding value and does not invent realized fills',()=>{
 const f=fixture(),before=JSON.stringify(f),x=held(f),a=x.paths[0];assert.equal(x.status,'estimated');assert.equal(a.heldMarkLoss,300);assert.equal(a.heldEquityAfter,12700);assert.equal(a.realizedLoss,null);assert.equal(a.exitProceedsAssumed,0);assert.equal(a.currentlyRestrictedLotLoss,200);assert.equal(a.otherHoldingLoss,100);assert.equal(JSON.stringify(f),before);assert.equal(x.canTrade,false);
});
test('C8.1 stale original marks, fresh wrapper and bad receipt cannot create current gap estimate',()=>{
 for(const patch of [{quoteAt:now-15001},{receivedAt:now+1},{tradeDate:'2026-11-26'},{missingReason:'conflict'},{quoteAt:now+1}]){
  const f=fixture();Object.assign(f.equity.positions[0].quote,patch);assert.equal(held(f).status,'unknown');assert.equal(held(f).paths.length,0);
 }
});
test('C8.1 partial equity, wrong authority and duplicate holding fail closed',()=>{
 for(const edit of [f=>{f.equity.status='partial'},f=>{f.equity.cashMovements.status='unknown'},f=>{f.stress.equityEvidenceId=fp},f=>{f.equity.positions.push(f.equity.positions[0])},f=>{f.equity.marketValue++}]){
  const f=fixture();edit(f);assert.equal(held(f).status,'unknown');
 }
});
test('C8.2 three successive equal hypothetical shocks compound, not add or claim actual limit rates',()=>{
 const x=held(fixture());assert.deepEqual(x.paths.map(p=>p.compoundDeclinePct),[10,19,27.1]);assert.deepEqual(x.paths.map(p=>p.heldMarkLoss),[300,570,813]);assert.equal(x.actualFutureLimitDownPath,null);assert.equal(x.assumptions.actualLimitDownRateKnown,false);assert.ok(x.paths.every(p=>p.exitProceedsAssumed===0&&p.guaranteedFill===false));
});
test('C8.2 unknown sellable amount keeps total no-exit shock but no fictitious locked split',()=>{
 const f=fixture();f.equity.positions[0].sellableQuantity=null;const x=held(f);assert.equal(x.status,'partial');assert.equal(x.paths[2].heldMarkLoss,813);assert.equal(x.paths[2].currentlyRestrictedLotLoss,null);assert.equal(x.paths[2].otherHoldingLoss,null);
});
test('C8.2 fully locked positive holding keeps its whole modeled loss under no-exit scenario',()=>{
 const f=fixture([position('600000',100,0)]),x=held(f);assert.equal(x.paths[2].heldMarkLoss,271);assert.equal(x.paths[2].currentlyRestrictedLotLoss,271);assert.equal(x.paths[2].otherHoldingLoss,0);
});
test('C8.3 simultaneous common-theme retreat counts each held security exactly once',()=>{
 const x=held(fixture()).simultaneousThemeRetreat;assert.equal(x.themeCount,2);assert.deepEqual(x.symbols,['600000','600001']);assert.equal(x.coveredHoldingValue,3000);assert.equal(x.loss,450);assert.equal(x.includesPendingOrders,false);assert.equal(x.statisticalCorrelation,null);
});
test('C8.3 conflicting, missing or future classification never certifies zero overlap',()=>{
 for(const edit of [f=>f.stress.classifications.pop(),f=>f.stress.classifications[0].status='conflict',f=>f.stress.classifications[0].themes=[],f=>f.stress.classifications[0].sourceRefs[0].knownAt=now+1]){
  const f=fixture();edit(f);const x=held(f);assert.equal(x.simultaneousThemeRetreat.status,'unknown');assert.equal(x.simultaneousThemeRetreat.loss,null);assert.equal(x.paths[0].heldMarkLoss,300);
 }
});
test('C8.3 true complete disjoint themes preserve observed no-overlap without safety permission',()=>{
 const f=fixture();f.stress.classifications[0].themes=['AI'];f.stress.classifications[1].themes=['医药'];const x=held(f);assert.equal(x.simultaneousThemeRetreat.status,'no-observed-overlap');assert.equal(x.simultaneousThemeRetreat.loss,0);assert.equal(x.canTrade,false);
});
test('C8.4 pending remainder and original estimated fees enter only the explicit all-fill scenario',()=>{
 const x=held(fixture());assert.equal(x.pendingBudget.remainingBuyNotional,2000);assert.equal(x.pendingBudget.estimatedRemainingFees,5);
 assert.equal(x.paths[0].allPendingFillLoss,505);assert.equal(x.paths[0].allPendingFillEquityAfter,12495);assert.equal(x.paths[1].allPendingFillLoss,955);assert.equal(x.paths[2].allPendingFillLoss,1360);assert.equal(x.paths[0].heldMarkLoss,300);
 assert.equal(x.grossLimit.limitPct,30);assert.equal(x.paths[0].aboveOriginalGrossLimit,true);assert.equal(x.canTrade,false);
});
test('C8.4 wrong account/revision, duplicate ids or broken cash reservation cannot produce all-fill losses',()=>{
 for(const edit of [f=>f.rules.accountId='pre',f=>f.rules.accountRevision++,f=>f.rules.accountEpoch=fp,f=>f.rules.occupancy.availableCash=8000,f=>f.rules.occupancy.reservedCash=10001,f=>f.rules.occupancy.pendingOrderIds=['pending','pending'],f=>f.rules.occupancy.pendingBuyValue=null,f=>f.rules.occupancy.totalExposure=1]){
  const f=fixture();edit(f);const x=held(f);assert.equal(x.status,'partial');assert.equal(x.pendingBudget.status,'unknown');assert.equal(x.paths[0].allPendingFillLoss,null);assert.equal(x.paths[0].aboveOriginalGrossLimit,null);assert.equal(x.paths[0].heldMarkLoss,300);
 }
});
test('C8.4 zero pending is a verified zero only when original count and cash reconcile',()=>{
 const f=fixture();Object.assign(f.rules.occupancy,{pendingBuyValue:0,totalExposure:3000,reservedCash:0,availableCash:10000,pendingOrderCount:0,pendingOrderIds:[]});
 const x=held(f);assert.equal(x.pendingBudget.remainingBuyNotional,0);assert.equal(x.paths[0].allPendingFillLoss,x.paths[0].heldMarkLoss);assert.equal(x.grossLimit,null);
});
test('C8.4 original unconfigured or mismatched limit never creates a synthetic risk threshold',()=>{
 for(const edit of [f=>f.rules.rules=[],f=>f.rules.rules[0].enabled=false,f=>f.rules.rules[0].used=0,f=>f.rules.policyVersion=null]){
  const f=fixture();edit(f);const x=held(f);assert.equal(x.grossLimit,null);assert.equal(x.paths[0].aboveOriginalGrossLimit,null);assert.equal(x.paths[0].allPendingFillLoss,505);
 }
});
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
test('C8.5 frozen plan price geometry returns gross ratio but never a probability or expected value',()=>{
 const f=planFixture(),before=JSON.stringify(f),x=odds(f),r=x.rows[0];assert.equal(r.scope,'unfilled-candidate');assert.equal(r.status,'price-geometry-only');assert.equal(r.rewardPct,40);assert.equal(r.riskPct,20);assert.equal(r.grossRewardRiskRatio,2);assert.equal(r.winProbability,null);assert.equal(r.expectedValue,null);assert.equal(r.costAdjustedRatio,null);assert.equal(x.canTrade,false);assert.equal(JSON.stringify(f),before);
});
test('C8.5 candidate outside frozen entry range is expired, not a fresh favorable ratio',()=>{
 for(const mark of [8.5,11.01,14,7]){const x=odds(planFixture(false,mark));assert.equal(x.rows[0].status,'entry-range-expired');assert.equal(x.rows[0].grossRewardRiskRatio,null);}
});
test('C8.5 held stop/target trigger never becomes a negative or infinite odds value',()=>{
 for(const [mark,status] of [[8,'stop-reached'],[7,'stop-reached'],[14,'target-reached'],[15,'target-reached']]){
  const r=odds(planFixture(true,mark)).rows[0];assert.equal(r.scope,'held-position');assert.equal(r.status,status);assert.equal(r.grossRewardRiskRatio,null);
 }
});
test('C8.5 held price outside entry range retains only hold-specific hypothetical ratio',()=>{
 const r=odds(planFixture(true,12)).rows[0];assert.equal(r.scope,'held-position');assert.equal(r.status,'price-geometry-only');assert.equal(r.grossRewardRiskRatio,.5);
});
test('C8.5 stale, wrong source, old frozen quote and changed stop cannot certify odds',()=>{
 for(const edit of [f=>{f.actions.items[0].constraints.price.quoteAt=now-15001},f=>{f.actions.items[0].condition.source='other'},f=>{f.plans[0].frozenAt=new Date(now).toISOString()},f=>{f.actions.items[0].constraints.price.stop=9},f=>{f.actions.items[0].condition.observedAt=now-1}]){
  const f=planFixture();edit(f);assert.equal(odds(f).rows[0].status,'unknown');assert.equal(odds(f).rows[0].grossRewardRiskRatio,null);
 }
});
test('C8.5 duplicate plan or action and unbound account receipt fail closed',()=>{
 let f=planFixture();f.plans.push({...f.plans[0]});assert.equal(odds(f).rows[0].status,'unknown');
 f=planFixture();f.actions.items.push({...f.actions.items[0]});assert.equal(odds(f).rows[0].status,'unknown');
 f=planFixture();f.actions.authoritySnapshotFingerprint=epoch;assert.equal(odds(f).rows.length,0);
});
test('C8.5 completed and old unfilled plans cannot be recycled as current recommendations',()=>{
 let f=planFixture();f.actions.items[0].status='filled';assert.equal(odds(f).status,'no-applicable-plan');
 f=planFixture();f.plans[0].intendedDate='2026-11-26';assert.equal(odds(f).status,'no-applicable-plan');
});

test('C8.5 unfilled plan for a held symbol is not a fresh entry recommendation',()=>{
 const f=planFixture(),symbol='600000';f.plans[0].code=symbol;f.actions.items[0].code=symbol;
 const r=odds(f).rows[0];assert.equal(r.scope,'held-unlinked');assert.equal(r.status,'already-held-unlinked');assert.equal(r.grossRewardRiskRatio,null);assert.equal(r.canTrade,false);
});
test('C8.5 claimed held remainder must reconcile with actual same-account holding quantity',()=>{
 const f=planFixture(true);f.actions.items[0].constraints.remainingQuantity=101;assert.equal(odds(f).rows[0].status,'unknown');
 f.actions.items[0].constraints.remainingQuantity=100;f.equity.positions=[];assert.equal(odds(f).rows[0].status,'unknown');
});
