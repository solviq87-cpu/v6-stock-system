'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateUpload}=require('../src/strategy/research-upload-validator');
const now=Date.parse('2026-11-05T08:00:00Z');
const bars=Array.from({length:27},()=>({open:10,high:11,low:9,close:10,volume:100}));
const payload={stocks:[{symbol:'000001',feed:{source:'imported',timestamp:now},bars}]};
test('rejects NaN, infinite, fractional and negative upload limits',()=>{
 for(const value of [NaN,Infinity,-1,0,1.5,'100',null]){
  assert.match(validateUpload(payload,{maxStocks:value,now}),/参数无效/);
  assert.match(validateUpload(payload,{maxBars:value,now}),/参数无效/);
 }
});
test('rejects invalid observation clocks rather than bypassing timestamp gate',()=>{
 for(const value of [NaN,Infinity,-Infinity,0,'2026-11-05',null])
  assert.match(validateUpload(payload,{now:value}),/参数无效/);
});
test('valid custom limits remain enforced',()=>{
 assert.equal(validateUpload(payload,{maxStocks:1,maxBars:27,now}),null);
 assert.match(validateUpload(payload,{maxStocks:1,maxBars:26,now}),/参数无效/);
 assert.equal(validateUpload(payload,{maxStocks:1,maxBars:28,now}),null);
});

test('rejects finite timestamps outside JavaScript date range',()=>{
 for(const value of [1e20,Number.MAX_VALUE]){
  assert.match(validateUpload(payload,{now:value}),/参数无效/);
  const invalid={stocks:[{...payload.stocks[0],feed:{source:'imported',timestamp:value}}]};
  assert.match(validateUpload(invalid,{now}),/时间戳非法/);
 }
});

test('rejects dated bars newer than the declared observation date',()=>{
 const dated=bars.map((bar,i)=>({...bar,date:`2026-10-${String(i+1).padStart(2,'0')}`}));
 const stock={...payload.stocks[0],bars:dated,feed:{source:'imported',timestamp:Date.parse('2026-10-20T08:00:00Z')}};
 assert.match(validateUpload({stocks:[stock]},{now}),/未来数据风险/);
 const valid={...stock,feed:{source:'imported',timestamp:Date.parse('2026-11-01T08:00:00Z')}};
 assert.equal(validateUpload({stocks:[valid]},{now}),null);
});
