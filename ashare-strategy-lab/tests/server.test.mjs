import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request as sendHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAppServer } from '../server.mjs';
import { evaluate } from '../public/engine.mjs';

async function listen(t, server) {
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
}

async function setup(t, evaluator = input => ({ evaluatedStock: input.stock?.code ?? null })) {
  const root = await mkdtemp(join(tmpdir(), 'ashare-test-'));
  const publicDir = join(root, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>研究台</title>');
  await writeFile(join(publicDir, 'engine.mjs'), 'export const test = true;');
  await writeFile(join(root, 'private.json'), '{"testOnly":true}');
  const server = await createAppServer({ publicDir, evaluator });
  await listen(t, server);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { server, root, publicDir };
}

function request(server, path, { method = 'GET', body = [], headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    // Use raw paths here because URL parsing normally removes dot segments before transmission.
    const req = sendHttp({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    for (const chunk of body) req.write(chunk);
    req.end();
  });
}

test('serves the homepage and JavaScript modules with matching GET and HEAD metadata', async t => {
  const { server } = await setup(t);
  const page = await request(server, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /研究台/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  const module = await request(server, '/engine.mjs');
  const head = await request(server, '/engine.mjs', { method: 'HEAD' });
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /javascript/);
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], module.headers['content-length']);
  assert.equal(head.body, '');
});

test('uses the evaluator statelessly and keeps API errors and health boundaries explicit', async t => {
  const { server } = await setup(t, input => {
    if (input.stock?.code === 'bad') throw new TypeError('证券代码格式无效');
    return { code: input.stock?.code ?? null };
  });
  const health = await request(server, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  const options = input => ({
    method: 'POST', headers: { 'content-type': 'application/json' }, body: [JSON.stringify(input)],
  });
  const valid = await request(server, '/api/evaluate', options({ stock: { code: '600000' } }));
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(valid.body), { code: '600000' });
  assert.equal(valid.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse((await request(server, '/api/evaluate', options({}))).body), { code: null });
  const invalid = await request(server, '/api/evaluate', options({ stock: { code: 'bad' } }));
  assert.equal(invalid.status, 400);
  assert.match(invalid.body, /证券代码格式无效/);
  assert.equal((await request(server, '/api/evaluate', options([]))).status, 400);
  const badMethod = await request(server, '/api/evaluate');
  assert.equal(badMethod.status, 405);
  assert.equal(badMethod.headers.allow, 'POST');
  assert.equal((await request(server, '/api/absent')).status, 404);
});

test('the default production endpoint produces the same 95-rule evaluation as the browser', async t => {
  const server = await createAppServer();
  await listen(t, server);
  const sample = { stock: { code: '600001', day: '2026-11-20' } };
  const response = await request(server, '/api/evaluate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: [JSON.stringify(sample)],
  });
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.rules.length, 95);
  assert.deepEqual(result, evaluate(sample));
});

test('limits body size for declared and streamed requests and rejects non-JSON types', async t => {
  const { server } = await setup(t);
  const headers = { 'content-type': 'application/json' };
  assert.equal((await request(server, '/api/evaluate', { method: 'POST', headers, body: ['{broken'] })).status, 400);
  assert.equal((await request(server, '/api/evaluate', { method: 'POST', body: ['{}'] })).status, 415);
  const large = JSON.stringify({ field: 'a'.repeat(65_536) });
  const declared = await request(server, '/api/evaluate', {
    method: 'POST', body: [large], headers: { ...headers, 'content-length': Buffer.byteLength(large) },
  });
  assert.equal(declared.status, 413);
  const chunked = await request(server, '/api/evaluate', {
    method: 'POST', body: [large.slice(0, 10), large.slice(10)], headers,
  });
  assert.equal(chunked.status, 413);
});

test('exposes only allowed static files inside public/', async t => {
  const { server, root, publicDir } = await setup(t);
  for (const path of ['/private.json', '/missing.html', '/DEPLOYMENT.md']) {
    assert.equal((await request(server, path)).status, 404);
  }
  for (const path of ['/../private.json', '/%2e%2e/private.json', '/%2e%2e%5cprivate.json', '/.env', '/bad%']) {
    assert.equal((await request(server, path)).status, 400);
  }
  if (process.platform !== 'win32') {
    await symlink(join(root, 'private.json'), join(publicDir, 'linked.json'));
    assert.equal((await request(server, '/linked.json')).status, 404);
  }
});
