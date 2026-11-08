'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceQuoteTimeSeconds,classifyQuoteTime,auditSnapshotQuoteTimes}=require('../src/core/market-snapshot-quote-time');
const {toStock,fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const {joinObservedCandidates}=require('../src/core/live-candidate-bridge');
const {researchLiveMarket}=require('../src/core/live-market-research');
const {assessCandidateEvidence}=require('../src/core/research-risk-gate');
const asOf=Date.parse('2026-11-06T14:58:00+08:00');
const day='2026-11-06';
const sec=ms=>Math.floor(ms/1000);
const record=(code,f124,change=2)=>({f12:code,f13:0,f3:change,f6:100,f124});
function snapshot(items,clock=asOf){
 return {date:day,source:'eastmoney-clist-unverified-live',
  retrievedAt:new Date(clock).toISOString(),universeSize:items.length,
  stocks:items.map(x=>toStock(x)),pages:1};
}
test('f124 is an optional raw supplier timestamp: never derived from request date',()=>{
 const fresh=toStock(record('000001',sec(asOf-5000)));
 const noTime=toStock(record('000002',undefined));
 assert.equal(fresh.vendorQuoteAt,asOf-5000);
 assert.equal(noTime.vendorQuoteAt,null);
 for(const invalid of [null,0,'',false,[],{},'1790000000000',1790000000000,'not-a-time'])
  assert.equal(sourceQuoteTimeSeconds(invalid),null);
 assert.equal(sourceQuoteTimeSeconds(String(sec(asOf-5000))),asOf-5000);
});
test('supplier timestamps separately classify recent, stale, historical, future and missing observations',()=>{
 const row=vendorQuoteAt=>({vendorQuoteAt});
 const options={requestDate:day,retrievedAt:asOf,maxAgeMs:90000};
 for(const [at,status] of [
  [asOf-5000,'recent-source-unverified'],
  [asOf-90000,'recent-source-unverified'],
  [asOf-90001,'stale-source-time'],
  [asOf-86400000,'historical-snapshot'],
  [asOf+1000,'future'],
  [null,'unknown']
 ]) {
  const result=classifyQuoteTime(row(at),options);
  assert.equal(result.quoteTimeStatus,status);
  assert.equal(result.canTrade,false);
  assert.equal(result.exchangeVerified,false);
 }
 assert.throws(()=>classifyQuoteTime(row(asOf),{...options,retrievedAt:NaN}),/时钟/);
});
test('request-day labels cannot replace missing provider quote date in candidate intersection',()=>{
 const src=snapshot([record('000001',undefined),record('000002',sec(asOf-60000))]);
 const result=joinObservedCandidates(src,{usable:true},[
  {code:'000001',name:'缺少源时间',finalScore:80},
  {code:'000002',name:'源时间存在',finalScore:78}
 ],{asOf});
 assert.equal(result.items.length,2);
 assert.equal(result.items[0].requestDate,day);
 assert.equal(result.items[0].quoteDate,null);
 assert.equal(result.items[0].quoteAt,null);
 assert.equal(result.items[0].quoteTimeStatus,'unknown');
 assert.equal(result.items[1].quoteDate,day);
 assert.equal(result.items[1].quoteTimeStatus,'recent-source-unverified');
 assert.equal(result.quoteTimeReadyCount,1);
 assert.equal(result.items[0].candidateScore,80);
 assert.equal(result.rankingModified,false);
});
test('old server retrieval date is not considered an original vendor quote timestamp',()=>{
 const src=snapshot([record('000001',sec(asOf-86400000))]);
 const result=joinObservedCandidates(src,{usable:true},[{code:'000001',finalScore:77}],{asOf});
 assert.equal(result.items[0].quoteDate,'2026-11-05');
 assert.equal(result.items[0].requestDate,'2026-11-06');
 assert.equal(result.items[0].quoteTimeStatus,'historical-snapshot');
 assert.equal(result.items[0].quoteTimeVerified,false);
});
test('research pipeline rejects false evidence-ready without recent original provider time',async()=>{
 const src=snapshot([record('000001',undefined),record('000002',sec(asOf-5000))]);
 const candidates=[{code:'000001',name:'未知时间',finalScore:90},
   {code:'000002',name:'来源近期',finalScore:75}];
 const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
 const r=await researchLiveMarket({now:asOf,fetchSnapshot:async()=>src,candidates,
  scores,scoreSource:'independent-market-source',scoreDate:day});
 assert.equal(r.regime.usable,true);
 assert.equal(r.breadth.usable,true);
 assert.equal(r.verifiedLive,false);
 assert.equal(r.candidateIntersection.matched,2);
 assert.equal(r.quoteTimeAudit.recentSourceTimeCount,1);
 assert.equal(r.quoteTimeAudit.unknownSourceTimeCount,1);
 assert.equal(r.riskEvidence.items[0].riskStatus,'unknown');
 assert.equal(r.riskEvidence.items[0].evidenceReady,false);
 assert.match(r.riskEvidence.items[0].reason,/原始|供应商/);
 assert.equal(r.riskEvidence.items[1].riskStatus,'research-only');
 assert.equal(r.riskEvidence.items[1].evidenceReady,true);
 assert.equal(r.riskEvidence.items[1].canTrade,false);
 assert.deepEqual(candidates.map(x=>x.finalScore),[90,75]);
});
test('explicit ST risk always blocks even when original source time is recent',()=>{
 const src=snapshot([record('000001',sec(asOf))]);
 const intersection=joinObservedCandidates(src,{usable:true},[{code:'000001',finalScore:95}],{asOf});
 const r=assessCandidateEvidence(src,{usable:true},{usable:true},[
  {code:'000001',finalScore:95,isST:true}],intersection,{requireOriginalQuoteTime:true});
 assert.equal(r.items[0].riskStatus,'blocked');
 assert.equal(r.items[0].evidenceReady,false);
});
test('snapshot fetch requests source time, but missing field stays null and no synthetic quote date',async()=>{
 const payload=JSON.stringify({data:{total:1,diff:[record('000001',undefined)]}});
 let url;
 const s=await fetchEastmoneySnapshot({fetchImpl:async endpoint=>{url=endpoint;return new Response(payload)},
  now:asOf,clock:()=>asOf,pageSize:1,maxPages:1});
 assert.ok(new URL(url).searchParams.get('fields').split(',').includes('f124'));
 assert.equal(s.date,day);
 assert.equal(s.stocks[0].vendorQuoteAt,null);
 const report=auditSnapshotQuoteTimes(s,{asOf});
 assert.equal(report.unknownSourceTimeCount,1);
 assert.equal(report.recentSourceTimeCount,0);
 assert.equal(report.quoteTimeVerified,false);
 assert.equal(report.canTrade,false);
});
