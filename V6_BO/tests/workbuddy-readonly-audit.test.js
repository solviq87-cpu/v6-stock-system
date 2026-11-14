'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit, privateShareCode, PATHS, ORIGIN } = require('../scripts/workbuddy-readonly-audit');

const SECRET = 'fixture-only-SHARECODE-123456';
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
    if (parsed.pathname === '/') return new Response('<h1>private</h1>', { status: 200 });
    if (parsed.pathname === '/api/records') return json({ ok: true, records: [
      { name: 'v6.app.state', content: JSON.stringify({ revision: 2, cash: 1000, positions: [], orders: [], privatePassword: 'sensitive-account-data' }) },
      { name: 'v6.news.pool', content: '{}' }
    ] });
    return json({ ok: true, password: 'sensitive-account-data', site: { html: '<h1>private</h1>' } });
  } });
  assert.deepEqual(paths, PATHS);
  assert.equal(result.ok, true);
  assert.equal(result.method, 'GET-only');
  assert.equal(result.endpoints[3].recordCount, 2);
  assert.equal(result.endpoints[3].hasV6State, true);
  assert.equal(result.endpoints[3].ledgerStatus, 'shape-readable-unverified');
  assert.equal(result.htmlMatch, true);
  assert.equal(result.accountRecoveryVerified, false);
  const output = JSON.stringify(result);
  assert.ok(!output.includes(SECRET) && !output.includes('sensitive-account-data'));
  assert.ok(!output.includes('privatePassword') && !output.includes('<h1>private</h1>'));
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
  assert.equal(result.ok, false, 'missing ledger cannot be reported as recovered');
  assert.equal(result.code, 'ledger-missing');
  assert.equal(result.endpoints[3].recordCount, 0);
  assert.equal(result.endpoints[3].hasV6State, false);
  assert.equal(result.accountRecoveryVerified, false);
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
  assert.throws(() => privateShareCode(link), /ELOOP|credential-file-permissions-invalid/);
});

test('permission errors, missing route and malformed JSON have different evidence classifications', async () => {
  const fixture = (status, body) => audit({ sharecode: SECRET, request(url) {
    if (new URL(url).pathname === '/') return new Response('<h1>private</h1>');
    if (new URL(url).pathname === '/api/records')
      return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    return json({ ok: true, site: { html: '<h1>private</h1>' } });
  } });
  assert.equal((await fixture(403, 'private stuff')).code, 'records-access-denied');
  assert.equal((await fixture(404, 'private stuff')).code, 'records-endpoint-not-found');
  assert.equal((await fixture(200, '<html>not JSON</html>')).code, 'records-unverified');
});

test('duplicate, invalid-json and missing account fields all fail without leaking account payload', async () => {
  const rows = [
    [{ name: 'v6.app.state', content: '{"revision":' }],
    [{ name: 'v6.app.state', content: '{}' }],
    [{ name: 'v6.app.state', content: JSON.stringify({revision:1,cash:3,positions:[],orders:[]}) },
      { name: 'v6.app.state', content: JSON.stringify({revision:2,cash:5,positions:[],orders:[]}) }]
  ];
  const labels=['invalid-json','unrecognized-shape','duplicate-ambiguous'];
  for(let i=0;i<rows.length;i++){
    const response=await audit({sharecode: SECRET, request(url) {
      const u=new URL(url);
      if(u.pathname === '/') return new Response('<html>safe fixture</html>');
      if(u.pathname === '/api/site') return json({ok:true,site:{html:'<html>safe fixture</html>'}});
      if(u.pathname === '/api/records') return json({ok:true,records:rows[i]});
      return json({ok:true});
    }});
    assert.equal(response.ok,false);
    assert.equal(response.code,'ledger-unverified');
    assert.equal(response.endpoints[3].ledgerStatus,labels[i]);
    assert.equal(response.accountRecoveryVerified,false);
    assert.ok(!JSON.stringify(response).includes(SECRET));
  }
});

test('matching JSON API health does not hide mismatched published HTML', async () => {
  const ledger = { name: 'v6.app.state', content: JSON.stringify({revision:1,cash:300,positions:[],orders:[]}) };
  const response=await audit({ sharecode: SECRET, request(url) {
    const u=new URL(url);
    if(u.pathname === '/') return new Response('<html>frontend version A</html>');
    if(u.pathname === '/api/site') return json({ok:true,published:true,site:{html:'<html>frontend version B</html>'}});
    if(u.pathname === '/api/records') return json({ok:true,records:[ledger]});
    return json({ok:true});
  }});
  assert.equal(response.code,'site-html-mismatch');
  assert.equal(response.htmlMatch,false);
  assert.equal(response.ok,false);
  assert.equal(response.accountRecoveryVerified,false);
  assert.ok(!JSON.stringify(response).includes('frontend version A'));
  assert.ok(!JSON.stringify(response).includes('frontend version B'));
});

test('missing site HTML evidence is not treated as verified release identity', async () => {
  const ledger={name:'v6.app.state',content:{revision:1,cash:100,positions:[],orders:[]}};
  const response=await audit({ sharecode:SECRET, request(url) {
    const u=new URL(url);
    if(u.pathname === '/') return new Response('<html>fixture</html>');
    if(u.pathname === '/api/records') return json({ok:true,records:[ledger]});
    return json({ok:true});
  }});
  assert.equal(response.code,'site-html-unverified');
  assert.equal(response.ok,false);
  assert.equal(response.htmlMatch,null);
});

test('response over byte limit does not count as verified records', async () => {
  const response=await audit({ sharecode: SECRET, request(url) {
    const u=new URL(url);
    if(u.pathname === '/api/records') return new Response('x'.repeat(4*1024*1024+1));
    if(u.pathname === '/') return new Response('<html>fixture</html>');
    return json({ok:true,site:{html:'<html>fixture</html>'}});
  }});
  assert.equal(response.code,'records-unverified');
  assert.equal(response.endpoints[3].error,'oversized-response');
  assert.equal(response.ok,false);
});

test('record payloads are never printed, including unknown shape and transport failures', async () => {
  const sensitive='VERY_PRIVATE_ACCOUNT_DATA';
  const response=await audit({ sharecode:SECRET, request(url) {
    const u=new URL(url);
    if(u.pathname === '/') return new Response('<html>fixture</html>');
    if(u.pathname === '/api/site') return json({ok:true,site:{html:'<html>fixture</html>',password:sensitive}});
    if(u.pathname === '/api/records') return json({ok:true,records:[{name:'v6.app.state',content:JSON.stringify({secret:sensitive})}]});
    return json({ok:true,token:sensitive});
  }});
  const printed=JSON.stringify(response);
  assert.equal(response.code,'ledger-unverified');
  assert.ok(!printed.includes(sensitive));
  assert.ok(!printed.includes(SECRET));
});
