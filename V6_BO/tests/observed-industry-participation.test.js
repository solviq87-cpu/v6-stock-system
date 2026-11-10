'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateObservedIndustryParticipation:evaluate}=
 require('../src/core/observed-industry-participation');
const {researchLiveMarket}=require('../src/core/live-market-research');
const asOf=Date.parse('2026-11-10T10:30:00+08:00'),date='2026-11-10';
const received=asOf-2000,vendorAt=asOf-40000;
const seq=Array.from({length:18},(_,i)=>String(600001+i));
const changes=[3,3,4,4,2,3,20,18,-1,-1,-1,-1,-2,-2,-1,-1,-3,-2];
const industries=['A设备','B传媒','C材料'];
function fixture(){
 const snapshot={date,source:'eastmoney-clist-unverified-live',universeSize:18,pages:1,
  retrievedAt:new Date(received).toISOString(),
  stocks:seq.map((code,i)=>({code,pctChange:changes[i],vendorQuoteAt:vendorAt}))};
 const classification={schemaVersion:1,source:'baostock:query_stock_industry',
  completed:true,standard:'证监会行业分类',updateDate:'2026-11-09',
  observedAt:asOf-3600000,declaredRows:18,
  rows:seq.map((code,i)=>({updateDate:'2026-11-09',code:'sh.'+code,
   industry:industries[Math.floor(i/6)],industryClassification:'证监会行业分类'}))};
 return {snapshot,classification,asOf};
}
test('broad participation ranks above two-stock rally; neither is an official board index return',()=>{
 const input=fixture(),copy=structuredClone(input);
 const r=evaluate(input);
 assert.equal(r.status,'observed-unverified');
 assert.equal(r.validIndustries,3);
 assert.equal(r.sectors[0].industry,'A设备');
 assert.equal(r.sectors[0].label,'broad-participation');
 assert.equal(r.sectors[1].label,'leader-concentrated');
 assert.equal(r.sectors[1].up,2);
 assert.equal(r.sectors[0].officialBoardChangePct,null);
 assert.equal(r.officialBoardChangeAvailable,false);
 assert.equal(r.quoteSource,input.snapshot.source);
 assert.equal(r.industrySource,input.classification.source);
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);
 assert.equal(r.weightsChanged,false);assert.equal(r.rankingModified,false);
 assert.deepEqual(input,copy);
});
test('member return is matched by exact symbol, independent of input row order',()=>{
 const x=fixture();
 const a=evaluate(x);
 x.classification.rows.reverse();x.snapshot.stocks.reverse();
 const b=evaluate(x);
 assert.deepEqual(b.sectors,a.sectors);
 assert.equal(b.bySymbol['600001'].industry,'A设备');
});
test('missing/stale/future/or prior day per-stock vendorQuoteAt cannot be replaced by retrievedAt',()=>{
 for(const modify of [
  x=>x.snapshot.stocks.forEach(s=>delete s.vendorQuoteAt),
  x=>x.snapshot.stocks.forEach(s=>s.vendorQuoteAt=asOf-900000),
  x=>x.snapshot.stocks.forEach(s=>s.vendorQuoteAt=asOf+1000),
  x=>x.snapshot.stocks.forEach(s=>s.vendorQuoteAt=Date.parse('2026-11-09T14:59:00+08:00'))
 ]){
  const x=fixture();modify(x);
  const r=evaluate(x);
  assert.equal(r.status,'insufficient-evidence');
  assert.equal(r.reason,'original-quote-time-market-coverage-insufficient');
 }
});
test('partial stock quote coverage excludes low-participation industry without turning missing prices to zero',()=>{
 const x=fixture();x.snapshot.stocks.slice(0,2).forEach(s=>s.vendorQuoteAt=null);
 const r=evaluate(x);
 assert.equal(r.status,'insufficient-comparison');
 assert.equal(r.validIndustries,2);
 assert.equal(r.excludedIndustries[0].name,'A设备');
 assert.equal(r.sectors.some(s=>s.industry==='A设备'),false);
});
test('missing, partial and duplicated industry classification rejects false ranking',()=>{
 for(const modify of [
  x=>x.classification.declaredRows=100,
  x=>x.classification.rows[1].code=x.classification.rows[0].code,
  x=>x.classification.rows[0].industryClassification='申万行业',
  x=>x.classification.completed=false,
  x=>x.classification.source='unknown',
  x=>x.classification.rows[0].updateDate='2026-11-10'
 ]){
  const x=fixture();modify(x);
  assert.equal(evaluate(x).status,'insufficient-evidence');
 }
});
test('dated classification guards historical membership and source lineage',()=>{
 const x=fixture();x.classification.updateDate='2026-10-01';
 x.classification.rows.forEach(s=>s.updateDate='2026-10-01');
 assert.equal(evaluate(x).reason,'classification-update-too-old');
 const y=fixture();y.classification.updateDate='2026-11-11';
 y.classification.rows.forEach(s=>s.updateDate='2026-11-11');
 assert.equal(evaluate(y).reason,'classification-source-completeness-or-date-invalid');
 const z=fixture();z.snapshot.source='fixture';
 assert.equal(evaluate(z).reason,'quote-snapshot-date-source-or-retrieval-invalid');
});
test('stale retrieval, invalid clock and duplicate quote symbols block the entire study',()=>{
 const x=fixture();x.asOf+=400000;
 assert.equal(evaluate(x).status,'insufficient-evidence');
 const y=fixture();y.snapshot.stocks.push({...y.snapshot.stocks[0]});
 assert.equal(evaluate(y).reason,'duplicate-or-invalid-quote-symbol');
 const z=fixture();z.snapshot.date='2026-11-09';
 assert.equal(evaluate(z).status,'insufficient-evidence');
});
test('classification observed after the quote capture is lookahead and cannot join',()=>{
 const x=fixture();x.classification.observedAt=received+1;
 assert.equal(evaluate(x).reason,'classification-source-completeness-or-date-invalid');
});
test('BaoStock one-shot collector does not initiate a provider session by default',()=>{
 const cp=require('node:child_process'),os=require('node:os'),path=require('node:path'),fs=require('node:fs');
 const script=path.join(__dirname,'../scripts/collect-baostock-industry.py');
 const dest=path.join(os.tmpdir(),'v6-unapproved-industry-'+process.pid+'.json');
 const result=cp.spawnSync('python3',[script,'--output',dest],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);
 assert.equal(fs.existsSync(dest),false);
});
test('unchanged researchLiveMarket response unless optional classification is supplied; one quote fetch',async()=>{
 const input=fixture(),opts={now:asOf,fetchSnapshot:async()=>input.snapshot};
 let calls=0;
 const baseline=await researchLiveMarket({...opts,fetchSnapshot:async()=>{calls++;return input.snapshot;}});
 const joined=await researchLiveMarket({...opts,industryClassification:input.classification,
  fetchSnapshot:async()=>{calls++;return input.snapshot;}});
 assert.equal(calls,2);
 assert.equal(Object.hasOwn(baseline,'industryParticipationStudy'),false);
 assert.equal(joined.industryParticipationStudy.status,'observed-unverified');
 assert.deepEqual(joined.breadth,baseline.breadth);
 assert.deepEqual(joined.candidateIntersection,baseline.candidateIntersection);
 assert.equal(joined.rankingModified,false);
});
