'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {auditRegisteredSourceReadiness:audit}=require('../src/core/data-source-readiness-audit');
const registry=require('../config/data-source-registry-2026.json');
// Preserve the original 120 routes from dev b9b4447 while allowing reviewed additions.
const BASELINE_ROUTE_IDS=[
 "eastmoney","tencent","sina","baostock","mootdx",
 "pytdx","ashare","efinance","akshare-em-daily","akshare-em-minute",
 "akshare-sina-minute","akshare-sina-daily","akshare-tencent-daily","easyquotation-sina","easyquotation-tencent",
 "ashare-tencent-route","pytdx-quote-route","stock-data-hub-efinance","stock-data-hub-pytdx","cnequity-em",
 "cnequity-official","eastmoney-public-history","cninfo","sse-disclosure","szse-disclosure",
 "bse-disclosure","csrc-disclosure","sse-calendar","szse-calendar","bse-calendar",
 "sw-industry","china-index","tushare","rqdata","joinquant",
 "ifind","choice","wind","miniqmt","tqsdk",
 "ctp","shfe","ine","dce","czce",
 "cffex","gfex","sge","hkex","sec-edgar",
 "yfinance","yahooquery","yfinance-hk","stooq","finance-datareader",
 "alpha-vantage","twelve-data","tiingo","finnhub","massive-polygon",
 "fmp","eodhd","nasdaq-datalink","databento","itick",
 "alltick","fred","alfred","worldbank","imf",
 "oecd","bis","ecb","eurostat","nbs",
 "pboc","safe","sse-fund","szse-fund","efinance-fund",
 "stock-data-hub-yfinance","openbb","qlib","vnpy","pykrx",
 "wbgapi","fredapi","pandas-datareader-fred","pandas-datareader-worldbank","boj-statistics",
 "boj-timeseries-json","japan-estat","jpx-equities","jpx-calendar","us-treasury-fiscal",
 "us-treasury-average-rates","us-treasury-debt","us-census","us-bea","us-bls",
 "us-eia","us-cftc-cot","us-cboe-vix","us-treasury-yield-curve","ecb-fx-daily",
 "ecb-sdmx-generic","eurostat-sdmx21","eurostat-jsonstat","imf-sdmx","oecd-sdmx",
 "bis-sdmx","un-comtrade","fao-faostat","ilo-ilostat","hkma-opendata",
 "mas-statistics","rba-statistics","boe-database","snb-data","boc-valet"
];
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
test('the preserved registry is a discovery directory, not a connected or licensed feed count',()=>{
 const r=audit({asOf:NOW});
 assert.equal(r.status,'registry-only-no-probe');
 assert.equal(r.schemaVersion,2);
 assert.equal(BASELINE_ROUTE_IDS.length,120);
 assert.ok(BASELINE_ROUTE_IDS.every(id=>registry.sources.some(route=>route.id===id)), 'Original routes cannot be replaced by new candidates');
 assert.equal(r.summary.registeredRoutes,registry.sources.length);
 assert.equal(r.summary.reportedExactRoutes,0);
 assert.equal(r.summary.attemptedExactRoutes,0);
 assert.equal(r.summary.observedExactRoutes,0);
 assert.equal(r.summary.successfulQuoteObservations,0);
 assert.equal(r.summary.recentQuotesAtAudit,0);
 assert.equal(r.summary.unobservedRoutes,registry.sources.length);
 assert.equal(r.summary.guardedResearchRoutes,2);
 assert.equal(r.summary.licensedLiveSources,0);
 assert.equal(r.summary.productionActiveSourcesVerified,0);
 assert.equal(r.canTrade,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.verifiedLive,false);
 assert.ok(r.routes.every(x=>!x.observedOnThisExactRoute&&x.observationState==='not-probed'));
 assert.ok(r.routes.every(x=>x.phases.attempt==='unknown'&&x.phases.singleQuote==='unknown'&&
  x.phases.sustainedAvailability==='unknown'&&x.phases.authorization==='unknown'&&x.phases.productionActivation==='unknown'));
 assert.ok(r.routes.every(x=>x.licensedForLive===null&&x.productionEnabled===null&&
  x.sustainedAvailabilityVerified===null&&x.effectiveObservationDays===null));
});
test('only exact three public quote routes inherit a one-shot observation',()=>{
 const r=audit({asOf:NOW,snapshot:snapshot()});
 assert.equal(r.summary.registeredRoutes,registry.sources.length);
 assert.equal(r.summary.reportedExactRoutes,3);
 assert.equal(r.summary.attemptedExactRoutes,3);
 assert.equal(r.summary.observedExactRoutes,3);
 assert.equal(r.summary.successfulQuoteObservations,2);
 assert.equal(r.summary.recentQuotesAtAudit,2);
 assert.equal(r.summary.observedUpstreamLabels,3);
 assert.equal(r.summary.licensedLiveSources,0);
 const entries=new Map(r.routes.map(x=>[x.id,x]));
 assert.equal(entries.get('eastmoney').observationState,'recent-original-quote-unverified');
 assert.equal(entries.get('tencent').observationState,'recent-original-quote-unverified');
 assert.equal(entries.get('sina').observationState,'access-denied');
 assert.equal(entries.get('sina').lastProbeStatus,'access-denied');
 assert.equal(entries.get('efinance').upstreamGroup,'eastmoney');
 assert.equal(entries.get('efinance').observationState,'not-probed');
 assert.equal(entries.get('efinance').reportedOnThisExactRoute,false);
 assert.equal(entries.get('efinance').attemptedOnThisExactRoute,false);
 assert.equal(entries.get('efinance').successfulQuoteObservation,null);
 assert.equal(entries.get('akshare-em-daily').observationState,'not-probed');
 assert.equal(entries.get('eastmoney-public-history').observationState,'not-probed');
 assert.equal(entries.get('baostock').observationState,'not-probed');
 assert.equal(entries.get('ashare').upstreamUnique,false);
 assert.equal(entries.get('ashare').observationState,'not-probed');
 assert.equal(entries.get('eastmoney').licensedForLive,null);
 assert.equal(r.canNotify,false);
 assert.equal(r.providerIndependenceVerified,false);
 assert.equal(JSON.stringify(r).includes('1440.41'),false,
  'readiness reports never republish price or raw upstream data');
});
test('the same healthy-looking capture expires at the audit clock, not at its original report time',()=>{
 const r=audit({asOf:NOW+16001,snapshot:snapshot()});
 assert.equal(r.summary.observedExactRoutes,3);
 assert.equal(r.summary.successfulQuoteObservations,2);
 assert.equal(r.summary.recentQuotesAtAudit,0);
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
 assert.equal(result.summary.reportedExactRoutes,3);
 assert.equal(result.summary.attemptedExactRoutes,0);
 assert.equal(result.summary.observedExactRoutes,0);
 assert.equal(result.summary.successfulQuoteObservations,0);
 assert.equal(result.summary.recentQuotesAtAudit,0);
 assert.equal(result.summary.unobservedRoutes,registry.sources.length);
 assert.equal(result.summary.observedUpstreamLabels,0);
 assert.equal(result.summary.byEvidenceState['not-requested'],3);
 assert.equal(result.status,'report-only-no-attempt');
 for(const route of result.routes.filter(row=>row.reportedOnThisExactRoute)){
  assert.equal(route.attemptedOnThisExactRoute,false);
  assert.equal(route.observedOnThisExactRoute,false);
  assert.equal(route.lastObservedAt,null);
  assert.equal(route.lastReportedAt,iso(midday));
  assert.equal(route.successfulQuoteObservation,null);
  assert.equal(route.phases.attempt,'not-requested');
 }
 const later=audit({asOf:midday+60000,snapshot:s});
 assert.equal(later.summary.byEvidenceState['not-requested'],3);
 assert.equal(later.summary.observedExactRoutes,0);
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
 const registryRun=run([]);
 assert.equal(registryRun.status,0,registryRun.stderr);
 assert.equal(JSON.parse(registryRun.stdout).summary.registeredRoutes,registry.sources.length);
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
 assert.equal(r.summary.reportedExactRoutes,3);
 assert.equal(r.summary.attemptedExactRoutes,3);
 assert.equal(r.summary.successfulQuoteObservations,0);
 assert.equal(r.summary.recentQuotesAtAudit,0);
 assert.equal(r.summary.licensedLiveSources,0);
 assert.equal(r.canTrade,false);
});

