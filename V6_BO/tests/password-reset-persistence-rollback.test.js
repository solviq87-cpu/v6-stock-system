'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const reset = src.slice(src.indexOf("if (p === '/api/lock/reset-pwd'"), src.indexOf("if (p === '/api/lock/", src.indexOf("if (p === '/api/lock/reset-pwd'")+10));
test('password reset snapshots previous access state before mutation', () => {
  assert.match(reset, /const previousAccessSecret = accessSecret;[\s\S]*accessSecret = \{/);
});
test('password reset restores previous access state on failed save', () => {
  assert.match(reset, /if \(!saveAccess\(\)\) \{\s*accessSecret = previousAccessSecret;/);
});
test('reset token is consumed only after durable save', () => {
  const save = reset.indexOf('if (!saveAccess())');
  const consume = reset.lastIndexOf("_otp.delete('R' + rt)");
  assert.ok(save >= 0 && consume > save);
});
test('session invalidation follows durable save', () => {
  assert.ok(reset.indexOf('_tokens.clear()') > reset.lastIndexOf("_otp.delete('R' + rt)"));
});
