'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf('function ingestPx(rows)'),end=source.indexOf('// ⛔ 2026-10-28 补（用户「买卖都按正常 A 股逻辑」',start);
const now=Date.parse('2026-11-13T10:00:00+08:00');
function harness(){const c={S:{lastPx:new Map(),stocks:[],trendPool:[],candidatePool:[]},Date:{now:()=>now},Map};c.require=c.require||require('node:module').createRequire(require.resolve('../server.js'));vm.createContext(c);vm.runInContext(source.slice(start,end),c);return c;}
const row=(patch={})=>({code:'600000',price:10,quoteSource:'tencent',quoteAt:now-1000,receivedAt:now-500,canTrade:true,...patch});
test('account cache rejects read-only, imported and synthetic rows even with a recent timestamp and canTrade true',()=>{
 for(const flag of ['readOnlyBackup','simulated','imported','fixture','mock','synthetic']){const c=harness();c.ingestPx([row({[flag]:true})]);assert.equal(c.S.lastPx.size,0,flag);}
});
test('account cache requires explicit executable permission, numeric price and causal receipt clocks',()=>{
 for(const patch of [{canTrade:undefined},{canTrade:null},{canTrade:'true'},{price:'10'},{receivedAt:undefined},{receivedAt:0},{receivedAt:now+1},{receivedAt:now-2000}]){
  const c=harness();c.ingestPx([row(patch)]);assert.equal(c.S.lastPx.size,0,JSON.stringify(patch));
 }
});
test('rejected cache rows cannot replace an existing good quote or make their price readable',()=>{
 const c=harness();c.ingestPx([row()]);c.ingestPx([row({price:999,quoteAt:now,receivedAt:now,readOnlyBackup:true})]);assert.equal(c.paperPrices().get('600000'),10);assert.equal(c.S.lastPx.get('600000').quoteAt,now-1000);
});
test('account cache accepts the exact 15 second boundary, rejects the next millisecond and preserves provider ordering',()=>{
 const c=harness();c.ingestPx([row({quoteAt:now-15000})]);assert.equal(c.paperPrices().get('600000'),10);
 const old=harness();old.ingestPx([row({quoteAt:now-15001})]);assert.equal(old.S.lastPx.size,0);
 c.ingestPx([row({price:11})]);c.ingestPx([row({price:12,quoteAt:now-2000})]);assert.equal(c.paperPrices().get('600000'),11);
});

test('account ingestion shares execution use exclusions for source modes, suspension and cross-date observations',()=>{
 for(const patch of [{quoteMode:'research-observation'},{quoteMode:'historical-bars'},{quoteSource:'mock:quote'},{suspended:true},{tradable:false}]){
  const c=harness();c.ingestPx([row(patch)]);assert.equal(c.S.lastPx.size,0,JSON.stringify(patch));
 }
 const midnight=Date.parse('2026-11-14T00:00:01+08:00'),c=harness();c.Date.now=()=>midnight;
 c.ingestPx([row({quoteAt:midnight-2000,receivedAt:midnight})]);assert.equal(c.S.lastPx.size,0);
});
