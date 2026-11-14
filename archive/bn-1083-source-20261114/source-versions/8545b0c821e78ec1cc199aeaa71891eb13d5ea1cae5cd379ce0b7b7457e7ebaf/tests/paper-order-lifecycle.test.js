'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaperOrderLedger, ORDER_STATES } = require('../src/core/paper-order-lifecycle');

const day1 = '2026-11-02', day2 = '2026-11-03';
function ledger() { return createPaperOrderLedger({ initialCash: 100000, feeBps: 8, sellTaxBps: 5 }); }

test('buy partial fill then cancel releases only the unfilled reservation', () => {
  const a = ledger();
  a.submit({ id: 'B1', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 });
  const before = a.snapshot();
  assert.ok(before.reservedCash > 10000);
  a.fill('B1', { quantity: 400, price: 9.99, tradingDay: day1 });
  const partial = a.snapshot();
  assert.equal(partial.orders[0].status, ORDER_STATES.PARTIALLY_FILLED);
  assert.equal(partial.positions['600000'].shares, 400);
  assert.ok(partial.reservedCash > 0);
  a.cancel('B1', { tradingDay: day1 });
  const after = a.snapshot();
  assert.equal(after.orders[0].status, ORDER_STATES.CANCELLED);
  assert.equal(after.orders[0].filledQuantity, 400);
  assert.equal(after.reservedCash, 0);
  assert.equal(after.positions['600000'].shares, 400);
  assert.equal(a.audit().ok, true, JSON.stringify(a.audit().errors));
});

test('fully filled buy consumes reservation once and cannot be filled twice', () => {
  const a = ledger();
  a.submit({ id: 'B2', side: 'BUY', code: '600000', quantity: 500, limitPrice: 10, tradingDay: day1 });
  a.fill('B2', { quantity: 500, price: 10, tradingDay: day1 });
  assert.equal(a.snapshot().reservedCash, 0);
  assert.equal(a.snapshot().orders[0].status, ORDER_STATES.FILLED);
  assert.throws(() => a.fill('B2', { quantity: 100, price: 10, tradingDay: day1 }), /终态/);
  assert.equal(a.audit().ok, true);
});

test('sell order reserves sellable shares and partial fill updates reservation correctly', () => {
  const a = ledger();
  a.submit({ id: 'B3', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 });
  a.fill('B3', { quantity: 1000, price: 10, tradingDay: day1 });
  assert.equal(a.snapshot().positions['600000'].sellableShares, 0);
  assert.throws(() => a.submit({ id: 'S0', side: 'SELL', code: '600000', quantity: 100, limitPrice: 11, tradingDay: day1 }), /T\+1/);
  a.advanceTradingDay(day2);
  a.submit({ id: 'S1', side: 'SELL', code: '600000', quantity: 600, limitPrice: 11, tradingDay: day2 });
  a.fill('S1', { quantity: 200, price: 11, tradingDay: day2 });
  assert.equal(a.snapshot().positions['600000'].shares, 800);
  assert.equal(a.snapshot().positions['600000'].sellableShares, 400);
  a.cancel('S1', { tradingDay: day2 });
  assert.equal(a.snapshot().positions['600000'].sellableShares, 800);
  assert.equal(a.audit().ok, true, JSON.stringify(a.audit().errors));
});

test('sell proceeds, fee, tax and realized pnl reconcile after complete lifecycle', () => {
  const a = ledger();
  a.submit({ id: 'B4', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 });
  a.fill('B4', { quantity: 1000, price: 10, tradingDay: day1 });
  a.advanceTradingDay(day2);
  a.submit({ id: 'S2', side: 'SELL', code: '600000', quantity: 1000, limitPrice: 12, tradingDay: day2 });
  a.fill('S2', { quantity: 1000, price: 12, tradingDay: day2 });
  const s = a.snapshot();
  assert.equal(s.positions['600000'], undefined);
  assert.ok(s.realizedPnl > 1900);
  assert.equal(a.audit().ok, true);
});

