'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixtures}=require('./helpers/advanced-portfolio-fixture');
const {buildAdvancedPortfolioReport}=require('../src/core/advanced-portfolio-runtime');
const {accountExitDiagnostics}=require('../src/core/advanced-account-risk');
test('C14 original advanced report exposes bound defense without writes and retains all prior sections',()=>{
 const f=fixtures(),before=JSON.stringify({book:f.book,input:f.input}),r=accountExitDiagnostics(f.book,f.input).portfolioEvidence;
 assert.equal(r.defense.accountEvidenceRef,f.book.fingerprint);
 assert.equal(r.defense.accountRevision,f.book.revision);
 assert.equal(r.defense.liquidityStress.cases[2].residualHoldingExposure,10000);
 assert.ok(r.previews.length&&r.exits.length&&r.batchPreview);assert.equal(JSON.stringify({book:f.book,input:f.input}),before);
});
test('C14.3 old frozen plan with persisted entry cannot reuse allowed research receipt across account periods',()=>{
 const f=fixtures(),d=accountExitDiagnostics(f.book,f.input);
 f.book.archives=[{account:{events:[{side:'buy',symbol:f.plan.code,quantity:100,reason:'作战台计划['+f.plan.id+'] '+f.plan.code+' · 原账户风控'}]}}];
 const r=buildAdvancedPortfolioReport({book:f.book,diagnostic:d,account:f.input.account,day:f.input.day,now:f.input.now,
  quotes:f.input.quotes,portfolioContext:f.input.portfolioContext,portfolioContextStatus:f.input.portfolioContextStatus});
 assert.equal(r.previews[0].previewBlocked,true);assert.equal(r.previews[0].reason,'ORIGINAL_PLAN_ALREADY_HAS_PERSISTED_ENTRY');
 assert.equal(r.opportunityComparisons.length,0);assert.equal(r.batchPreview.status,'unknown');
});
