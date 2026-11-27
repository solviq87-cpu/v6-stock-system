'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {previewPlanBatch,exitRisk,capacityScenarios}=require('../src/core/advanced-portfolio-evidence');
const {selectAdvancedRiskQuotes}=require('../src/core/advanced-account-risk');
const now=Date.parse('2026-11-25T10:00:00+08:00'),day='2026-11-25';
const snapshot={evidenceRef:'original-book',cash:10000,availableCash:7500,equity:20000,positions:[{symbol:'600000',marketValue:10000}]};
const policy={version:'original-policy',maxGrossExposurePct:90};
function plan(n,symbol='600001',quantity=300,fee=5,baseline=12000,limit=90){
 const price=10,gross=quantity*price;
 return {planId:'plan-'+n,symbol,quantity,price,estimatedFee:fee,gateEvidenceRef:'original-gate-'+n,accountEvidenceRef:'original-book',accountRevision:3,
  status:'estimated-unverified',previewBlocked:false,originalGateStatus:'allowed',
  planAllocationBudgetAfter:{policyScope:'original-plan-effective-position-cap',estimatedConstraintsSatisfied:true,originalEquityBasis:20000,afterFeeEquity:20000-fee,budgets:[{kind:'single',limitPct:50,exposureAfter:gross}]},
  riskBudgetAfter:{policyScope:'original-account-readonly-preview',policyVersion:'original-policy',estimatedConstraintsSatisfied:true,canTrade:false,writesAccount:false,evidenceRef:'original-budget-'+n,
   originalEquityBasis:20000,afterFeeEquity:20000-fee,budgets:[{kind:'gross',limitPct:limit,exposureAfter:baseline+gross}]}};
}
const run=(plans,extra={})=>previewPlanBatch({snapshot,plans,policy,accountRevision:3,...extra});
test('C13.1 independent candidate previews share original free cash only once',()=>{
 const p=[plan(1),plan(2,'600002')],before=JSON.stringify(p),r=run(p);
 assert.equal(r.totalAdditionalNotional,6000);assert.equal(r.totalEstimatedFees,10);assert.equal(r.availableCashAfter,1490);
 assert.equal(r.existingReservedCash,2500);assert.equal(r.grossBudget.originalPendingExposure,2000);
 assert.equal(r.grossBudget.exposureAfter,18000);assert.equal(r.grossBudget.originalBasisWithinLimit,true);
 assert.equal(r.grossBudget.afterFeeWithinLimit,false);assert.equal(r.jointlyApproved,false);assert.equal(r.canTrade,false);assert.equal(JSON.stringify(p),before);
});
test('C13.1 cash deficit and gross exposure become joint conditional conflicts, not separate approvals',()=>{
 const p=[plan(1,'600001',400),plan(2,'600002',400)],r=run(p);
 assert.equal(r.availableCashAfter,-510);assert.equal(r.grossBudget.exposureAfter,20000);
 assert.ok(r.reasonCodes.includes('SHARED_CASH_BUDGET_EXCEEDED'));assert.ok(r.reasonCodes.includes('SHARED_GROSS_LIMIT_EXCEEDED'));
 assert.equal(r.jointBudgetStatus,'conditional-budget-exceeded');
 assert.deepEqual(run(p.slice().reverse()),r);
});
test('C13.1 missing or mismatched original authority and cash not treated as zero',()=>{
 for(const extra of [{snapshot:{...snapshot,availableCash:null}},{snapshot:{...snapshot,equity:19999}},{accountRevision:4}]){
  const r=run([plan(1)],extra);assert.equal(r.status,'unknown');assert.equal(r.canTrade,false);
 }
});
test('C13.2 repeated symbol, plan id, or original receipt is not a joint batch',()=>{
 for(const p of [plan(2),{...plan(2,'600002'),planId:'plan-1'},{...plan(2,'600002'),gateEvidenceRef:'original-gate-1'}]){
  assert.equal(run([plan(1),p]).reason,'BATCH_DUPLICATE_PLAN_OR_SYMBOL');
 }
});
test('C13.2 original blocked or incomplete candidate remains unknown, not silently dropped from expected batch',()=>{
 for(const patch of [{previewBlocked:true},{originalGateStatus:'blocked'},{status:'unknown'},{estimatedFee:null},{accountEvidenceRef:'other'}])
  assert.equal(run([plan(1),{...plan(2,'600002'),...patch}]).reason,'BATCH_INDIVIDUAL_PREVIEW_UNAVAILABLE');
});
test('C13.3 common gross baseline conflict cannot manufacture available exposure',()=>{
 const r=run([plan(1),plan(2,'600002',300,5,11000)]);
 assert.equal(r.grossBudget,null);assert.ok(r.reasonCodes.includes('ORIGINAL_GROSS_BASELINE_CONFLICT'));assert.equal(r.jointBudgetStatus,'unknown');
});
test('C13.3 fee-adjusted individual cap remains relevant after every proposed fee',()=>{
 const p=plan(1);p.planAllocationBudgetAfter.budgets[0].limitPct=15.005;
 const r=run([p,plan(2,'600002',100,20)],{policy:null});
 assert.ok(r.reasonCodes.includes('SHARED_AFTER_FEE_PLAN_CAP_EXCEEDED'));
 assert.equal(r.grossBudget,null);assert.equal(r.jointlyApproved,false);
});
test('C13.3 sector and strategy shared attribution never guessed from individual receipts',()=>{
 const r=run([plan(1),plan(2,'600002',100)],{policy:{...policy,maxSectorPct:40,maxStrategyPct:50}});
 assert.ok(r.reasonCodes.includes('SHARED_SECTOR_BUDGET_RECHECK_REQUIRED'));
 assert.ok(r.reasonCodes.includes('SHARED_STRATEGY_BUDGET_RECHECK_REQUIRED'));assert.equal(r.jointlyApproved,false);
});
test('C13.3 individually clear plans can have a conditional joint view, never an execution permission',()=>{
 const p=[plan(1,'600001',100),plan(2,'600002',200)];
 const r=run(p);assert.equal(r.jointBudgetStatus,'conditional-cash-and-known-caps-within-limit');assert.equal(r.requiresSequentialRecheck,true);assert.equal(r.reservesCash,false);
});
const quote=(symbol='600000',price=10,extra={})=>({code:symbol,price,quoteAt:now-1000,receivedAt:now,quoteSource:'provider',canTrade:true,suspended:false,...extra});
const prior={date:'2026-11-24',source:'original',dataVersion:'v1',availableAt:Date.parse('2026-11-24T16:00:00+08:00'),evidenceKind:'historical',priceBasis:'unadjusted',volume:100000,volumeUnit:'shares',amount:100000,amountUnit:'CNY'};
const exit=(p=prior,q=quote(),quantity=300)=>exitRisk({position:{symbol:q.code,quantity,sellable:quantity},quote:q,now,limitDown:false,suspended:false,prior:p,maxParticipationPct:1,assumedExitBps:20});
test('C13.4 multi-session cost is unknown, one-session conditional friction stays known',()=>{
 const r=exit();assert.equal(r.conditionalSessions,3);assert.equal(r.estimatedExitCost,null);assert.equal(r.estimatedSellableExitCost,null);
 assert.equal(exit(prior,quote(),100).estimatedExitCost,2);
});
test('C13.4 explicit wrong currency unit never becomes CNY liquidity merely due to unadjusted prices',()=>{
 const p={...prior,amountUnit:'USD'};
 assert.equal(exit(p).historicalDailyShares,null);
 assert.equal(capacityScenarios({prior:p,asOf:now,price:10,lotSize:100,capitalLevels:[10000],targetWeight:1,maxParticipationPct:1,feeBps:3,impactBpsAtLimit:50}).reason,'PRIOR_LIQUIDITY_UNAVAILABLE');
});
const pick=(rows,wire,limit=.1)=>selectAdvancedRiskQuotes({codes:['600000'],stocks:rows,lastPx:new Map([['600000',{wireQuote:wire}]]),now,limitFor:()=>limit})['600000'];
const mark=(price=9,extra={})=>quote('600000',price,{name:'original',preClose:10,...extra});
test('C13.5 same original time conflicting eligible prices are not a current exit mark regardless of order',()=>{
 for(const rows of [[mark(9),mark(9.5)],[mark(9.5),mark(9)]]){
  const r=pick(rows);assert.equal(r.quote.sourceConflict,true);assert.equal(r.quote.canTrade,false);assert.equal(r.limitDown,null);
 }
});
test('C13.5 distinct original quote times do not by themselves create a conflict, old wire cannot override current stock',()=>{
 const r=pick([mark()],mark(8,{quoteAt:now-16000}));assert.equal(r.quote.price,9);assert.equal(r.limitDown,true);
 assert.equal(r.limitEvidenceStatus,'original-rule-derived-unverified');
});
test('C13.5 explicit dated boundary mismatch, null or special session cannot generate confirmed limit classification',()=>{
 for(const patch of [{lowerLimit:8},{lowerLimit:null},{noPriceLimit:true},{ipoNoLimit:true},{corporateAction:{referenceClose:8}}]){
  const r=pick([mark(9,patch)]);assert.equal(r.limitDown,null);assert.equal(r.lowerLimit,null);
 }
});
test('C13.5 original distinct limit rule values and matching explicit boundary are not universally ten percent',()=>{
 for(const [limit,boundary] of [[.05,9.5],[.1,9],[.2,8],[.3,7]]){
  const r=pick([mark(boundary,{lowerLimit:boundary})],null,limit);
  assert.equal(r.limitDown,true);assert.equal(r.lowerLimit,boundary);assert.equal(r.limitEvidenceStatus,'original-rule-and-quote-agree');
 }
});
