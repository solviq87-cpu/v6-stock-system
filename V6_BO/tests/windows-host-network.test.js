'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateServe } = require('../deploy/windows-host/host-network-check.js');
const fixture = () => ({ TCP: { '443': { HTTPS: true } }, Web: { 'private-host.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } } }, AllowFunnel: { 'private-host.example.ts.net:443': false } });

test('private HTTPS loopback configuration is verified without claiming a phone connection or exposing its name', () => {
  const report = validateServe(fixture());
  assert.equal(report.configurationVerified, true);
  assert.equal(report.phoneConnected, false);
  assert.equal(report.changed, false);
  assert.doesNotMatch(JSON.stringify(report), /private-host|ts.net/);
});
test('public Funnel is rejected, including nested session configurations', () => {
  for (const nested of [false, true]) {
    const value = fixture();
    if (nested) value.extra = { AllowFunnel: { 'private-host.example.ts.net:443': true } };
    else value.AllowFunnel['private-host.example.ts.net:443'] = true;
    assert.equal(validateServe(value).code, 'public-funnel-rejected');
  }
});
test('non-loopback, alternate port and public proxy routes are refused', () => {
  for (const proxy of ['http://0.0.0.0:8787', 'http://localhost:8787', 'http://127.0.0.1:80', 'https://example.com']) {
    const value = fixture(); value.Web['private-host.example.ts.net:443'].Handlers['/'].Proxy = proxy;
    assert.equal(validateServe(value).code, 'non-loopback-proxy-rejected');
  }
});
test('plain TCP forwarding, extra web handlers, and foreground sessions require separate review', () => {
  const tcp = fixture(); tcp.TCP['8787'] = { TCPForward: 'localhost:8787' };
  assert.equal(validateServe(tcp).code, 'non-https-route-rejected');
  const handler = fixture(); handler.Web['private-host.example.ts.net:443'].Handlers['/other'] = { Proxy: 'http://127.0.0.1:8787' };
  assert.equal(validateServe(handler).code, 'unexpected-serve-routes');
  const foreground = fixture(); foreground.Foreground = { session: {} };
  assert.equal(validateServe(foreground).code, 'foreground-serve-rejected');
});
test('missing, malformed and unconfigured statuses do not pass', () => {
  for (const value of [null, [], 'status', {}, { Web: {} }, { TCP: { '443': { HTTPS: true } } }]) assert.equal(validateServe(value).configurationVerified, false);
});
test('malformed Funnel allowance values cannot pass a private-network verification', () => {
  for (const allowance of [true, false, 'true', [], ['false'], { host: 'false' }, { host: 0 }, { host: null }]) {
    const value = fixture(); value.AllowFunnel = allowance;
    assert.equal(validateServe(value).code, 'invalid-serve-status');
  }
});
