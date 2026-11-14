'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {normalizeBaoStockDaily}=require('../src/core/baostock-historical-normalizer');
const {audit}=require('../scripts/research-cross-source-history');
const script=path.resolve(__dirname,'../scripts/research-cross-source-history.js');
function rows(){
 const days=Array.from({length:90},(_,i)=>new Date(Date.UTC(2026,4,1+i)).toISOString().slice(0,10))
   .filter(d=>![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())).slice(0,40);
 return days.map(d=>({date:d,code:'sh.600000',open:'10',high:'11',low:'9',close:'10',
  volume:'10000',amount:'100000',adjustflag:'3',tradestatus:'1'}));
}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-parity-'));
 t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 const raw=rows(),normalized=normalizeBaoStockDaily({code:'600000',rows:raw}).dataset;
 const em={...structuredClone(normalized),provider:'eastmoney-public-history',
  datasetId:'em-unadjusted-v2-raw',priceAdjustment:{mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'}};
 const a=path.join(root,'em.json'),b=path.join(root,'baostock.json'),out=path.join(root,'report.json');
 fs.writeFileSync(a,JSON.stringify(em));
 fs.writeFileSync(b,JSON.stringify({provider:'baostock',code:'600000',rows:raw}));
 return {a,b,out,em,raw,root};
}
test('two properly typed separate tapes can produce immutable research-only parity report',t=>{
 const f=fixture(t),r=audit(f.a,f.b);
 assert.equal(r.comparison.consensus,true);
 assert.equal(r.comparison.primary.upstreamGroup,'eastmoney');
 assert.equal(r.comparison.secondary.upstreamGroup,'baostock');
 assert.equal(r.comparison.amountComparedBars,40);
 assert.equal(r.canTrade,false);assert.equal(r.verifiedExternal,false);
 assert.equal(r.sourceIndependenceAuthenticated,false);
 assert.equal(r.researchEvidenceComplete,false,'historical shared gaps/holidays must not pass a whole-history claim');
 assert.equal(r.calendarCoverage.exchangeVerified,false);
 assert.equal(r.calendarCoverage.canTrade,false);
 const run=spawnSync(process.execPath,[script,f.a,f.b,f.out],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.equal(JSON.parse(fs.readFileSync(f.out)).comparison.consensus,true);
});
test('price or amount mismatch is seen and not silently averaged away',t=>{
 const f=fixture(t);
 f.em.stocks[0].bars[0].amount*=1000;fs.writeFileSync(f.a,JSON.stringify(f.em));
 const r=audit(f.a,f.b);
 assert.equal(r.comparison.consensus,false);
 assert.equal(r.comparison.discrepancies,2,'amount mismatch plus raw VWAP sanity');
 assert.deepEqual(r.comparison.displayedDiscrepancies.map(x=>x.field),
  ['amount','primary-vwap-outside-range']);
 assert.equal(r.comparison.releaseReady,false);
});
test('an already-existing report refuses overwrite and preserves original bytes',t=>{
 const f=fixture(t);
 fs.writeFileSync(f.out,'SAVED-IMMUTABLE');
 const run=spawnSync(process.execPath,[script,f.a,f.b,f.out],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/EEXIST/);
 assert.equal(fs.readFileSync(f.out,'utf8'),'SAVED-IMMUTABLE');
});
test('unverified public provider and adjusted or wrong code input fail without report',t=>{
 const f=fixture(t),original=structuredClone(f.em);
 for(const change of [
  data=>data.priceAdjustment.mode='qfq',
  data=>data.provider='efinance',
  data=>data.stocks[0].code='000001']){
  f.em=structuredClone(original);change(f.em);
  fs.writeFileSync(f.a,JSON.stringify(f.em));
  const run=spawnSync(process.execPath,[script,f.a,f.b,f.out],{encoding:'utf8'});
  assert.notEqual(run.status,0,run.stdout);
  assert.equal(fs.existsSync(f.out),false);
 }
});
test('BaoStock source status must be observed and raw source identity explicit',t=>{
 const f=fixture(t);
 fs.writeFileSync(f.b,JSON.stringify({mode:'optional-research-sources',code:'600000',observedAt:Date.now(),
  sources:[{provider:'baostock',status:'permission-pending',data:{bars:f.raw}}]}));
 assert.throws(()=>audit(f.a,f.b),/未成功获得原始日线/);
 fs.writeFileSync(f.b,JSON.stringify({provider:'wrong',code:'600000',rows:f.raw}));
 assert.throws(()=>audit(f.a,f.b),/来源标签/);
});

const officialCalendar=require('../config/research-calendar-2026.json');
const observedAt=Date.parse('2026-11-15T12:00:00+08:00');
const openDates=officialCalendar.sessions.filter(x=>x.open&&x.date<='2026-11-13').map(x=>x.date).slice(-38);
function real2026Fixture(t,drop=null,halt=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-open-session-parity-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const records=openDates.map(date=>({
  date,code:'sh.600000',open:'10',high:'11',low:'9',close:'10',
  volume:'10000',amount:'100000',adjustflag:'3',tradestatus:'1'
 }));
 if(drop){
  const ix=records.findIndex(r=>r.date===drop);
  assert.ok(ix>0);records.splice(ix,1);
  if(halt)records.push({date:drop,code:'sh.600000',open:'',high:'',low:'',close:'',
   volume:'0',amount:'0',adjustflag:'3',tradestatus:'0'});
 }
 records.sort((a,b)=>a.date.localeCompare(b.date));
 const active=records.filter(x=>x.tradestatus==='1');
 const b=normalizeBaoStockDaily({code:'600000',rows:active,collectorObservedAt:observedAt}).dataset;
 const em={...structuredClone(b),provider:'eastmoney-public-history',
  datasetId:'em-unadjusted-v2-halt-aware',priceAdjustment:{mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'}};
 const a=path.join(dir,'em.json'),source=path.join(dir,'baostock.json');
 fs.writeFileSync(a,JSON.stringify(em));
 fs.writeFileSync(source,JSON.stringify({provider:'baostock',code:'600000',
  collectorObservedAt:observedAt,rows:records}));
 return {a,b:source,em,records};
}
test('real official open-date subset qualifies only for research shape coverage, not trading',t=>{
 const f=real2026Fixture(t);
 const report=audit(f.a,f.b,{now:observedAt});
 assert.equal(report.comparison.consensus,true);
 assert.equal(report.calendarCoverage.status,'open-session-shape-consistent-unverified');
 assert.equal(report.researchEvidenceComplete,true);
 assert.equal(report.calendarCoverage.completeByProviderEvidence,true);
 assert.equal(report.calendarCoverage.exchangeVerified,false);
 assert.equal(report.calendarCoverage.pointInTimeBacktestReady,false);
 assert.equal(report.usableForExecution,false);
});
test('both independent sources missing the same 2026 open trading day can never pass whole-history audit',t=>{
 const missing=openDates[11],f=real2026Fixture(t,missing,false);
 const report=audit(f.a,f.b,{now:observedAt});
 assert.equal(report.comparison.consensus,true);
 assert.equal(report.researchEvidenceComplete,false);
 assert.equal(report.calendarCoverage.status,'unexplained-or-zero-volume-gaps');
 assert.deepEqual(report.calendarCoverage.bySymbol[0].unexplainedMissingOpenDays,[missing]);
 assert.equal(report.canTrade,false);
});
test('BaoStock explicit halted source row is separated without inventing a matching candle',t=>{
 const day=openDates[11],f=real2026Fixture(t,day,true);
 const report=audit(f.a,f.b,{now:observedAt});
 assert.equal(report.comparison.consensus,true);
 assert.equal(report.excludedRawSuspensionRows,1);
 assert.equal(report.calendarCoverage.status,'provider-declared-halts-unverified');
 assert.deepEqual(report.calendarCoverage.bySymbol[0].providerDeclaredSuspensionDays,[day]);
 assert.equal(report.researchEvidenceComplete,true);
 assert.equal(report.calendarCoverage.exchangeVerified,false);
 assert.equal(report.usableForExecution,false);
});
test('source-declared halts without timestamp or with real turnover are rejected before report publication',t=>{
 const day=openDates[11],f=real2026Fixture(t,day,true);
 const b=JSON.parse(fs.readFileSync(f.b));
 delete b.collectorObservedAt;fs.writeFileSync(f.b,JSON.stringify(b));
 assert.throws(()=>audit(f.a,f.b,{now:observedAt}),/采集时间/);
 b.collectorObservedAt=observedAt;
 b.rows.find(x=>x.date===day).amount='20000';
 fs.writeFileSync(f.b,JSON.stringify(b));
 assert.throws(()=>audit(f.a,f.b,{now:observedAt}),/不为零/);
});
