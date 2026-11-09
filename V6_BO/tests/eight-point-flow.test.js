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

test('previous-day imported signal is recognized as successive observation, missing prior stock stays unknown',()=>{
 const h=history(),params=fakeOutputs(h,fakeProjection(h.asOf));
 const yesterday=new Date(Date.parse(h.asOf+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 params.previousWatchStates=[
  {symbol:'600001',name:'银行观察样本',stage:'observe',lastSeen:yesterday,
   streak:1,misses:0,matched:['quality:trend'],riskIds:[],confirmed:false,
   dataStatus:'observed-research-only',reason:'上次历史研究命中'},
  {symbol:'600002',name:'已缺失样本',stage:'focus',lastSeen:yesterday,
   streak:3,misses:0,matched:['quality:trend'],riskIds:[],confirmed:true,
   dataStatus:'observed-research-only',reason:'上次关注'}];
 const r=buildEightPointEvidence(params),rows=r.dimensions.stock.watchStates;
 assert.equal(rows.length,2);assert.equal(r.dimensions.stock.previousStateCount,2);
 assert.equal(rows.find(x=>x.symbol==='600001').stage,'focus');
 assert.equal(rows.find(x=>x.symbol==='600001').streak,2);
 const missing=rows.find(x=>x.symbol==='600002');
 assert.equal(missing.dataStatus,'unavailable');
 assert.equal(missing.stage,'focus');
 assert.equal(r.dimensions.stock.watch.length,1,'missing old stock cannot look newly verified');
 assert.equal(r.dimensions.stock.notPersistedAcrossDates,true,
  'pure report never claims it saved user private state');
});
test('same-day official issuer headline risks and timed market shock are linked without inferred cause',()=>{
 const h=history('imported',65),date=h.asOf,at=Date.parse(date+'T14:50:00+08:00');
 const row={source:'declared-index',observedAt:at};
 const shock={schemaVersion:1,source:'imported',provider:'declared-index',
  tradeDate:date,observedAt:at,coverage:.91,
  breadth:{...row,upPct:15},
  indices:{shanghai:{...row,changePct:-3.5},shenzhen:{...row,changePct:-4.0},
   chinext:{...row,changePct:-4.2}}};
 const announcements=[
  {code:'600001',title:'公司收到立案调查通知书',source:'巨潮资讯',
   publishedAt:date+'T14:30:00+08:00',
   url:'https://static.cninfo.com.cn/finalpage/'+date+'/123456.pdf'},
  {code:'600001',title:'未来时点公告不可使用',source:'巨潮资讯',
   publishedAt:date+'T16:30:00+08:00',
   url:'https://static.cninfo.com.cn/finalpage/'+date+'/123457.pdf'}
 ];
 const before=structuredClone({h,announcements,shock});
 const out=runCompleteWorkbench({history:h,market:context(date),
  announcements,marketShockContext:shock});
 const rationale=out.selectionEvidence.candidates[0].rationale;
 assert.equal(rationale.issuerEvidence.count,1);
 assert.equal(rationale.issuerEvidence.riskClues.length,1);
 assert.equal(rationale.issuerEvidence.events[0].verified,false);
 assert.equal(rationale.whyUp.confirmedCauses.length,0);
 assert.equal(out.eightPointFlow.dimensions.explanation.issuerHeadlinesUnverified,1);
 assert.equal(out.eightPointFlow.dimensions.explanation.stocks[0].issuerRiskCount,1);
 assert.equal(out.eightPointFlow.dimensions.learning.marketShock.deferLearningUpdate,true);
 assert.equal(out.eightPointFlow.dimensions.learning.marketShock.forceMajeureVerified,false);
 assert.equal(out.eightPointFlow.dimensions.learning.manualReviewPausedForShock,true);
 assert.equal(out.eightPointFlow.dimensions.learning.weightsChanged,false);
 assert.deepEqual({h,announcements,shock},before);
 const stale=runCompleteWorkbench({history:h,marketShockContext:{...shock,
  observedAt:at-7200000}});
 assert.equal(stale.eightPointFlow.dimensions.learning.marketShock.status,'unverified');
 assert.equal(stale.eightPointFlow.dimensions.learning.manualReviewPausedForShock,false);
});
test('private local CLI reports only holding risk counts and preserves journal across identical runs',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {run}=require('../scripts/eight-point-closure');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-eight-complete-'));
 try{
  const input=path.join(dir,'input.json'),holdings=path.join(dir,'holdings.json'),
   watch=path.join(dir,'watch-private.json');
  const h=history('imported',65);
  fs.writeFileSync(input,JSON.stringify({history:h}));
  fs.writeFileSync(holdings,JSON.stringify({schemaVersion:1,mode:'manual-holding-watch',
   positions:[{symbol:'600001',cost:10,shares:100,weightPct:55}],
   quotes:[{symbol:'600001',price:9.0,quoteAt:Date.now()-1500,
    quoteSource:'declared-public-source'}]}),{mode:0o600});
  const first=run([input,'--watch-state',watch,'--holding-watch',holdings]);
  assert.equal(first.coverage.codeConnected,8);
  assert.equal(first.dimensions.stock.journal.status,'local-private-saved');
  assert.equal(first.dimensions.stock.journal.revision,1);
  assert.equal(first.dimensions.stock.notPersistedAcrossDates,false);
  const risks=first.dimensions.risk.manualHoldingWatch;
  assert.equal(risks.status,'local-private-evaluated');
  assert.equal(risks.positionsCount,1);
  assert.equal(risks.recentQuoteCount,1);
  assert.equal(risks.warningsCount,2);
  assert.equal(risks.canNotify,false);
  assert.equal(risks.notificationDelivered,false);
  assert.ok(!JSON.stringify(risks).includes('600001'));
  assert.ok(!JSON.stringify(risks).includes('55'));
  const again=run([input,'--watch-state',watch,'--holding-watch',holdings]);
  assert.equal(again.dimensions.stock.journal.status,'same-day-reused');
  assert.equal(again.dimensions.stock.journal.revision,1);
  assert.equal(again.dimensions.stock.journal.digest,first.dimensions.stock.journal.digest);
  assert.equal(JSON.parse(fs.readFileSync(watch,'utf8')).canTrade,false);
  const tomorrow=history('imported',66);
  fs.writeFileSync(input,JSON.stringify({history:tomorrow}));
  const next=run([input,'--watch-state',watch]);
  assert.equal(next.dimensions.stock.journal.revision,2);
  assert.equal(next.dimensions.stock.previousStateCount,
   first.dimensions.stock.watchStates.length);
  assert.equal(next.verifiedLive,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
