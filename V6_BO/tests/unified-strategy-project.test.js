'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:32,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
test('one project produces native evidence, research ranking, ledger and risk gate',()=>{
 const r=runUnifiedStrategyProject(history);assert.equal(r.canTrade,false);
 assert.equal(r.native.details.length,40);assert.ok(Array.isArray(r.ranking));
 assert.ok(r.paper.metrics);assert.equal(r.coverage.python.unknown,40);
 assert.equal(r.native.replay.windows.outOfSample.systems.python.paperTrades,0);
 assert.equal(r.gate.eligible,false);
});
test('unified project rejects future-dated snapshot evidence',()=>{
 assert.throws(()=>runUnifiedStrategyProject(history,{snapshots:{[`000001/${dates[20]}`]:{symbol:'000001',observedThrough:dates[21]}}}),/快照/);
});
