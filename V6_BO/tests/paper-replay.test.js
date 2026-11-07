'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayPaperAccount}=require('../src/core/paper-replay');
function fixture(){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:65},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
test('paper account replays next-day execution and preserves auditable equity and signals',()=>{const r=replayPaperAccount(fixture());assert.equal(r.canTrade,false);assert.equal(r.mode,'offline-paper-replay');assert.equal(r.equity.length,34);assert.equal(r.signals.length,34);assert.ok(r.metrics.finalEquity>0);assert.match(r.fingerprint,/^[0-9a-f]{64}$/);for(const o of r.orders.filter(x=>x.status==='filled'))assert.ok(r.signals.some(s=>s.executionDate===o.day));});
test('same history yields reproducible paper report',()=>{const d=fixture();assert.deepEqual(replayPaperAccount(d),replayPaperAccount(d));});
test('bad history cannot enter simulation',()=>{const d=fixture();d.stocks[0].bars[5].low=-1;assert.throws(()=>replayPaperAccount(d),/OHLCV/);});
test('invalid risk settings rejected',()=>{assert.throws(()=>replayPaperAccount(fixture(),{allocationPct:2}),/参数无效/);});
test('insufficient history rejected without synthetic prices',()=>{const d=fixture();d.stocks[0].bars=d.stocks[0].bars.slice(0,32);assert.throws(()=>replayPaperAccount(d),/参数无效/);});
test('paper account rejects malformed optional risk pause limits',()=>{
 for(const value of [NaN,Infinity,-1,0,101,'10'])assert.throws(()=>replayPaperAccount(fixture(),{maxDrawdownPausePct:value}),/风控参数无效/);
 assert.throws(()=>replayPaperAccount(fixture(),{maxDailyLossPausePct:NaN}),/风控参数无效/);
});
test('optional risk limits do not invent drawdowns for an uninvested account',()=>{
 const d=fixture();
 // An artificial declining fixture is for control-flow testing only, not market evidence.
 for(let i=31;i<d.stocks[0].bars.length;i++){
  const b=d.stocks[0].bars[i];b.open=5;b.high=5.2;b.low=4.8;b.close=5;b.volume=100000;
 }
 const r=replayPaperAccount(d,{maxDrawdownPausePct:0.01,maxDailyLossPausePct:0.01});
 assert.equal(r.canTrade,false);
 assert.equal(r.metrics.riskPauseDays,r.orders.filter(x=>x.status==='risk-paused').length);
 assert.equal(r.metrics.riskPauseDays,0);
 assert.equal(r.metrics.finalEquity,100000);
 assert.ok(r.orders.filter(x=>x.status==='risk-paused').every(x=>x.side==='buy'&&x.reason));
});
