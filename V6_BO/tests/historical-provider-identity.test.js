'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const {adaptCachedKline}=require('../src/strategy/cached-kline-adapter');
const now=Date.UTC(2026,10,5,12);
const rows=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:100}));
test('rejects mismatched provider symbol before invoking adapter',async()=>{
 let adapted=0;
 const r=await refreshHistorical({codes:['000001'],now,fetchKline:async()=>({code:'000002',rows}),
 adapt:()=>{adapted++;return {stock:{}};}});
 assert.equal(r.success,0);assert.equal(adapted,0);
 assert.match(r.items[0].error,/股票代码/);
});
test('mismatched primary data falls back to authorized matching provider',async()=>{
 const r=await refreshHistorical({codes:['000001'],now,fetchKline:async()=>({symbol:'000002',rows}),
 authorizedFallbacks:[{authorized:true,name:'licensed',fetchKline:async()=>({symbol:'000001',rows})}],
 adapt:adaptCachedKline});
 assert.equal(r.success,1);assert.equal(r.items[0].provider,'licensed');
 assert.deepEqual(r.items[0].attempts.map(x=>x.ok),[false,true]);
});
test('rejects tomorrow date bar even if under 24 hours ahead',()=>{
 const rows2=rows.map((r,i)=>i===29?{...r,date:'2026-11-06'}:r);
 assert.equal(adaptCachedKline('000001',{rows:rows2},{now,cachedAt:now}).stock,null);
});
test('accepts current UTC date bar when ordered',()=>{
 const rows2=rows.map((r,i)=>i===29?{...r,date:'2026-11-05'}:r);
 assert.ok(adaptCachedKline('000001',{rows:rows2},{now,cachedAt:now}).stock);
});
