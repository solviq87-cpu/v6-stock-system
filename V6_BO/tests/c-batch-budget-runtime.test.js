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
