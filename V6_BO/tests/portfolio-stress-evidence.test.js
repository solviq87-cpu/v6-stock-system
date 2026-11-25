'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildAccountEquityEvidence}=require('../src/core/account-equity-evidence');
const {buildPortfolioStressEvidence:stress,DEFAULT_ASSUMPTIONS}=require('../src/core/portfolio-stress-evidence');
const {fixture,BASE,sealBook}=require('./helpers/account-equity-fixture');
function prepare(t) {
  const f=fixture(t);f.buy('600000',100,10);f.buy('600001',100,20);
  const equity=buildAccountEquityEvidence({book:f.service.read(),accountId:'pool',quotes:{600000:f.quote(),600001:f.quote('600001',20)},now:f.now});
  const classification=(symbol,themes,extra={})=>({symbol,themes,source:'dabanke',sourceRecordId:'record-'+symbol,version:'v1',day:'2026-11-23',knownAt:BASE-5000,...extra});
  return {f,equity,classification};
}

test('multi-theme overlap retains each membership but unique portfolio and scenario totals never double count',t=>{
  const {f,equity,classification}=prepare(t);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI','机器人','AI']),classification('600001',['AI','机器人'])]});
  assert.equal(result.groups.length,2);assert.equal(result.overlaps.length,1);assert.deepEqual(result.overlaps[0].sharedThemes,['AI','机器人']);
  assert.equal(result.totals.marketValue,3000);assert.equal(result.totals.uniquePositionCount,2);
  for (const s of result.scenarios.filter(s=>s.theme)) assert.equal(s.estimatedLoss,450);
  assert.equal(result.scenarios.find(s=>s.id==='opening-gap').estimatedLoss,300);
  assert.equal(result.overlaps[0].statisticalCorrelation,null);assert.equal(result.classificationCoverage.positionPct,100);
});

test('first-observed classification is usable only from knownAt, without inventing publication time',t=>{
  const {f,equity,classification}=prepare(t);
  let result=stress({equity,now:f.now,classifications:[classification('600000',['AI']),classification('600001',['AI'])]});
  assert.equal(result.classifications[0].publicationTimeUnknown,true);
  assert.equal(result.classifications[0].sourceRefs[0].publishedAt,null);
  assert.equal(result.classifications[0].sourceRefs[0].effectiveBasis,'first-observed');
  result=stress({equity,now:f.now,classifications:[classification('600000',['AI'],{knownAt:BASE+1}),classification('600001',['AI'],{day:'2026-11-22'})]});
  assert.equal(result.classificationCoverage.classified,0);assert.equal(result.scenarios.find(s=>s.id==='theme-retreat').estimatedLoss,null);
});

test('source conflict remains unknown rather than choosing whichever publisher arrived last',t=>{
  const {f,equity,classification}=prepare(t);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI']),classification('600000',['芯片'],{source:'other-provider',knownAt:BASE-1}),classification('600001',['AI'])]});
  assert.equal(result.classifications[0].status,'conflict');assert.equal(result.classificationCoverage.classified,1);
  assert.ok(result.missing.some(row=>row.code==='CLASSIFICATION_SOURCE_CONFLICT'));
});

test('latest same-provider classification respects historical knowledge time',t=>{
  const {f,equity,classification}=prepare(t);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['old']),classification('600000',['AI'],{version:'v2',knownAt:BASE-1}),
    classification('600000',['future'],{version:'v3',knownAt:BASE+60000}),classification('600001',['AI'])]});
  assert.deepEqual(result.classifications[0].themes,['AI']);assert.equal(result.overlaps.length,1);
});

test('malformed or expired classification effective periods remain unknown',t=>{
  const {f,equity,classification}=prepare(t);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI'],{effectiveTo:'not-a-time'}),
    classification('600001',['AI'],{effectiveTo:BASE-1})]});
  assert.equal(result.classificationCoverage.classified,0);
  assert.ok(result.missing.some(row=>row.code==='CLASSIFICATION_PROVENANCE_MISSING'));
  assert.ok(result.missing.some(row=>row.code==='CLASSIFICATION_NOT_EFFECTIVE_AT_OBSERVATION'));
});

