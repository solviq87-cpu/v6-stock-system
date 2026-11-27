'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildPortfolioDefense:build}=require('../src/core/portfolio-defense-evidence');
const day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00'),fp='a'.repeat(64);
function fixture(){
 const symbols=['600000','600001'],book={paperOnly:true,brokerConnected:false,fingerprint:fp,revision:3,
  riskPolicy:{version:'original',maxPositionPct:40,maxDrawdownPausePct:10,maxDailyLossPausePct:5},
  account:{cash:4000,positions:{'600000':{quantity:400,lots:[{quantity:400,cost:6000}]},'600001':{quantity:600,lots:[{quantity:600,cost:6000}]}}},orders:{}};
 const diagnostic={account:'pool',revision:3,checkedAt:now,day,originalReadValidation:true,status:'observed-unverified',canTrade:false,writesAccount:false,
  cash:4000,equity:14000,availableCash:4000,reservedCash:0,positions:symbols.map((symbol,i)=>({symbol,quantity:i?600:400,matureUnreserved:i?0:400,quoteAt:now-1000,quoteSource:'provider',quoteStatus:'recent-unverified'}))};
 const quotes=Object.fromEntries(symbols.map(code=>[code,{quote:{code,price:10,quoteAt:now-1000,receivedAt:now,quoteSource:'provider',canTrade:true,suspended:false},suspended:false,limitDown:false}]));
 const snapshot={evidenceRef:fp,cash:4000,availableCash:4000,equity:14000,positions:symbols.map((symbol,i)=>({symbol,marketValue:i?6000:4000,theme:i?'B':'A',
  classificationSource:'original',classificationVersion:'v1',classificationKnownAt:now-1000}))};
 const exitFlags={status:'estimated-unverified',canTrade:false,writesAccount:false,guaranteedFill:false,quoteAt:now-1000};
 const exits=[{...exitFlags,symbol:symbols[0],sellable:400,exitEstimateQuantity:400,historicalDailyShares:400,conditionalSellableSessions:1},
 {...exitFlags,symbol:symbols[1],sellable:0,exitEstimateQuantity:null,historicalDailyShares:100,conditionalSellableSessions:null}];
 const previews=[{planId:'p1',symbol:symbols[0],status:'estimated-unverified',originalGateStatus:'allowed',previewBlocked:false,accountRevision:3,
  accountEvidenceRef:fp,gateEvidenceRef:'original-gate',quantity:200,price:10,estimatedFee:5,quoteAt:now-1000}];
 const observations=Array.from({length:120},(_,i)=>{const date=new Date(Date.parse('2026-05-01')+i*86400000).toISOString().slice(0,10);
  return {date,availableAt:Date.parse(date+'T16:00:00+08:00'),evidenceKind:'historical',returnBasis:'adjusted-price',source:'original-aligned',dataVersion:'v'+i,
   returns:{'600000':i<12?-.08:i%2?.02:-.01,'600001':i<12?-.06:i%2?-.01:.02}};});
 const tail={status:'estimated-unverified',returnBasis:'adjusted-price',sampleCount:120,start:observations[0].date,end:observations.at(-1).date};
 return {book,diagnostic,snapshot,account:'pool',day,now,quotes,exits,previews,observations,tail};
}
test('C14.1 actual concentration threshold is crossed by selective losses, not a universal decline prediction',()=>{
 const f=fixture(),r=build(f).reverseStress,x=r.heldOnly.find(x=>x.symbol==='600000'),y=r.heldOnly.find(x=>x.symbol==='600001');
 assert.equal(x.lossToTouch,4000);assert.equal(x.otherDeclineToTouchPct,66.66666667);
 assert.equal(y.alreadyAboveLimit,true);assert.equal(y.lossToTouch,0);assert.equal(r.lossPauseRemainingYuan,null);assert.equal(r.canTrade,false);
});
test('C14.1 freeze remainder and original reserved fee enter explicit all-fill scenario only',()=>{
 const f=fixture();f.book.orders.a={order:{orderId:'a',symbol:'600000',side:'buy',limitPrice:10,quantity:100},state:{orderId:'a',symbol:'600000',side:'buy',quantity:100,status:'pending',filledQuantity:0,terminal:false,remainingQuantity:100}};
 f.snapshot.availableCash=2995;f.diagnostic.availableCash=2995;f.diagnostic.reservedCash=1005;
 const r=build(f);assert.equal(r.pending.remainingNotional,1000);assert.equal(r.pending.estimatedReservedFees,5);
 assert.equal(r.reverseStress.heldOnly.find(x=>x.symbol==='600000').lossToTouch,4000);
 assert.equal(r.reverseStress.allPendingFill.find(x=>x.symbol==='600000').lossToTouch,1495);
});
test('C14.1 inconsistent reservation or unknown threshold never manufactures reverse limit',()=>{
 const f=fixture();f.book.orders.a={order:{orderId:'a',symbol:'600000',side:'buy',limitPrice:10,quantity:100},state:{orderId:'a',symbol:'600000',side:'buy',quantity:100,status:'pending',filledQuantity:0,terminal:false,remainingQuantity:100}};
 assert.equal(build(f).reverseStress.allPendingFill,null);
 f.book.riskPolicy=null;assert.equal(build(f).reverseStress.heldOnly,null);
});
test('C14.1 a 100 percent cap cannot be strictly exceeded through other holdings loss alone',()=>{
 const f=fixture();f.book.riskPolicy.maxPositionPct=100;
 assert.ok(build(f).reverseStress.heldOnly.every(x=>x.canExceedWithinScenario===false&&x.touchReachable===false));
});
test('C14.2 lowering average cost leaves larger current exposure and hypothetical new T+1 restriction',()=>{
 const f=fixture(),before=JSON.stringify(f),a=build(f).additions[0];
 assert.equal(a.beforeAverageCost,15);assert.equal(a.afterAverageCost,13.34166667);assert.equal(a.averageCostFalls,true);
 assert.equal(a.lossPerOnePctBefore,40);assert.equal(a.lossPerOnePctAfter,60);assert.equal(a.additionalLossPerOnePct,20);
 assert.equal(a.beforeUnrealizedPnl,-2000);assert.equal(a.afterUnrealizedPnlAtSameMark,-2005);assert.equal(a.conditionalNewLockedShares,200);
 assert.equal(a.canAdd,false);assert.equal(JSON.stringify(f),before);
});
test('C14.2 unknown lot basis preserves known incremental exposure without fabricated average',()=>{
 const f=fixture();f.book.account.positions['600000'].lots[0].cost=null;const a=build(f).additions[0];
 assert.equal(a.status,'exposure-only');assert.equal(a.afterAverageCost,null);assert.equal(a.additionalLossPerOnePct,20);
});
test('C14.2 changed account, stale mark, price mismatch or blocked preview never simulates current addition',()=>{
 for(const patch of [{accountRevision:2},{accountEvidenceRef:'b'.repeat(64)},{quoteAt:now-15001},{price:11},{previewBlocked:true}]){
  const f=fixture();Object.assign(f.previews[0],patch);assert.equal(build(f).additions[0].status,'unknown');
 }
});
test('C14.3 changed account revision, omitted holding, invalid observation and mismatched cash suppress all account projections',()=>{
 for(const edit of [f=>f.book.revision++,f=>f.snapshot.positions.pop(),f=>f.diagnostic.positions[0].quoteAt=now-15001,
  f=>f.diagnostic.positions[0].quoteStatus='stale',f=>f.snapshot.cash++,f=>f.diagnostic.account='pre']){
  const f=fixture();edit(f);const r=build(f);assert.equal(r.status,'unknown');assert.equal(r.reverseStress,null);
 }
});
test('C14.4 selling only historically liquid subset can leave all remaining exposure in one restricted stock',()=>{
 const r=build(fixture()).liquidityStress.cases;
 assert.equal(r[0].residualHoldingExposure,6000);assert.equal(r[0].largestResidualWeightPct,100);assert.equal(r[0].largestThemeResidualWeightPct,100);
 assert.equal(r[1].residualHoldingExposure,8000);assert.equal(r[1].largestResidualWeightPct,75);
 assert.equal(r[2].residualHoldingExposure,10000);assert.equal(r[2].actualProceeds,null);
 assert.equal(r[0].rows[1].hypotheticalRemovedShares,0);
});
test('C14.4 missing sellability or historical capacity never silently gives complete zero residual',()=>{
 const f=fixture();f.exits[0].historicalDailyShares=null;const r=build(f).liquidityStress.cases;
 assert.equal(r[0].residualHoldingExposure,null);assert.equal(r[0].knownResidualExposure,6000);assert.equal(r[0].largestResidualWeightPct,null);
 assert.equal(r[2].residualHoldingExposure,10000);
});
test('C14.4 explicitly unknown theme stays unknown even if stock-level residual is known',()=>{
 const f=fixture();f.snapshot.positions[1].classificationKnownAt=now+1;
 const r=build(f).liquidityStress.cases[0];assert.equal(r.largestResidualWeightPct,100);assert.equal(r.largestThemeResidualWeightPct,null);
});
test('C14.5 different declared themes can co-lose on every worst-decile day',()=>{
 const x=build(fixture()).jointLoss,p=x.pairs[0];assert.equal(x.alignedDays,120);assert.equal(x.tailDays,12);
 assert.equal(p.classificationComparison,'different-declared-themes');assert.equal(p.coLossDays,12);assert.equal(p.coLossFraction,.1);
 assert.equal(p.worstDecileCoLossFraction,1);assert.equal(x.styleExposure,null);assert.equal(x.independenceCertified,false);
});
test('C14.5 insufficient tail samples retain complete all-day description but no tail certainty',()=>{
 const f=fixture();f.observations=f.observations.slice(0,60);f.tail.sampleCount=60;f.tail.end=f.observations.at(-1).date;
 const r=build(f).jointLoss;assert.equal(r.status,'partial');assert.equal(r.tailDays,null);assert.equal(r.pairs[0].worstDecileCoLossFraction,null);
});
test('C14.5 missing, duplicate, future, wrong basis or misbound history does not certify diversification',()=>{
 for(const edit of [f=>delete f.observations[2].returns['600001'],f=>f.observations[2].date=f.observations[1].date,
  f=>f.observations[2].availableAt=now+1,f=>f.observations[2].returnBasis='unadjusted',f=>f.tail.start='2026-05-02']){
  const f=fixture();edit(f);const r=build(f).jointLoss;assert.equal(r.status,'unknown');assert.equal(r.pairs.length,0);
 }
});

