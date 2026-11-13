'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditQuoteSourceWindow:audit}=require('../src/core/quote-source-window-quality');
const base=Date.parse('2026-11-09T10:00:00+08:00');
const expectedSlots=[base,base+60000,base+120000];
const registeredAt=base-10000,asOf=base+180000;
function report(slot,{lag=2000,a=slot+lag-900,b=slot+lag-1000,priceBps=10,unavailable=false}={}){
 const time=slot+lag;
 return {schemaVersion:1,mode:'two-source-public-quote-diagnostic',code:'600001',
  asOf:new Date(time).toISOString(),source1:'tencent',source2:'eastmoney',
  canTrade:false,canNotify:false,certifiedLive:false,exchangeVerified:false,
  providerLicensed:false,calendarVerified:false,
  status:unavailable?'insufficient-fresh-sources':priceBps>50?'source-conflict':'sources-agree-unverified',
  discrepancyBps:unavailable?null:priceBps,
  quoteAt:unavailable?null:Math.min(a,b),
  quoteTimeGapMs:unavailable?undefined:Math.abs(a-b),
  sourceStatuses:[{provider:'tencent',status:'fresh-unverified',quoteAt:a},
   {provider:'eastmoney',status:unavailable?'unavailable':'fresh-unverified',quoteAt:unavailable?null:b}]};
}
const sample=(slots=expectedSlots)=>({registeredAt,asOf,expectedSlots:[...expectedSlots],
 observations:slots.map(slotAt=>({slotAt,report:report(slotAt)}))});
test('three declared valid slots measure freshness and relative time alignment without granting execution',()=>{
 const r=audit(sample());
 assert.equal(r.status,'limited-alignment-unverified');
 assert.equal(r.sourceCoverage[0].operationalFreshnessScore,100);
 assert.equal(r.pair.timeAlignedPairs,3);
 assert.equal(r.canTrade,false);assert.equal(r.canAutoSelectProvider,false);
 assert.equal(r.qualityProvesPriceAccuracy,false);
 assert.match(r.evidenceFingerprint,/^[a-f0-9]{64}$/);
});
test('missing scheduled observations penalize coverage, not counted as success',()=>{
 const r=audit(sample(expectedSlots.slice(0,2)));
 assert.equal(r.status,'coverage-watch');assert.equal(r.missingSlotCount,1);
 assert.equal(r.sourceCoverage[0].freshCoveragePct,66.7);
 assert.equal(r.sourceCoverage[1].missingEvidenceSlots,1);
});
test('fresh but time-misaligned snapshots are not allowed to count as consistent',()=>{
 const x=sample();x.observations[1].report=report(expectedSlots[1],{a:expectedSlots[1]+1000,b:expectedSlots[1]-10000});
 const r=audit(x);
 assert.equal(r.status,'time-misalignment-watch');assert.equal(r.pair.timeMisalignedPairs,1);
 assert.equal(r.pair.alignedPriceAgreements,2);
});
test('same-time price conflict remains unattributed to any one supplier',()=>{
 const x=sample();x.observations[1].report=report(expectedSlots[1],{priceBps:150});
 const r=audit(x);
 assert.equal(r.status,'price-disagreement-watch');assert.equal(r.pair.alignedPriceDisagreements,1);
 assert.equal(r.canAutoSelectProvider,false);
});
test('unavailable provider loses fresh coverage rather than being treated as a zero price',()=>{
 const x=sample();x.observations[1].report=report(expectedSlots[1],{unavailable:true});
 const r=audit(x);
 assert.equal(r.sourceCoverage[1].unavailableSlots,1);
 assert.equal(r.sourceCoverage[1].operationalFreshnessScore,66.7);
 assert.equal(r.pair.freshPairs,2);
});
test('duplicate, unregistered, future, stale, forged and missing original-time evidence are blocked',()=>{
 for(const mut of [
  x=>x.observations.push({...x.observations[0]}),
  x=>x.registeredAt=x.expectedSlots[0],
  x=>x.observations[0].report.asOf=new Date(x.observations[0].slotAt+70000).toISOString(),
  x=>x.observations[0].report.sourceStatuses[0].quoteAt=x.observations[0].slotAt-17000,
  x=>x.observations[0].report.sourceStatuses[1].quoteAt=null,
  x=>x.observations[0].report.providerLicensed=true,
  x=>x.observations[1].report.code='600002',
  x=>x.observations[0].report.discrepancyBps=51,
  x=>x.expectedSlots[1]=x.expectedSlots[0]
 ]) {const x=sample();mut(x);assert.equal(audit(x).status,'blocked');}
});
test('cannot hide a conflict through duplicate provider identities or contradictory pair verdicts',()=>{
 const x=sample();x.observations[0].report.sourceStatuses[1].provider='tencent';
 assert.equal(audit(x).status,'blocked');
 const y=sample();y.observations[0].report.status='source-conflict';
 assert.equal(audit(y).status,'blocked');
});

test('rounded boundary conflicts remain conflicts without certifying agreement',()=>{
 const x=sample();x.observations[0].report.discrepancyBps=50;
 x.observations[0].report.status='source-conflict';
 const result=audit(x);
 assert.equal(result.status,'price-disagreement-watch');
 assert.equal(result.pair.alignedPriceDisagreements,1);
 assert.equal(result.canTrade,false);
});

test('offline CLI accepts bounded evidence and refuses symlinks and oversized inputs',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-quote-window-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'evidence.json'),link=path.join(dir,'link.json');
 fs.writeFileSync(file,JSON.stringify(sample()));fs.symlinkSync(file,link);
 const run=p=>spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/quote-source-window-quality.js'),p],{encoding:'utf8'});
 const result=run(file);assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).canTrade,false);
 assert.equal(run(link).status,2);
 fs.truncateSync(file,4*1024*1024+1);assert.equal(run(file).status,2);
});
