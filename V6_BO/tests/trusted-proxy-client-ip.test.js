'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {clientIp, normalizeIp} = require('../src/server/trusted-proxy-ip');
const req = (peer, xff, xr) => ({socket:{remoteAddress:peer},headers:{... (xff === undefined ? {} : {'x-forwarded-for':xff}),...(xr===undefined?{}:{'x-real-ip':xr})}});

test('untrusted direct peer cannot spoof throttle IP using forwarding headers', () => {
  assert.equal(clientIp(req('198.51.100.20','198.51.100.99','203.0.113.50')), '198.51.100.20');
  assert.equal(clientIp(req('::ffff:198.51.100.20','198.51.100.99')), '198.51.100.20');
  assert.equal(clientIp(req('198.51.100.20','198.51.100.99'), '127.0.0.1'), '198.51.100.20');
});
test('trusted proxy uses rightmost untrusted XFF hop, not leftmost spoofed header', () => {
  const trusted='127.0.0.1,192.0.2.10';
  assert.equal(clientIp(req('127.0.0.1','10.1.1.1, 198.51.100.25, 192.0.2.10'),trusted),'198.51.100.25');
  assert.equal(clientIp(req('127.0.0.1','198.51.100.25, 192.0.2.10'),trusted),'198.51.100.25');
  assert.equal(clientIp(req('127.0.0.1','2001:db8::8'),trusted),'2001:db8::8');
});
test('directly untrusted peer ignores XFF even if upstream IP is allowed', () => {
  assert.equal(clientIp(req('198.51.100.20','203.0.113.9'),'127.0.0.1'),'198.51.100.20');
});
test('missing, invalid, excessively long or ambiguously formatted chains fail closed to peer', () => {
  const trusted='127.0.0.1';
  for (const xff of [undefined,'evil','198.51.100.1, broken',',198.51.100.1','198.51.100.1:9000','198.51.100.1,'.repeat(20),'x'.repeat(2049)]) {
    assert.equal(clientIp(req('127.0.0.1',xff),trusted),'127.0.0.1');
  }
  assert.equal(normalizeIp('127.0.0.1:80'),'');
});
test('caller cannot mutate runtime proxy policy using request headers', () => {
  assert.equal(clientIp(req('127.0.0.1','198.51.100.42','198.51.100.99'),''),'127.0.0.1');
});
