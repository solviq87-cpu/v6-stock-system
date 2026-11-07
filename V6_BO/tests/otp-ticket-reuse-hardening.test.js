'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const forgot = source.slice(source.indexOf("if (p === '/api/lock/forgot'"), source.indexOf("if (p === '/api/lock/verify-code'"));
const verify = source.slice(source.indexOf("if (p === '/api/lock/verify-code'"), source.indexOf("if (p === '/api/lock/reset-pwd'"));
test('repeated forgot calls reuse ticket and do not reset tries', () => {
  assert.match(forgot, /const oldRec = oldTicket && _otp\.get\(oldTicket\)/);
  assert.match(forgot, /oldRec\.tries < 3/);
  assert.match(forgot, /const ticket = reuseTicket \? oldTicket : crypto\.randomBytes/);
  assert.match(forgot, /if \(!reuseTicket\) _otp\.set\(ticket/);
});
test('reused ticket retains original expiry', () => {
  assert.equal((forgot.match(/exp: reuseTicket \? oldRec\.exp : exp/g) || []).length, 2);
});
test('three failed guesses invalidate ticket and its reuse slot', () => {
  assert.match(verify, /if \(rec\.tries >= 3\) \{/);
  assert.match(verify, /if \(\(_otp\.get\(slotKey\) \|\| \{\}\)\.ticket === ticket\) _otp\.delete\(slotKey\)/);
});
