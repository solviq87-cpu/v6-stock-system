'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildEightPointEvidence,keys}=require('../src/core/eight-point-research-pipeline');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
function history(source='imported',count=76){
 const dates=[];
 for(let i=0;dates.length<count;i++){
  const d=new Date(Date.UTC(2026,0,5+i));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  dates.push(d.toISOString().slice(0,10));
 }
 const bars=dates.map((date,i)=>{
  const close=10+i*.065;
  return {date,open:close-.02,high:close+.16,low:close-.2,close,
   volume:1000000,amount:10000000};
 });
 return {source,provider:'declared-historical-source',datasetId:'declared-2026-001',
  asOf:dates.at(-1),priceAdjustment:{mode:'unadjusted',provider:'declared-historical-source'},
  stocks:[{symbol:'600001',name:'银行观察样本',market:'main',corporateActionsVerified:true,
   bars}]};
}
function context(d){
 const observedAt=Date.parse(d+'T14:50:00+08:00');
 const idx=changePct=>({source:'declared-index',tradeDate:d,observedAt,changePct});
 return {linkage:{market:{source:'declared-index',tradeDate:d,observedAt,coverage:.91,
  breadthScore:15,indices:{shanghai:idx(-3.5),shenzhen:idx(-4),chinext:idx(-4.2),
   a50:idx(-1.6)}},
  sectors:{'600001':{source:'declared-sector',tradeDate:d,observedAt,
   name:'银行',relativeStrengthScore:88,changePct:1.1}}}};
}
function fakeProjection(date,source='imported'){
 const price={status:source==='imported'?'imported-unverified':'simulation',date,
  changePct:1.2};
 const rules=[{id:'quality:trend',name:'研究趋势',family:'trend-quality',type:'research-candidate',
   status:'matched',evidence:['趋势线连续上升']}];
 return {status:'evaluated',asOf:date,openSourceCatalog:[{},{}],
  linkedResearchCatalog:[{},{},{}],qualityResearchCatalog:[{},{},{}],
  candidates:[{symbol:'600001',name:'银行观察样本',score:88,
   quality:{usable:true},
   rationale:{price,selection:{rules,ruleCount:1,watchEligible:source==='imported',
    explanation:'研究趋势满足'},
    market:{status:'imported-unverified',source:'declared-index',breadthScore:15},
    sector:{status:'imported-unverified',name:'银行',source:'declared-sector'},
    marketSectorResilience:{status:'market-sector-observed-unverified',tradeDate:date,
     marketRegime:'systemic-selloff-observed',marketSource:'declared-index',
     marketIndexChanges:{shanghai:-3.5,shenzhen:-4,chinext:-4.2,a50:-1.6},
     sectorName:'银行',sectorSource:'declared-sector',
     sectorChangePct:1.1,relativeToCorePct:5},
    weakMarketPreference:{researchDeprioritized:true},
    sectorCohortRps:{status:'unknown'},
    whyUp:{observedRise:true,possibleContributors:['同期板块逆势上涨'],confirmedCauses:[],
     conclusion:'上涨原因未独立证实'},
    risks:[]}}],researchWatchlist:source==='imported'?[{symbol:'600001'}]:[]};
}
function fakeOutputs(h,projection){
 return {history:h,selectionEvidence:projection,publicRuleForwardAudit:undefined,
  reconciliation:{paper:{balanced:true},backtest:{balanced:true}},
  strategies:{coverage:{fourteen:{},bazi:{},gpt:{},python:{}}},
  calendar:{valid:null}};
}
test('one unified run contains eight evidence-linked workstreams and no hidden production promotion',()=>{
 const h=history(),before=structuredClone(h);
 const out=buildEightPointEvidence(fakeOutputs(h,fakeProjection(h.asOf)));
 assert.equal(out.workstreams.length,8);
 assert.deepEqual(out.workstreams.map(x=>x.id),keys.map(x=>x[0]));
 assert.equal(out.coverage.codeConnected,8);
 assert.equal(out.coverage.externalAccepted,0);
 assert.ok(out.workstreams.every(x=>!x.externallyAccepted&&x.unresolved.length));
 assert.equal(out.verifiedLive,false);assert.equal(out.canNotify,false);
 assert.equal(out.canTrade,false);assert.equal(out.productionReleaseReady,false);
 assert.equal(out.accountModified,false);assert.equal(out.strategyParametersModified,false);
 assert.equal(out.dimensions.market.regime,'systemic-selloff-observed');
 assert.deepEqual(Object.keys(out.dimensions.market.indices).sort(),['a50','chinext','shanghai','shenzhen']);
 assert.equal(out.dimensions.sector.weakMarketDeprioritizedCount,1);
 assert.equal(out.dimensions.sector.stockSectorLinks,1);
 assert.equal(out.dimensions.stock.watch.length,1);
 assert.equal(out.dimensions.stock.watch[0].stage,'observe');
 assert.equal(out.dimensions.explanation.stocks[0].ruleCount,1);
 assert.deepEqual(out.dimensions.explanation.stocks[0].confirmedUpsideCauses,[]);
 assert.equal(out.dimensions.risk.paperLedgerBalanced,true);
 assert.equal(out.dimensions.risk.manualHoldingWatch.canNotify,false);
 assert.equal(out.dimensions.learning.autoPromotion,false);
 assert.equal(out.dimensions.publicRules.originalStrategyKeys.length,4);
 assert.equal(out.dimensions.publicRules.researchCatalogCount,8);
 assert.equal(out.dimensions.testing.ciVerifiedByThisReport,false);
 assert.deepEqual(h,before);
 assert.deepEqual(buildEightPointEvidence(fakeOutputs(h,fakeProjection(h.asOf))),out);
});
test('unverified/simulated or contradictory dates never promote a historical signal',()=>{
 for(const mode of ['fixture','simulated']){
  const h=history(mode);
  const report=buildEightPointEvidence(fakeOutputs(h,fakeProjection(h.asOf,mode)));
  assert.equal(report.dimensions.stock.watch.length,0);
  assert.equal(report.dimensions.market.status,'unavailable');
  assert.equal(report.dimensions.sector.status,'unavailable');
  assert.equal(report.verifiedLive,false);
 }
 const h=history();
 const p=fakeProjection(h.asOf);p.asOf='2025-01-01';
 const r=buildEightPointEvidence(fakeOutputs(h,p));
 assert.equal(r.asOf,null);
 assert.equal(r.dimensions.stock.watch.length,0);
 assert.equal(r.dimensions.market.status,'unavailable');
});
test('partial, blocked or optional audit failures cannot be misrepresented as validation',()=>{
 const h=history(),p=fakeProjection(h.asOf),params=fakeOutputs(h,p);
 p.candidates[0].rationale.risks.push('看跌形态冲突');
 const r=buildEightPointEvidence(params);
 assert.equal(r.dimensions.stock.watch[0].stage,'risk-review');
 assert.ok(r.dimensions.risk.flaggedStocks.includes('600001'));
 params.reconciliation.paper.balanced=false;
 const bad=buildEightPointEvidence(params);
 assert.equal(bad.dimensions.risk.status,'reconciliation-unavailable');
 assert.equal(bad.productionReleaseReady,false);
 params.publicRuleForwardAudit={status:'unavailable'};
 assert.equal(buildEightPointEvidence(params).dimensions.learning.status,'needs-opt-in-forward-audit');
});
test('full existing workbench composes eight evidence dimensions without mutating strategies or account',()=>{
 const h=history('fixture',65),before=structuredClone(h);
 const r=runCompleteWorkbench({history:h});
 assert.equal(r.eightPointFlow.mode,'v6-eight-point-integrated-historical-research');
 assert.equal(r.eightPointFlow.workstreams.length,8);
 assert.equal(r.eightPointFlow.verifiedLive,false);
 assert.equal(r.eightPointFlow.productionReleaseReady,false);
 assert.equal(r.eightPointFlow.dimensions.stock.watch.length,0);
 assert.equal(r.reconciliation.paper.balanced,true);
 assert.equal(r.reconciliation.backtest.balanced,true);
 assert.deepEqual(Object.keys(r.strategies.coverage),['fourteen','bazi','gpt','python']);
 assert.deepEqual(h,before);
});
test('full imported workbench links market, sector and individual research without a live feed',()=>{
 const h=history('imported',65);
 const r=runCompleteWorkbench({history:h,market:context(h.asOf)});
 const flow=r.eightPointFlow;
 assert.equal(flow.workstreams.length,8);
 assert.ok(['imported-observed-unverified','unavailable'].includes(flow.dimensions.market.status));
 assert.ok(r.selectionEvidence.candidates.length>0);
 assert.equal(flow.dimensions.publicRules.officialPromotion,false);
 assert.equal(flow.dimensions.learning.weightsChanged,false);
 assert.equal(flow.dimensions.testing.ciVerifiedByThisReport,false);
 assert.equal(r.canTrade,false);
});
