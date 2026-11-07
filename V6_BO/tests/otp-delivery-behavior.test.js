'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('function pushVerifyCode(');
const end = source.indexOf('// 把「访问链接', start);
const fnSource = source.slice(start, end);
function harness({ replica = false, ready = true, probe = () => Promise.resolve({ok:true}) } = {}) {
  const calls = [], logs = [];
  const context = { isReplica: () => replica, feishuSecReady: () => ready,
    phoneStore: () => ({masked:'***1234'}), feishuSecId: () => 'private',
    feishuProbe: (...args) => {calls.push(args); return probe(...args);},
    pushLog: (...args) => logs.push(args), process: {env:{}}, S: {config:{}},
    console: {error: () => {}} };
  vm.runInNewContext(fnSource + '\nthis.pushVerifyCode = pushVerifyCode;', context);
  return {send: context.pushVerifyCode, calls, logs};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('private bot accepts OTP without public delivery, and only reports accepted', async () => {
  const h = harness(); const states = [];
  assert.equal(h.send('123456', 5, state => states.push(state)), true);
  await settle();
  assert.deepEqual(states, ['accepted']);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'private');
  assert.match(h.calls[0][2], /123456/);
});
test('rejected private delivery reports failed without public fallback', async () => {
  const h = harness({probe: () => Promise.resolve({ok:false})}); const states = [];
  assert.equal(h.send('123456', 5, state => states.push(state)), true);
  await settle(); assert.deepEqual(states, ['failed']); assert.equal(h.calls.length, 1);
});
test('network error is unknown, never silently requeued to public bot', async () => {
  const h = harness({probe: () => Promise.reject(new Error('timeout'))}); const states = [];
  assert.equal(h.send('123456', 5, state => states.push(state)), true);
  await settle(); assert.deepEqual(states, ['unknown']); assert.equal(h.calls.length, 1);
});
test('unavailable and replica paths do not send a private or public request', () => {
  for (const opts of [{ready:false}, {replica:true}]) {
    const h = harness(opts), states = [];
    assert.equal(h.send('123456', 5, state => states.push(state)), false);
    assert.equal(h.calls.length, 0);
    assert.equal(states.length, 1);
    assert.equal(states[0], opts.replica ? 'blocked' : 'unavailable');
  }
});
test('forgot flow marks pending before dispatch and preserves synchronous rejection', () => {
  const forgot = source.slice(source.indexOf("if (p === '/api/lock/forgot'"), source.indexOf("if (p === '/api/lock/otp-delivery'"));
  assert.match(forgot, /activeBeforeSend\.deliveryStatus = 'pending'/);
  assert.match(forgot, /if \(!pushed && _otp\.get\(ticket\)\?\.deliveryStatus === 'pending'\)/);
  assert.doesNotMatch(forgot, /if \(pushed\) _otp\.get\(ticket\)\.deliveryStatus = 'pending'/);
  assert.match(forgot, /const deliveryMinutes = Math\.max\(1, Math\.ceil/);
});