test('one structurally valid quote does not certify sustained availability, permission or production activation',()=>{
 const s=snapshot();s.providers=[fresh('tencent')];
 const r=audit({asOf:NOW,snapshot:s}),route=r.routes.find(x=>x.id==='tencent');
 assert.equal(r.summary.reportedExactRoutes,1);
 assert.equal(r.summary.attemptedExactRoutes,1);
 assert.equal(r.summary.successfulQuoteObservations,1);
 assert.equal(r.summary.recentQuotesAtAudit,1);
 assert.equal(r.summary.unobservedRoutes,registry.sources.length-1);
 assert.equal(route.successfulQuoteObservation,true);
 assert.equal(route.recentQuoteAtAudit,true);
 assert.equal(route.phases.singleQuote,'observed-unverified');
 for(const phase of ['sustainedAvailability','authorization','productionActivation'])assert.equal(route.phases[phase],'unknown');
 assert.equal(route.licensedForLive,null);
 assert.equal(route.productionEnabled,null);
 assert.equal(route.sustainedAvailabilityVerified,null);
 assert.equal(route.observationWindow,null);
 assert.equal(route.effectiveObservationDays,null);
 assert.equal(route.canTrade,false);
 assert.equal(route.activeByThisAudit,false);
 assert.equal(audit({asOf:NOW+14000,snapshot:s}).summary.recentQuotesAtAudit,1);
 const expired=audit({asOf:NOW+14001,snapshot:s});
 assert.equal(expired.summary.successfulQuoteObservations,1);
 assert.equal(expired.summary.recentQuotesAtAudit,0);
 assert.equal(expired.routes.find(x=>x.id==='tencent').observationState,'quote-expired-at-audit');
});

