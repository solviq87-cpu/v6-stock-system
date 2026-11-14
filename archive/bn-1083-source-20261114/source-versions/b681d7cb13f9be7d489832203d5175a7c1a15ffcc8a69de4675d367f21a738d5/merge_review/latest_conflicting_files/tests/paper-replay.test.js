'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayPaperAccount}=require('../src/core/paper-replay');
function fixture(){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'研究样本',market:'main',bars:Array.from({length:65},(_,i)=>{const p=10+i*.08;return {date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:p,high:p+.25,low:p-.2,close:p+.1,volume:100000};})}]};}
function addLinkedOrder(r){const s=r.signals[0];const order={day:s.executionDate,symbol:'000001',side:'buy',status:'blocked',reason:'test',provenance:{kind:'offline-replay-decision',signalId:s.signalId,signalDate:s.signalDate,executionDate:s.executionDate,datasetFingerprint:r.fingerprint,source:r.source,canTrade:false}};r.orders.push(order);r.provenance.ordersWithSignalReference=r.orders.length;return order;}
test('paper account replays next-day execution and preserves auditable equity and signals',()=>{const r=replayPaperAccount(fixture());assert.equal(r.canTrade,false);assert.equal(r.mode,'offline-paper-replay');assert.equal(r.equity.length,34);assert.equal(r.signals.length,34);assert.ok(r.metrics.finalEquity>0);assert.match(r.fingerprint,/^[0-9a-f]{64}$/);for(const o of r.orders.filter(x=>x.status==='filled'))assert.ok(r.signals.some(s=>s.executionDate===o.day));});
test('paper replay embeds read-only cash and position reconciliation',()=>{const r=replayPaperAccount(fixture());assert.equal(r.accountReconciliation.ok,true,JSON.stringify(r.accountReconciliation));assert.equal(r.accountReconciliation.complete,true);assert.equal(r.accountReconciliation.mode,'offline-paper-replay-read-only');assert.equal(r.accountReconciliation.canTrade,false);assert.equal(r.accountReconciliation.cash.diff,0);});
test('same history yields reproducible paper report',()=>{const d=fixture();assert.deepEqual(replayPaperAccount(d),replayPaperAccount(d));});
test('bad history cannot enter simulation',()=>{const d=fixture();d.stocks[0].bars[5].low=-1;assert.throws(()=>replayPaperAccount(d),/OHLCV/);});
test('invalid risk settings rejected',()=>{assert.throws(()=>replayPaperAccount(fixture(),{allocationPct:2}),/参数无效/);});
test('insufficient history rejected without synthetic prices',()=>{const d=fixture();d.stocks[0].bars=d.stocks[0].bars.slice(0,32);assert.throws(()=>replayPaperAccount(d),/参数无效/);});
test('every paper order carries immutable replay provenance linked to its prior-close signal',()=>{const r=replayPaperAccount(fixture());const byId=new Map(r.signals.map(s=>[s.signalId,s]));assert.ok(r.signals.length>0);for(const o of r.orders){assert.ok(o.provenance);assert.equal(o.provenance.kind,'offline-replay-decision');assert.equal(o.provenance.canTrade,false);assert.equal(o.provenance.executionDate,o.day);assert.equal(o.provenance.datasetFingerprint,r.fingerprint);const signal=byId.get(o.provenance.signalId);assert.ok(signal);assert.equal(signal.signalDate,o.provenance.signalDate);assert.equal(signal.executionDate,o.day);assert.ok(signal.signalDate<o.day);}assert.equal(r.provenance.ordersWithSignalReference,r.orders.length);assert.equal(r.provenance.canTrade,false);});
test('paper replay provenance changes when the source dataset changes',()=>{const a=fixture(),b=fixture();b.source='alternate-fixture';b.provider='alternate-fixture';const x=replayPaperAccount(a),y=replayPaperAccount(b);assert.notEqual(x.fingerprint,y.fingerprint);assert.notEqual(x.signals[0].signalId,y.signals[0].signalId);});

test('replay provenance audit accepts an intact report and reports linked counts',()=>{
 const {auditPaperReplayProvenance}=require('../src/core/paper-replay');
 const r=replayPaperAccount(fixture()),a=auditPaperReplayProvenance(r);
 assert.equal(a.ok,true,JSON.stringify(a));assert.equal(a.orders,r.orders.length);assert.equal(a.linkedOrders,r.orders.length);assert.equal(a.canTrade,false);
});
test('replay provenance audit detects orphaned order references without mutating report',()=>{
 const {auditPaperReplayProvenance}=require('../src/core/paper-replay');
 const r=replayPaperAccount(fixture());const order=addLinkedOrder(r);
 order.provenance.signalId='f'.repeat(64);const before=JSON.stringify(r),a=auditPaperReplayProvenance(r);
 assert.equal(a.ok,false);assert.ok(a.errors.some(x=>x.includes('不存在的信号')));assert.equal(JSON.stringify(r),before);
});
test('replay provenance audit detects altered signal payload and duplicate signal ids',()=>{
 const {auditPaperReplayProvenance}=require('../src/core/paper-replay');
 const r=replayPaperAccount(fixture());r.signals[0].picks.push('999999');r.signals[1].signalId=r.signals[0].signalId;
 const a=auditPaperReplayProvenance(r);assert.equal(a.ok,false);assert.ok(a.errors.some(x=>x.includes('指纹不匹配')));assert.ok(a.errors.some(x=>x.includes('重复')));
});
test('replay provenance audit rejects tradable claims and mismatched source/fingerprint',()=>{
 const {auditPaperReplayProvenance}=require('../src/core/paper-replay');
 const r=replayPaperAccount(fixture());const order=addLinkedOrder(r);r.signals[0].canTrade=true;order.provenance.source='forged-source';r.provenance.ordersWithSignalReference++;
 const a=auditPaperReplayProvenance(r);assert.equal(a.ok,false);assert.ok(a.errors.some(x=>x.includes('交易授权标记')));assert.ok(a.errors.some(x=>x.includes('行情来源')));assert.ok(a.errors.some(x=>x.includes('数量不一致')));
});
test('replay provenance audit rejects malformed report and missing provenance',()=>{
 const {auditPaperReplayProvenance}=require('../src/core/paper-replay');
 assert.equal(auditPaperReplayProvenance(null).ok,false);
 const r=replayPaperAccount(fixture());addLinkedOrder(r).provenance=null;const a=auditPaperReplayProvenance(r);
 assert.equal(a.ok,false);assert.ok(a.errors.some(x=>x.includes('缺少离线证据')));
});
