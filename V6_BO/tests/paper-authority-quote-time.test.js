'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const epoch=Date.parse('2026-11-06T02:00:00Z');
function setup(){
 let now=epoch;
 const c={S:{stocks:[],stocksAt:epoch,lastPx:new Map(),candidatePool:[],trendPool:[]},Map,Date:{now:()=>now},limitPctOfCode:()=>.1,require:require('node:module').createRequire(require.resolve('../server.js'))};
 vm.createContext(c);
 const a=source.indexOf('function paperAuthorityQuotes()'),b=source.indexOf('refreshPaperAuthority();',a);
 vm.runInContext(source.slice(a,b),c);
 const x=source.indexOf('function ingestPx(rows)'),y=source.indexOf('function paperEquity(key, pm)',x);
 vm.runInContext(source.slice(x,y),c);
 const row={code:'600519',price:10,preClose:10,volume:100000,quoteSource:'tencent',quoteAt:epoch-1000,receivedAt:epoch,canTrade:true};
 return {c,row,clock:t=>{now=t;}};
}
test('authority stores provider time and source, never the later receive time',()=>{
 const {c,row}=setup();c.S.stocks=[row];c.ingestPx([row]);
 const q=c.paperAuthorityQuotes()['600519'];
 assert.equal(q.timestamp,row.quoteAt);assert.equal(q.quoteAt,row.quoteAt);assert.equal(q.quoteSource,'tencent');
 assert.equal(q.riskContext.observedAt,row.quoteAt);assert.equal(q.riskContext.marks['600519'],10);
 assert.equal(q.tradeDate,'2026-11-06');assert.notEqual(q.timestamp,c.S.lastPx.get('600519').t);
});
test('authority rejects stale, missing, future, fractional and read-only full-A observations',()=>{
 for(const patch of [{quoteAt:epoch-15001},{quoteAt:undefined},{quoteAt:epoch+1},{quoteAt:epoch-.5},{quoteAt:0},{quoteSource:''},{quoteSource:' '},{quoteSource:{}},{canTrade:false},{price:Infinity}]){
  const {c,row}=setup();c.S.stocks=[{...row,...patch}];
  assert.equal(Object.keys(c.paperAuthorityQuotes()).length,0,JSON.stringify(patch));
 }
});
test('fresh receive time cannot revive stale cache or risk marks; holdings outside full-A retain fresh marks',()=>{
 const {c,row}=setup();c.S.stocks=[{...row,quoteAt:epoch-20000}];
 c.S.lastPx.set('600519',{p:11,t:epoch,quoteAt:epoch-20000,quoteSource:'tencent'});
 c.S.lastPx.set('000001',{p:9,t:epoch,quoteAt:epoch-500,quoteSource:'tencent'});
 c.S.stocks.push({...row,code:'600000'});
 const q=c.paperAuthorityQuotes();assert.equal(q['600519'],undefined);
 assert.equal(q['600000'].riskContext.marks['600519'],undefined);
 assert.equal(q['600000'].riskContext.marks['000001'],9);
});
test('authority and execution expire together at provider 15-second boundary',()=>{
 const {c,row,clock}=setup();row.quoteAt=epoch;c.S.stocks=[row];c.ingestPx([row]);
 clock(epoch+15000);assert.equal(c.paperAuthorityQuotes()['600519'].price,10);assert.equal(c.paperPxFresh('600519'),10);
 clock(epoch+15001);assert.equal(c.paperAuthorityQuotes()['600519'],undefined);assert.equal(c.paperPxFresh('600519'),0);
});
test('stale cache falls back only to a fresh full-A original observation',()=>{
 const {c,row}=setup();c.S.stocks=[row];c.S.lastPx.set('600519',{p:8,t:epoch,quoteAt:epoch-16000,quoteSource:'tencent'});
 const q=c.paperAuthorityQuotes()['600519'];assert.equal(q.price,10);assert.equal(q.timestamp,row.quoteAt);
});
test('execution ingestion and full-A fallback reject infinite price or malformed provenance',()=>{
 for(const patch of [{price:Infinity},{price:'Infinity'},{quoteSource:' '},{quoteSource:{}},{quoteAt:0}]){
  const {c,row}=setup();c.S.stocks=[{...row,...patch}];c.ingestPx(c.S.stocks);
  assert.equal(c.S.lastPx.size,0);assert.equal(c.paperPxFresh(row.code),0);
 }
});
