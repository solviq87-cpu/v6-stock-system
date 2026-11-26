'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const days=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
const date=days.at(-1);
const at=Date.parse(date+'T15:15:00+08:00');
function feed(provider){
 return {source:'imported',provider,datasetId:'phase4-offline-probe',asOf:date,observedAt:at,
  priceAdjustment:{mode:'unadjusted',provider},volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
  stocks:[{code:'600000',bars:days.map(date=>({date,open:10,high:11,low:9,close:10,volume:10000,amount:100000,suspended:false}))}]};
}
function pair(){return [feed('eastmoney-public-history'),feed('baostock')]}
test('matching capture times cannot predate the declared historical observation date',()=>{
 for(const clock of [at-86400000,Number.MAX_SAFE_INTEGER]){
  const [a,b]=pair();a.observedAt=b.observedAt=clock;
  assert.throws(()=>compareMarketFeeds(a,b),/时点|时间戳/);
 }
 const [a,b]=pair();a.asOf=b.asOf='2025-02-11';
 assert.throws(()=>compareMarketFeeds(a,b),/时点/);
});
test('capture-date comparison uses the China calendar and does not rewrite historical bars',()=>{
 const [a,b]=pair();const t=Date.parse(date+'T00:00:00+08:00');
 a.observedAt=b.observedAt=t;
 assert.equal(compareMarketFeeds(a,b).consensus,true);
 b.observedAt=t-1;assert.throws(()=>compareMarketFeeds(a,b),/时点/);
});
test('nested shares, currency and turnover basis cannot contradict the dataset',()=>{
 for(const [target,field,value] of [['stock','volumeUnit','lots'],['bar','volumeUnit','hands'],
  ['bar','amountUnit','USD'],['stock','amountUnit','thousand-CNY'],['bar','amountBasis','adjusted-turnover']]){
  const [a,b]=pair();const row=target==='stock'?b.stocks[0]:b.stocks[0].bars[4];row[field]=value;
  assert.throws(()=>compareMarketFeeds(a,b),/元数据冲突/);
 }
});
test('nested declarations cannot create complete amount coverage without the original root contract',()=>{
 const [a,b]=pair();
 for(const d of [a,b]){
  delete d.amountUnit;delete d.amountBasis;
  for(const row of d.stocks[0].bars)delete row.amount;
 }
 b.stocks[0].bars[0].amountUnit='CNY';
 assert.throws(()=>compareMarketFeeds(a,b),/成交额必须都标明/);
});
test('price adjustment and security identity cannot hide behind matching OHLC',()=>{
 for(const patch of [{adjustment:'qfq'},{priceAdjustment:{mode:'hfq'}},{code:'600001'},{symbol:'600001'},
  {provider:'eastmoney-public-history'},{upstreamGroup:'eastmoney'}]){
  const [a,b]=pair();Object.assign(b.stocks[0].bars[4],patch);
  assert.throws(()=>compareMarketFeeds(a,b),/元数据冲突|复权元数据冲突|证券身份冲突|上游身份冲突/);
 }
 const [a,b]=pair();a.priceBasis='qfq';
 assert.throws(()=>compareMarketFeeds(a,b),/元数据冲突/);
});
test('nested captures must bound their dates and their parent observation times',()=>{
 for(const patch of [{observedAt:Date.parse(days[3]+'T15:00:00+08:00')},{observedAt:at+1},{observedAt:'invalid'}]){
  const [a,b]=pair();Object.assign(b.stocks[0].bars[4],patch);
  assert.throws(()=>compareMarketFeeds(a,b),/时点/);
 }
 const [a,b]=pair();b.stocks[0].observedAt=at-86400000;
 assert.throws(()=>compareMarketFeeds(a,b),/时点/);
});
test('zero versus positive activity remains a conflict at maximum numeric tolerance',()=>{
 const [a,b]=pair();const row=b.stocks[0].bars[4];row.volume=0;row.amount=0;
 const out=compareMarketFeeds(a,b,{volumeTolerancePct:100,amountTolerancePct:100});
 assert.equal(out.consensus,false);
 assert.equal(out.bySymbol[0].fields.includes('volume'),true);
 assert.equal(out.bySymbol[0].fields.includes('amount'),true);
 assert.equal(out.evidenceQuality.status,'quarantined-conflict');
});
test('legitimate nested metadata and zero observations remain comparable without trade permission',()=>{
 const [a,b]=pair();for(const d of [a,b]){
  Object.assign(d.stocks[0],{observedAt:at,volumeUnit:'shares',amountUnit:'CNY',priceBasis:'unadjusted'});
  Object.assign(d.stocks[0].bars[4],{observedAt:at,volume:0,amount:0,code:'600000',priceBasis:'unadjusted',volumeUnit:'shares'});
 }
 const out=compareMarketFeeds(a,b);assert.equal(out.consensus,true);assert.equal(out.evidenceQuality.evidenceCompletenessScore,85);
 assert.equal(out.canTrade,false);assert.equal(out.upstreamIndependenceVerified,false);
});
