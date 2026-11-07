'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const forgot = source.slice(source.indexOf("if (p === '/api/lock/forgot'"), source.indexOf("if (p === '/api/lock/verify-code'"));
const verify = source.slice(source.indexOf("if (p === '/api/lock/verify-code'"), source.indexOf("if (p === '/api/lock/reset-pwd'"));
test('OTP reuse slot is namespaced by hashed request origin', () => {
  assert.match(forgot, /const otpSlot = 'CUR:' \+ crypto\.createHash\('sha256'\)\.update\(ip\)\.digest\('hex'\)/);
  assert.match(forgot, /_otp\.get\(otpSlot\)/);
  assert.equal((forgot.match(/_otp\.set\(otpSlot,/g) || []).length, 2);
});
test('OTP verification consumes only the matching origin reuse slot', () => {
  assert.match(verify, /_otp\.delete\('CUR:' \+ crypto\.createHash\('sha256'\)\.update\(rec\.ip\)\.digest\('hex'\)\)/);
  assert.doesNotMatch(verify, /_otp\.delete\('CUR'\)/);
});
test('OTP slots never store raw request origin as map key', () => {
  assert.doesNotMatch(forgot, /_otp\.set\('CUR:' \+ ip/);
});
