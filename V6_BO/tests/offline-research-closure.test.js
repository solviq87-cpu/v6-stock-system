'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {runOfflineResearchClosure}=require('../src/core/offline-research-closure');
function fixture(){return {source:'fixture',asOf:'2026-11-05',splitDay:35,stocks:[{code:'000001',market:'main',name:'示例A',bars:Array.from({length:70},(_,i)=>{const p=10+i*.03;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.3,low:p-.2,close:p+.1,volume:10000};})}]};}
test('offline end-to-end creates ranked research and ledger metrics without trading authorization',()=>{
 const r=runOfflineResearchClosure(fixture());
 assert.equal(r.mode,'offline-research-only');assert.equal(r.canTrade,false);
 assert.equal(r.verifiedLive,false);assert.equal(r.ranking.length,1);
 assert.equal(r.ranking[0].code,'000001');assert.equal(r.ranking[0].executable,false);
 assert.ok(r.backtest.metrics);assert.equal(r.paper.mode,'offline-paper-replay');assert.ok(r.paper.equity.length);assert.equal(r.gate.eligible,false);
 assert.match(r.fingerprint,/^[a-f0-9]{64}$/);
});
test('identical dataset produces identical fingerprint and research rank',()=>{
 const d=fixture(),a=runOfflineResearchClosure(d),b=runOfflineResearchClosure(d);
 assert.equal(a.fingerprint,b.fingerprint);assert.deepEqual(a.ranking,b.ranking);
});
test('bad OHLCV cannot enter the research pipeline',()=>{
 const d=fixture();d.stocks[0].bars[3].high=0;
 assert.throws(()=>runOfflineResearchClosure(d),/OHLCV/);
});
test('missing source cannot be presented as verified live',()=>{
 const d=fixture();delete d.source;
 assert.throws(()=>runOfflineResearchClosure(d),/来源/);
});
