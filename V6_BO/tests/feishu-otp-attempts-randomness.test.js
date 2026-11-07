'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const verifyStart = src.indexOf("if (p === '/api/lock/verify-code'");
const resetStart = src.indexOf("if (p === '/api/lock/reset-pwd'", verifyStart);
const verify = src.slice(verifyStart, resetStart);
function simulate(code, tries) {
  const ticket = 'ticket';
  const rec = { code: '123456', tries, ip: '127.0.0.1', exp: Date.now() + 60000 };
  const _otp = new Map([[ticket, rec]]);
  let response;
  const context = { p: '/api/lock/verify-code', req: { method: 'POST' }, body: JSON.stringify({ticket,code}), _otp,
    Date, crypto: require('node:crypto'), clientIp: () => '127.0.0.1',
    json: (_res, value) => { response = value; return value; }, res: {} };
  vm.runInNewContext(`(function(){ ${verify} })()`, context);
  return {response, _otp};
}
test('correct OTP on third attempt succeeds', () => {
  const {response,_otp} = simulate('123456', 2);
  assert.equal(response.ok, true);
  assert.equal(typeof response.resetToken, 'string');
  assert.equal(_otp.has('ticket'), false);
});
test('third incorrect OTP attempt invalidates ticket', () => {
  const {response,_otp} = simulate('999999', 2);
  assert.equal(response.ok, false);
  assert.equal(_otp.has('ticket'), false);
});
test('wrong OTP increments only failed attempts', () => {
  const {response,_otp} = simulate('999999', 0);
  assert.equal(response.ok, false);
  assert.equal(_otp.get('ticket').tries, 1);
});
test('generated reset password uses cryptographic randomInt', () => {
  const reset = src.slice(resetStart, src.indexOf("if (p === '/", resetStart + 10));
  assert.match(reset, /AB\[crypto\.randomInt\(0, AB\.length\)\]/);
  assert.doesNotMatch(reset, /Math\.random\(\)/);
});
