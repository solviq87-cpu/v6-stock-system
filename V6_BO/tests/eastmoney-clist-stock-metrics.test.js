'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchEastmoneySnapshot,toStock}=require('../src/core/eastmoney-market-snapshot');
const {auditSnapshotQuoteTimes}=require('../src/core/market-snapshot-quote-time');

test('bounded clist request includes optional stock indicators without replacing per-stock quote clocks',async()=>{
 const now=Date.parse('2026-11-09T07:00:00Z'); // Monday 15:00 Asia/Shanghai
 const requests=[];
 const rows=[
  {f12:'600519',f13:1,f14:'sample',f3:1.25,f2:1444.99,f5:1234,f6:12345678,
   f8:0.75,f20:123000000000,f62:-2300000,f184:-1.9,f124:now/1000-12},
  {f12:'000001',f13:0,f3:-0.5,f2:12.14,f5:4321,f6:201000,
   f8:2.1,f20:1000000000,f62:50000,f184:3.25,f124:now/1000-38}
 ];
 const fetchImpl=async url=>{
  requests.push(new URL(url));
  return {ok:true,json:async()=>({data:{total:2,diff:rows}})};
 };
 const result=await fetchEastmoneySnapshot({fetchImpl,pageSize:2,maxPages:1,now});
 assert.equal(requests.length,1);
 const q=requests[0].searchParams;
 assert.equal(q.get('fltt'),'2');
 for(const f of ['f2','f3','f5','f6','f8','f12','f13','f20','f62','f124','f184'])
  assert.ok(q.get('fields').split(',').includes(f),f);
 assert.equal(result.verifiedLive,false);
 assert.equal(result.retrievedAt,new Date(now).toISOString());
 assert.equal(result.stocks.length,2);
 const [a,b]=result.stocks;
 assert.equal(a.lastPriceYuan,1444.99);
 assert.equal(a.volumeHands,1234);
 assert.equal(a.turnoverPct,0.75);
 assert.equal(a.totalMarketCapYuan,123000000000);
 assert.equal(a.mainNetInflowYuan,-2300000);
 assert.equal(a.mainNetInflowPct,-1.9);
 assert.equal(a.vendorQuoteAt,now-12000);
 assert.equal(b.vendorQuoteAt,now-38000);
 assert.notEqual(a.vendorQuoteAt,b.vendorQuoteAt,
  'the batch retrieval clock must not replace either provider quote clock');
 assert.equal(b.mainNetInflowYuan,50000);
 const audit=auditSnapshotQuoteTimes(result,{asOf:now});
 assert.equal(audit.recentSourceTimeCount,2);
 assert.equal(audit.quoteTimeVerified,false);
 assert.equal(audit.canTrade,false);
});

test('missing, invalid and string-valued vendor indicators stay absent instead of becoming false zeros',()=>{
 const item={f12:'600519',f13:1,f3:1,f5:null,f6:null,f8:'-',
  f2:'',f20:'',f62:'not-a-number',f184:null,f124:'-'};
 const out=toStock(item);
 assert.equal(out.code,'600519');
 for(const key of ['lastPriceYuan','volumeHands','amount','turnoverPct',
  'totalMarketCapYuan','mainNetInflowYuan','mainNetInflowPct'])
  assert.equal(out[key],undefined,key);
 assert.equal(out.vendorQuoteAt,null);
 assert.doesNotMatch(JSON.stringify(out),/"amount":0|"mainNetInflowYuan":0/);
});

test('real vendor zero values survive; malformed indicators cannot silently enter stock signals',()=>{
 const fixed={f12:'000001',f13:0,f3:0,f2:0,f5:0,f6:0,f8:0,f20:0,f62:0,f184:0,f124:0};
 const out=toStock(fixed);
 for(const key of ['volumeHands','amount','turnoverPct',
  'totalMarketCapYuan','mainNetInflowYuan','mainNetInflowPct'])
  assert.equal(out[key],0,key);
 assert.equal(out.lastPriceYuan,undefined,'zero price is not a valid executable quote');
 assert.equal(out.vendorQuoteAt,null);
 const corrupted=toStock({...fixed,f5:1.5,f8:-1,f20:Infinity,f62:NaN,f184:2000});
 assert.equal(corrupted.volumeHands,undefined);
 assert.equal(corrupted.turnoverPct,undefined);
 assert.equal(corrupted.totalMarketCapYuan,undefined);
 assert.equal(corrupted.mainNetInflowYuan,undefined);
 assert.equal(corrupted.mainNetInflowPct,undefined);
});
