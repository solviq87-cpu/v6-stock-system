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
