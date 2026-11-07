'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayStrategyEvidence}=require('../src/core/strategy-evidence-replay');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),splitDay:35,stocks:[{code:'000001',bars:dates.map((date,i)=>({date,open:10+i*.1,high:11+i*.1,low:9+i*.1,close:10+i*.1,volume:10000}))}]};
const sig=(i,system='fourteen')=>({system,symbol:'000001',date:dates[i],observedThrough:dates[i],verdict:'pass',provenance:'native-test-fixture',evaluatorVersion:'v1'});
const bundle=signals=>({source:'test-fixture',generatedAt:'2026-11-05T00:00:00Z',signals});
test('separates in-sample and out-of-sample by execution dates, not signal date',()=>{const r=replayStrategyEvidence(history,bundle([sig(31),sig(33),sig(35,'gpt')]));assert.equal(r.windows.inSample.systems.fourteen.paperTrades,1);assert.equal(r.windows.unassigned.systems.fourteen.paperTrades,1);assert.equal(r.windows.outOfSample.systems.gpt.paperTrades,1);assert.equal(r.canTrade,false);});
test('refuses lookahead and missing observation cutoff',()=>{assert.throws(()=>replayStrategyEvidence(history,bundle([{...sig(32),observedThrough:dates[33]}])),/未来数据/);assert.throws(()=>replayStrategyEvidence(history,bundle([{...sig(32),observedThrough:undefined}])),/观察截止/);});
test('does not invent results for strategies without evidence',()=>{const r=replayStrategyEvidence(history,bundle([sig(32)]));assert.equal(r.systems.python.status,'not-evaluated');assert.equal(r.windows.outOfSample.systems.python.winRatePct,null);});
test('rejects duplicate native evidence and invalid split',()=>{assert.throws(()=>replayStrategyEvidence(history,bundle([sig(32),sig(32)])),/重复/);assert.throws(()=>replayStrategyEvidence(history,bundle([]),{splitDay:39}),/分割/);});

test('sample-window stats expose drawdown and label small samples as insufficient',()=>{
 const history={source:'fixture',asOf:'2026-02-10',stocks:[{code:'000001',market:'main',bars:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10+i*.01,high:10.5+i*.01,low:9.5+i*.01,close:10+i*.01,volume:10000}))}]};
 const dates=history.stocks[0].bars.map(x=>x.date);
 const signals=[{system:'fourteen',symbol:'000001',date:dates[5],verdict:'pass',provenance:'native-test',observedThrough:dates[5],evaluatorVersion:'test-v1'}];
 const result=replayStrategyEvidence(history,{source:'test',generatedAt:'2026-02-11T00:00:00Z',signals},{splitDay:20});
 const stat=result.windows.inSample.systems.fourteen;
 assert.equal(stat.status,'insufficient-sample');
 assert.equal(stat.paperTrades,1);
 assert.equal(typeof stat.maxDrawdownPct,'number');
 assert.equal(stat.metricsNote.includes('不作策略有效性结论'),true);
});
