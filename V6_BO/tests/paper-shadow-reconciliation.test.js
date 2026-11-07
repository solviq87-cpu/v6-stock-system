'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPaperShadowReconciler } = require('../src/core/paper-shadow-reconciliation');

function fixture(dir, overrides = {}) {
  const snapshot = {
    trades: [
      { t: 1, tradeId: 'b1', side: 'BUY', code: '600001', shares: 1000, amount: 10000, fee: 5 },
      { t: 2, tradeId: 's1', side: 'SELL', code: '600001', shares: 400, amount: 4400, fee: 5 }
    ],
    account: { cash: 94390, realized: 393, positions: { '600001': { shares: 600, basis: 6003 } } }
  };
  const reconciler = createPaperShadowReconciler({
    initialCash: 100000,
    auditLogPath: path.join(dir, 'shadow.jsonl'),
    readSnapshot: async () => snapshot,
    ...overrides
  });
  return { reconciler, snapshot };
}

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'v6-shadow-')); }

test('writes PASS shadow audit after a settled event without mutating snapshot', async () => {
  const dir = temp(); const { reconciler, snapshot } = fixture(dir);
  const before = JSON.stringify(snapshot);
  const result = await reconciler.run({ settlementId: 'settle-1', status: 'FILLED' });
  assert.equal(result.status, 'PASS');
  assert.equal(reconciler.inspectLog().length, 1);
  assert.equal(JSON.stringify(snapshot), before);
});

test('skips events that are not settled', async () => {
  const { reconciler } = fixture(temp());
  const result = await reconciler.run({ settlementId: 'pending-1', status: 'NEW' });
  assert.equal(result.skipped, true);
  assert.equal(reconciler.inspectLog().length, 0);
});

test('is idempotent for duplicate settlement event identifiers', async () => {
  const { reconciler } = fixture(temp());
  await reconciler.run({ settlementId: 'settle-2', status: 'SETTLED' });
  const duplicate = await reconciler.run({ settlementId: 'settle-2', status: 'SETTLED' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(reconciler.inspectLog().length, 1);
});

test('serializes concurrent events and builds a hash chain', async () => {
  const { reconciler } = fixture(temp());
  await Promise.all(['a', 'b', 'c'].map(settlementId => reconciler.run({ settlementId, status: 'FILLED' })));
  const rows = reconciler.inspectLog();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].previousHash, null);
  assert.equal(rows[1].previousHash, rows[0].hash);
  assert.equal(rows[2].previousHash, rows[1].hash);
});

test('records ALERT for a cash mismatch rather than changing the account', async () => {
  const dir = temp();
  const { reconciler, snapshot } = fixture(dir, { readSnapshot: async () => ({
    trades: [ { t: 1, side: 'BUY', code: '600001', shares: 100, amount: 1000, fee: 1 } ],
    account: { cash: 99999, realized: 0, positions: {} }
  }) });
  const before = JSON.stringify(snapshot);
  const result = await reconciler.run({ settlementId: 'mismatch', status: 'FILLED' });
  assert.equal(result.status, 'ALERT');
  assert.equal(JSON.stringify(snapshot), before);
});

test('fails closed when snapshot provider fails and does not append a false PASS', async () => {
  const { reconciler } = fixture(temp(), { readSnapshot: async () => { throw new Error('db unavailable'); } });
  await assert.rejects(reconciler.run({ settlementId: 'db-down', status: 'FILLED' }), /db unavailable/);
  assert.equal(reconciler.inspectLog().length, 0);
});

test('detects tampering in the append-only audit log', async () => {
  const dir = temp(); const { reconciler } = fixture(dir);
  await reconciler.run({ settlementId: 'tamper', status: 'FILLED' });
  fs.appendFileSync(reconciler.auditLogPath, '{}\n');
  assert.throws(() => reconciler.inspectLog(), /指纹不匹配/);
});

test('requires an explicit settlement identifier', async () => {
  const { reconciler } = fixture(temp());
  await assert.rejects(reconciler.run({ status: 'FILLED' }), /必须提供/);
});
