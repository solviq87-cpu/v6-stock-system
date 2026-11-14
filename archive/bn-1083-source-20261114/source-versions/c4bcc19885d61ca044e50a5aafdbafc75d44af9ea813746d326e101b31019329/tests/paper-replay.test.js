'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayPaperAccount}=require('../src/core/paper-replay');
function fixture(){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:65},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
test('paper account replays next-day execution and preserves auditable equity and signals',()=>{const r=replayPaperAccount(fixture());assert.equal(r.canTrade,false);assert.equal(r.mode,'offline-paper-replay');assert.equal(r.equity.length,34);assert.equal(r.signals.length,34);assert.ok(r.metrics.finalEquity>0);assert.match(r.fingerprint,/^[0-9a-f]{64}$/);for(const o of r.orders.filter(x=>x.status==='filled'))assert.ok(r.signals.some(s=>s.executionDate===o.day));});
test('same history yields reproducible paper report',()=>{const d=fixture();assert.deepEqual(replayPaperAccount(d),replayPaperAccount(d));});
test('bad history cannot enter simulation',()=>{const d=fixture();d.stocks[0].bars[5].low=-1;assert.throws(()=>replayPaperAccount(d),/OHLCV/);});
test('invalid risk settings rejected',()=>{assert.throws(()=>replayPaperAccount(fixture(),{allocationPct:2}),/参数无效/);});
test('insufficient history rejected without synthetic prices',()=>{const d=fixture();d.stocks[0].bars=d.stocks[0].bars.slice(0,32);assert.throws(()=>replayPaperAccount(d),/参数无效/);});
