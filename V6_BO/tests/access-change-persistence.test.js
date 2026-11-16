'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function between(start, next) {
  const offset = source.indexOf(start), end = source.indexOf(next, offset + start.length);
  assert.ok(offset >= 0 && end > offset);
  return source.slice(offset, end);
}
const bind = between('function bindPhone(num) {', '// 首次启动默认绑定');
const change = between("  if (p === '/api/lock/change'", '  // ---------------- 只读设备');
const reset = between("  if (p === '/api/lock/reset-pwd'", "  if (p === '/api/lock/bind-phone'");
const bump = between('function _devGenBump(role) {', 'function mkDeviceToken');
const saveRestore = between('function saveAccessOrRestore(previousAccess) {', '// ── 双密码体系');
const hashPwd = (pwd, salt) => crypto.scryptSync(pwd, salt, 32).toString('hex');
function fixture({ durable = true, initial = undefined } = {}) {
  const account = initial === undefined ? {
    salt: 'fixture-edit-salt', hash: hashPwd('fixture-old-edit', 'fixture-edit-salt'),
    gen: 7, devices: { editor: { role: 'edit', fp: 'fixture-editor' } },
    phone: { salt: 'fixture-phone-salt', hash: 'fixture-phone-hash', masked: 'fixture-phone', boundBy: 'user' },
    view: { salt: 'fixture-view-salt', hash: hashPwd('fixture-old-view', 'fixture-view-salt'), gen: 9,
      devices: { viewer: { role: 'view', fp: 'fixture-viewer' } }, pending: { request: { state: 'pending' } } },
    machineKey: 'fixture-machine-key', revoked: { old: { at: 'fixture-revoked-at' } },
    recoveryPolicy: { fixture: true }
  } : initial;
  const x = { accessSecret: structuredClone(account), crypto, Date, structuredClone,
    normPhone: value => String(value || '').replace(/[^\d]/g, ''),
    phoneMasked: value => value.slice(0, 3) + '******' + value.slice(-2),
    _otp: new Map([['fixture-ticket', { code: 'fixture-code', reset: true }]]),
    _runtimeMK: '', PWD_MAXLEN: 200, hashPwd,
    saveCount: 0, issued: 0, durableAccount: structuredClone(account),
    isLocalReq: () => false, roleOf: () => 'edit', clientIp: () => 'fixture-ip', checkToken: () => true,
    req: { method: 'POST', __tok: 'fixture-editor-token' }, res: {}, p: '/api/lock/change',
    S: { config: { viewIdleHours: 24 } },
  };
  x.viewStore = () => x.accessSecret?.view || null;
  x.pwdOk = (pwd, role) => {
    const store = role === 'view' ? x.viewStore() : x.accessSecret;
    return !!store?.salt && hashPwd(pwd, store.salt) === store.hash;
  };
  x.saveAccess = () => { x.saveCount++; if (!durable) return false; x.durableAccount = structuredClone(x.accessSecret); return true; };
  x.issueToken = () => { assert.ok(x.saveCount > 0, 'must durably save before issuing a replacement session'); x.issued++; return 'fixture-new-session'; };
  x.json = (_, result) => { x.result = result; };
  vm.createContext(x); vm.runInContext(saveRestore + bump + bind, x);
  x.change = (role, password = 'fixture-old-edit', newPassword = 'fixture-new-password') => {
    x.body = JSON.stringify({ role, password, newPassword });
    vm.runInContext('(function(){' + change + '})()', x);
    return x.result;
  };
  return x;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('failed phone binding restores complete account and preserves in-flight OTP/reset tickets', () => {
  const x = fixture({ durable: false }), before = plain(x.accessSecret), otp = [...x._otp];
  assert.equal(x.bindPhone('15500000000').ok, false);
  assert.deepEqual(plain(x.accessSecret), before); assert.deepEqual(plain(x.durableAccount), before);
  assert.deepEqual([...x._otp], otp); assert.equal(x.saveCount, 1);
});
test('first phone binding failure does not create an in-memory account', () => {
  const x = fixture({ durable: false, initial: null });
  assert.equal(x.bindPhone('15500000000').ok, false); assert.equal(x.accessSecret, null);
  assert.equal(x._otp.size, 1);
});
test('successful phone binding clears old OTP only after persistence and preserves other policy', () => {
  const x = fixture(), before = plain(x.accessSecret);
  const result = x.bindPhone('15500000000');
  assert.equal(result.ok, true); assert.equal(x._otp.size, 0);
  assert.deepEqual(plain(x.accessSecret), plain(x.durableAccount));
  assert.equal(x.accessSecret.phone.hash, hashPwd('15500000000', x.accessSecret.phone.salt));
  for (const key of Object.keys(before).filter(k => k !== 'phone')) assert.deepEqual(plain(x.accessSecret[key]), before[key]);
});
test('invalid phone does not mutate account, durable data, or OTP', () => {
  const x = fixture(), before = plain(x.accessSecret);
  assert.equal(x.bindPhone('12').ok, false); assert.equal(x.saveCount, 0);
  assert.deepEqual(plain(x.accessSecret), before); assert.equal(x._otp.size, 1);
});
for (const role of ['edit', 'view']) test('failed ' + role + ' password save restores hash, generation, devices and recovery state', () => {
  const x = fixture({ durable: false }), before = plain(x.accessSecret), otp = [...x._otp];
  assert.equal(x.change(role).ok, false);
  assert.deepEqual(plain(x.accessSecret), before); assert.deepEqual(plain(x.durableAccount), before);
  assert.equal(x.issued, 0); assert.deepEqual([...x._otp], otp);
  assert.equal(x.pwdOk('fixture-old-' + role, role), true);
  assert.equal(x.pwdOk('fixture-new-password', role), false);
});
test('successful editor password change keeps recovery phone, revocations, machine key, viewer and policy', () => {
  const x = fixture(), before = plain(x.accessSecret), result = x.change('edit');
  assert.equal(result.ok, true); assert.equal(x.issued, 1); assert.equal(x.accessSecret.gen, before.gen + 1);
  assert.deepEqual(plain(x.accessSecret.devices), {});
  for (const key of ['phone', 'revoked', 'view', 'machineKey', 'recoveryPolicy']) assert.deepEqual(plain(x.accessSecret[key]), before[key]);
  assert.deepEqual(plain(x.accessSecret), plain(x.durableAccount));
  assert.equal(x.pwdOk('fixture-old-edit', 'edit'), false); assert.equal(x.pwdOk('fixture-new-password', 'edit'), true);
});
test('successful viewer password change revokes viewer devices while keeping editor and recovery fields', () => {
  const x = fixture(), before = plain(x.accessSecret), result = x.change('view');
  assert.equal(result.ok, true); assert.equal(x.issued, 0); assert.equal(x.accessSecret.view.gen, before.view.gen + 1);
  assert.deepEqual(plain(x.accessSecret.view.devices), {}); assert.deepEqual(plain(x.accessSecret.view.pending), {});
  for (const key of Object.keys(before).filter(k => k !== 'view')) assert.deepEqual(plain(x.accessSecret[key]), before[key]);
  assert.deepEqual(plain(x.accessSecret), plain(x.durableAccount));
  assert.equal(x.S.config.viewIdleHours, 24);
  assert.equal(x.pwdOk('fixture-old-view', 'view'), false); assert.equal(x.pwdOk('fixture-new-password', 'view'), true);
});
test('unchanged viewer password keeps all devices and generation without a write', () => {
  const x = fixture(), before = plain(x.accessSecret);
  const result = x.change('view', '', 'fixture-old-view');
  assert.equal(result.ok, true); assert.equal(result.unchanged, true); assert.equal(x.saveCount, 0);
  assert.deepEqual(plain(x.accessSecret), before);
});
test('wrong editor password cannot mutate or persist account', () => {
  const x = fixture(), before = plain(x.accessSecret);
  assert.equal(x.change('edit', 'fixture-wrong-password').ok, false);
  assert.equal(x.saveCount, 0); assert.equal(x.issued, 0); assert.deepEqual(plain(x.accessSecret), before);
});
test('failed password reset with kick preserves old generation, recovery state and one-time reset ticket', () => {
  const x = fixture({ durable: false }), before = plain(x.accessSecret);
  x.p = '/api/lock/reset-pwd';
  x.body = JSON.stringify({ resetToken: 'fixture-reset', newPassword: 'fixture-new-password', kick: true });
  x._otp.set('Rfixture-reset', { reset: true, ip: 'fixture-ip', exp: Date.now() + 60000 });
  const tickets = [...x._otp];
  vm.runInContext('(function(){' + reset + '})()', x);
  assert.equal(x.result.ok, false); assert.equal(x.issued, 0);
  assert.deepEqual(plain(x.accessSecret), before); assert.deepEqual(plain(x.durableAccount), before);
  assert.deepEqual([...x._otp], tickets);
  assert.equal(x.pwdOk('fixture-old-edit', 'edit'), true);
  assert.equal(x.pwdOk('fixture-new-password', 'edit'), false);
});
