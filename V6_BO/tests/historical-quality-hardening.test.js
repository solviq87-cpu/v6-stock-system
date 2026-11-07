'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {adaptCachedKline,validTradingDate}=require('../src/strategy/cached-kline-adapter');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const now=Date.now();
const bars=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:100}));
const adapt=(code,k)=>adaptCachedKline(code,k,{cachedAt:now,now});
test('rejects impossible calendar dates, including leap-day errors',()=>{
 assert.equal(validTradingDate('2026-02-29'),false);
 assert.equal(validTradingDate('2024-02-29'),true);
 assert.equal(validTradingDate('2026-13-01'),false);
 assert.equal(adapt('000001',{rows:bars.map((x,i)=>i===5?{...x,date:'2026-02-29'}:x)}).stock,null);
});
test('rejects OHLC with high below low',()=>{
 const rows=bars.map((x,i)=>i===3?{...x,high:8,low:9,open:8,close:8}:x);
 assert.equal(adapt('000001',{rows}).stock,null);
});
test('historical refresh audits fallback attempts and source',async()=>{
 const r=await refreshHistorical({codes:['000001'],now,adapt,
  fetchKline:async()=>{throw Error('primary offline')},
  authorizedFallbacks:[{authorized:true,name:'licensed',fetchKline:async()=>({rows:bars})}]});
 assert.equal(r.success,1);
 assert.equal(r.items[0].provider,'licensed');
 assert.deepEqual(r.items[0].attempts.map(x=>x.ok),[false,true]);
 assert.equal(r.verifiedLive,false);
});
test('historical refresh records all failed attempts',async()=>{
 const r=await refreshHistorical({codes:['000001'],now,adapt,fetchKline:async()=>({rows:[]})});
 assert.equal(r.success,0);
 assert.equal(r.items[0].attempts.length,1);
 assert.match(r.items[0].attempts[0].error,/供应商/);
});
