'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const { sameOriginOk, initialSetupAuthorized } = require('../src/server/request-security');
const { createDashboardServer } = require('../src/server/bootstrap');
const req = (origin, headers = {}, encrypted = false) => ({
  headers: { host: 'localhost:8787', ...(origin === undefined ? {} : { origin }), ...headers }, socket: { encrypted }
});

test('browser source must match scheme, hostname and effective port', () => {
  assert.equal(sameOriginOk(req('http://localhost:8787'), {}), true);
  for (const origin of ['http://localhost:1234', 'https://localhost:8787', 'null', '', 'file:///tmp/panel.html'])
    assert.equal(sameOriginOk(req(origin), {}), false, origin);
  assert.equal(sameOriginOk(req('https://dashboard.example', { host: 'dashboard.example:443' }, true), {}), true);
  assert.equal(sameOriginOk(req('http://[::1]:8787', { host: '[::1]:8787' }), {}), true);
  assert.equal(sameOriginOk(req(undefined), {}), true, 'native clients remain available with normal auth');
});

test('untrusted forwarding headers and retired default domains cannot open CORS', () => {
  assert.equal(sameOriginOk(req('https://evil.example', { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }), {}), false);
  assert.equal(sameOriginOk(req('https://quant-dashboard-77614.app.workbuddy.host'), {}), false);
  assert.equal(sameOriginOk(req('http://localhost:8787', { referer: 'https://evil.example/path' }), {}), false);
  assert.equal(sameOriginOk(req(undefined, { 'sec-fetch-site': 'cross-site' }), {}), false, 'no-referrer image requests cannot call local privileged APIs');
  assert.equal(sameOriginOk(req(undefined, { 'sec-fetch-site': 'same-site' }), {}), false, 'another port or subdomain is not the same origin');
  assert.equal(sameOriginOk(req(undefined, { 'sec-fetch-site': 'none' }), {}), true);
});

test('operator-configured TLS public origins work behind proxies, including Tailscale and Render', () => {
  for (const env of [{ QD_PUBLIC_URL: 'https://host.fixture.ts.net/panel' }, { RENDER_EXTERNAL_URL: 'https://host.fixture.ts.net/' }]) {
    assert.equal(sameOriginOk(req('https://host.fixture.ts.net', { referer: 'https://host.fixture.ts.net/page?q=x' }), env), true);
    assert.equal(sameOriginOk(req('http://host.fixture.ts.net'), env), false);
  }
});

const setupSecret = 'isolated-bootstrap-secret-32-characters';
test('public initial setup requires a private capability and cannot be disabled on Render', () => {
  for (const env of [{ RENDER: 'true', QD_REQUIRE_SETUP_TOKEN: '0' }, { QD_REQUIRE_SETUP_TOKEN: '1' }]) {
    assert.equal(initialSetupAuthorized(req(), {}, env), false);
    assert.equal(initialSetupAuthorized(req(), { setupToken: setupSecret }, env), false, 'unset secret fails closed');
    const configured = { ...env, QD_SETUP_TOKEN: setupSecret };
    assert.equal(initialSetupAuthorized(req(), {}, configured), false);
    assert.equal(initialSetupAuthorized(req(), { setupToken: 'wrong' }, configured), false);
    assert.equal(initialSetupAuthorized(req(), { setupToken: setupSecret }, configured), true);
    assert.equal(initialSetupAuthorized(req(undefined, { 'x-v6-setup-token': setupSecret }), {}, configured), true);
    assert.equal(initialSetupAuthorized(req(), { setupToken: 'é'.repeat(setupSecret.length) }, configured), false);
  }
  assert.equal(initialSetupAuthorized(req(), {}, { QD_CLOUD: '1' }), true, 'existing private Windows onboarding preserved');
});

function setupFixture({ persisted = true, access = null, env = { RENDER: 'true', QD_SETUP_TOKEN: setupSecret } } = {}) {
  const source = fs.readFileSync(process.env.V6_SECURITY_BASELINE_SOURCE || require.resolve('../server.js'), 'utf8');
  const start = source.indexOf("  if (p === '/api/lock/setup' && req.method === 'POST') {");
  const end = source.indexOf('// 自动识别：', start);
  assert.ok(start > 0 && end > start);
  const context = {
    accessSecret: access, PWD_MAXLEN: 200, ACCESS_FILE: 'fixture-access.json', _runtimeMK: '', writes: 0,
    crypto: require('node:crypto'), hashPwd: () => 'synthetic-password-hash',
    hasDev: () => !!context.accessSecret?.hash, hasView: () => !!context.accessSecret?.view,
    isLocalReq: () => true, roleOf: () => 'edit', issueToken: () => 'synthetic-session-token',
    atomicWrite: () => { context.writes++; return persisted; },
    initialSetupAuthorized: (request, body) => initialSetupAuthorized(request, body, env),
    json: (response, body) => { response.end(JSON.stringify(body)); }
  };
  vm.createContext(context);
  vm.runInContext('this.route = function(req,res,body) { const p="/api/lock/setup";\n' + source.slice(start, end) + '\n}', context);
  return context;
}

async function serveSetup(fixture, body, headers = {}) {
  const { server } = createDashboardServer({
    handle: (request, response, url, data) => fixture.route(request, response, data), sameOriginOk: request => sameOriginOk(request, {}),
    bodyLimit: 2048, host: '127.0.0.1', port: 0
  });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  try {
    const port = server.address().port;
    return await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path: '/api/lock/setup', method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers } }, response => {
        let raw = ''; response.on('data', chunk => raw += chunk); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(raw) }));
      });
      request.on('error', reject); request.end(JSON.stringify(body));
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('actual setup route blocks anonymous public account takeover before memory or disk mutation', async () => {
  const fixture = setupFixture();
  const denied = await serveSetup(fixture, { password: 'fixture-password' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'SETUP_AUTHORIZATION_REQUIRED');
  assert.equal(fixture.accessSecret, null); assert.equal(fixture.writes, 0);
  assert.equal(JSON.stringify(denied.body).includes(setupSecret), false);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.equal(denied.headers['referrer-policy'], 'no-referrer');
  const authorized = await serveSetup(fixture, { password: 'fixture-password' }, { 'x-v6-setup-token': setupSecret });
  assert.equal(authorized.body.ok, true); assert.equal(fixture.writes, 1);
  const again = await serveSetup(fixture, { password: 'fixture-password' });
  assert.equal(again.body.ok, false, 'bootstrap cannot reset an existing account');
  assert.equal(fixture.writes, 1);
});

test('failed initial editor or viewer setup restores the previously durable account and issues no session', async () => {
  const editor = setupFixture({ persisted: false });
  const denied = await serveSetup(editor, { password: 'fixture-password', setupToken: setupSecret });
  assert.equal(denied.body.ok, false); assert.equal(denied.body.token, undefined);
  assert.equal(editor.accessSecret, null);
  const original = { salt: 'fixture', hash: 'original-editor-hash', devices: {} };
  const before = JSON.stringify(original);
  const viewer = setupFixture({ persisted: false, access: original });
  const result = await serveSetup(viewer, { role: 'view', password: 'fixture-password' });
  assert.equal(result.body.ok, false);
  assert.equal(JSON.stringify(viewer.accessSecret), before);
  assert.equal(viewer.accessSecret.view, undefined);
});
