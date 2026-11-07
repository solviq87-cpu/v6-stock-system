'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {adaptCachedKline: adaptBase} = require('../src/strategy/cached-kline-adapter');
const {adaptCachedKline: adaptResearch} = require('../src/strategy/research-v2-cached-kline-adapter');
const {fetchEastmoneySnapshot, fetchEastmoneyBreadth} = require('../src/core/eastmoney-market-snapshot');
const {aShareCalendarAgeDays} = require('../src/core/a-share-calendar');

const start = Date.UTC(2026, 10, 4, 15, 59, 59);
const nextDay = Date.UTC(2026, 10, 4, 16, 0, 0);
const rows = () => Array.from({length:30},(_,i) => ({
 date:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),
 open:10, high:11, low:9, close:10, volume:1000
}));
const quote = n => ({f12:String(n).padStart(6, '0'), f13:0, f3:1.5, f6:100});
const response = (total,diff) => ({ok:true,json:async()=>({data:{total,diff}})});

test('two research K-line adapters reject empty, null, boolean or object OHLCV instead of coercing a false zero',()=>{
 for(const adapt of [adaptBase, adaptResearch]) {
  for(const field of ['open','high','low','close','volume']) {
   for(const bad of [null, '', ' ', false, true, [], {}]) {
    const data=rows(); data[3][field]=bad;
    assert.equal(adapt('000001',{rows:data},{cachedAt:nextDay,now:nextDay}).stock,null, `${field}:${JSON.stringify(bad)}`);
   }
  }
 }
});
test('numeric-string quote fields remain compatible when complete and finite',()=>{
 for(const adapt of [adaptBase,adaptResearch]) {
  const data=rows().map(b=>({...b,open:'10',high:'11',low:'9',close:'10',volume:'1000'}));
  assert.ok(adapt('000001',{rows:data},{cachedAt:nextDay,now:nextDay}).stock);
 }
});
test('paginated quote collection rejects crossing China-market midnight',async()=>{
 let n=0;
 const fetchImpl=async()=>response(4,n++===0?[quote(1),quote(2)]:[quote(3),quote(4)]);
 const clock=()=>n===1?start:nextDay;
 await assert.rejects(fetchEastmoneySnapshot({now:start,clock,fetchImpl,pageSize:2,maxPages:2}),/跨越.*日期|跨越.*交易日/);
});
test('paginated quote collection keeps completed sampling time separately from request start',async()=>{
 const finish=start+700;
 const result=await fetchEastmoneySnapshot({now:start,clock:()=>finish,fetchImpl:async()=>response(1,[quote(1)]),pageSize:1});
 assert.equal(result.date,'2026-11-04');
 assert.equal(result.retrievedAt,new Date(finish).toISOString());
 assert.equal(result.startedAt,new Date(start).toISOString());
 assert.equal(result.verifiedLive,false);
});
test('paginated quote collection rejects excessively long sampling even within same market day',async()=>{
 const finish=start-1000; // initial timestamp is near market midnight; older start is invalid
 await assert.rejects(fetchEastmoneySnapshot({now:start,clock:()=>finish,fetchImpl:async()=>response(1,[quote(1)])}),/时间.*倒退|时间.*无效/);
 const day=Date.UTC(2026,10,4,9);
 await assert.rejects(fetchEastmoneySnapshot({now:day,clock:()=>day+120001,fetchImpl:async()=>response(1,[quote(1)])}),/跨度|超过/);
});
test('market breadth does not certify unverified public quotes',async()=>{
 const r=await fetchEastmoneyBreadth({now:start,clock:()=>start+100,fetchImpl:async()=>response(1,[quote(1)]),pageSize:1});
 assert.equal(r.snapshotMetadata.verifiedLive,false);
 assert.equal(r.breadth.usable,true);
});

test('K-line calendar age is zero on the current China-market date even when UTC is yesterday',()=>{
 for(const adapt of [adaptBase,adaptResearch]) {
  const data=rows();data.at(-1).date='2026-11-05';
  const atMidnight=adapt('000001',{rows:data},{cachedAt:nextDay,now:nextDay});
  assert.match(atMidnight.error,/15:10/);
  assert.equal(aShareCalendarAgeDays('2026-11-05',nextDay),0);
  const tomorrow=Date.UTC(2026,10,5,16);
  const next=adapt('000001',{rows:data},{cachedAt:tomorrow,now:tomorrow});
  assert.equal(next.stock.dataAudit.barAgeDays,1);
 }
});
