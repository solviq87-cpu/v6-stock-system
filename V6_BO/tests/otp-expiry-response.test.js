'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const forgot = source.slice(source.indexOf("if (p === '/api/lock/forgot'"), source.indexOf("if (p === '/api/lock/verify-code'"));
test('reused OTP ticket response reflects remaining validity, not a fresh 300 seconds', () => {
  assert.match(forgot, /const ticketExpiry = reuseTicket \? oldRec\.exp : exp/);
  assert.match(forgot, /Math\.max\(0, Math\.ceil\(\(ticketExpiry - Date\.now\(\)\) \/ 1000\)\)/);
  assert.match(forgot, /ok: true, ticket, expiresIn: secondsRemaining/);
  assert.doesNotMatch(forgot, /ok: true, ticket, expiresIn: 300/);
});
test('the original ticket expiry is not extended when reusing it', () => {
  assert.match(forgot, /exp: reuseTicket \? oldRec\.exp : exp/);
});