test('C17.1 equal total equity cannot hide redistributed security values',()=>{
 const f=fixture();f.snapshot.positions[0].marketValue=5000;f.snapshot.positions[1].marketValue=5000;
 assert.equal(build(f).status,'unknown');
});
test('C17.1 original quote and cash identity are rechecked, not just wrapper time or aggregate',()=>{
 for(const edit of [f=>f.quotes['600000'].quote.code='600001',f=>f.quotes['600000'].quote.quoteSource='other',f=>f.quotes['600000'].quote.quoteAt--,
  f=>f.quotes['600000'].quote.sourceConflict=true,f=>f.quotes['600000'].quote.receivedAt=null,f=>f.diagnostic.cash++,f=>delete f.quotes['600000']]){
  const f=fixture();edit(f);assert.equal(build(f).status,'unknown');
 }
});
function activeBuy(f){
 f.book.orders.a={order:{orderId:'a',symbol:'600000',side:'buy',limitPrice:10,quantity:100},state:{orderId:'a',symbol:'600000',side:'buy',quantity:100,status:'pending',filledQuantity:0,terminal:false,remainingQuantity:100}};
 f.snapshot.availableCash=2995;f.diagnostic.availableCash=2995;f.diagnostic.reservedCash=1005;
 return f.book.orders.a;
}
test('C17.2 pending remainder requires original order key, state identity, status and filled arithmetic',()=>{
 for(const edit of [x=>x.order.orderId='other',x=>x.state.symbol='600001',x=>x.state.side='sell',
  x=>x.state.terminal=true,x=>x.state.status='canceled',x=>x.state.filledQuantity=10,x=>x.order.quantity=200]){
  const f=fixture(),x=activeBuy(f);edit(x);const r=build(f);assert.equal(r.pending,null);assert.equal(r.reverseStress.allPendingFill,null);
  assert.ok(r.reverseStress.heldOnly.length);
 }
});
test('C17.2 a partial order contributes only remaining shares; canceled remainder is not a new exposure',()=>{
 const f=fixture(),x=activeBuy(f);x.order.quantity=200;x.state.quantity=200;x.state.filledQuantity=100;x.state.status='partial';
 assert.equal(build(f).pending.remainingNotional,1000);
 x.state.status='canceled';x.state.terminal=true;f.snapshot.availableCash=4000;f.diagnostic.availableCash=4000;f.diagnostic.reservedCash=0;
 assert.equal(build(f).pending.remainingNotional,0);
});
test('C17.3 a profitable lot still has the same marked exposure and one-percent loss',()=>{
 const f=fixture();f.book.account.positions['600000'].lots[0].cost=2000;
 const r=build(f).heldProfitRisk[0];assert.equal(r.unrealizedPnl,2000);assert.equal(r.marketValue,4000);
 assert.equal(r.lossPerOnePct,40);assert.equal(r.priceDeclineToErasePositiveUnrealizedPnlPct,50);
 assert.equal(r.profitReducesRisk,false);assert.equal(r.actualExitProceeds,null);
 f.book.account.positions['600000'].lots[0].cost=6000;
 const loss=build(f).heldProfitRisk[0];assert.equal(loss.unrealizedPnl,-2000);assert.equal(loss.lossPerOnePct,40);
 assert.equal(loss.priceDeclineToErasePositiveUnrealizedPnlPct,null);
});
test('C17.3 incomplete lot cost cannot manufacture profit or suppress exposure',()=>{
 const f=fixture();f.book.account.positions['600000'].lots[0].cost=null;
 const r=build(f).heldProfitRisk[0];assert.equal(r.status,'exposure-only');assert.equal(r.unrealizedPnl,null);assert.equal(r.lossPerOnePct,40);
 f.book.account.positions['600000'].lots=[{quantity:400,cost:2000},{quantity:0,cost:100}];
 assert.equal(build(f).heldProfitRisk[0].unrealizedPnl,null);
});
test('C17.4 stale or mismatched exit projection cannot reduce residual holding exposure',()=>{
 for(const patch of [{quoteAt:now-2000},{sellable:399},{conditionalSellableSessions:2},{historicalDailyShares:0},{guaranteedFill:true},{canTrade:true},{writesAccount:true}]){
  const f=fixture();Object.assign(f.exits[0],patch);const r=build(f).liquidityStress.cases;
  assert.equal(r[0].residualHoldingExposure,null);assert.equal(r[0].rows[0].hypotheticalRemovedShares,null);assert.equal(r[2].residualHoldingExposure,10000);
 }
});
test('C17.5 equal portfolio boundary losses all remain in the descriptive worst-decile cohort',()=>{
 const f=fixture();f.observations.forEach(o=>{o.returns={'600000':-.01,'600001':-.01};});
 const r=build(f).jointLoss;assert.equal(r.nominalTailDays,12);assert.equal(r.tailBoundaryScenarioCount,120);
 assert.equal(r.tailDays,120);assert.equal(r.pairs[0].worstDecileCoLossDays,120);assert.equal(r.pairs[0].worstDecileCoLossFraction,1);
 assert.equal(r.independenceCertified,false);
});
