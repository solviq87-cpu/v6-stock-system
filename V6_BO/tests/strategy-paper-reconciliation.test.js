'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileStrategyWithPaper } = require('../src/core/strategy-paper-reconciliation');
const fp = 'a'.repeat(64);
function fixture(){
 const records = [
  {system:'fourteen',symbol:'000001',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}},
  {system:'bazi',symbol:'000002',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}},
  {system:'gpt',symbol:'000003',signalDate:'2026-01-01',verdict:'unknown',outcome:{status:'not-evaluated'}},
  {system:'python',symbol:'000004',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}}
 ];
 const strategy={mode:'audited-strategy-evidence-replay',datasetFingerprint:fp,evidenceBundleFingerprint:'b'.repeat(64),windows:{inSample:{records},outOfSample:{records:[]},unassigned:{records:[]}}};
 const paper={mode:'offline-paper-replay',fingerprint:fp,signals:[{executionDate:'2026-01-02',picks:['000001','000002']}],orders:[
  {symbol:'000001',day:'2026-01-02',side:'buy',status:'filled'},
  {symbol:'000002',day:'2026-01-02',side:'buy',status:'risk-paused',reason:'最大回撤暂停'},
  {symbol:'000005',day:'2026-01-02',side:'buy',status:'filled'}
 ]};
 return {strategy,paper};
}
test('matches strategy signal to same-symbol same-session paper fill without claiming causation',()=>{
 const {strategy,paper}=fixture();const r=reconcileStrategyWithPaper(strategy,paper);
 assert.equal(r.systems.fourteen.filledMatches,1);assert.equal(r.systems.fourteen.matchRatePct,100);
 assert.equal(r.systems.bazi.riskPaused,1);assert.equal(r.systems.gpt.notActionable,1);
 assert.equal(r.unmatchedPaperBuys.length,1);assert.equal(r.canTrade,false);
 assert.match(r.limitations[0],/不证明模拟盘由四套策略驱动/);
});
test('refuses reconciliation across different dataset fingerprints',()=>{
 const {strategy,paper}=fixture();paper.fingerprint='c'.repeat(64);
 assert.throws(()=>reconcileStrategyWithPaper(strategy,paper),/数据指纹不一致/);
});
test('distinguishes picked-but-not-filled, blocked and no-match states',()=>{
 const {strategy,paper}=fixture();
 strategy.windows.inSample.records.push(
  {system:'fourteen',symbol:'000006',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}},
  {system:'fourteen',symbol:'000007',signalDate:'2026-01-01',verdict:'pass',outcome:{entryDate:'2026-01-02'}}
 );
 paper.signals[0].picks.push('000006');
 paper.orders.push({symbol:'000007',day:'2026-01-02',side:'buy',status:'blocked',reason:'一字涨停'});
 const r=reconcileStrategyWithPaper(strategy,paper).systems.fourteen;
 assert.equal(r.pickedNotFilled,1);assert.equal(r.executionBlocked,1);assert.equal(r.noPaperMatch,0);
});
test('rejects malformed report contracts',()=>{
 const {strategy,paper}=fixture();assert.throws(()=>reconcileStrategyWithPaper({},paper),/策略回放报告无效/);
 assert.throws(()=>reconcileStrategyWithPaper(strategy,{...paper,orders:null}),/模拟盘回放报告无效/);
});