test('a valid dated snapshot is one quote observation but never a recent quote',()=>{
 const s=snapshot();s.providers=[{...fresh('tencent'),status:'dated-snapshot',quoteAt:NOW-60000,quoteAgeMs:60000}];
 const r=audit({asOf:NOW,snapshot:s});
 assert.equal(r.summary.attemptedExactRoutes,1);
 assert.equal(r.summary.successfulQuoteObservations,1);
 assert.equal(r.summary.recentQuotesAtAudit,0);
 assert.equal(r.routes.find(x=>x.id==='tencent').phases.sustainedAvailability,'unknown');
});

test('an HTTP 200 without usable quote fields remains an attempted failure',()=>{
 const s=snapshot();s.providers=[{provider:'tencent',status:'invalid-quote',httpStatus:200,
  quoteAt:null,quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10}];
 const r=audit({asOf:NOW,snapshot:s});
 assert.equal(r.summary.attemptedExactRoutes,1);
 assert.equal(r.summary.observedExactRoutes,1);
 assert.equal(r.summary.successfulQuoteObservations,0);
 assert.equal(r.summary.recentQuotesAtAudit,0);
 assert.equal(r.routes.find(x=>x.id==='tencent').phases.singleQuote,'no-usable-quote');
});

test('a no-fetch report cannot claim an HTTP response',()=>{
 const midday=Date.parse('2026-11-10T12:00:00+08:00');
 const s=snapshot();s.status='outside-weekday-session-window';s.startedAt=iso(midday);delete s.finishedAt;
 s.providers=[{provider:'tencent',status:'not-requested',httpStatus:200,quoteAt:null,
  quoteAgeMs:null,price:null,previousClose:null,elapsedMs:0}];
 assert.throws(()=>audit({asOf:midday,snapshot:s}),/请求状态冲突/);
});

