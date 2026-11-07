'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const between = (a,b) => src.slice(src.indexOf(a), src.indexOf(b,src.indexOf(a)+a.length));
test('OTP reuse is restricted to same request origin', () => {
 const forgot = between("if (p === '/api/lock/forgot'", "if (p === '/api/lock/verify-code'");
 assert.match(forgot, /cur\.ip === ip/);
});
test('OTP ticket is bound to issuing request IP', () => {
 const verify = between("if (p === '/api/lock/verify-code'", "if (p === '/api/lock/reset-pwd'");
 assert.match(verify, /rec\.ip !== clientIp\(req\)/);
});
test('password reset token is bound to issuing request IP', () => {
 const reset = between("if (p === '/api/lock/reset-pwd'", "if \(p === '/api/lock/");
 assert.match(reset, /rec\.ip !== clientIp\(req\)/);
});