test('today buys remain unavailable for immediate liquidation and liquidity costs do not invent their sale',t=>{
  const {f,equity,classification}=prepare(t);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI']),classification('600001',['AI'])]});
  const liquidity=result.scenarios.find(s=>s.id==='liquidity-deterioration');
  assert.equal(liquidity.potentiallySellableLoss,0);assert.equal(liquidity.temporarilyUnsellableLoss,150);
  assert.equal(liquidity.rows[0].additionalLiquidationCost,0);assert.equal(liquidity.executionGuaranteed,false);assert.equal(liquidity.maximumLossGuarantee,false);
});

test('stale current valuations and missing classification never display safe or complete pressure results',t=>{
  const {f,equity}=prepare(t);
  const result=stress({equity,now:f.now+16000,classifications:[]});
  assert.equal(result.current,false);assert.equal(result.status,'partial');assert.ok(result.scenarios.every(s=>s.estimatedLoss===null));
  assert.equal(result.classificationCoverage.positionPct,0);
});

test('a recent equity report never refreshes the original quote lifetime for current stress estimates',t=>{
  const {f,classification}=prepare(t);
  const equity=buildAccountEquityEvidence({book:f.service.read(),accountId:'pool',now:f.now,quotes:{
    600000:f.quote('600000',10,{quoteAt:f.now-15000}),600001:f.quote('600001',20,{quoteAt:f.now-15000})}});
  assert.equal(equity.status,'complete');
  const classifications=[classification('600000',['AI']),classification('600001',['AI'])];
  const edge=stress({equity,now:f.now,classifications});assert.equal(edge.current,true);
  const expired=stress({equity,now:f.now+1,classifications});
  assert.equal(expired.current,false);assert.equal(expired.status,'partial');
  assert.ok(expired.scenarios.every(row=>row.estimatedLoss===null));
  assert.equal(expired.scenarios.find(row=>row.id==='opening-gap').coveredLossEstimate,300);
  assert.equal(expired.asOf,equity.observedAt);assert.equal(expired.equityEvidenceId,equity.fingerprint);
});

test('partial price coverage preserves observed loss while total remains unknown',t=>{
  const {f,classification}=prepare(t);
  const equity=buildAccountEquityEvidence({book:f.service.read(),accountId:'pool',quotes:{600000:f.quote()},now:f.now});
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI']),classification('600001',['AI'])]});
  const gap=result.scenarios.find(s=>s.id==='opening-gap');assert.equal(gap.estimatedLoss,null);assert.equal(gap.coveredLossEstimate,100);
  assert.deepEqual(gap.missingSymbols,['600001']);assert.equal(result.classificationCoverage.marketValuePct,null);
});

test('conflicting original position quantities cannot become a numeric complete scenario despite a fresh quote',t=>{
  const {f,classification}=prepare(t),book=f.service.read();
  book.account.positions['600000'].lots[0].quantity=200;sealBook(book);
  const equity=buildAccountEquityEvidence({book,accountId:'pool',now:f.now,quotes:{600000:f.quote(),600001:f.quote('600001',20)}});
  assert.equal(equity.equity,null);assert.equal(equity.positions[0].marketValue,null);
  assert.equal(equity.positions[0].evidenceStatus,'unknown');assert.equal(equity.coverage.pricedPositions,1);
  const result=stress({equity,now:f.now,classifications:[classification('600000',['AI']),classification('600001',['AI'])]});
  const gap=result.scenarios.find(s=>s.id==='opening-gap');
  assert.equal(gap.estimatedLoss,null);assert.equal(gap.coveredLossEstimate,200);
  assert.ok(gap.missingSymbols.includes('600000'));
});

test('fixed research assumptions have version and source; changed thresholds cannot reuse the version',t=>{
  const {f,equity}=prepare(t);
  const result=stress({equity,now:f.now});assert.equal(result.assumptions.version,DEFAULT_ASSUMPTIONS.version);assert.ok(result.assumptions.source);
  assert.throws(()=>stress({equity,now:f.now,assumptions:{...DEFAULT_ASSUMPTIONS,gapPct:1}}),/版本/);
  assert.throws(()=>stress({equity,now:f.now,assumptions:{...DEFAULT_ASSUMPTIONS,version:'v2',source:''}}),/来源/);
});
