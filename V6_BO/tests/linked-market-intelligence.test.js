'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildLinkedIntelligence,publicContextView}=require('../src/core/linked-market-intelligence');
const {runLinkedIntelligenceJob}=require('../src/server/linked-intelligence-job');
const {readStockMemory}=require('../src/core/stock-intelligence-memory');
function fixture(){
 const dates=Array.from({length:85},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
 const bars=dates.slice(0,84).map((date,i)=>({date,open:10+i*.03,high:10.1+i*.03,low:9.9+i*.03,close:10.04+i*.03,volume:10000,amount:100000000,
  knownAt:Date.parse(date+'T15:01:00+08:00'),statusKnownAt:date+'T09:00:00+08:00',tradable:true,suspended:false,isST:false,corporateAction:false}));
 const asOf=Date.parse(dates[83]+'T16:00:00+08:00');
 return {schemaVersion:1,asOf,tradeDates:dates,stocks:[{symbol:'600001',name:'样本',source:'fixture',priceBasis:'unadjusted',observedAt:asOf,bars}]};
}
function context(f){return {source:'eastmoney',tradeDate:f.stocks[0].bars.at(-1).date,retrievedAt:f.asOf,
 stockFlow:{source:'eastmoney',symbol:'600001',fundsMethod:'vendor-order-size-estimate',retrievedAt:f.asOf,
 records:[{tradeDate:f.stocks[0].bars.at(-1).date,mainNetInflow:0}]}};}
test('connector preserves stock order, original unknown domains and empirical forecasts without promoting',()=>{
 const f=fixture(),r=buildLinkedIntelligence(f);assert.equal(r.stocks[0].symbol,'600001');assert.ok(r.stocks[0].forecast.direction.samples>=20);
 assert.equal(r.stocks[0].forecast.limitUp.probability,null);assert.equal(r.marketContext.status,'unknown');assert.equal(r.sectorRelations.status,'unknown');
 assert.equal(r.stocks[0].patternStudy.prospective,false);assert.equal(r.stocks[0].patternStudy.canTrade,false);
 assert.equal(r.stocks[0].conditions.find(c=>c.id==='market-breadth').status,'unknown');
 assert.equal(r.productionWeightsChanged,false);assert.equal(r.canTrade,false);assert.equal(r.autoPromotion,false);
});
test('zero is known outflow condition false; missing/wrong stock/future source evidence remain unknown',()=>{
 const f=fixture();f.publicContext=context(f);
 const condition=()=>buildLinkedIntelligence(f).stocks[0].conditions.find(c=>c.id==='observed-stock-flow');
 assert.equal(condition().status,'not_met');f.publicContext.stockFlow.records[0].mainNetInflow=4;assert.equal(condition().status,'met');
 f.publicContext.stockFlow.symbol='600002';assert.equal(condition().status,'unknown');f.publicContext.stockFlow.symbol='600001';
 f.publicContext.stockFlow.retrievedAt=f.asOf+1;assert.equal(condition().status,'unknown');f.publicContext.stockFlow.retrievedAt=f.asOf;
 f.publicContext.stockFlow.records.push({...f.publicContext.stockFlow.records[0]});assert.equal(condition().status,'unknown');
});
test('untrusted public metadata is projected and pool ratios require actual disjoint complete rows',()=>{
 const f=fixture(),c=context(f),date=c.tradeDate;
 c.canTrade=true;c.stockFlow.canTrade=true;c.stockFlow.status='verified';
 c.limitPools={sealRate:1,status:'verified',sealed:{tradeDate:date,totalCount:1,complete:true,partial:false,records:[{symbol:'600001'}]},broken:{tradeDate:date,totalCount:1,complete:true,partial:false,records:[{symbol:'600002'}]}};
 let out=publicContextView(c,f.asOf);assert.equal(out.funds.stock.canTrade,false);assert.equal(out.funds.stock.status,'observed-unverified');assert.equal(out.sentiment.sealRate,.5);
 c.limitPools.broken.records[0].symbol='600001';assert.equal(publicContextView(c,f.asOf).sentiment.sealRate,null);
 c.limitPools.broken.records[0].symbol='600002';c.limitPools.broken.partial=true;assert.equal(publicContextView(c,f.asOf).sentiment.sealRate,null);
 c.stockFlow.sourceTimestamp=f.asOf+100;assert.equal(publicContextView(c,f.asOf).funds.stock,null);
 c.retrievedAt=f.asOf+100;assert.equal(publicContextView(c,f.asOf).status,'unknown');
});
test('explicit persistence stores full raw history and causal context without changing forecasts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'linked-intelligence-'));
 try{const f=fixture(),before=buildLinkedIntelligence(f);f.persist=true;
  const result=buildLinkedIntelligence(f,{memoryRoot:root});assert.equal(result.stocks[0].memory.status,'saved');
  assert.equal(readStockMemory(root,'600001').totalRevisions,1);assert.equal(readStockMemory(root,'600001').revisions[0].stock.bars.length,84);
  assert.deepEqual(result.stocks[0].forecast,before.stocks[0].forecast);
  assert.equal(buildLinkedIntelligence(f,{memoryRoot:root}).stocks[0].memory.reused,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('invalid duplicate symbols and worker invalid inputs fail without publishing memory',async()=>{
 const f=fixture();f.stocks.push(structuredClone(f.stocks[0]));assert.throws(()=>buildLinkedIntelligence(f),/唯一/);
 const r=await runLinkedIntelligenceJob({schemaVersion:1});assert.equal(r.ok,false);
});
