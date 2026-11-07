'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reducePaperOrderEvents } = require('../src/core/paper-order-state-machine');
const order = () => ({ orderId: 'P-001', symbol: '600000', side: 'buy', quantity: 300 });
const ev = (eventId, sequence, type, extra = {}) => ({ eventId, sequence, type, ...extra });
test('new order starts pending with all quantity remaining', () => {
  const r = reducePaperOrderEvents(order(), []); assert.equal(r.status, 'pending'); assert.equal(r.remainingQuantity, 300);
});
test('single complete fill transitions pending to filled', () => {
  const r = reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 300, price: 10 })]);
  assert.equal(r.status, 'filled'); assert.equal(r.averageFillPrice, 10); assert.equal(r.remainingQuantity, 0);
});
test('multiple fills transition pending to partial then filled with weighted price', () => {
  const r = reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 100, price: 10 }), ev('e2', 2, 'fill', { quantity: 200, price: 11 })]);
  assert.equal(r.status, 'filled'); assert.equal(r.averageFillPrice, 10.6667); assert.equal(r.fills.length, 2);
});
test('partial fill may be canceled and retains remaining quantity', () => {
  const r = reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 100, price: 10 }), ev('e2', 2, 'cancel')]);
  assert.equal(r.status, 'canceled'); assert.equal(r.filledQuantity, 100); assert.equal(r.remainingQuantity, 200);
});
test('pending order can be rejected with bounded reason', () => {
  const r = reducePaperOrderEvents(order(), [ev('e1', 1, 'reject', { reason: '风控拒绝' })]);
  assert.equal(r.status, 'rejected'); assert.equal(r.rejectReason, '风控拒绝');
});
test('duplicate event id is idempotently ignored', () => {
  const r = reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 100, price: 10 }), ev('e1', 1, 'fill', { quantity: 100, price: 10 })]);
  assert.equal(r.filledQuantity, 100); assert.equal(r.events.length, 1);
});
test('overfill is rejected', () => assert.throws(() => reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 400, price: 10 })]), /超过剩余/));
test('non-increasing sequence is rejected', () => assert.throws(() => reducePaperOrderEvents(order(), [ev('e1', 2, 'cancel'), ev('e2', 2, 'cancel')]), /严格递增/));
test('terminal order cannot accept later events', () => assert.throws(() => reducePaperOrderEvents(order(), [ev('e1', 1, 'cancel'), ev('e2', 2, 'fill', { quantity: 100, price: 10 })]), /终态订单/));
test('partially filled order cannot be rejected as if no execution occurred', () => assert.throws(() => reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 100, price: 10 }), ev('e2', 2, 'reject')]), /部分成交/));
test('invalid board lot quantity and invalid price are rejected', () => {
  assert.throws(() => reducePaperOrderEvents({ ...order(), quantity: 150 }, []), /整数手/);
  assert.throws(() => reducePaperOrderEvents(order(), [ev('e1', 1, 'fill', { quantity: 100, price: 0 })]), /价格无效/);
});
test('result is paper-only and never mutates input', () => {
  const o = order(), events = [ev('e1', 1, 'fill', { quantity: 100, price: 10 })], before = JSON.stringify([o, events]);
  const r = reducePaperOrderEvents(o, events);
  assert.equal(JSON.stringify([o, events]), before); assert.equal(r.brokerConnected, false); assert.equal(r.accountMutated, false);
});
