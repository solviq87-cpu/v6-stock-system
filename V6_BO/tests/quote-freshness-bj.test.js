'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('old primary success falls through per symbol to a fresh secondary quote',async()=>{
 const source=fs.readFileSync(require.resolve('../em.js'),'utf8'),start=source.indexOf('async function fetchBatchSnapshot(codes)'),end=source.indexOf('async function fetchBatchSnapshotEM',start);
 const now=Date.parse('2026-11-13T10:00:00+08:00');class Clock extends Date{static now(){return now;}}
 const row=(code,quoteAt,quoteSource)=>({code,price:10,quoteAt,quoteSource,receivedAt:now,quoteFreshness:now-quoteAt>15000?'stale':'recent-unverified',canTrade:now-quoteAt<=15000});
 const calls=[];const c={Date:Clock,_srcWarn(){},fetchBatchSnapshotEM:async()=>[row('600519',now-60000,'eastmoney'),row('000001',now-1000,'eastmoney')],fetchBatchSnapshotTx:async codes=>{calls.push(codes);return [row('600519',now-1000,'tencent')]},require:()=>({photoQuoteFallback:()=>[]})};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 const rows=await c.fetchBatchSnapshot(['600519','000001']);assert.deepEqual(Array.from(rows,r=>r.code),['600519','000001']);assert.deepEqual(Array.from(calls[0]),['600519']);
});
test('Eastmoney batch rows reject unknown or old original timestamps',async()=>{
 const source=fs.readFileSync(require.resolve('../em.js'),'utf8'),start=source.indexOf('async function fetchBatchSnapshotEM(codes)'),end=source.indexOf('// 个股资金流历史',start),now=Date.now();
 const c={EM:'https://example.test',get:async()=>({data:{diff:[{f12:'600519',f2:10,f124:Math.floor((now-60000)/1000)}]}}),normalizeStock:d=>({code:d.f12,price:d.f2}),Date};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 let rows=await c.fetchBatchSnapshotEM(['600519']);assert.equal(rows[0].quoteFreshness,'stale');assert.equal(rows[0].canTrade,false);
 c.get=async()=>({data:{diff:[{f12:'600519',f2:10}]}});rows=await c.fetchBatchSnapshotEM(['600519']);assert.equal(rows[0].quoteFreshness,'unknown');assert.equal(rows[0].canTrade,false);
});
test('provider old, missing and future clocks never write or remain readable as fresh account prices',()=>{
 const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf('function ingestPx(rows)'),end=source.indexOf('// ⛔ 2026-10-28 补（用户「买卖都按正常 A 股逻辑」',start);
 let now=100000;const c={S:{lastPx:new Map(),stocks:[],trendPool:[],candidatePool:[]},Date:{now:()=>now},Map};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 c.ingestPx([{code:'600519',price:10,quoteSource:'tencent',quoteAt:now-60000},{code:'000001',price:11,quoteSource:'eastmoney'},{code:'600000',price:12,quoteSource:'tencent',quoteAt:now+1}]);assert.equal(c.S.lastPx.size,0);
 c.ingestPx([{code:'600519',price:10,quoteSource:'tencent',quoteAt:now-1000}]);assert.equal(c.paperPrices().get('600519'),10);
 now+=16000;assert.equal(c.paperPrices().has('600519'),false);
});
