'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const capturedAt=Date.parse('2025-02-10T08:00:00Z'),clock=()=>Date.parse('2026-11-15T00:00:00Z');
function sample(provider){
 return {source:'imported',provider,datasetId:'test-historical-1',asOf:dates.at(-1),
  observedAt:capturedAt,priceAdjustment:{mode:'unadjusted',provider},
  volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
  stocks:[{code:'600000',bars:dates.map(date=>({date,open:10,high:11,low:9,
   close:10,volume:10000,amount:100000,suspended:false}))}]};
}
const response=x=>({ok:true,status:200,headers:{get:()=>null},
 body:Readable.from([Buffer.from(JSON.stringify(x))])});
function centerFor(t,primary,secondary){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-evidence-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputFile=path.join(dir,'history.json'),secondaryFile=path.join(dir,'secondary.json');
 fs.writeFileSync(secondaryFile,JSON.stringify(secondary));
 const center=createMarketDataCenter({url:'https://data.example.org/history',
  outputFile,secondaryFile,provider:primary.provider,datasetId:primary.datasetId,
  clock,fetchImpl:async()=>response(primary)});
 return {center,outputFile,secondaryFile};
}
test('known distinct upstream, aligned captures and complete units enable RESEARCH history only',async t=>{
 const a=sample('eastmoney-public-history'),b=sample('baostock');
 const comparison=compareMarketFeeds(a,b);
 assert.equal(comparison.consensus,true);
 assert.equal(comparison.evidenceQuality.status,'consistent-research-only');
 assert.equal(comparison.evidenceQuality.evidenceCompletenessScore,85);
 assert.equal(comparison.evidenceQuality.canTrade,false);
 assert.equal(comparison.evidenceQuality.independentlyVerified,false);
 assert.deepEqual(comparison.bySymbol,[{symbol:'600000',comparedBars:40,discrepancies:0,fields:[]}]);
 const {center,outputFile}=centerFor(t,a,b);
 const result=await center.sync();
 assert.equal(result.updated,true,result.error);
 assert.equal(result.consensus.evidenceQuality.status,'consistent-research-only');
 assert.equal(center.status().verifiedLive,false);
 assert.equal(center.status().canTrade,false);
 assert.ok(fs.existsSync(outputFile));
});
test('two differently labeled wrappers of Eastmoney are one upstream and never import',async t=>{
 const a=sample('eastmoney-public-history'),b=sample('efinance');
 assert.throws(()=>compareMarketFeeds(a,b),/同一原始上游/);
 const {center,outputFile}=centerFor(t,a,b);
 assert.match((await center.sync()).error,/同一原始上游/);
 assert.equal(fs.existsSync(outputFile),false);
});
test('unknown provider labels cannot turn two identical datasets into trusted import',async t=>{
 const a=sample('provider-A'),b=sample('provider-B'),comparison=compareMarketFeeds(a,b);
 assert.equal(comparison.consensus,true,'legacy comparison is still a research-only number comparison');
 assert.equal(comparison.upstreamIdentityCatalogued,false);
 assert.equal(comparison.evidenceQuality.status,'incomplete-evidence');
 const {center,outputFile}=centerFor(t,a,b);
 assert.match((await center.sync()).error,/证据不足/);
 assert.equal(fs.existsSync(outputFile),false);
});
test('declared missing units, amount rows or observedAt block strict import',async t=>{
 const base=sample('eastmoney-public-history'),other=sample('baostock');
 const cases=[
  b=>{delete b.volumeUnit},
  b=>{delete b.amountUnit},
  b=>{delete b.stocks[0].bars[10].amount},
  b=>{delete b.observedAt}
 ];
 for(const mutate of cases){
  const a=structuredClone(base),b=structuredClone(other);mutate(b);
  const {center,outputFile}=centerFor(t,a,b);
  assert.ok((await center.sync()).error);
  assert.equal(fs.existsSync(outputFile),false);
 }
});
test('an untrusted fresh update leaves previous history bytes unchanged',async t=>{
 const a=sample('eastmoney-public-history'),b=sample('baostock');
 const {center,outputFile,secondaryFile}=centerFor(t,a,b);
 assert.equal((await center.sync()).updated,true);
 const before=fs.readFileSync(outputFile,'utf8');
 b.stocks[0].bars[5].amount*=1000;
 fs.writeFileSync(secondaryFile,JSON.stringify(b));
 assert.match((await center.sync()).error,/不一致/);
 assert.equal(fs.readFileSync(outputFile,'utf8'),before);
});
test('conflicting stop-trading flags, even with identical prices, are audited per symbol',()=>{
 const a=sample('eastmoney-public-history'),b=sample('baostock');
 b.stocks[0].bars[3].suspended=true;
 const r=compareMarketFeeds(a,b);
 assert.equal(r.consensus,false);
 assert.equal(r.evidenceQuality.status,'quarantined-conflict');
 assert.equal(r.bySymbol[0].discrepancies,2);
 assert.ok(r.bySymbol[0].fields.includes('suspension-status'));
 assert.ok(r.bySymbol[0].fields.includes('suspension-volume-integrity'));
 assert.equal(r.displayedDiscrepancies[0].date,dates[3]);
});
test('missing only one side suspension evidence never means confirmed not suspended',()=>{
 const a=sample('eastmoney-public-history'),b=sample('baostock');
 delete b.stocks[0].bars[0].suspended;
 const r=compareMarketFeeds(a,b);
 assert.equal(r.consensus,false);
 assert.equal(r.displayedDiscrepancies[0].field,'suspension-coverage');
});
test('future capture time cannot bypass strict importer even if two snapshots agree',async t=>{
 const a=sample('eastmoney-public-history'),b=sample('baostock');
 a.observedAt=b.observedAt=clock()+1000;
 const {center,outputFile}=centerFor(t,a,b);
 assert.match((await center.sync()).error,/未来/);
 assert.equal(fs.existsSync(outputFile),false);
});

test('changing a native publisher declaration cannot split the catalogued original feed',()=>{
 const a=sample('eastmoney'),b=sample('efinance');
 a.upstreamGroup='invented-other-seller';
 assert.throws(()=>compareMarketFeeds(a,b),/同一原始上游/);
});
