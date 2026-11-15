'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {auditRegisteredSourceReadiness:audit}=require('../src/core/data-source-readiness-audit');
const ROOT=path.resolve(__dirname,'../scripts/audit-data-source-readiness.js');
const NOW=Date.parse('2026-11-10T13:58:00+08:00');
const iso=x=>new Date(x).toISOString();
const fresh=(provider)=>({provider,status:'fresh-source-unverified',httpStatus:200,
 quoteAt:NOW-1000,quoteAgeMs:1000,price:1440.41,previousClose:1444.99,elapsedMs:10});
function snapshot(){
 return {schemaVersion:1,mode:'one-shot-public-quote-endpoint-health',
  code:'600519',status:'completed-unverified',startedAt:iso(NOW-1100),finishedAt:iso(NOW),
  providerLicensed:false,verifiedLive:false,exchangeCalendarVerified:false,
  canTrade:false,canNotify:false,providers:[fresh('tencent'),fresh('eastmoney'),
   {provider:'sina',status:'access-denied',httpStatus:403,quoteAt:null,
    quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10}]};
}
test('120 routes are a discovery directory, not 120 connected or licensed feeds',()=>{
 const r=audit({asOf:NOW});
 assert.equal(r.status,'registry-only-no-probe');
 assert.equal(r.summary.registeredRoutes,120);
 assert.equal(r.summary.observedExactRoutes,0);
 assert.equal(r.summary.unobservedRoutes,120);
 assert.equal(r.summary.guardedResearchRoutes,2);
 assert.equal(r.summary.licensedLiveSources,0);
 assert.equal(r.summary.productionActiveSourcesVerified,0);
 assert.equal(r.canTrade,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.verifiedLive,false);
 assert.ok(r.routes.every(x=>!x.observedOnThisExactRoute&&x.observationState==='not-probed'));
});
test('only exact three public quote routes inherit a one-shot observation',()=>{
 const r=audit({asOf:NOW,snapshot:snapshot()});
 assert.equal(r.summary.registeredRoutes,120);
 assert.equal(r.summary.observedExactRoutes,3);
 assert.equal(r.summary.observedUpstreamLabels,3);
 assert.equal(r.summary.licensedLiveSources,0);
 const entries=new Map(r.routes.map(x=>[x.id,x]));
 assert.equal(entries.get('eastmoney').observationState,'recent-original-quote-unverified');
 assert.equal(entries.get('tencent').observationState,'recent-original-quote-unverified');
 assert.equal(entries.get('sina').observationState,'access-denied');
 assert.equal(entries.get('sina').lastProbeStatus,'access-denied');
 assert.equal(entries.get('efinance').upstreamGroup,'eastmoney');
 assert.equal(entries.get('efinance').observationState,'not-probed');
 assert.equal(entries.get('akshare-em-daily').observationState,'not-probed');
 assert.equal(entries.get('eastmoney-public-history').observationState,'not-probed');
 assert.equal(entries.get('baostock').observationState,'not-probed');
 assert.equal(entries.get('ashare').upstreamUnique,false);
 assert.equal(entries.get('ashare').observationState,'not-probed');
 assert.equal(entries.get('eastmoney').licensedForLive,false);
 assert.equal(r.canNotify,false);
 assert.equal(r.providerIndependenceVerified,false);
 assert.equal(JSON.stringify(r).includes('1440.41'),false,
  'readiness reports never republish price or raw upstream data');
});
test('the same healthy-looking capture expires at the audit clock, not at its original report time',()=>{
 const r=audit({asOf:NOW+16001,snapshot:snapshot()});
 assert.equal(r.summary.observedExactRoutes,3);
 assert.equal(r.routes.find(x=>x.id==='tencent').observationState,'historical-probe-only');
 assert.equal(r.routes.find(x=>x.id==='eastmoney').observationState,'historical-probe-only');
 assert.equal(r.routes.find(x=>x.id==='sina').observationState,'historical-probe-only');
 assert.equal(r.routes.find(x=>x.id==='sina').lastProbeStatus,'access-denied');
 assert.equal(r.summary.byEvidenceState['recent-original-quote-unverified']||0,0);
 assert.equal(r.summary.licensedLiveSources,0);
});
test('declared trade, licensed or exchange-verified observation never gets promoted',()=>{
 for(const patch of [{canTrade:true},{providerLicensed:true},{verifiedLive:true},
  {exchangeCalendarVerified:true},{canNotify:true},{mode:'live-feed'},{code:'600519&secret=1'}]){
  assert.throws(()=>audit({asOf:NOW,snapshot:{...snapshot(),...patch}}),/快照/);
 }
});
test('unknown aliases, inconsistent quote clock and stale reported fresh flag fail closed',()=>{
 const cases=[
  s=>{s.providers[0].provider='efinance'},
  s=>{s.providers[0].quoteAt=NOW+1000},
  s=>{s.providers[0].quoteAgeMs=0},
  s=>{s.providers[0].status='source-accredited'},
  s=>{s.providers[1].provider='tencent'},
  s=>{s.providers[0].price=0},
  s=>{s.providers[0].status='not-requested'},
  s=>{s.providers[0].httpStatus=null},
  s=>{s.providers[2].httpStatus=200},
  s=>{s.finishedAt=iso(NOW+1)}
 ];
 for(const patch of cases){const s=snapshot();patch(s);
  assert.throws(()=>audit({asOf:NOW,snapshot:s}),undefined,JSON.stringify(patch));}
});
test('no-fetch outside-session report cannot inflate quote availability',()=>{
 const s=snapshot();
 s.status='outside-weekday-session-window';
 const midday=Date.parse('2026-11-10T12:00:00+08:00');
 s.startedAt=iso(midday);
 delete s.finishedAt;
 s.providers=s.providers.map(x=>({provider:x.provider,status:'not-requested',
  httpStatus:null,quoteAt:null,quoteAgeMs:null,price:null,
  previousClose:null,elapsedMs:0}));
 const result=audit({asOf:midday,snapshot:s});
 assert.equal(result.summary.observedExactRoutes,3);
 assert.equal(result.summary.byEvidenceState['not-requested'],3);
 assert.equal(result.summary.byEvidenceState['recent-original-quote-unverified']||0,0);
 assert.equal(result.canTrade,false);
});
test('regressing clock cannot grant a recent quote even when an HTTP response succeeded',()=>{
 const s=snapshot();
 s.status='clock-regressed';
 s.finishedAt=iso(NOW-2000);
 s.providers=[{provider:'tencent',status:'access-denied',httpStatus:403,
  quoteAt:null,quoteAgeMs:null,price:null,previousClose:null,elapsedMs:0}];
 const report=audit({asOf:NOW,snapshot:s});
 assert.equal(report.routes.find(x=>x.id==='tencent').observationState,'clock-regressed');
 assert.equal(report.summary.licensedLiveSources,0);
});
test('offline CLI reads bounded private records and never follows links, fetches or writes output files',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v6-readiness-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const run=args=>spawnSync(process.execPath,[ROOT,...args],{encoding:'utf8'});
 const registry=run([]);
 assert.equal(registry.status,0,registry.stderr);
 assert.equal(JSON.parse(registry.stdout).summary.registeredRoutes,120);
 const input=path.join(folder,'probe.json');
 fs.writeFileSync(input,JSON.stringify({...snapshot(),secretToken:'must-not-leak'}));
 const report=run([input]);
 assert.equal(report.status,0,report.stderr);
 const data=JSON.parse(report.stdout);
 assert.equal(data.summary.observedExactRoutes,3);
 assert.ok(!report.stdout.includes('must-not-leak'));
 assert.ok(!report.stdout.includes(input));
 const linked=path.join(folder,'symlink.json');fs.symlinkSync(input,linked);
 const forbidden=path.join(folder,'public');fs.mkdirSync(forbidden);
 const publicInput=path.join(forbidden,'probe.json');
 fs.copyFileSync(input,publicInput);
 const oversized=path.join(folder,'large.json');fs.writeFileSync(oversized,' '.repeat(128*1024+1));
 for(const bad of [linked,publicInput,oversized,'https://example.com/probe.json']){
  const denied=run([bad]);
  assert.notEqual(denied.status,0);
  assert.equal(denied.stdout,'');
  assert.ok(!denied.stderr.includes(bad),'reject without leaking private paths');
 }
});

