'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditQuoteSourceWindow:audit,auditQuoteSourceHistory:history}=require('../src/core/quote-source-window-quality');
const base=Date.parse('2026-11-23T10:00:00+08:00'),DAY=86400000;
function report(slot,states=['fresh-unverified','fresh-unverified'],patch={}){
 const time=slot+2000,sourceStatuses=['tencent','eastmoney'].map((provider,i)=>({provider,status:states[i],quoteAt:states[i]==='unavailable'?null:time-1000-i*100}));
 const both=states.every(s=>s==='fresh-unverified');
 return {schemaVersion:1,mode:'two-source-public-quote-diagnostic',code:'600001',asOf:new Date(time).toISOString(),
  source1:'tencent',source2:'eastmoney',canTrade:false,canNotify:false,certifiedLive:false,exchangeVerified:false,
  providerLicensed:false,calendarVerified:false,status:both?'sources-agree-unverified':'insufficient-fresh-sources',
  discrepancyBps:both?10:null,quoteAt:both?time-1100:null,quoteTimeGapMs:both?100:undefined,sourceStatuses,...patch};
}
const window=(d=0,states=null)=>{
 const t=base+d*DAY,expectedSlots=[t,t+60000,t+120000];
 return {windowId:'w'+d,evidence:{registeredAt:t-10000,asOf:t+180000,expectedSlots,
  observations:expectedSlots.map((slotAt,i)=>({slotAt,report:report(slotAt,states?.[i])}))}};
};
const review=()=>({schemaVersion:1,mode:'quote-source-history-review',asOf:base+2*DAY,code:'600001',
 policy:{registeredAt:base-20000,minExpectedSlots:3,healthyMinPct:90,watchMinPct:60},windows:[window(),window(1)]});
const cost=(windowId,provider,costMinor,currency='CNY',ref='a')=>({windowId,provider,costMinor,currency,
 basis:'actual-allocated-window-cost',knownAt:base+DAY+200000,evidenceRef:ref.repeat(64)});
test('D54 both unavailable, both dated, missing and partial reports remain separate evidence',()=>{
 const x=window().evidence;
 x.observations=[{slotAt:base,report:report(base,['unavailable','unavailable'])},
  {slotAt:base+60000,report:report(base+60000,['dated-snapshot','dated-snapshot'])}];
 const j=audit(x).jointCoverage;
 assert.equal(j.bothUnavailableSlots,1);assert.equal(j.bothDatedSlots,1);assert.equal(j.neitherFreshSlots,2);
 assert.equal(j.missingReportSlots,1);assert.equal(j.pairedObservedSlots,2);assert.equal(j.neitherFreshRatePct,100);
 assert.equal(j.commonCauseVerified,false);
 const m=audit(window(0,[['fresh-unverified','unavailable'],['unavailable','dated-snapshot'],['fresh-unverified','fresh-unverified']]).evidence).jointCoverage;
 assert.equal(m.oneFreshSlots,1);assert.equal(m.mixedNonFreshSlots,1);assert.equal(m.bothFreshSlots,1);
});
test('D54 outside-session report is not a two-provider failure',()=>{
 const t=Date.parse('2026-11-23T15:00:00+08:00'),x=window().evidence;
 x.expectedSlots=[t,t+60000,t+120000];x.asOf=t+180000;
 x.observations=x.expectedSlots.map(slotAt=>({slotAt,report:report(slotAt,undefined,{status:'outside-weekday-session-window',sourceStatuses:[],quoteAt:null,discrepancyBps:null,quoteTimeGapMs:null})}));
 const j=audit(x).jointCoverage;assert.equal(j.outsideSessionReportSlots,3);assert.equal(j.neitherFreshSlots,0);assert.equal(j.neitherFreshRatePct,null);
});
const unsafeMutations=[x=>x.canTrade=true,x=>x.observations[0].fixture=true,x=>x.observations[0].report.sourceStatuses[0].receivedAt=base-1,
 x=>x.observations[0].report.sourceStatuses[0].receivedAt=base+3000,x=>x.observations[0].report.sourceStatuses[0].vendorQuoteAt=base,
 x=>x.observations[0].report.sourceStatuses[0].quoteAgeMs=10,x=>x.observations[0].report.sourceStatuses[0].quoteMode='simulated'];
