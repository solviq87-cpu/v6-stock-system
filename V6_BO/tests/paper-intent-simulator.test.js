'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulatePaperIntents } = require('../src/core/paper-intent-simulator');
const fp = 'a'.repeat(64);
function fixture() {
  return {
    plan: { mode: 'paper-order-intent-plan', canTrade: false, executed: false, datasetFingerprint: fp,
      intents: [{ system: 'fourteen', symbol: '600000', executionDate: '2026-11-05', side: 'buy',
        status: 'proposal-only', referencePrice: 10, quantity: 100 }] },
    snapshot: { datasetFingerprint: fp, asOf: '2026-11-05', symbols: [{ symbol: '600000', price: 10,
      open: 10, volume: 100000, complete: true, stale: false, tradable: true }] },
    account: { cash: 100000, positions: {}, ledger: [] }
  };
}
test('valid proposal becomes offline simulated fill with fees and T+1 label', () => {
  const f = fixture(), before = JSON.stringify(f);
  const r = simulatePaperIntents(f.plan, f.snapshot, f.account);
  assert.equal(r.fills.length, 1); assert.equal(r.fills[0].status, 'simulated-filled');
  assert.match(r.fills[0].sellableDate, /T\+1/); assert.ok(r.cash < 100000);
  assert.equal(r.canTrade, false); assert.equal(r.brokerConnected, false); assert.equal(r.accountMutated, false);
  assert.equal(JSON.stringify(f), before);
});
test('duplicate intent is idempotently blocked when already in ledger', () => {
  const f = fixture();
  const first = simulatePaperIntents(f.plan, f.snapshot, f.account);
  f.account.ledger = first.ledger;
  const second = simulatePaperIntents(f.plan, f.snapshot, f.account);
  assert.equal(second.fills.length, 0); assert.match(second.blocked[0].reason, /重复意图/);
});
test('missing volume and participation limit block fills', () => {
  let f = fixture(); delete f.snapshot.symbols[0].volume;
  assert.equal(simulatePaperIntents(f.plan, f.snapshot, f.account).blocked.length, 1);
  f = fixture(); f.snapshot.symbols[0].volume = 500;
  assert.equal(simulatePaperIntents(f.plan, f.snapshot, f.account).blocked.length, 1);
});
test('cash after actual simulated fees cannot go negative', () => {
  const f = fixture(); f.account.cash = 1000;
  const r = simulatePaperIntents(f.plan, f.snapshot, f.account);
  assert.equal(r.fills.length, 0); assert.ok(r.cash >= 0);
});
test('invalid simulation costs are rejected', () => {
  const f = fixture(); assert.throws(() => simulatePaperIntents(f.plan, f.snapshot, f.account, { slippageBps: -1 }), /参数无效/);
});
