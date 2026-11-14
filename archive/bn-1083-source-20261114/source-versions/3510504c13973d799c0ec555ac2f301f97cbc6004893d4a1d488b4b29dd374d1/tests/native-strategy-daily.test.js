'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:32,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
test('native daily evaluates each date with prefix only, no fabricated Python or GPT results',()=>{
 const r=runNativeDaily(history,{splitDay:32});assert.equal(r.details.length,40);assert.equal(r.coverage.python.unknown,40);assert.equal(r.coverage.gpt.unknown,40);
 assert.equal(r.replay.systems.python.paperTrades,0);assert.equal(r.canTrade,false);
 assert.equal(r.replay.windows.outOfSample.systems.python.meanNetReturnPct,null);
});
test('native daily has reproducible provenance and no forward leakage from later bars',()=>{
 const r=runNativeDaily(history,{splitDay:32});const h=structuredClone(history);h.stocks[0].bars[39].close+=.5;
 const t=runNativeDaily(h,{splitDay:32});assert.deepEqual(r.details.slice(0,39),t.details.slice(0,39));
 assert.equal(r.replay.windows.inSample.systems.gpt.paperTrades,0);
});
test('rejects snapshot observed after signal date or for another stock',()=>{
 assert.throws(()=>runNativeDaily(history,{snapshots:{[`000001/${dates[20]}`]:{symbol:'000001',observedThrough:dates[21]}}}),/快照/);
 assert.throws(()=>runNativeDaily(history,{snapshots:{[`000001/${dates[20]}`]:{symbol:'000002',observedThrough:dates[20]}}}),/快照/);
});
test('missing GPT factor fields never become zero or fake research pass',()=>{
 const snapshots={[`000001/${dates[38]}`]:{symbol:'000001',observedThrough:dates[38],gptSnapshotObservedThrough:dates[38],gptSnapshot:{trendScore:99}}};
 const r=runNativeDaily(history,{snapshots});assert.equal(r.details[38].results.gpt.verdict,'unknown');
 assert.match(r.details[38].results.gpt.reason,/缺少完整/);
});