test('D74 nested unsafe evidence and malformed or future receipt cannot certify quality',()=>{
 for(const edit of unsafeMutations){const x=window().evidence;edit(x);assert.equal(audit(x).status,'blocked');}
 const x=window().evidence;x.observations[0].report.sourceStatuses[0].receivedAt=base+1500;
 x.observations[0].report.sourceStatuses[0].quoteAgeMs=1000;assert.equal(audit(x).status,'limited-alignment-unverified');
});
test('D55 chronological multi-window scorecard uses all expected slots and missing observations',()=>{
 const x=review();x.windows[1].evidence.observations.pop();
 const r=history(x),p=r.providerCoverage[0];
 assert.equal(r.status,'historical-quality-watch');assert.equal(r.expectedSlotCount,6);
 assert.equal(p.freshSlots,5);assert.equal(p.missingEvidenceSlots,1);assert.equal(p.freshCoveragePct,83.3);
 assert.equal(p.history[0].grade,'healthy-coverage-unverified');assert.equal(p.history[1].grade,'watch-coverage');
 assert.equal(p.history[1].cumulativeGrade,'watch-coverage');assert.equal(p.coverageGrade,'watch-coverage');
 assert.equal(r.canAutoSelectProvider,false);assert.equal(r.qualityProvesPriceAccuracy,false);
});
test('D55 entirely missing mature window remains in the denominator',()=>{
 const x=review();x.windows[1].evidence.observations=[];
 const r=history(x);assert.equal(r.expectedSlotCount,6);assert.equal(r.providerCoverage[1].freshCoveragePct,50);
 assert.equal(r.providerCoverage[1].coverageGrade,'low-coverage');assert.equal(r.jointCoverage.missingReportSlots,3);
});
test('D55 cannot duplicate, overlap, reorder or compare a different security or policy',()=>{
 for(const edit of [
  x=>x.windows[1].windowId=x.windows[0].windowId,
  x=>x.windows[1].evidence=JSON.parse(JSON.stringify(x.windows[0].evidence)),
  x=>x.windows.reverse(),x=>x.windows[1].evidence.observations.forEach(o=>o.report.code='600002'),
  x=>x.windows[1].evidence.maxPairSkewMs=1000,x=>x.policy.registeredAt=base,
  x=>x.windows[1].evidence.asOf=x.windows[1].evidence.expectedSlots.at(-1),
  x=>x.asOf=base,x=>x.windows[1].canAutoSelectProvider=true,x=>delete x.windows[1]
 ]){const x=review();edit(x);assert.equal(history(x).status,'blocked');}
});
test('D55 lunch and close-crossing planned slots cannot become supplier failures',()=>{
 const x=review(),t=Date.parse('2026-11-24T11:29:45+08:00');
 x.windows[1].evidence={registeredAt:t-10000,asOf:t+180000,expectedSlots:[t,t+60000,t+120000],observations:[]};
 assert.equal(history(x).status,'blocked');
});
test('D55 small samples retain insufficient grade without a supplier verdict',()=>{
 const x=review();x.policy.minExpectedSlots=10;const r=history(x);
 assert.equal(r.status,'insufficient-samples');assert.equal(r.providerCoverage[0].coverageGrade,'insufficient-samples');
});
test('D76 no cost record is not free and partial coverage cannot produce a total',()=>{
 const x=review(),a=history(x).providerCoverage[0].cost;
 assert.equal(a.status,'unknown-cost');assert.equal(a.totalCostMinor,null);assert.equal(a.costMinorPerFreshObservation,null);
 x.costEvidence=[cost('w0','tencent',0)];
 const b=history(x).providerCoverage[0].cost;assert.equal(b.status,'partial-cost-evidence');assert.equal(b.totalCostMinor,null);
});
test('D73 D76 documented zero and positive allocated costs use exact provider and complete window scope',()=>{
 const x=review();x.costEvidence=[cost('w0','tencent',0,'CNY','a'),cost('w1','tencent',0,'CNY','b'),
  cost('w0','eastmoney',120,'CNY','c'),cost('w1','eastmoney',180,'CNY','d')];
 const r=history(x);
 assert.equal(r.providerCoverage[0].cost.totalCostMinor,0);assert.equal(r.providerCoverage[0].cost.costMinorPerFreshObservation,0);
 assert.equal(r.providerCoverage[1].cost.totalCostMinor,300);assert.equal(r.providerCoverage[1].cost.costMinorPerFreshObservation,50);
 assert.equal(r.providerCoverage[1].cost.costMinorPerExpectedSlot,50);assert.equal(r.costEvidenceIndependentlyVerified,false);
 assert.equal(r.supplierAuthorizationVerified,false);assert.equal(r.canAutoSelectProvider,false);
});
test('D76 mixed currencies and no fresh observations never produce fabricated comparable unit cost',()=>{
 const x=review();x.costEvidence=[cost('w0','tencent',100,'CNY','a'),cost('w1','tencent',100,'USD','b')];
 assert.equal(history(x).providerCoverage[0].cost.status,'mixed-currency');assert.equal(history(x).providerCoverage[0].cost.totalCostMinor,null);
 x.windows.forEach(w=>w.evidence.observations=[]);x.costEvidence[1].currency='CNY';
 const c=history(x).providerCoverage[0].cost;assert.equal(c.totalCostMinor,200);assert.equal(c.costMinorPerFreshObservation,null);
 assert.equal(c.costMinorPerExpectedSlot,33.333);
});
test('D73 rejects future, premature, duplicate, unscoped or untrusted cost evidence',()=>{
 for(const edit of [x=>x.costEvidence[0].knownAt=x.asOf+1,x=>x.costEvidence[0].knownAt=base,
  x=>x.costEvidence[0].provider='sina',x=>x.costEvidence[0].windowId='unknown',
  x=>x.costEvidence[0].costMinor=-1,x=>x.costEvidence[0].costMinor='0',x=>x.costEvidence[0].basis='estimated-free',
  x=>x.costEvidence[0].verifiedLive=true,x=>x.costEvidence.push({...x.costEvidence[0]}),
  x=>x.costEvidence.push(cost('w1','eastmoney',1,'CNY','a'))]){
  const x=review();x.costEvidence=[cost('w0','tencent',1)];edit(x);assert.equal(history(x).status,'blocked');
 }
});
test('D55 exact grade thresholds are not raised by rounded percentages',()=>{
 const x=review(),t=base;x.policy.healthyMinPct=80;x.policy.watchMinPct=50;
 x.windows=[{windowId:'one',evidence:{registeredAt:t-10000,asOf:t+240000,expectedSlots:[t,t+30000,t+60000,t+90000,t+120000],observations:[t,t+30000,t+60000,t+90000].map(slotAt=>({slotAt,report:report(slotAt)}))}}];
 const p=history(x).providerCoverage[0];assert.equal(p.freshCoveragePct,80);assert.equal(p.coverageGrade,'healthy-coverage-unverified');
 x.windows[0].evidence.observations.pop();assert.equal(history(x).providerCoverage[0].coverageGrade,'watch-coverage');
});
test('D54 history combines disagreements without attributing blame or raising trade permission',()=>{
 const x=review(),r=x.windows[1].evidence.observations[0].report;r.status='source-conflict';r.discrepancyBps=100;
 const out=history(x);assert.equal(out.pair.alignedPriceDisagreements,1);assert.equal(out.status,'historical-quality-watch');
 assert.equal(out.commonCauseVerified,false);assert.equal(out.providerIndependenceVerified,false);assert.equal(out.canTrade,false);
});
test('D55 existing offline CLI can replay history without network and rejects malformed UTF8',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-source-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'history.json'),cli=path.resolve(__dirname,'../scripts/quote-source-window-quality.js');
 const run=()=>spawnSync(process.execPath,[cli,file],{encoding:'utf8'});
 fs.writeFileSync(file,JSON.stringify(review()));let result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).windowCount,2);
 const raw=JSON.stringify({...review(),note:'MARKER'}),i=raw.indexOf('MARKER');
 fs.writeFileSync(file,Buffer.concat([Buffer.from(raw.slice(0,i)),Buffer.from([255]),Buffer.from(raw.slice(i+6))]));
 assert.equal(run().status,2);
});

