'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit, privateShareCode, PATHS, ORIGIN } = require('../scripts/workbuddy-readonly-audit');

const SECRET = 'fixture-only-SHARECODE-123456';
const HTML = '<!DOCTYPE html><html><body>private html body</body></html>';
const json = data => new Response(JSON.stringify(data), { status: 200,
  headers: { 'content-type': 'application/json' } });

test('without a sharecode no network or mutation is attempted', async () => {
  let calls = 0;
  const result = await audit({ request: () => { calls++; throw Error('unreachable'); }, now: () => 'fixed' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'credential-unavailable');
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('all four exact same-origin paths are read-only and only hashed metadata is emitted', async () => {
  const paths = [];
  const result = await audit({ sharecode: SECRET, now: () => '2026-11-14T00:00:00Z', request(url, options) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, ORIGIN);
    assert.equal(parsed.searchParams.get('sharecode'), SECRET);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    paths.push(parsed.pathname);
    if (parsed.pathname === '/') return new Response(HTML, {status: 200, headers: {'content-type':'text/html'}});
    if (parsed.pathname === '/api/records') return json({ ok: true, records: [
      { name: 'v6.app.state', content: '{"privatePassword":"sensitive-account-data"}' },
      { name: 'v6.news.pool', content: '{}' }
    ] });
    return json({ ok: true, password: 'sensitive-account-data', site: { html: HTML } });
  } });
  assert.deepEqual(paths, PATHS);
  assert.equal(result.ok, true);
  assert.equal(result.method, 'GET-only');
  assert.equal(result.endpoints[2].recordCount, 2);
  assert.equal(result.endpoints[2].hasV6State, true);
  assert.equal(result.endpoints[2].ledgerStatus, 'parseable-not-validated');
  assert.equal(result.pageIntegrity, 'matching-bytes');
  assert.equal(result.accountRecoveryVerified, false);
  assert.equal(result.serverLoginVerified, false);
  const output = JSON.stringify(result);
  assert.ok(!output.includes(SECRET) && !output.includes('sensitive-account-data'));
  assert.ok(!output.includes('privatePassword') && !output.includes(HTML));
});

test('HTML 403 is not misclassified as a working data backend or disclosed', async () => {
  const result = await audit({ sharecode: SECRET, request: () => new Response(
    '<html>please contact admin - secret</html>', { status: 403 }) });
  assert.equal(result.ok, false);
  assert.ok(result.endpoints.every(endpoint => endpoint.httpStatus === 403));
  assert.ok(!JSON.stringify(result).includes('secret</html>'));
});

test('malformed JSON 200 is not a successful API test', async () => {
  const result = await audit({ sharecode: SECRET, request: () => new Response('<html>not JSON</html>', { status: 200 }) });
  assert.equal(result.ok, false);
  assert.ok(result.endpoints.every(endpoint => endpoint.validJson === false));
});

test('unexpected empty data does not prove recovery of any historical account', async () => {
  const result = await audit({ sharecode: SECRET, request: () => json({ ok: true, records: [] }) });
  assert.equal(result.ok, true, 'API can work while records are empty, not a recovery proof');
  assert.equal(result.endpoints[2].recordCount, 0);
  assert.equal(result.endpoints[2].hasV6State, false);
});

test('transport errors cannot leak private URL/query or credentials', async () => {
  const result = await audit({ sharecode: SECRET, request: url => { throw Error('network failed at ' + url); } });
  assert.equal(result.ok, false);
  assert.equal(result.endpoints.length, 4);
  assert.ok(result.endpoints.every(row => row.error === 'transport-failed'));
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test('credential file must be absolute, 0600 and non-symlink', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = path.join(dir, 'sharecode'), link = path.join(dir, 'link');
  fs.writeFileSync(real, SECRET + '\n', { mode: 0o600 });
  assert.equal(privateShareCode(real), SECRET);
  assert.throws(() => privateShareCode('./sharecode'), /credential-path-required/);
  fs.chmodSync(real, 0o644);
  assert.throws(() => privateShareCode(real), /credential-file-permissions-invalid/);
  fs.chmodSync(real, 0o600);
  fs.symlinkSync(real, link);
  assert.throws(() => privateShareCode(link), /credential-file-permissions-invalid/);
});

test('duplicate or corrupt ledger remains unverified even with HTTP 200', async () => {
  for (const [records, expected] of [
    [[], 'not-returned'],
    [[{ name: 'v6.app.state', content: '{not-json' }], 'invalid-account-json'],
    [[{ name: 'v6.app.state', content: '{}' }, { name: 'v6.app.state', content: '{}' }], 'duplicate-ambiguous']
  ]) {
    const result = await audit({ sharecode: SECRET, request: url => new URL(url).pathname === '/api/records'
      ? json({ ok: true, records }) : json({ ok: true, site: { html: HTML } }) });
    assert.equal(result.endpoints[2].ledgerStatus, expected);
    assert.equal(result.accountRecoveryVerified, false);
  }
});

test('root/site HTML version mismatch is shown without leaking either page', async () => {
  const result = await audit({ sharecode: SECRET, request(url) {
    const p = new URL(url).pathname;
    if (p === '/') return new Response('<!DOCTYPE html><html>different private page</html>');
    if (p === '/api/site') return json({ok:true,site:{html:HTML}});
    if (p === '/api/records') return json({ok:true,records:[{name:'v6.app.state',content:'{}'}]});
    return json({ok:true});
  }});
  assert.equal(result.pageIntegrity, 'different-bytes');
  assert.equal(result.ok, true, 'root mismatch does not change the three API responses');
  assert.ok(!JSON.stringify(result).includes('different private page'));
  assert.ok(!JSON.stringify(result).includes(HTML));
});

test('missing root page cannot be marked as HTML readback success', async () => {
  const result = await audit({ sharecode: SECRET, request: url => new URL(url).pathname === '/'
    ? new Response('unknown', {status:404}) : json({ok:true,records:[]}) });
  assert.equal(result.pageIntegrity,'unverified');
  assert.equal(result.endpoints[3].httpStatus,404);
  assert.equal(result.accountRecoveryVerified,false);
});