test('rejects duplicate ids, invalid sides, fractional lots, invalid dates and overfills', () => {
  const a = ledger();
  assert.throws(() => a.submit({ id: 'x', side: 'BUY', code: '600000', quantity: 101, limitPrice: 10, tradingDay: day1 }), /整手/);
  assert.throws(() => a.submit({ id: 'x', side: 'BUYISH', code: '600000', quantity: 100, limitPrice: 10, tradingDay: day1 }), /方向/);
  assert.throws(() => a.submit({ id: 'x', side: 'BUY', code: '600000', quantity: 100, limitPrice: 10, tradingDay: '2026-02-30' }), /日期/);
  a.submit({ id: 'x', side: 'BUY', code: '600000', quantity: 200, limitPrice: 10, tradingDay: day1 });
  assert.throws(() => a.submit({ id: 'x', side: 'BUY', code: '600000', quantity: 100, limitPrice: 10, tradingDay: day1 }), /重复/);
  assert.throws(() => a.fill('x', { quantity: 300, price: 10, tradingDay: day1 }), /成交数量/);
  assert.equal(a.audit().ok, true);
});

test('insufficient available cash cannot create a reservation', () => {
  const a = createPaperOrderLedger({ initialCash: 1000 });
  assert.throws(() => a.submit({ id: 'B5', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 }), /资金不足/);
  assert.equal(a.snapshot().reservedCash, 0);
  assert.equal(a.audit().ok, true);
});

test('open sell reservation remains respected across a trading-day advance', () => {
  const a = ledger();
  a.submit({ id: 'B6', side: 'BUY', code: '600000', quantity: 500, limitPrice: 10, tradingDay: day1 });
  a.fill('B6', { quantity: 500, price: 10, tradingDay: day1 });
  a.advanceTradingDay(day2);
  a.submit({ id: 'S3', side: 'SELL', code: '600000', quantity: 300, limitPrice: 11, tradingDay: day2 });
  a.advanceTradingDay('2026-11-04');
  assert.equal(a.snapshot().positions['600000'].sellableShares, 200);
  assert.throws(() => a.submit({ id: 'S4', side: 'SELL', code: '600000', quantity: 300, limitPrice: 11, tradingDay: '2026-11-04' }), /T\+1/);
  assert.equal(a.audit().ok, true);
});

test('lifecycle fill ledger reconciles against cash, realized pnl and FIFO position snapshot', () => {
  const { reconcilePaperAccount } = require('../src/core/paper-account-reconciliation');
  const a = ledger();
  a.submit({ id: 'B7', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 });
  a.fill('B7', { quantity: 400, price: 10, tradingDay: day1 });
  a.fill('B7', { quantity: 600, price: 9.99, tradingDay: day1 });
  a.advanceTradingDay(day2);
  a.submit({ id: 'S5', side: 'SELL', code: '600000', quantity: 300, limitPrice: 11, tradingDay: day2 });
  a.fill('S5', { quantity: 300, price: 11, tradingDay: day2 });
  const s = a.snapshot();
  const result = reconcilePaperAccount({ initialCash: 100000, trades: s.fills, account: { cash: s.cash, realized: s.realizedPnl, positions: s.positions } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.cash.diff, 0);
  assert.equal(result.positions.differences.length, 0);
});


test('better-price full buy releases unused cash reservation', () => {
  const a = ledger();
  a.submit({ id: 'B-discount', side: 'BUY', code: '600000', quantity: 1000, limitPrice: 10, tradingDay: day1 });
  a.fill('B-discount', { quantity: 1000, price: 9, tradingDay: day1 });
  const s = a.snapshot();
  assert.equal(s.reservedCash, 0);
  assert.equal(s.orders[0].reservedCashCents, 0);
  assert.equal(a.audit().ok, true, JSON.stringify(a.audit().errors));
});

test('trading day cannot be replayed backwards or repeated to bypass T+1', () => {
  const a = ledger();
  a.submit({ id: 'B-day', side: 'BUY', code: '600000', quantity: 100, limitPrice: 10, tradingDay: day1 });
  a.fill('B-day', { quantity: 100, price: 10, tradingDay: day1 });
  assert.throws(() => a.advanceTradingDay(day1), /严格递增/);
  assert.throws(() => a.advanceTradingDay('2026-11-01'), /严格递增/);
  assert.equal(a.snapshot().positions['600000'].sellableShares, 0);
  a.advanceTradingDay(day2);
  assert.throws(() => a.advanceTradingDay(day2), /严格递增/);
  assert.throws(() => a.submit({ id: 'B-backdated', side: 'BUY', code: '600000', quantity: 100, limitPrice: 10, tradingDay: day1 }), /交易日期/);
  assert.throws(() => a.fill('B-day', { quantity: 100, price: 10, tradingDay: day1 }), /终态/);
  assert.equal(a.audit().ok, true);
});
