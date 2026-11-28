'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {investigateKnownNews}=require('../src/core/index-window-research');
const T=Date.parse('2026-11-10T02:00:00Z');
const event={baseAt:T,quoteAt:T+60000,detectedAt:T+61000};
const row={publishedAt:T+1000,receivedAt:T+2000,newsEvidence:{recordedAt:T+3000,eventHash:'a'.repeat(64)}};
const read=(e=event,r=row)=>investigateKnownNews(e,{goodAll:[r],badAll:[r]});
test('same-window news with ordered original receipt and archive is only a de-duplicated reference',()=>{
 const q=read();assert.deepEqual(q.evidenceHashes,['a'.repeat(64)]);assert.equal(q.inspected,2);
});
test('a cached reference archived before its stated receipt cannot establish contemporaneous evidence',()=>{
 const q=read(event,{...row,newsEvidence:{...row.newsEvidence,recordedAt:T+1500}});
 assert.deepEqual(q.evidenceHashes,[]);
});
test('malformed or reversed market-event clocks withhold the entire investigation',()=>{
 for(const e of [null,{}, {...event,baseAt:NaN},{...event,baseAt:event.quoteAt+1},{...event,detectedAt:event.quoteAt-1},{...event,quoteAt:String(event.quoteAt)}]){
  assert.deepEqual(investigateKnownNews(e,{goodAll:[row]}),{status:'unavailable'});
 }
});
test('receipt or archive after discovery cannot be backfilled, and an earlier public date is not enough',()=>{
 for(const patch of [{receivedAt:event.detectedAt+1},{publishedAt:event.baseAt-1},{newsEvidence:{...row.newsEvidence,recordedAt:event.detectedAt+1}}])
  assert.deepEqual(read(event,{...row,...patch}).evidenceHashes,[]);
});
test('source-time boundary permits exact receipt/archive equality without asserting causal attribution',()=>{
 const r={...row,publishedAt:event.quoteAt,receivedAt:event.detectedAt,newsEvidence:{...row.newsEvidence,recordedAt:event.detectedAt}};
 assert.deepEqual(read(event,r).evidenceHashes,['a'.repeat(64)]);
});
