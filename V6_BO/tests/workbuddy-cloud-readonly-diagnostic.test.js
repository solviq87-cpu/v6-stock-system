'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { diagnose, readShareCode, TARGET } = require('../scripts/workbuddy-cloud-readonly-diagnostic');
const SECRET = 'test-secret-never-disclose';
const response = (body, status=200, type='application/json') => new Response(body, { status, headers: { 'content-type': type } });
function fixture(routes={}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, TARGET);
    assert.equal(u.searchParams.get('sharecode'), SECRET);
    assert.equal(u.searchParams.size, 1);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    requests.push(u.pathname);
    const entry = routes[u.pathname];
    if (entry instanceof Error) throw entry;
    return typeof entry === 'function' ? entry() : entry instanceof Response ? entry.clone() : (entry || response(JSON.stringify({ ok: true, records: [] })));
  };
  return { requests, fetchImpl };
}
const ledger = { name: 'v6.app.state', content: JSON.stringify({ revision: 2, balance: 'sensitive-private-cash' }) };
const routes = {
  '/': response('<!DOCTYPE html><html>private title</html>',200,'text/html'),
  '/api/site': response(JSON.stringify({ ok: true, published: true, site: { html: '<!DOCTYPE html><html>private title</html>' } })),
  '/api/health': response(JSON.stringify({ ok: true })),
  '/api/records': response(JSON.stringify({ ok: true, records: [ledger] }))
};
test('no sharecode = no requests and no secrets', async () => {
  const f = fixture(routes);
  const out = await diagnose({env:{}, fetchImpl:f.fetchImpl});
  assert.deepEqual(f.requests, []);
  assert.equal(out.code,'credential-required'); assert.equal(out.requests,0);
});
test('reads exactly four fixed same-origin endpoints using GET, never prints secret or account data', async () => {
  const f = fixture(routes);
  const out = await diagnose({ env:{V6_WORKBUDDY_SHARECODE:SECRET}, fetchImpl:f.fetchImpl, now:()=> '2026-11-14T14:00:00Z' });
  assert.deepEqual(f.requests,['/','/api/site','/api/health','/api/records']);
  assert.equal(out.code,'readonly-evidence-collected');
  assert.equal(out.htmlEquality,'matching-bytes');
  assert.equal(out.dataService.ledger,'parseable-not-validated');
  assert.equal(out.accountRecoveryVerified,false);
  assert.equal(out.productionDeploymentVerified,false);
  const exported=JSON.stringify(out);
  for(const sensitive of [SECRET, 'private title', 'sensitive-private-cash', 'v6.app.state', 'sharecode']) assert.ok(!exported.includes(sensitive),sensitive);
});
test('classifies nonexistent records route without inventing a backend or performing a POST', async () => {
  const f=fixture({...routes,'/api/records':response('not found '+SECRET,404)});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.code,'records-endpoint-not-found'); assert.equal(out.endpoints.records.status,404);
  assert.ok(!JSON.stringify(out).includes(SECRET));
});
test('access denied is not mislabeled as nonexistent route', async () => {
  const f=fixture({...routes,'/api/records':response('password '+SECRET,403)});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.code,'records-access-denied');
});
test('empty records and broken content are not success', async () => {
  for (const [records, expected] of [
    [[], 'ledger-not-returned'],
    [[{name:'v6.app.state',content:'{{ broken'}], 'ledger-unverified'],
    [[ledger, ledger], 'ledger-unverified'],
  ]) {
    const f=fixture({...routes,'/api/records':response(JSON.stringify({ok:true,records}))});
    const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
    assert.equal(out.code,expected);
  }
});
test('root/site mismatch produces explicit evidence without publication claim', async () => {
  const f=fixture({...routes,'/':response('<html>different</html>')});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.htmlEquality,'different-bytes');assert.equal(out.code,'site-html-different');
});
test('redirect or transport failure cannot be treated as 200 success', async () => {
  const f=fixture({...routes,'/api/records':new Error('redirect to https://evil/?sharecode='+SECRET)});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.code,'records-unverified');
  assert.ok(!JSON.stringify(out).includes(SECRET));
});
test('rejects invalid credentials and group-readable or symlinked private file', async t => {
  const f=fixture(routes);
  const bad=await diagnose({env:{V6_WORKBUDDY_SHARECODE:'bad token'},fetchImpl:f.fetchImpl});
  assert.equal(bad.code,'credential-invalid');assert.equal(bad.requests,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cloud-readonly-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=path.join(dir,'sharecode');fs.writeFileSync(file,SECRET,{mode:0o600});
  assert.equal(readShareCode({V6_WORKBUDDY_SHARECODE_FILE:file}),SECRET);
  fs.chmodSync(file,0o644);
  const f2=await diagnose({env:{V6_WORKBUDDY_SHARECODE_FILE:file},fetchImpl:f.fetchImpl});
  assert.equal(f2.code,'credential-invalid');assert.equal(f2.requests,0);
  fs.chmodSync(file,0o600);
  const symlink=path.join(dir,'link');fs.symlinkSync(file,symlink);
  const f3=await diagnose({env:{V6_WORKBUDDY_SHARECODE_FILE:symlink},fetchImpl:f.fetchImpl});
  assert.equal(f3.code,'credential-invalid');assert.equal(f3.requests,0);
});
test('non-200 HTML is never parsed or copied into the report', async () => {
  const f=fixture({...routes,'/api/site':response('<script>'+SECRET+'</script>',404)});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.endpoints.site.status,404);
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.equal(out.siteHtml,undefined);
});
test('oversized responses are rejected without a false success state', async () => {
  const huge='x'.repeat(8*1024*1024+1);
  const f=fixture({...routes,'/api/records':() => response(huge)});
  const out=await diagnose({env:{V6_WORKBUDDY_SHARECODE:SECRET},fetchImpl:f.fetchImpl});
  assert.equal(out.endpoints.records.code,'response-unreadable');
  assert.equal(out.code,'records-unverified');
  assert.ok(!JSON.stringify(out).includes(huge.slice(0,100)));
});
