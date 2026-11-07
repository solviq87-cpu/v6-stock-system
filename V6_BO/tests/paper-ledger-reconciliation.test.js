'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { reducePaperOrderEvents } = require('../src/core/paper-order-state-machine');
const { reconcilePaperLedger } = require('../src/core/paper-ledger-reconciliation');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture() {
  const order = { orderId: 'ord-1', symbol: '600000', side: 'buy', quantity: 100 };
  const events = [{ eventId: 'fill-1', sequence: 1, type: 'fill', quantity: 100, price: 10, date: '2026-11-05' }];
  const state = reducePaperOrderEvents(order, events);
  const record = { schemaVersion: 1, order, events, state, journalHash: hash(events) };
  const account = { schemaVersion: 1, cash: 89995, positions: { '600000': { quantity: 100, sellable: 0, lots: [{ buyDate: '2026-11-05', quantity: 100, price: 10, cost: 1005, sourceEventId: 'fill-1' }] } }, events: [{ eventId: 'fill-1', orderId: 'ord-1', symbol: '600000', side: 'buy', quantity: 100, price: 10, fee: 5, gross: 1000, tradeDate: '2026-11-05', cashAfter: 89995 }] };
  account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
  return { record, account };
}
test('订单成交与账户流水一致时通过且只读', () => {
  const { record, account } = fixture();
  const before = JSON.stringify(account);
  const report = reconcilePaperLedger([record], account);
  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.accountMutated, false);
  assert.equal(JSON.stringify(account), before);
});
test('订单有成交但账户流水缺失时明确报缺失', () => {
  const { record, account } = fixture(); account.events = [];
  account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
  const report = reconcilePaperLedger([record], account);
  assert.equal(report.ok, false);
  assert.equal(report.missingLedger.length, 1);
});
test('账户存在没有订单依据的流水时列为孤儿事件', () => {
  const { record, account } = fixture();
  account.events.push({ ...account.events[0], eventId: 'orphan', orderId: 'other' });
  account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
  const report = reconcilePaperLedger([record], account);
  assert.equal(report.ok, false);
  assert.equal(report.orphanLedger.length, 1);
});
test('篡改账户或订单日志时拒绝生成可信对账结果', () => {
  const { record, account } = fixture(); account.cash += 1;
  assert.throws(() => reconcilePaperLedger([record], account), /指纹校验失败/);
  const f = fixture(); f.record.events[0].quantity = 200;
  assert.throws(() => reconcilePaperLedger([f.record], f.account), /订单日志指纹校验失败/);
});
test('订单与流水字段不一致时单列差异', () => {
  const { record, account } = fixture(); account.events[0].quantity = 200;
  account.fingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
  const report = reconcilePaperLedger([record], account);
  assert.equal(report.ok, false);
  assert.equal(report.mismatched.length, 1);
});