test('D55 overlapping report windows cannot reuse or regress one provider original fresh quote',()=>{
 for(const delta of [0,-500]){
  const x=window().evidence,t=x.expectedSlots[0];
  x.expectedSlots=[t,t+30000,t+60000];x.maxReportLagMs=60000;
  x.observations=x.expectedSlots.map(slotAt=>({slotAt,report:report(slotAt)}));
  const a=x.observations[0].report,b=x.observations[1].report;
  a.asOf=new Date(t+32000).toISOString();
  a.sourceStatuses[0].quoteAt=t+31000;
  a.sourceStatuses[1].quoteAt=t+30900;
  a.quoteAt=t+30900;a.quoteTimeGapMs=100;
  b.asOf=new Date(t+33000).toISOString();
  b.sourceStatuses[0].quoteAt=t+31000+delta;
  b.sourceStatuses[1].quoteAt=t+32000;
  b.quoteAt=Math.min(b.sourceStatuses[0].quoteAt,b.sourceStatuses[1].quoteAt);
  b.quoteTimeGapMs=Math.abs(b.sourceStatuses[0].quoteAt-b.sourceStatuses[1].quoteAt);
  assert.equal(audit(x).reason,'duplicate-or-regressing-fresh-provider-quote');
  const h=review();h.windows=[{windowId:'one',evidence:x}];
  assert.equal(history(h).status,'blocked');
 }
});
test('D55 legitimate distinct fresh observations survive overlapping lag windows and out-of-order input',()=>{
 const x=window().evidence,t=x.expectedSlots[0];
 x.expectedSlots=[t,t+30000,t+60000];x.maxReportLagMs=60000;
 x.observations=x.expectedSlots.map(slotAt=>({slotAt,report:report(slotAt)}));
 const a=x.observations[0].report,b=x.observations[1].report;
 a.asOf=new Date(t+31000).toISOString();a.sourceStatuses[0].quoteAt=t+30000;
 a.sourceStatuses[1].quoteAt=t+29900;a.quoteAt=t+29900;a.quoteTimeGapMs=100;
 b.asOf=new Date(t+33000).toISOString();b.sourceStatuses[0].quoteAt=t+32000;
 b.sourceStatuses[1].quoteAt=t+31900;b.quoteAt=t+31900;b.quoteTimeGapMs=100;
 x.observations.reverse();
 const r=audit(x);assert.equal(r.status,'limited-alignment-unverified');assert.equal(r.sourceCoverage[0].freshSlots,3);
});
test('D54 repeated old dated snapshots remain nonfresh observations rather than supplier coverage',()=>{
 const x=window().evidence;
 x.observations=x.expectedSlots.map(slotAt=>({slotAt,report:report(slotAt,['dated-snapshot','dated-snapshot'])}));
 for(const o of x.observations)for(const s of o.report.sourceStatuses)s.quoteAt=base-60000;
 const r=audit(x);assert.equal(r.sourceCoverage[0].freshSlots,0);assert.equal(r.sourceCoverage[0].datedSlots,3);
 assert.equal(r.jointCoverage.bothDatedSlots,3);assert.equal(r.jointCoverage.commonCauseVerified,false);
});
test('D74 explicit source conflict and quote date contradictions cannot earn a quality grade',()=>{
 for(const edit of [
  x=>x.sourceConflict=true,
  x=>x.observations[0].report.quoteStatus='conflict',
  x=>x.observations[0].report.sourceStatuses[0].quoteSourceConflict=true,
  x=>x.observations[0].report.sourceStatuses[0].evidenceStatus='conflict',
  x=>x.observations[0].report.sourceStatuses[0].tradeDate='2026-11-22',
  x=>x.observations[0].report.sourceStatuses[0].quoteDate=['2026-11-23']
 ]){
  const x=window().evidence;edit(x);assert.equal(audit(x).status,'blocked');
 }
 const x=window().evidence;x.observations[0].report.sourceStatuses[0].sourceTradeDate='2026-11-23';
 assert.equal(audit(x).status,'limited-alignment-unverified');
});
