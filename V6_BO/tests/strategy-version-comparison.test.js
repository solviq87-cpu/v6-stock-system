'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rollingPaperDiagnosis:diagnose,strategyHealth}=require('../src/core/strategy-health-monitor');
const {replayStrategyEvidence:replay}=require('../src/core/strategy-evidence-replay');
const dates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const input={sessionDates:dates,splitDate:dates[0],universeCount:2,marketQuality:{reviewReady:true}};
const rowSet=()=>dates.flatMap((signalDate,i)=>['000001','000002'].map(symbol=>({system:'fourteen',signalDate,symbol,verdict:'pass',evaluatorVersion:'native/v1',outcome:{status:'paper-estimate',entryDate:dates[i+1],exitDate:dates[i+2],netReturnPct:i<58?2:-2}})));
const recentFrom=dates[58];
test('same-version rolling windows preserve the original descriptive deterioration check',()=>{
 const rows=rowSet(),before=JSON.stringify(rows),r=diagnose(rows,input);
 assert.equal(r.status,'paper-deterioration-review');assert.equal(r.changePp,-4);
 assert.equal(r.comparableEvaluatorVersion,'native/v1');assert.equal(r.canTrade,false);
 assert.equal(JSON.stringify(rows),before);
});
test('a version change between windows cannot be interpreted as decay',()=>{
 const rows=rowSet().map(r=>r.signalDate>=recentFrom?{...r,evaluatorVersion:'native/v2'}:r);
 const r=diagnose(rows,input);assert.equal(r.status,'unknown');assert.equal(r.reason,'evaluator-version-not-comparable');
 assert.equal(r.changePp,null);assert.equal(r.comparableEvaluatorVersion,null);
 assert.deepEqual(r.previous.evaluatorVersions,['native/v1']);assert.deepEqual(r.recent.evaluatorVersions,['native/v2']);
 assert.equal(r.previous.meanDailySignalReturnPct,2);assert.equal(r.recent.meanDailySignalReturnPct,-2);
});
test('mixed or missing versions in an otherwise adequate comparison fail closed',()=>{
 const mixed=rowSet();mixed.find(r=>r.signalDate===recentFrom).evaluatorVersion='native/v2';
 assert.equal(diagnose(mixed,input).reason,'evaluator-version-not-comparable');
 for(const evaluatorVersion of [undefined,null,' ','v1\nother']){
  const rows=rowSet();rows.find(r=>r.signalDate===recentFrom).evaluatorVersion=evaluatorVersion;
  const r=diagnose(rows,input);assert.equal(r.reason,'evaluator-version-unverified');assert.equal(r.changePp,null);
  assert.equal(r.recent.unknownVersionRows,1);
 }
});
test('unassessed placeholders do not contaminate an evaluated version comparison',()=>{
 const rows=rowSet(),row=rows.find(r=>r.signalDate===recentFrom);
 row.verdict='unknown';row.evaluatorVersion='placeholder';row.outcome={status:'not-evaluated'};
 const r=diagnose(rows,input);assert.equal(r.status,'paper-deterioration-review');
 assert.equal(r.comparableEvaluatorVersion,'native/v1');assert.equal(r.recent.evaluatedCoverage,39/40);
});
test('system-level health explicitly warns about pooled versions while retaining descriptive metrics',()=>{
 const systems=['fourteen','bazi','gpt','python'];
 const rows=rowSet().map(r=>r.signalDate>=recentFrom?{...r,evaluatorVersion:'native/v2'}:r);
 const own=Object.fromEntries(systems.map(k=>[k,{paperTrades:k==='fourteen'?40:0,meanNetReturnPct:1,winRatePct:60}]));
 const native={coverage:Object.fromEntries(systems.map(k=>[k,{evaluated:k==='fourteen'?40:0,unknown:0}])),replay:{splitDay:0,splitDate:dates[0],windows:{outOfSample:{systems:own,records:rows}}}};
 const portfolios={systems:Object.fromEntries(systems.map(k=>[k,{metrics:{closedTrades:40,returnPct:2,maxDrawdownPct:1,halted:false}}]))};
 const r=strategyHealth(native,portfolios,input).systems.fourteen;
 assert.equal(r.status,'research-warning');assert.equal(r.holdoutMeanReturnPct,1);
 assert.match(r.warnings.join(' '),/评估器版本/);assert.deepEqual(r.holdoutVersionEvidence.evaluatorVersions,['native/v1','native/v2']);
 assert.equal(r.liveEligible,false);
});
const history={source:'fixture',asOf:dates.at(-1),splitDay:75,stocks:[{code:'000001',market:'main',bars:dates.map((date,i)=>({date,open:10+i*.01,high:10.5+i*.01,low:9.5+i*.01,close:10+i*.01,volume:10000}))}]};
const sig=(i,version)=>({system:'fourteen',symbol:'000001',date:dates[i],observedThrough:dates[i],verdict:'pass',provenance:'native-test-fixture',evaluatorVersion:version});
const run=signals=>replay(history,{source:'fixture',generatedAt:'2026-11-05T00:00:00Z',signals});
test('version summaries keep separate denominators and do not award a pooled 30-sample threshold to either version',()=>{
 const signals=Array.from({length:30},(_,i)=>sig(i+1,i<15?'native/v1':'native/v2'));
 const r=run(signals),window=r.windows.inSample,s=window.systems.fourteen;
 assert.equal(s.evidenceCount,30);assert.equal(s.paperTrades,30);assert.equal(s.mixedEvaluatorVersions,true);
 assert.equal(s.versionSummaryStatus,'available');
 assert.deepEqual(s.versionSummaries.map(v=>[v.evaluatorVersion,v.evidenceCount,v.paperTrades,v.status]),[['native/v1',15,15,'insufficient-sample'],['native/v2',15,15,'insufficient-sample']]);
 for(const v of s.versionSummaries){
  const rs=window.records.filter(x=>x.evaluatorVersion===v.evaluatorVersion).map(x=>x.outcome.netReturnPct);
  assert.equal(v.meanNetReturnPct,+(rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(4));
  assert.equal(Object.hasOwn(v,'dailyPortfolioReturns'),false);
 }
 assert.equal(window.systems.bazi.versionSummaryStatus,'empty');assert.deepEqual(window.systems.bazi.versionSummaries,[]);
 assert.equal(r.canTrade,false);
});
test('version summary expansion is bounded without inventing a partial single-version evaluation',()=>{
 const s=run(Array.from({length:65},(_,i)=>sig(i+1,'version/'+i))).windows.inSample.systems.fourteen;
 assert.equal(s.evaluatorVersions.length,65);assert.equal(s.evidenceCount,65);
 assert.equal(s.versionSummaryStatus,'too-many-versions');assert.deepEqual(s.versionSummaries,[]);
});