test('supplying a market-session timestamp while claiming no requests were made outside hours fails closed',()=>{
 const s=snapshot();
 s.status='outside-weekday-session-window';
 delete s.finishedAt;
 s.providers=s.providers.map(x=>({provider:x.provider,status:'not-requested',
  httpStatus:null,quoteAt:null,quoteAgeMs:null,price:null,previousClose:null,elapsedMs:0}));
 assert.throws(()=>audit({asOf:NOW,snapshot:s}),/时钟|因果/);
});

test('403 denial, 429 throttle and 302 redirect stay separate without manufacturing quote data',()=>{
 const s=snapshot();
 s.providers=[
  {provider:'tencent',status:'access-denied',httpStatus:403,quoteAt:null,
   quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10},
  {provider:'eastmoney',status:'rate-limited',httpStatus:429,quoteAt:null,
   quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10},
  {provider:'sina',status:'redirect-refused',httpStatus:302,quoteAt:null,
   quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10}
 ];
 const r=audit({asOf:NOW,snapshot:s});
 const byId=new Map(r.routes.map(x=>[x.id,x]));
 assert.equal(byId.get('tencent').observationState,'access-denied');
 assert.equal(byId.get('eastmoney').observationState,'rate-limited');
 assert.equal(byId.get('sina').observationState,'redirect-refused');
 assert.equal(r.summary.byEvidenceState['recent-original-quote-unverified']||0,0);
 assert.equal(r.summary.licensedLiveSources,0);
 assert.equal(r.canTrade,false);
});
