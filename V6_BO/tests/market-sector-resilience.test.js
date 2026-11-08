'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateMarketSectorResilience:evaluate}=require('../src/strategy/market-sector-resilience');
const {evaluateLinkage}=require('../src/strategy/market-sector-pattern-linkage');
const {candidateRationale}=require('../src/strategy/candidate-rationale');
const date='2026-11-06',asOf=Date.parse(date+'T15:00:00+08:00'),observedAt=asOf-300000;
const core=(changePct)=>({changePct,source:'A-share-market-fixture',tradeDate:date,observedAt});
function source(){
 const market={source:'A-share-market-fixture',tradeDate:date,observedAt,
  breadthScore:18,coverage:.96,indices:{
   shanghai:core(-3.5),shenzhen:core(-4),chinext:core(-4.5),a50:core(-1.4)}};
 const sector={source:'A-share-sector-fixture',tradeDate:date,observedAt,
  name:'算力设备',changePct:2.5,relativeStrengthScore:84};
 return {market,sector,tradeDate:date,asOf};
}
test('systemic selloff plus rising sector is observational countertrend, not a causality or trade signal',()=>{
 const input=source(),before=structuredClone(input);
 const r=evaluate(input);
 assert.equal(r.status,'market-sector-observed-unverified');
 assert.equal(r.marketRegime,'systemic-selloff-observed');
 assert.equal(r.sectorRegime,'countertrend-observed');
 assert.equal(r.upBreadthPct,18);
 assert.equal(r.relativeToCorePct,6.5);
 assert.equal(r.marketIndexChanges.a50,-1.4);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.equal(r.verifiedLive,false);assert.equal(r.adjustLearningWeights,false);
 assert.equal(r.support.length,1);assert.ok(r.risks.some(x=>x.includes('系统性')));
 assert.deepEqual(input,before);
});
test('sector declines less than average: resilience does not mean it rose',()=>{
 const input=source();input.sector.changePct=-1;
 const r=evaluate(input);
 assert.equal(r.sectorRegime,'relative-resilience-observed');
 assert.equal(r.sectorChangePct,-1);
 assert.equal(r.relativeToCorePct,3);
 assert.ok(r.support.some(x=>x.includes('仍可能亏损')));
});
test('weak sector is flagged and not promoted during selloff',()=>{
 const input=source();input.sector.changePct=-7;
 const r=evaluate(input);
 assert.equal(r.sectorRegime,'sector-underperforming-observed');
 assert.ok(r.risks.some(x=>x.includes('弱于')));
 assert.equal(r.support.length,0);
});
test('strong market is not mistaken for a crash and strong sector is not countertrend',()=>{
 const input=source();for(const idx of Object.values(input.market.indices))idx.changePct=1.5;
 input.market.breadthScore=72;
 const r=evaluate(input);
 assert.equal(r.marketRegime,'broad-advance-observed');
 assert.equal(r.sectorRegime,'sector-mixed-observed');
 assert.equal(r.risks.length,0);
});
test('missing one index is allowed but missing two fails; A50 alone cannot prove A-share selloff',()=>{
 const input=source();delete input.market.indices.chinext;
 assert.equal(evaluate(input).status,'market-sector-observed-unverified');
 delete input.market.indices.shenzhen;
 const r=evaluate(input);
 assert.equal(r.status,'unverified');
 assert.equal(r.reason,'core-index-evidence-insufficient');
});
test('future, mismatched, simulated, stale and invalid index inputs fail closed',()=>{
 const changes=[
  x=>x.market.indices.shenzhen.observedAt=asOf+1,
  x=>x.market.indices.shenzhen.tradeDate='2026-11-05',
  x=>x.market.indices.shenzhen.source='inconsistent-provider',
  x=>x.market.indices.shenzhen.changePct='-3',
  x=>x.market.indices.shenzhen.simulated=true,
  x=>x.market.indices.shenzhen.observedAt=asOf-3600000,
  x=>x.market.breadthScore=undefined,
  x=>x.market.coverage=.79
 ];
 for(const change of changes){
  const input=source();change(input);
  const r=evaluate(input);
  assert.equal(r.status,'unverified',r.reason);
  assert.equal(r.sectorRegime,'unknown');
  assert.equal(r.canTrade,false);
 }
});
test('market valid but sector future/stale remains unknown, not a false countertrend',()=>{
 for(const change of [
  x=>x.sector.observedAt=asOf+1,
  x=>x.sector.tradeDate='2026-11-05',
  x=>x.sector.simulated=true,
  x=>x.sector.changePct=NaN,
  x=>x.sector.observedAt=asOf-3600000
 ]){
  const input=source();change(input);
  const r=evaluate(input);
  assert.equal(r.status,'market-observed-sector-unverified');
  assert.equal(r.sectorRegime,'unknown');
  assert.equal(r.relativeToCorePct,null);
 }
});
test('linkage and stock rationale carry optional crash/countertrend evidence, preserving old rules',()=>{
 const input=source(),bars=[{date:'2026-11-05',close:10},{date,close:10.4}];
 const link=evaluateLinkage({
  symbol:'600001',quality:{usable:true},bars,asOf,patterns:{positiveCount:1,riskCount:0},
  linkage:{market:input.market,sectors:{'600001':input.sector}}
 });
 assert.equal(link.marketStatus,'observed-unverified');
 assert.equal(link.sectorStatus,'observed-unverified');
 assert.equal(link.resilienceResearch.sectorRegime,'countertrend-observed');
 assert.equal(link.scoreBonus,0);assert.equal(link.canTrade,false);
 const item={symbol:'600001',name:'研究样本',tradable:false,blockedBySafety:false,
  quality:{usable:true,fresh:true,simulated:false,source:'imported',timestamp:asOf},
  patterns:{matched:[{status:'matched',side:'bullish',id:'breakout',label:'突破',detail:'样本'}]},
  linkageResearch:link};
 const reason=candidateRationale(item,{stock:{bars},asOf});
 assert.equal(reason.marketSectorResilience.sectorRegime,'countertrend-observed');
 assert.ok(reason.whyUp.possibleContributors.some(x=>x.includes('逆势')));
 assert.ok(reason.risks.some(x=>x.includes('系统性')));
 assert.equal(reason.whyUp.confirmedCauses.length,0);
 assert.equal(reason.selection.officialCandidate,false);
});
test('optional fields not supplied leave existing explanation contract unchanged',()=>{
 const bars=[{date:'2026-11-05',close:10},{date,close:10.4}];
 const x=evaluateLinkage({symbol:'600001',quality:{usable:true},bars,
  patterns:{positiveCount:1,riskCount:0},asOf,
  linkage:{market:{source:'market',breadthScore:65,coverage:.92,tradeDate:date,observedAt},
   sectors:{'600001':{source:'sector',relativeStrengthScore:75,name:'测试板块',tradeDate:date,observedAt}}}});
 assert.equal(x.positiveContextCount,2);
 assert.equal(x.resilienceResearch,undefined);
});
