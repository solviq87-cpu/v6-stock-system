'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candidateRationale}=require('../src/strategy/candidate-rationale');
const {annotateScanReport,scanUniverseWithRationale}=require('../src/strategy/scan-with-rationale');
const now=Date.parse('2026-11-06T15:10:00+08:00');
const stock={symbol:'600001',bars:[{date:'2026-11-05',close:10},{date:'2026-11-06',close:10.5}]};
function item(){return {symbol:'600001',name:'样本股票',score:75,tradable:true,
  blockedBySafety:false,quality:{usable:true,fresh:true,simulated:false,source:'eastmoney',timestamp:now},
  strategy:{pass:true,topDrivers:[{strategy:'趋势追踪',hits:['均线上行'],score:85}],
  extendedFactors:{signals:[{id:'sector_heat',label:'板块热度',score:81}]},
  playbookAnalysis:{playbooks:[{id:'platform_breakout',label:'平台突破',status:'candidate',reason:'放量突破'}]}},
  patterns:{matched:[{id:'red_three_soldiers',label:'红三兵',side:'bullish',status:'matched',detail:'3日上涨'}]},
  linkageResearch:{marketStatus:'observed-unverified',marketBreadth:64,marketSource:'market-feed',
    sectorStatus:'observed-unverified',sector:'人工智能',sectorStrength:72,sectorSource:'sector-feed',
    risks:[]},issuerEvidence:{status:'headline-research-only',strengthClues:[{title:'公司拟回购股份'}],riskClues:[],conflicts:[]}}}
test('explanation separates original hits, research hits and unverified factor scores',()=>{
 const result=candidateRationale(item(),{stock,asOf:now});
 assert.equal(result.selection.officialCandidate,true);
 assert.equal(result.selection.watchEligible,true);
 assert.equal(result.selection.ruleCount,3);
 assert.equal(result.selection.independentFamilyCount,3);
 assert.equal(result.selection.rules[0].type,'original-strategy');
 assert.equal(result.factors[0].status,'score-unverified');
 assert.equal(result.price.changePct,5);
 assert.equal(result.whyUp.observedRise,true);
 assert.equal(result.whyUp.confirmedCauses.length,0);
 assert.equal(result.whyUp.possibleContributors.length,4);
 assert.equal(result.market.status,'imported-unverified');
 assert.equal(result.sector.name,'人工智能');
});
test('missing market and sector evidence never become false positive context',()=>{
 const x=item();x.linkageResearch={marketStatus:'stale-or-invalid',marketBreadth:99,
   sectorStatus:'unknown',sectorStrength:99};
 const result=candidateRationale(x,{stock,asOf:now});
 assert.equal(result.market.status,'unknown');
 assert.equal(result.market.breadthScore,null);
 assert.equal(result.sector.relativeStrength,null);
 assert.ok(!result.whyUp.possibleContributors.some(s=>s.includes('市场')));
});
test('simulated stale and safety blocked items do not enter watchlist or claim official candidate',()=>{
 for(const change of [x=>x.quality.simulated=true,x=>x.quality.fresh=false,x=>x.blockedBySafety=true]){
  const x=item();change(x);const result=candidateRationale(x,{stock,asOf:now});
  assert.equal(result.selection.watchEligible,false);
  assert.equal(result.selection.officialCandidate,false);
  assert.equal(result.selection.originalScannerPassed,true);
  assert.ok(result.risks.length);
 }
});
test('upward explanation is unknown without valid recent observations',()=>{
 const x=item();x.quality.usable=false;
 const result=candidateRationale(x,{stock,asOf:now});
 assert.equal(result.price,null);
 assert.equal(result.whyUp.observedRise,false);
 assert.equal(result.whyUp.confirmedCauses.length,0);
});
test('risk headlines and bearish shapes remain visible even with bullish matches',()=>{
 const x=item();x.issuerEvidence.riskClues=[{title:'业绩预亏公告'}];
 x.patterns.matched.push({id:'three_black_crows',label:'三只乌鸦',status:'matched',side:'bearish'});
 const result=candidateRationale(x,{stock,asOf:now});
 assert.ok(result.risks.some(r=>r.includes('业绩预亏')));
 assert.ok(result.risks.some(r=>r.includes('三只乌鸦')));
 assert.equal(result.selection.ruleCount,3);
});
test('annotated research watchlist ranks independent rule hits without reordering original report',()=>{
 const one=item(),two={...item(),symbol:'600002',name:'其他样本',score:99,tradable:false,
   strategy:{pass:false,topDrivers:[],playbookAnalysis:{playbooks:[]},extendedFactors:{signals:[]}},
   patterns:{matched:[{id:'rps120_breakout',label:'RPS强势',side:'bullish',status:'matched'}]}};
 const report={asOf:now,items:[two,one],eligible:1};
 const out=annotateScanReport(report,{stocks:[stock],now});
 assert.deepEqual(out.items.map(x=>x.symbol),['600002','600001']);
 assert.deepEqual(out.researchWatchlist.map(x=>x.symbol),['600001','600002']);
 assert.equal(out.eligible,1);
 assert.equal(out.researchWatchlist[1].officialCandidate,false);
 assert.equal(report.items[0].rationale,undefined);
});
test('duplicate stock sources cannot supply arbitrary price attribution',()=>{
 const out=annotateScanReport({asOf:now,items:[item()]},{stocks:[stock,{...stock,bars:[{close:5},{close:10}]}],now});
 assert.equal(out.items[0].rationale.price,null);
});
test('a fresh quote with an old or undated K-line cannot explain current rise',()=>{
 const dated=candidateRationale(item(),{stock:{...stock,bars:[{date:'2026-11-04',close:10},{date:'2026-11-05',close:11}]},asOf:now});
 assert.equal(dated.price.status,'bar-date-unverified');
 assert.equal(dated.whyUp.observedRise,false);
 const undated=candidateRationale(item(),{stock:{...stock,bars:[{close:10},{close:11}]},asOf:now});
 assert.equal(undated.whyUp.observedRise,false);
});
test('empty universe retains original scan shape and adds empty explained watchlist',()=>{
 const report=scanUniverseWithRationale({stocks:[],now});
 assert.equal(report.total,0);
 assert.deepEqual(report.researchWatchlist,[]);
 assert.equal(report.items.length,0);
});
