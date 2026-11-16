'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const diagnostics = require('../src/server/client-error-diagnostics');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function route(start, next) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0);
  const end = source.indexOf(next, offset + start.length);
  assert.ok(end > offset);
  return source.slice(offset, end);
}
const similar = route("  if (p === '/api/similar') {", "  if (p === '/api/shortline') {");
const clientError = route("  if (p === '/api/client-error') {", "  // 数据源自检快照");

async function similarRequest(role, force) {
  let scans = 0, result;
  const context = {
    p: '/api/similar', req: { __tok: 'fixture-' + role }, res: {},
    u: new URL('http://fixture/api/similar' + (force ? '?force=1' : '')),
    scanSimilarPush: async () => { scans++; },
    requireEditor: (_, token) => {
      assert.equal(token, 'fixture-' + role);
      if (role === 'edit') return true;
      result = { ok: false, readOnly: true }; return false;
    },
    S: { similar: { time: 'fixture-time', items: [{ code: '000001' }] }, learn: {} },
    _govCfg: () => 70, json: (_, value) => { result = value; }, console
  };
  await vm.runInNewContext('(async()=>{' + similar + '})()', context);
  return { scans, result };
}

test('view forced similar request cannot scan, learn, or dispatch a notification', async () => {
  const r = await similarRequest('view', true);
  assert.equal(r.scans, 0); assert.equal(r.result.readOnly, true);
});
test('view ordinary similar query retains the existing result without a scan', async () => {
  const r = await similarRequest('view', false);
  assert.equal(r.scans, 0); assert.equal(r.result.ok, true);
  assert.equal(r.result.items[0].code, '000001');
});
test('editor can still explicitly force the similar scan', async () => {
  const r = await similarRequest('edit', true);
  assert.equal(r.scans, 1); assert.equal(r.result.ok, true);
});

test('diagnostic URL retains origin and path while dropping credentials, query and fragment', () => {
  assert.equal(diagnostics.diagnosticUrl('https://fixture-user:fixture-pass@example.test/nova/app.js?token=fixture-query#fixture-hash'), 'https://example.test/nova/app.js');
  assert.equal(diagnostics.diagnosticUrl('javascript:fixture-secret'), '');
  assert.equal(diagnostics.diagnosticUrl('/relative?token=fixture-secret'), '');
});
test('diagnostic text redacts bearer and common serialized credential fields', () => {
  const fields = ['token', 'access_token', 'refreshToken', 'deviceToken', 'resetToken', 'password', 'passwd', 'pwd', 'secret', 'api_key', 'machineKey', 'sharecode'];
  for (const field of fields) {
    for (const value of [field + '=fixture-secret', '"' + field + '":"fixture secret with space"', field + ':fixture-secret']) {
      const redacted = diagnostics.diagnosticText(value, 500);
      assert.ok(!redacted.includes('fixture'), field + ' was not redacted');
      assert.match(redacted, /REDACTED/);
    }
  }
  assert.ok(!diagnostics.diagnosticText('Authorization: Bearer fixture.header.signature', 500).includes('fixture.header.signature'));
});
test('diagnostic stack preserves source locations without URL secrets', () => {
  const result = diagnostics.sanitizeClientError({ msg: 'Failed to fetch', stack: 'at refresh (https://example.test/nova/app.js?token=fixture-query#fragment:7:12)', where: 'refresh', ua: 'Fixture Browser', url: 'https://example.test/nova/?sharecode=fixture-share#fixture-fragment' });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('fixture-query')); assert.ok(!serialized.includes('fixture-share'));
  assert.ok(!serialized.includes('fixture-fragment')); assert.match(result.stack, /example\.test\/nova\/app\.js/);
  assert.equal(result.msg, 'Failed to fetch'); assert.equal(result.where, 'refresh');
});
test('anonymous error route sanitizes both persisted diagnostics and console output', async () => {
  let saved = '', logged = '', response;
  const context = {
    p: '/api/client-error', __dirname: '/fixture',
    body: JSON.stringify({ msg: 'password=fixture-password Bearer fixture-bearer', stack: 'GET https://example.test/api?token=fixture-token#fixture-fragment', where: 'sharecode=fixture-share', url: 'https://example.test/nova/?token=fixture-url#fixture-hash' }),
    res: {}, Date,
    fs: { existsSync: () => false, appendFileSync: (_, line) => { saved += line; } },
    require: name => name === './src/server/client-error-diagnostics' ? diagnostics : require(name),
    console: { error: (...args) => { logged += args.join(' '); } },
    json: (_, value) => { response = value; }
  };
  await vm.runInNewContext('(async()=>{' + clientError + '})()', context);
  assert.equal(response.ok, true);
  assert.ok(saved.length > 0); assert.ok(logged.length > 0);
  for (const marker of ['fixture-password', 'fixture-bearer', 'fixture-token', 'fixture-fragment', 'fixture-share', 'fixture-url', 'fixture-hash']) {
    assert.ok(!saved.includes(marker), marker + ' persisted');
    assert.ok(!logged.includes(marker), marker + ' logged');
  }
  assert.equal(JSON.parse(saved).url, 'https://example.test/nova/');
});
test('diagnostic fields remain bounded on oversized or malformed reports', () => {
  assert.deepEqual(diagnostics.sanitizeClientError(null), { msg: '', stack: '', where: '', ua: '', url: '' });
  const report = diagnostics.sanitizeClientError(Object.fromEntries(['msg','stack','where','ua','url'].map(k => [k, 'x'.repeat(50000)])));
  assert.equal(report.msg.length, 500); assert.equal(report.stack.length, 4000);
  assert.equal(report.where.length, 60); assert.equal(report.ua.length, 300); assert.equal(report.url, '');
});
