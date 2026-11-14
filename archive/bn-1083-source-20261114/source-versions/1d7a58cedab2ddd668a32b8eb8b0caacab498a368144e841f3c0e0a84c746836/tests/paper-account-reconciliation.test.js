'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePaperAccount } = require('../src/core/paper-account-reconciliation');

function sample() {
  const trades = [
    { t: 1, side: '买入', code: '600001', shares: 1000, amount: 10000, fee: 5 },
    { t: 2, side: '卖出', code: '600001', shares: 400, amount: 4400, fee: 5 }
  ];
  return { initialCash: 100000, trades, account: {
    cash: 94390, realized: 393,
    positions: { '600001': { shares: 600, basis: 6003 } }
  } };
}

test('reconciles cash, realized P&L and FIFO position basis', () => {
  const x = sample();
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cash.rebuilt, 94390);
  assert.equal(r.realized.rebuilt, 393);
  assert.equal(r.positions.differences.length, 0);
});

test('reports cash mismatch without mutating account', () => {
  const x = sample(); x.account.cash -= 100;
  const before = JSON.stringify(x);
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, false); assert.equal(r.cash.diff, 100);
  assert.equal(JSON.stringify(x), before);
});

test('detects phantom or missing shares and cost basis mismatch', () => {
  const x = sample(); x.account.positions['600001'].shares = 700; x.account.positions['600001'].basis = 7000;
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, false); assert.equal(r.positions.differences.length, 1);
  assert.equal(r.positions.differences[0].shareDiff, -100);
});

test('rejects missing fee evidence instead of assuming zero', () => {
  const x = sample(); delete x.trades[0].fee;
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, false); assert.equal(r.complete, false); assert.equal(r.missingFee, 1);
});

test('rejects overselling beyond recorded buy lots', () => {
  const x = sample(); x.trades[1].shares = 1200;
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.includes('超过可追溯买入数量')));
});

test('does not guess a corrupted trade direction', () => {
  const x = sample(); x.trades[0].side = '\uFFFD\uFFFD\uFFFD';
  const r = reconcilePaperAccount(x);
  assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.includes('方向无法识别')));
});

test('rejects malformed numeric input', () => {
  const r = reconcilePaperAccount({ initialCash: NaN, account: {}, trades: [] });
  assert.equal(r.ok, false); assert.equal(r.complete, false);
});