test('both npm entry points invoke the existing read-only readiness CLI',()=>{
 const root=path.resolve(__dirname,'../..');
 for(const cwd of [root,path.join(root,'V6_BO')]){
  const result=spawnSync('npm',['run','data:sources:readiness','--silent'],{cwd,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.mode,'read-only-registered-source-readiness-evidence');
  assert.equal(report.schemaVersion,2);
  assert.equal(report.summary.registeredRoutes,registry.sources.length);
  assert.equal(report.summary.attemptedExactRoutes,0);
  assert.equal(report.canTrade,false);
 }
});

test('all registered routes keep static adapter, actual attempt, successful data and business execution phases separate',()=>{
 const r=audit({asOf:NOW}),s=r.summary,byId=new Map(r.routes.map(x=>[x.id,x]));
 assert.equal(s.registeredRoutes,122);assert.equal(new Set(r.routes.map(x=>x.id)).size,122);
 assert.equal(s.candidateRegistrationOnlyRoutes,99);assert.equal(s.namedAdapterCodeReviewedRoutes,18);
 assert.equal(s.genericGatewayContractRoutes,2);assert.equal(s.manualImportContractRoutes,3);
 assert.equal(s.namedAdapterNotReviewedRoutes,0);assert.equal(s.staticBusinessAnalysisPathRoutes,4);
 assert.equal(s.businessAnalysisExecutionRoutesVerified,0);assert.equal(s.productionActiveSourcesVerified,0);
 assert.equal(byId.get('itick').integration.staticWiringScope,'conditional-diagnostic-only');
 assert.equal(byId.get('ecb-fx-daily').integration.adapterStage,'candidate-registration-only');
 assert.equal(byId.get('ecb').integration.staticWiringScope,'manual-background-archive');
 assert.ok(r.routes.every(x=>x.phases.businessAnalysis==='unknown'&&x.integration.businessAnalysisExecutionVerified===null&&x.phases.actualCall==='unknown'));
 const q=audit({asOf:NOW,snapshot:snapshot()});
 assert.equal(q.routes.find(x=>x.id==='tencent').phases.actualCall,'attempt-reported');
 assert.equal(q.routes.find(x=>x.id==='tencent').phases.dataReturn,'quote-returned-unverified');
 assert.equal(q.routes.find(x=>x.id==='tencent').phases.businessAnalysis,'unknown');
 assert.equal(q.routes.find(x=>x.id==='sina').phases.dataReturn,'no-usable-quote');
 assert.equal(q.routes.find(x=>x.id==='easyquotation-sina').phases.actualCall,'unknown');
});
test('all failure families require compatible HTTP status and never accept contradictory source or symbol',()=>{
 const fail={provider:'tencent',status:'timeout',httpStatus:null,quoteAt:null,quoteAgeMs:null,price:null,previousClose:null,elapsedMs:10};
 for(const [status,httpStatus] of [['timeout',200],['transport-error',500],['redirect-refused',200],['redirect-refused',403],['invalid-response',403],['response-too-large',null],['invalid-quote',404],['invalid-quote-time',429],['http-error',401],['http-error',403],['http-error',429]]){
  const s=snapshot();s.providers=[{...fail,status,httpStatus}];assert.throws(()=>audit({asOf:NOW,snapshot:s}),/HTTP/);
 }
 for(const patch of [{upstreamGroup:'eastmoney'},{code:'000001'},{source:'sina'},{quoteSource:'efinance'},{id:'sina'},{symbol:'000001'},{canTrade:true},{verifiedLive:true},{fixture:true}]){
  const s=snapshot();s.providers=[{...fresh('tencent'),...patch}];assert.throws(()=>audit({asOf:NOW,snapshot:s}),/身份/);
 }
 for(const [status,httpStatus] of [['timeout',null],['transport-error',null],['redirect-refused',null],['redirect-refused',302],['invalid-response',204],['invalid-quote',200],['http-error',500],['access-denied',403],['rate-limited',429]]){
  const s=snapshot();s.providers=[{...fail,status,httpStatus}];const r=audit({asOf:NOW,snapshot:s});
  assert.equal(r.summary.attemptedExactRoutes,1);assert.equal(r.summary.successfulQuoteObservations,0);
 }
});
test('regressed publication may retain a dated quote for diagnosis but must not count successful acquisition',()=>{
 const s=snapshot();s.status='clock-regressed';s.finishedAt=iso(NOW-2000);
 s.providers=[{...fresh('tencent'),status:'dated-snapshot',quoteAt:NOW-3000,quoteAgeMs:1000}];
 const r=audit({asOf:NOW,snapshot:s});assert.equal(r.summary.attemptedExactRoutes,1);
 assert.equal(r.summary.successfulQuoteObservations,0);assert.equal(r.summary.recentQuotesAtAudit,0);
 assert.equal(r.routes.find(x=>x.id==='tencent').lastProbeStatus,'dated-snapshot');
 assert.equal(r.routes.find(x=>x.id==='tencent').observationState,'clock-regressed');
});

test('a fixture-marked report is not evidence of an actual provider call',()=>{
 for(const flag of ['synthetic','mock','fixture','testSample'])assert.throws(()=>audit({asOf:NOW,snapshot:{...snapshot(),[flag]:true}}),/快照/);
});
