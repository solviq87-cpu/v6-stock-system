'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixtures}=require('./helpers/advanced-portfolio-fixture');
const {accountExitDiagnostics}=require('../src/core/advanced-account-risk');
test('C13 real original account projection preserves independent candidate but publishes batch and excludes duplicate plan from opportunity comparison',()=>{
 const f=fixtures(),before=JSON.stringify(f.book);
 const good=accountExitDiagnostics(f.book,f.input).portfolioEvidence;
 assert.equal(good.batchPreview.planCount,1);assert.equal(good.batchPreview.totalAdditionalNotional,9000);assert.equal(good.batchPreview.jointlyApproved,false);
 f.input.portfolioContext.plans.pool.push(structuredClone(f.plan));
 const bad=accountExitDiagnostics(f.book,f.input).portfolioEvidence;
 assert.equal(bad.previews.length,2);assert.ok(bad.previews.every(x=>x.previewBlocked===true));
 assert.equal(bad.opportunityComparisons.length,0);assert.equal(bad.batchPreview.status,'unknown');
 assert.equal(JSON.stringify(f.book),before);
});

test('C16.5 original runtime multi-session estimate cannot present a single-order impact as the complete future cost',()=>{
 const f=fixtures(),before=JSON.stringify(f.book);
 f.input.portfolioContext.scenarioPolicy={version:'fayo-portfolio-pressure-v1',maxParticipationPct:.01};
 const r=accountExitDiagnostics(f.book,f.input),p=r.positions.find(p=>p.symbol==='600000'),exit=r.portfolioEvidence.exits.find(x=>x.symbol===p.symbol);
 assert.ok(p.conditionalSessions>1);
 for(const row of [p,exit]){
  assert.equal(row.estimatedExitCost,null);assert.equal(row.estimatedSellableExitCost,null);
  assert.equal(row.estimatedMarketImpact,null);assert.equal(row.multiSessionExitCost,null);assert.equal(row.actualExitCost,null);
  assert.equal(row.exitCostBasis,'unavailable');assert.equal(row.estimatedFeeBasis,'current-mark-single-order-fee');
  assert.equal(row.costReason,'MULTI_SESSION_FEES_AND_PRICES_UNAVAILABLE');assert.equal(row.guaranteedFill,false);
 }
 assert.equal(JSON.stringify(f.book),before);assert.equal(r.canTrade,false);
});

test('F24.3 pending purchases occupy the same cash budget as new candidates and cannot be counted as free cash',()=>{
 const f=fixtures(),day=f.input.day;
 f.book.feePolicy={...f.book.feePolicy,feeBps:0,commissionScope:'order-day'};
 f.book.orders.pending={order:{orderId:'pending',symbol:'600002',side:'buy',quantity:100,tradeDate:day,limitPrice:10},
  state:{terminal:false,remainingQuantity:100},events:[{type:'not-a-fill',date:day,feeEvidence:{
   version:f.book.feePolicy.version,gross:1000,commission:5,tax:0,transfer:0,total:5}}]};
 const before=JSON.stringify(f.book),r=accountExitDiagnostics(f.book,f.input),p=r.portfolioEvidence;
 assert.equal(r.reservedCash,1005);assert.equal(r.availableCash,8995);
 assert.equal(p.cashBaseline.reservedCash,1005);assert.equal(p.cashBaseline.availableCash,8995);
 assert.equal(p.previews[0].previewBlocked,true);assert.equal(p.cashComparisons[0].status,'unknown');
 assert.equal(p.opportunityComparisons.length,0);assert.equal(r.canTrade,false);assert.equal(JSON.stringify(f.book),before);
});
