'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const forgot = source.slice(source.indexOf("if (p === '/api/lock/forgot'"), source.indexOf("if (p === '/api/lock/otp-delivery'"));
test('reuse requires active unexpired ticket and matching origin', () => {
  assert.match(forgot, /const activeTicket = cur && cur\.ticket && _otp\.get\(cur\.ticket\)/);
  assert.match(forgot, /activeTicket\.exp > now && activeTicket\.tries < 3/);
  assert.match(forgot, /activeTicket\.code === cur\.code && activeTicket\.ip === ip/);
});
test('invalid ticket creates a fresh secure code without inheriting lastPush', () => {
  assert.match(forgot, /else code = String\(crypto\.randomInt\(100000, 1000000\)\)/);
  assert.match(forgot, /let code, lastPush = 0/);
  assert.match(forgot, /if \(now - lastPush >= 60 \* 1000\)/);
});
