'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  http = require('node:http'),
  { spawnSync } = require('node:child_process');
const { createFixture } = require('./helpers/v6-studio-fixture'),
  W = require('../src/core/research-workspace'),
  { fixture } = require('./helpers/research-workspace-fixtures');
const endpoint = '/api/research/manual-loop';
test(
  'real HTTP journal is private, same-origin, bounded, CAS/idempotent and shared between devices',
  { timeout: 45000 },
  async (t) => {
    const f = await createFixture({ count: 1 });
    t.after(() => f.close());
    const root = path.join(f.tmp, 'data', 'manual-decision-loop');
    const source = W.saveObservation(
      fixture(),
      { workspaceRoot: path.join(f.tmp, 'data', 'research-workspace') },
      { requestId: 'synthetic_http_source' },
    );
    let r = await f.request(endpoint);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result.revision, 0);
    assert.match(r.headers['cache-control'], /no-store/);
    assert.equal(fs.existsSync(root), false);
    for (const token of ['', f.viewerToken]) {
      r = await f.request(endpoint, 'GET', null, token);
      assert.notEqual(r.body?.ok, true);
      assert.equal(r.body?.result, undefined);
    }
    for (const q of ['?token=' + f.token, '?root=/etc', '?limit=10'])
      assert.notEqual((await f.request(endpoint + q)).body?.ok, true);
    assert.equal((await f.request(endpoint, 'DELETE')).status, 405);
    const body = {
      action: 'freeze',
      runId: source.runId,
      shares: 100,
      limitPrice: '10',
      requestId: 'http_loop_freeze',
      expectedRevision: 0,
    };
    assert.equal(
      (await f.request(endpoint, 'POST', body, f.viewerToken)).status,
      403,
    );
    assert.equal(fs.existsSync(root), false);
    r = await new Promise((resolve, reject) => {
      const raw = JSON.stringify(body),
        req = http.request(
          {
            hostname: '127.0.0.1',
            port: f.port,
            path: endpoint,
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + f.token,
              Origin: 'https://evil.invalid',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(raw),
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
      req.on('error', reject);
      req.end(raw);
    });
    assert.equal(r, 403);
    assert.equal(fs.existsSync(root), false);
    assert.equal(
      (await f.request(endpoint, 'POST', { ...body, note: 'x'.repeat(66000) }))
        .status,
      413,
    );
    r = await f.request(endpoint, 'POST', body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const planId = r.body.result.recordId;
    assert.equal(
      (await f.request(endpoint, 'POST', body)).body.result.reused,
      true,
    );
    assert.equal(
      (
        await f.request(endpoint, 'POST', {
          ...body,
          requestId: 'http_loop_stale',
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.request(endpoint, 'POST', { ...body, shares: 200 })).status,
      409,
    );
    assert.equal(
      (
        await f.request(endpoint, 'POST', {
          action: 'validate',
          planId,
          candidateId: 'a'.repeat(64),
          requestId: 'http_bad_path',
          expectedRevision: 1,
          path: '/etc/passwd',
        })
      ).status,
      422,
    );
    const second = await f.request(endpoint);
    assert.equal(second.body.result.revision, 1);
    assert.equal(second.body.result.plans[0].id, planId);
    assert.equal(second.body.result.plans[0].risk.aiMayChangeLimits, false);
    assert.equal(second.body.result.canTrade, false);
    const done = {
      action: 'not-executed',
      planId,
      reason: '合成HTTP测试未执行',
      expectedRevision: 1,
      requestId: 'http_loop_not_executed',
    };
    assert.equal((await f.request(endpoint, 'POST', done)).status, 200);
    assert.equal(
      (await f.request(endpoint)).body.result.summary.notExecuted,
      1,
    );
    const replay = spawnSync(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify(require(process.argv[1]).view(process.argv[2])))',
        path.resolve(__dirname, '../src/core/manual-decision-loop'),
        root,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).revision, 2);
    for (const secret of [
      f.token,
      f.viewerToken,
      f.tmp,
      'private-test-value',
      '"calendar":{"schemaVersion"',
    ])
      assert.ok(!JSON.stringify(second.body).includes(secret));
    assert.equal(second.body.result.plans[0].calendar.sessions, undefined);
    const files = fs.readdirSync(root);
    assert.deepEqual(
      files.filter((s) => s.endsWith('.json')),
      ['000001.json', '000002.json'],
    );
  },
);
