'use strict';
// C closeout. Explicit synthetic sealed account; original evidence modules,
// not a real brokerage account or a replay of the authority's order reducer.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {buildAccountEquityEvidence}=require('../src/core/account-equity-evidence');
const {buildEffectiveRiskEvidence}=require('../src/core/effective-risk-evidence');
const {buildRiskActionEvidence}=require('../src/core/risk-action-evidence');
const {buildPortfolioStressEvidence}=require('../src/core/portfolio-stress-evidence');
const {buildAdversePathEvidence,buildPlanOddsEvidence}=require('../src/core/portfolio-adverse-path-evidence');
const {buildRiskWorkbench}=require('../src/core/risk-workbench');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const ui=import('../public/nova/risk-workbench-read-scope.mjs');
const day='2026-11-27',priorDay='2026-11-26',now=Date.parse(day+'T10:00:00+08:00');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
function seal(book){
 delete book.account.fingerprint;book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});
 delete book.fingerprint;book.fingerprint=hash(book);return book;
}
function entry(eventId,orderId,symbol,quantity,date){
 return {eventId,orderId,symbol,side:'buy',quantity,price:10,gross:quantity*10,fee:5,tradeDate:date,timestamp:Date.parse(date+'T09:45:00+08:00'),realizedPnl:0};
}
function fixture(){
 const entries=[entry('entry-old','old-buy','600000',200,priorDay),entry('entry-today','partial-buy','600000',100,day),
  entry('entry-second','second-buy','600001',200,priorDay)];
 const lot=e=>({quantity:e.quantity,buyDate:e.tradeDate,price:e.price,fee:e.fee,cost:e.gross+e.fee,sourceEventId:e.eventId});
 const order=(orderId,symbol,side,quantity,filledQuantity,remainingQuantity,status,tradeDate)=>({
  order:{orderId,symbol,side,quantity,limitPrice:10,tradeDate,strategyId:'original-test-strategy'},
  state:{status,terminal:['filled','canceled','rejected'].includes(status),filledQuantity,remainingQuantity},events:[]});
 const book=seal({schemaVersion:1,revision:7,initialCash:20000,paperOnly:true,brokerConnected:false,archives:[],
  legacy:{enabled:true},feePolicy:{version:'synthetic-original-fee-policy',feeBps:3,minFee:5,sellTaxBps:5},
  riskPolicy:{version:'synthetic-original-risk-policy',maxGrossExposurePct:30},
  account:{cash:14985,events:entries,positions:{'600000':{quantity:300,lots:[lot(entries[0]),lot(entries[1])]},
   '600001':{quantity:200,lots:[lot(entries[2])]}}},
  orders:{'old-buy':order('old-buy','600000','buy',200,200,0,'filled',priorDay),
   'second-buy':order('second-buy','600001','buy',200,200,0,'filled',priorDay),
   'partial-buy':order('partial-buy','600000','buy',300,100,200,'partial',day),
   'frozen-sell':order('frozen-sell','600000','sell',100,0,100,'pending',day)}});
 const quote=code=>{
  const raw={code,price:10,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',
   quoteAt:now-1000,receivedAt:now-500,canTrade:true,suspended:false,tradable:true};
  return {symbol:code,price:10,provider:'tencent',quoteSource:'tencent',quoteAt:raw.quoteAt,receivedAt:raw.receivedAt,
   timestamp:raw.quoteAt,tradeDate:day,mode:'public-live-unverified',canTrade:true,suspended:false,tradable:true,
   volume:10000000,volumeUnit:'shares',upperLimit:11,lowerLimit:9,
   inputProvenance:createAutomaticInputProvenance({stock:raw,observation:raw,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 };
 const classifications=['600000','600001'].map(symbol=>({symbol,themes:['AI','计算'],source:'isolated-declared-classification',
  sourceRecordId:day+'/'+symbol,version:'fixture-v1',day,knownAt:now-2000}));
 return {book,quotes:{'600000':quote('600000'),'600001':quote('600001')},classifications,calendar:{isOpen:d=>d===day||d===priorDay}};
}
function run(f){
 const before=JSON.stringify(f.book),accountId='pool',equity=buildAccountEquityEvidence({book:f.book,accountId,quotes:f.quotes,now}),
  rules=buildEffectiveRiskEvidence({book:f.book,accountId,quotes:f.quotes,now,calendar:f.calendar}),
  actions=buildRiskActionEvidence({book:f.book,accountId,quotes:f.quotes,now,calendar:f.calendar,continuous:true,plans:f.plans||[],originalExitChecks:f.originalExitChecks||{}}),
  stress=buildPortfolioStressEvidence({equity,classifications:f.classifications,now});
 stress.adversePaths=buildAdversePathEvidence({equity,rules,stress,now});
 stress.planOdds=buildPlanOddsEvidence({equity,actions,plans:f.plans||[],now});
 const report=buildRiskWorkbench({accountId,now,equity,rules,actions,stress});
 assert.equal(JSON.stringify(f.book),before);assert.equal(report.canTrade,false);assert.equal(report.writesAccount,false);
 return {equity,rules,actions,stress,report,p:stress.adversePaths};
}
const holding=(r,symbol='600000')=>r.equity.positions.find(x=>x.symbol===symbol);
const action=(r,symbol='600000')=>r.actions.items.find(x=>x.code===symbol);
const gross=r=>r.rules.rules.find(x=>x.id==='maxGrossExposurePct');
test('C26 original account/equity/actions/stress projection shares partial-fill and freeze identity',async()=>{
 const f=fixture(),r=run(f),p=holding(r),a=action(r),{boundRiskResearch}=await ui;
 assert.equal(r.equity.equity,19985);assert.equal(r.equity.marketValue,5000);
 assert.equal(p.quantity,300);assert.equal(p.sellableQuantity,100);assert.equal(p.todayBlockedQuantity,100);assert.equal(p.frozenQuantity,100);
 assert.equal(a.constraints.remainingQuantity,300);assert.equal(a.constraints.sellableQuantity,p.sellableQuantity);
 assert.equal(a.constraints.todayLockedQuantity,p.todayBlockedQuantity);assert.equal(a.constraints.frozenQuantity,p.frozenQuantity);
 assert.equal(r.rules.occupancy.pendingBuyValue,2000);assert.equal(r.rules.occupancy.totalExposure,7000);
 assert.equal(r.p.pendingBudget.remainingBuyNotional,2000);assert.equal(r.p.pendingBudget.estimatedRemainingFees,5);
 assert.equal(r.p.paths[0].heldMarkLoss,500);assert.equal(r.p.paths[0].currentlyRestrictedLotLoss,200);
 assert.equal(r.p.paths[0].allPendingFillLoss,705);assert.equal(r.p.paths[0].realizedLoss,null);
 assert.equal(r.p.paths[0].guaranteedFill,false);assert.equal(r.p.status,'estimated');
 assert.equal(r.p.simultaneousThemeRetreat.loss,750);assert.equal(r.p.simultaneousThemeRetreat.coveredHoldingValue,5000);
 assert.equal(r.p.simultaneousThemeRetreat.themeCount,2);
 assert.equal(boundRiskResearch(r.report,'adversePaths'),r.p);
 assert.equal(boundRiskResearch(r.report,'planOdds').status,'no-applicable-plan');
 assert.equal(gross(r).exceeded,true);assert.equal(r.p.grossLimit.currentOriginalExceeded,true);
});
test('C26 confirmed terminal cancellation releases remaining order exposure but not held lots',()=>{
 const f=fixture(),before=run(f);
 Object.assign(f.book.orders['partial-buy'].state,{status:'canceled',terminal:true,remainingQuantity:0});
 Object.assign(f.book.orders['frozen-sell'].state,{status:'canceled',terminal:true,remainingQuantity:0});
 f.book.revision++;seal(f.book);
 const r=run(f);
 assert.equal(r.equity.equity,before.equity.equity);assert.equal(holding(r).quantity,300);
 assert.equal(holding(r).sellableQuantity,200);assert.equal(holding(r).todayBlockedQuantity,100);
 assert.equal(r.p.pendingBudget.remainingBuyNotional,0);assert.equal(r.p.paths[0].allPendingFillLoss,r.p.paths[0].heldMarkLoss);
 assert.equal(r.p.paths[0].currentlyRestrictedLotLoss,100);assert.equal(r.p.paths[0].heldMarkLoss,500);
 assert.equal(action(r).constraints.sellableQuantity,200);
});
test('C26 unknown or excessive original sell freeze retains mark risk but no trusted sellable split',()=>{
 for(const remainingQuantity of [null,201]){
  const f=fixture();f.book.orders['frozen-sell'].state.remainingQuantity=remainingQuantity;seal(f.book);
  const r=run(f);
  assert.equal(holding(r).sellableQuantity,null);assert.equal(action(r).constraints.sellableQuantity,null);
  assert.equal(r.p.status,'partial');assert.equal(r.p.paths[0].heldMarkLoss,500);
  assert.equal(r.p.paths[0].currentlyRestrictedLotLoss,null);assert.equal(r.p.paths[0].otherHoldingLoss,null);
  assert.equal(r.p.paths[0].realizedLoss,null);
 }
});
test('C26 stale or conflicting marks invalidate the current pressure values without inventing zeros',()=>{
 for(const patch of [{quoteAt:now-15001,timestamp:now-15001},{sourceConflict:true},{receivedAt:now+1}]){
  const f=fixture();Object.assign(f.quotes['600000'],patch);
  const r=run(f);assert.equal(r.equity.equity,null);assert.equal(r.rules.occupancy.equity,null);
  assert.equal(r.p.status,'unknown');assert.equal(r.p.paths.length,0);
  assert.equal(gross(r).exceeded,null);
 }
});
test('C26 missing or conflicting classification does not erase no-exit account pressure',()=>{
 const f=fixture();f.classifications.pop();
 const r=run(f);assert.equal(r.p.status,'partial');assert.equal(r.p.simultaneousThemeRetreat.loss,null);
 assert.equal(r.p.paths[0].heldMarkLoss,500);assert.equal(r.p.paths[0].allPendingFillLoss,705);
});
test('C26 contradictory original gross-rule exceeded flag is not certified by the C projection',()=>{
 const r=run(fixture()),rules=clone(r.rules);rules.rules.find(x=>x.id==='maxGrossExposurePct').exceeded=false;
 const x=buildAdversePathEvidence({equity:r.equity,rules,stress:r.stress,now});
 assert.equal(x.grossLimit,null);assert.equal(x.paths[0].aboveOriginalGrossLimit,null);
 assert.equal(x.paths[0].allPendingFillLoss,705);assert.equal(x.canTrade,false);
});
test('C26 exact original strict exposure limit is retained even when displayed usage is rounded',()=>{
 const f=fixture();f.book.riskPolicy.maxGrossExposurePct=7000/19985*100;seal(f.book);
 const r=run(f);assert.equal(gross(r).exceeded,false);assert.equal(r.p.grossLimit.currentOriginalExceeded,false);
 const rules=clone(r.rules);rules.rules.find(x=>x.id==='maxGrossExposurePct').exceeded=true;
 const x=buildAdversePathEvidence({equity:r.equity,rules,stress:r.stress,now});
 assert.equal(x.grossLimit,null);assert.equal(x.paths[0].aboveOriginalGrossLimit,null);
});
test('C26 browser cannot reuse optional pressure evidence from another revision, account, or original valuation',async()=>{
 const {boundRiskResearch,createRiskViewReceipt,remainingRiskViewMs}=await ui,r=run(fixture());
 for(const patch of [{accountRevision:8},{accountId:'pre'},{equityEvidenceId:'c'.repeat(64)},{asOf:now-1},{canTrade:true}]){
  const bad=clone(r.report);Object.assign(bad.stress.adversePaths,patch);
  assert.equal(boundRiskResearch(bad,'adversePaths'),null);
  assert.equal(bad.canTrade,false);assert.ok(bad.risks.length);
 }
 const receipt=createRiskViewReceipt({report:r.report,accountId:'pool',startedAt:0,receivedAt:100});
 assert.ok(receipt);assert.equal(remainingRiskViewMs(receipt,14000),0);
});

test('C31 original account cost and locked-lot protection survive the original risk workbench read scope',async()=>{
 const f=fixture(),r=run(f),{boundRiskResearch}=await ui;
 const a=boundRiskResearch(r.report,'adversePaths').heldProtection.rows.find(x=>x.symbol==='600000');
 assert.equal(a.originalRemainingCostBasis,3010);assert.equal(a.currentUnrealizedPnl,-10);
 assert.equal(a.currentSellableQuantity,100);assert.equal(a.currentlyRestrictedQuantity,200);
 assert.equal(a.scenarios[0].markLoss,300);assert.equal(a.scenarios[0].unrealizedPnlAfter,-310);
 assert.equal(a.scenarios[0].realizedLoss,null);assert.equal(a.peakToCurrentDrawdownPct,null);
 assert.equal(a.canTrade,false);assert.equal(r.report.canTrade,false);
});
test('C31 original held action producer and exact same account mark support only hypothetical staged exposure',async()=>{
 const f=fixture(),code='600001',id='plan-00000000-0000-4000-8000-000000000031',at=Date.parse(priorDay+'T09:29:50+08:00');
 const card={authority:'fayo-decision-center',decisionId:'f'.repeat(64),code,day:priorDay,name:'隔离保护样本',
  calculatedAt:at-1000,strategyAt:at-2000,quoteBasis:{source:'tencent',quoteAt:at-1000},
  plan:{buyLow:9.5,buyHigh:10.2,stop:9,target:12,positionPct:20}};
 const plan=bindAuthoritativePlan({id,sampleSet:'real',frozenAt:new Date(at).toISOString(),...decisionPlanPayload(card)},card);
 f.plans=[plan];f.book.account.events.find(e=>e.eventId==='entry-second').reason='作战台计划['+id+'] 原账户风控';
 seal(f.book);
 f.originalExitChecks={[id]:{allowed:true,reason:'原隔离巡检回执',checkedAt:now,quoteAt:f.quotes[code].quoteAt}};
 const r=run(f),a=action(r,code),{boundRiskResearch}=await ui;
 assert.equal(a.execution.allowed,true);assert.equal(a.constraints.remainingQuantity,200);
 const o=boundRiskResearch(r.report,'planOdds').rows[0];assert.equal(o.scope,'held-position');
 assert.equal(o.status,'price-geometry-only');assert.equal(o.priceReview.signedDistanceToStopPct,10);
 assert.equal(o.stagedDefense.status,'estimated-unverified');
 assert.deepEqual(o.stagedDefense.scenarios.map(x=>x.hypotheticalRemovedQuantity),[0,100,200]);
 assert.deepEqual(o.stagedDefense.scenarios.map(x=>x.residualMarketValue),[2000,1000,0]);
 assert.equal(o.stagedDefense.canExecuteExit,false);
 f.originalExitChecks[id].allowed=false;
 const blocked=run(f),p=blocked.report.stress.planOdds.rows[0].stagedDefense;
 assert.equal(action(blocked,code).execution.allowed,false);assert.equal(p.status,'original-full-exit-blocked');
 assert.equal(p.scenarios.length,1);assert.equal(p.scenarios[0].residualMarketValue,2000);
});
