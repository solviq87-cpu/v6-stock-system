'use strict';
// Frozen public market-data samples observed 2026-11-10 around 13:47 China time.
// This only locks parser units and vendor timestamps; it cannot certify licensing,
// recurring availability, exchange freshness, or market-wide data quality.
const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../src/core/public-market');
const {fuseMultiSourcePrices}=require('../src/core/multi-source-price-consensus');
const code='600519';
const sampleTime=Date.parse('2026-11-10T13:47:50+08:00');
const eastmoneyRaw=JSON.stringify({rc:0,data:{
 f43:1440.03,f47:16477,f57:code,f60:1444.99,f86:1794289664
}});
const tencentFields=Array(31).fill('');
tencentFields[2]=code;
tencentFields[3]='1440.41';
tencentFields[4]='1444.99';
tencentFields[6]='16476';
tencentFields[30]='20261110134738';
const tencentRaw='v_sh600519="'+tencentFields.join('~')+'";';
function normalized(id,raw){
 const x=parse(id,raw,code);
 return {id,status:'fresh-unverified',quote:{...x,quoteAt:x.timestamp}};
}
test('Eastmoney fltt=2 f43/f60 are already quoted in CNY, no implicit 100x adjustment',()=>{
 const q=parse('eastmoney',eastmoneyRaw,code);
 assert.equal(q.price,1440.03);
 assert.equal(q.previousClose,1444.99);
 assert.equal(q.volume,1647700);
 assert.equal(q.timestamp,Date.parse('2026-11-10T13:47:44+08:00'));
 assert.equal(q.currency,'CNY');
});
test('Tencent share-volume, price and vendor-original timestamp are independently parsed',()=>{
 const q=parse('tencent',tencentRaw,code);
 assert.equal(q.price,1440.41);
 assert.equal(q.previousClose,1444.99);
 assert.equal(q.volume,1647600);
 assert.equal(q.timestamp,Date.parse('2026-11-10T13:47:38+08:00'));
});
test('actual 6-second vendor time gap is not silently collapsed to a single timestamp',()=>{
 const sources=[normalized('eastmoney',eastmoneyRaw),normalized('tencent',tencentRaw)];
 const strict=fuseMultiSourcePrices({code,now:sampleTime,sources});
 assert.equal(strict.status,'source-price-or-time-conflict');
 assert.equal(strict.referencePrice,null);
 const bounded=fuseMultiSourcePrices({code,now:sampleTime,sources,timeGapMs:10000});
 assert.equal(bounded.status,'sources-agree-unverified');
 assert.equal(bounded.referencePrice,1440.03);
 assert.equal(bounded.representativeProvider,'eastmoney');
 assert.equal(bounded.maxMatchedPreviousCloseGapBps,0);
 assert.equal(bounded.canTrade,false);
 assert.equal(bounded.certifiedLive,false);
});
test('wrong f43 unit is isolated as an outlier, not auto divided by 100',()=>{
 const raw=JSON.stringify({rc:0,data:{
  f43:144003,f47:16477,f57:code,f60:1444.99,f86:1794289664}});
 const r=fuseMultiSourcePrices({code,now:sampleTime,timeGapMs:10000,sources:[
  normalized('eastmoney',raw),normalized('tencent',tencentRaw)
 ]});
 assert.equal(r.referencePrice,null);
 assert.equal(r.status,'source-price-or-time-conflict');
});
