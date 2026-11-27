'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candidateRationale}=require('../src/strategy/candidate-rationale');
const {annotateScanReport}=require('../src/strategy/scan-with-rationale');
const now=Date.parse('2026-11-27T15:10:00+08:00');
function stock(symbol){return {symbol,bars:[{date:'2026-11-26',close:10},{date:'2026-11-27',close:10.5}]};}
function item(symbol,score=75){return {symbol,name:symbol,score,tradable:true,blockedBySafety:false,
 quality:{usable:true,fresh:true,simulated:false,source:'eastmoney',timestamp:now},
 strategy:{pass:true,riskFilter:{pass:true,reasons:[]},topDrivers:[{strategy:'趋势',score:80,hits:['均线']}],playbookAnalysis:{playbooks:[]}},
 patterns:{matched:[]},issuerEvidence:{riskClues:[],conflicts:[],strengthClues:[]},
 linkageResearch:{marketStatus:'observed-unverified',marketBreadth:60,marketSource:'market',sectorStatus:'observed-unverified',sectorStrength:75,sectorSource:'sector',sector:'设备',risks:[]}}}
const explain=(i,s=stock(i.symbol))=>candidateRationale(i,{stock:s,asOf:now});
const scan=(items,stocks)=>annotateScanReport({items,asOf:now,eligible:items.length},{stocks,now});
test('risk evidence precedes rule count and high scores in research ordering, not the original ranking',()=>{
 const a=item('600001',99),b=item('600002',65);
 a.issuerEvidence.riskClues=[{title:'重大风险'}];
 a.strategy.topDrivers.push({strategy:'另一个',score:90,hits:['同类信号']});
 const before=JSON.stringify([a,b]),out=scan([a,b],[stock(a.symbol),stock(b.symbol)]);
 assert.deepEqual(out.items.map(x=>x.symbol),[a.symbol,b.symbol]);
 assert.deepEqual(out.researchWatchlist.map(x=>x.symbol),[b.symbol,a.symbol]);
 assert.equal(out.researchWatchlist[1].reviewPriority.lane,'risk-review');
 assert.equal(out.researchWatchlist[0].reviewPriority.lane,'observed-watch');
 assert.equal(JSON.stringify([a,b]),before);
});
test('an actual risk-filter refusal blocks watch eligibility even if the scanner boolean says true',()=>{
 const a=item('600001',99);a.strategy.riskFilter={pass:false,reasons:['风险拦截']};
 const r=explain(a);assert.equal(r.selection.officialCandidate,false);assert.equal(r.selection.watchEligible,false);
 assert.equal(r.selection.originalScannerPassed,true);assert.equal(r.reviewPriority.lane,'blocked');
});
test('missing risk or quote context is not low risk and cannot outrank a complete observation',()=>{
 const a=item('600001',99),b=item('600002',50);delete a.strategy.riskFilter;
 const out=scan([a,b],[stock(a.symbol),stock(b.symbol)]);
 assert.equal(out.researchWatchlist[0].symbol,b.symbol);
 assert.equal(out.researchWatchlist[1].reviewPriority.lane,'evidence-review');
 assert.ok(out.researchWatchlist[1].reviewPriority.missing.includes('原风险过滤未确认通过'));
 assert.equal(out.researchWatchlist[1].reviewPriority.riskReward.ratio,null);
 assert.equal(out.researchWatchlist[1].reviewPriority.independentProbability,null);
});
test('duplicate report or duplicate source identity cannot be an official/watch candidate',()=>{
 const a=item('600001');
 for(const [items,stocks] of [[[a,a],[stock(a.symbol)]],[[a],[stock(a.symbol),stock(a.symbol)]]]){
  const out=scan(items,stocks);assert.equal(out.researchWatchlist.length,0);
  assert.ok(out.items.every(x=>x.rationale.selection.officialCandidate===false));
 }
});
test('future and malformed original observation clocks are not eligible even when fresh is asserted',()=>{
 for(const patch of [{timestamp:now+1},{timestamp:null},{timestamp:now+.5},{simulated:'false'},{usable:'true'}]){
  const a=item('600001');Object.assign(a.quality,patch);assert.equal(explain(a).selection.watchEligible,false);
 }
});
test('no import receives official live-candidate status; imported research remains visible',()=>{
 const a=item('600001');a.quality.source='imported';const r=explain(a);
 assert.equal(r.selection.officialCandidate,false);assert.equal(r.selection.watchEligible,true);
 assert.equal(r.reviewPriority.canTrade,false);assert.equal(r.reviewPriority.canNotify,false);
});
test('malformed prior dates or late bars cannot explain current rise',()=>{
 const a=item('600001');
 for(const patch of [{date:'2026-11-31'},{date:'2026-11-27'},{knownAt:now+1},{closed:false}]){
  const s=stock(a.symbol);Object.assign(s.bars[0],patch);assert.equal(explain(a,s).whyUp.observedRise,false);
 }
 const s=stock(a.symbol);s.bars[0].priceBasis='qfq';s.bars[1].priceBasis='unadjusted';
 assert.equal(explain(a,s).whyUp.observedRise,false);
});
test('invalid scores or drivers cannot generate supporting rule counts or numeric risk reward',()=>{
 const a=item('600001');a.score=Infinity;a.strategy.topDrivers=[{strategy:'无证据',score:99,hits:[]},{strategy:'坏分',score:101,hits:['伪证']}];
 a.linkageResearch.marketBreadth=101;a.linkageResearch.sectorStrength=-1;
 const r=explain(a);assert.equal(r.selection.ruleCount,0);assert.equal(r.market.breadthScore,null);assert.equal(r.sector.relativeStrength,null);
 assert.equal(r.reviewPriority.originalScore,null);assert.equal(r.reviewPriority.riskReward.ratio,null);
});
test('risk reasons from the original filter are carried into risk review without automatic trading',()=>{
 const a=item('600001',90);a.strategy.riskFilter.reasons=['成交额流动性不足'];
 const r=explain(a);assert.equal(r.reviewPriority.lane,'risk-review');
 assert.ok(r.reviewPriority.riskReasons.includes('成交额流动性不足'));assert.equal(r.reviewPriority.canTrade,false);
});
