'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const {createMarketDataCenter}=require('../src/core/market-data-center');
const dates=Array.from({length:39},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const feed=(provider)=>({source:'imported',provider,datasetId:'dataset-101',asOf:dates.at(-1),priceAdjustment:{mode:'qfq',provider},stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]});
const response=x=>({ok:true,status:200,headers:{get:()=>null},body:Readable.from([Buffer.from(JSON.stringify(x))])});
test('不同供应商相同日期、价格、成交量及复权口径通过独立一致性核对，但不误称已真实认证',()=>{
 const r=compareMarketFeeds(feed('provider-A'),feed('provider-B'));
 assert.equal(r.consensus,true);assert.equal(r.comparedBars,39);assert.equal(r.releaseReady,false);assert.equal(r.verifiedExternal,false);
 assert.equal(r.asOf,dates.at(-1),'consensus preserves declared data date, not local receipt time');
});
test('来源不是独立供应商、复权不一致或交易日不同直接拒绝',()=>{
 assert.throws(()=>compareMarketFeeds(feed('provider-A'),feed('provider-A')),/不同供应商/);
 const b=feed('provider-B');b.priceAdjustment.mode='hfq';assert.throws(()=>compareMarketFeeds(feed('provider-A'),b),/复权/);
 const c=feed('provider-B');c.stocks[0].bars[5].date='2020-01-01';assert.throws(()=>compareMarketFeeds(feed('provider-A'),c),/日期/);
});
test('多源发现价格和成交量偏差，逐项保留供审计的差异与来源指纹',()=>{
 const b=feed('provider-B');b.stocks[0].bars[10].close+=.2;b.stocks[0].bars[20].volume=9000;
 const r=compareMarketFeeds(feed('provider-A'),b);assert.equal(r.consensus,false);assert.equal(r.discrepancies,2);
 assert.ok(r.displayedDiscrepancies.some(x=>x.field==='close'));
 assert.ok(r.displayedDiscrepancies.some(x=>x.field==='volume'));
});
test('导入时可选多源核对，异常不覆盖已保存数据',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-consensus-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputFile=path.join(dir,'history.json'),secondaryFile=path.join(dir,'independent.json');
 const primary=feed('provider-A'),other=feed('provider-B');fs.writeFileSync(secondaryFile,JSON.stringify(other));
 const center=createMarketDataCenter({url:'https://data.example.org/history',outputFile,provider:'provider-A',datasetId:'dataset-101',secondaryFile,fetchImpl:async()=>response(primary)});
 assert.equal((await center.sync()).consensus.matched,true);
 const saved=fs.readFileSync(outputFile,'utf8');other.stocks[0].bars[10].close+=.2;fs.writeFileSync(secondaryFile,JSON.stringify(other));
 assert.match((await center.sync()).error,/不一致/);assert.equal(fs.readFileSync(outputFile,'utf8'),saved);
});

test('双源观察时钟一致性：时间差过大或只有一方带时间戳均拒绝',()=>{
 const a=feed('provider-A'),b=feed('provider-B');
 a.observedAt=Date.parse('2025-02-08T07:00:00Z');
 assert.throws(()=>compareMarketFeeds(a,b),/时间戳缺失/);
 b.observedAt=a.observedAt+300001;
 assert.throws(()=>compareMarketFeeds(a,b),/超过五分钟/);
 b.observedAt=a.observedAt+300000;
 const r=compareMarketFeeds(a,b);
 assert.equal(r.timestampComparable,true);
 assert.equal(r.observationSkewMs,300000);
 assert.equal(r.releaseReady,false);
});
test('双源未提供观察时间时不能误报时间已核对',()=>{
 const r=compareMarketFeeds(feed('provider-A'),feed('provider-B'));
 assert.equal(r.timestampComparable,false);
 assert.equal(r.observationSkewMs,null);
});
