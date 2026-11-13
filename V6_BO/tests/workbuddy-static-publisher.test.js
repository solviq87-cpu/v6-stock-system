'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createWorkBuddyStaticPublisher, TARGET } = require('../src/core/workbuddy-static-publisher');
const { buildWorkBuddyStatic } = require('../scripts/build-workbuddy-static');
const SHA = 'a'.repeat(40), NEXT = 'b'.repeat(40), FOREIGN = 'c'.repeat(40);
const hash = html => crypto.createHash('sha256').update(html).digest('hex');
const LEGACY = '<!doctype html><html><head><title>Legacy</title></head><body><script>const SHARE="OLD_PRIVATE_ACCESS_VALUE";</script>Legacy</body></html>';
const PRIVATE = 'TEST_PRIVATE_RUNTIME_ACCESS_VALUE';

function setup(t, legacy = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.html');
  fs.writeFileSync(file, '<!doctype html><html><head><title>V6</title></head><body>dashboard</body></html>');
  const artifacts = Object.fromEntries([SHA, NEXT, FOREIGN].map(sha => [sha, buildWorkBuddyStatic({ sourceFile: file, sha })]));
  const stateDir = path.join(dir, 'private-state');
  const config = { targetOrigin: TARGET, shareCode: PRIVATE, stateDir, artifactForSha: async sha => artifacts[sha] };
  let current = { html: legacy ? LEGACY : artifacts[SHA].html, title: 'V6', author: 'author', at: '2026-11-13T00:00:00Z' };
  let index = 0, post = 0;
  const requests = [];
  const hooks = {};
  const requestJson = async request => {
    index++; requests.push(request);
    if (hooks.request) await hooks.request(request, index);
    if (request.method === 'POST') {
      post++;
      if (hooks.post) return hooks.post(request, post);
      current = { ...current, ...request.body, at: `2026-11-13T00:00:${String(post).padStart(2, '0')}Z` };
      return { statusCode: 200, raw: JSON.stringify({ ok: true }) };
    }
    if (request.path === '/api/site') return { statusCode: 200, raw: JSON.stringify({ ok: true, published: true, site: current }) };
    if (request.path === '/api/health') return { statusCode: 200, raw: JSON.stringify({ ok: true, published: true, siteAt: current.at }) };
    return { statusCode: 200, raw: hooks.root ? hooks.root(current) : current.html };
  };
  const create = overrides => createWorkBuddyStaticPublisher({ ...config, ...overrides }, { requestJson });
  const provider = create();
  const actionArgs = (desired, current) => ({ sha: desired.sha, releaseId: desired.releaseId, artifactHash: desired.artifactHash,
    previousSha: current.sha, expectedCurrentReleaseId: current.releaseId, expectedCurrentArtifactHash: current.artifactHash,
    targetOrigin: TARGET, idempotencyKey: 'test-attempt' });
  const args = actionArgs(artifacts[NEXT], artifacts[SHA]);
  const rollbackArgs = actionArgs(artifacts[SHA], artifacts[NEXT]);
  return { dir, config, stateDir, artifacts, provider, args, rollbackArgs, actionArgs, hooks, requests, create,
    get: () => current, set: value => { current = { ...current, ...value }; }, posts: () => post };
}

test('inspect and health prove exact marked SHA/root; snapshot excludes private page bytes', async t => {
  const f = setup(t); const actual = await f.provider.inspect({ targetOrigin: TARGET });
  assert.equal(actual.sha, SHA); assert.equal(actual.scope, 'static-frontend-only');
  assert.equal((await f.provider.health(actual)).healthy, true);
  const snapshot = await f.provider.snapshot();
  assert.equal(snapshot.artifactHash, hash(f.get().html)); assert.equal(Object.hasOwn(snapshot, 'html'), false);
  assert.equal(f.posts(), 0);
});
test('apply snapshots encrypted prior HTML, verifies published root and returns evidence receipt', async t => {
  const f = setup(t); const r = await f.provider.apply(f.args);
  assert.equal(r.sha, NEXT); assert.equal(r.targetOrigin, TARGET); assert.equal(r.basis, 'post-readback');
  assert.match(r.receiptId, /^wb-[a-f0-9]{56}$/); assert.equal(f.posts(), 1);
  assert.equal(f.get().html, f.artifacts[NEXT].html);
  const snapshots = path.join(f.stateDir, 'snapshots'); const files = fs.readdirSync(snapshots);
  assert.equal(files.length, 2); const encoded = fs.readFileSync(path.join(snapshots, files[0]), 'utf8');
  assert.equal(encoded.includes('<!doctype'), false); assert.equal(encoded.includes(PRIVATE), false);
  assert.equal(fs.statSync(snapshots).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(snapshots, files[0])).mode & 0o777, 0o600);
  assert.ok(f.requests.every(r => !r.path.includes('sharecode') && !JSON.stringify(r).includes(PRIVATE)));
});
test('no-op verified existing candidate performs no POST', async t => {
  const f = setup(t); f.set({ html: f.artifacts[NEXT].html });
  const r = await f.provider.apply(f.args); assert.equal(r.basis, 'already-present'); assert.equal(f.posts(), 0);
});
function foreignArtifact(f, sha) {
  const sourceFile = path.join(f.dir, 'manual.html');
  fs.writeFileSync(sourceFile, '<!doctype html><html><head><title>Manual</title></head><body>different page</body></html>');
  return buildWorkBuddyStatic({ sourceFile, sha });
}
test('expectation builds trusted bytes; another valid artifact with same SHA is rejected', async t => {
  const f = setup(t); let calls = 0;
  const provider = f.create({ artifactForSha: async sha => { calls++; return f.artifacts[sha]; } });
  const expected = await provider.expectation({ sha: NEXT, targetOrigin: TARGET });
  assert.equal(expected.artifactHash, f.artifacts[NEXT].artifactHash);
  f.set({ html: foreignArtifact(f, NEXT).html });
  await assert.rejects(provider.apply(f.args), /target-changed/);
  assert.equal(calls, 1); assert.equal(f.posts(), 0);
});
test('same-SHA foreign previous artifact and forged target descriptor block writes', async t => {
  const f = setup(t); f.set({ html: foreignArtifact(f, SHA).html });
  await assert.rejects(f.provider.apply(f.args), /target-changed/);
  await assert.rejects(f.provider.apply({ ...f.args, artifactHash: 'e'.repeat(64) }), /artifact-identity-mismatch/);
  assert.equal(f.posts(), 0);
});
test('rollback never accepts or overwrites a foreign artifact with either recorded SHA', async t => {
  const f = setup(t); await f.provider.apply(f.args);
  f.set({ html: foreignArtifact(f, NEXT).html });
  await assert.rejects(f.provider.rollback(f.rollbackArgs), /target-changed/);
  f.set({ html: foreignArtifact(f, SHA).html });
  await assert.rejects(f.provider.rollback(f.rollbackArgs), /target-changed/);
  assert.equal(f.posts(), 1);
});
test('unknown legacy current cannot be assigned an invented SHA', async t => {
  const f = setup(t, true);
  assert.equal((await f.provider.snapshot()).sha, undefined);
  await assert.rejects(f.provider.inspect({ targetOrigin: TARGET }), /unknown-current/);
  await assert.rejects(f.provider.apply(f.args), /target-changed/); assert.equal(f.posts(), 0);
});
test('legacy bootstrap requires exact explicit hash; backup hides old hardcoded credential', async t => {
  const f = setup(t, true);
  await assert.rejects(f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: '0'.repeat(64) }), /bootstrap-hash-mismatch/);
  assert.equal(f.posts(), 0);
  const r = await f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) });
  assert.equal(r.sha, NEXT); assert.equal(r.basis, 'bootstrap-readback'); assert.equal(f.posts(), 1);
  const encrypted = fs.readFileSync(path.join(f.stateDir, 'snapshots', `${hash(LEGACY)}.json`), 'utf8');
  assert.equal(encrypted.includes('OLD_PRIVATE_ACCESS_VALUE'), false); assert.equal(encrypted.includes(PRIVATE), false);
  await assert.rejects(f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) }), /bootstrap-hash-mismatch/);
  assert.equal(f.posts(), 1);
});
test('bootstrap partial write failure restores the exact encrypted legacy snapshot once', async t => {
  const f = setup(t, true);
  f.hooks.post = async (request, n) => {
    f.set({ html: request.body.html });
    if (n === 1) throw Error('response lost with PRIVATE secret');
    return { statusCode: 200, raw: '{"ok":true}' };
  };
  await assert.rejects(f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) }), /bootstrap-recovery-required/);
  assert.equal(f.posts(), 2); assert.equal(f.get().html, LEGACY);
});
test('bootstrap partial failure never overwrites a foreign manual update', async t => {
  const f = setup(t, true);
  f.hooks.post = async () => { f.set({ html: f.artifacts[FOREIGN].html }); throw Error('timeout'); };
  await assert.rejects(f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) }), /bootstrap-recovery-required/);
  assert.equal(f.posts(), 1); assert.equal(f.get().html, f.artifacts[FOREIGN].html);
});
test('explicit legacy recovery survives restart and source outage, including malformed current markers', async t => {
  const f = setup(t, true); await f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) });
  const malformed = f.artifacts[NEXT].html.replace('dashboard', 'interrupted content'); f.set({ html: malformed });
  let builds = 0;
  const restarted = f.create({ artifactForSha: async () => { builds++; throw Error('source offline'); } });
  const r = await restarted.restoreLegacy({ targetOrigin: TARGET, expectedCurrentArtifactHash: hash(malformed), legacySnapshotHash: hash(LEGACY) });
  assert.equal(r.artifactHash, hash(LEGACY)); assert.equal(r.targetOrigin, TARGET); assert.equal(r.scope, 'static-frontend-only');
  assert.match(r.receiptId, /^wb-[a-f0-9]{56}$/); assert.equal(Object.hasOwn(r, 'sha'), false);
  assert.equal(f.get().html, LEGACY); assert.equal(builds, 0); assert.equal(f.posts(), 2);
});
test('legacy recovery requires both full preimages and never overwrites a different actual page', async t => {
  const f = setup(t, true); await f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) });
  for (const changed of [{ expectedCurrentArtifactHash: undefined }, { legacySnapshotHash: 'short' }]) {
    await assert.rejects(f.provider.restoreLegacy({ targetOrigin: TARGET, expectedCurrentArtifactHash: f.artifacts[NEXT].artifactHash,
      legacySnapshotHash: hash(LEGACY), ...changed }), /invalid-restoration-request/);
  }
  await assert.rejects(f.provider.restoreLegacy({ targetOrigin: TARGET, expectedCurrentArtifactHash: '0'.repeat(64), legacySnapshotHash: hash(LEGACY) }), /target-changed/);
  assert.equal(f.posts(), 1); assert.equal(f.get().html, f.artifacts[NEXT].html);
});
test('legacy recovery rejects authenticated marked snapshots and forged encrypted backups', async t => {
  const f = setup(t, true); await f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) });
  const request = { targetOrigin: TARGET, expectedCurrentArtifactHash: f.artifacts[NEXT].artifactHash, legacySnapshotHash: hash(LEGACY) };
  await assert.rejects(f.provider.restoreLegacy({ ...request, legacySnapshotHash: f.artifacts[NEXT].artifactHash }), /not-legacy-snapshot/);
  const file = path.join(f.stateDir, 'snapshots', `${hash(LEGACY)}.json`);
  const encoded = JSON.parse(fs.readFileSync(file)); encoded.tag = Buffer.alloc(16).toString('base64'); fs.writeFileSync(file, JSON.stringify(encoded));
  await assert.rejects(f.provider.restoreLegacy(request), /invalid-snapshot/); assert.equal(f.posts(), 1);
});
test('legacy recovery final read rejects a foreign update before restoring', async t => {
  const f = setup(t, true); await f.provider.bootstrap({ sha: NEXT, expectedLegacyHash: hash(LEGACY) });
  let reads = 0;
  f.hooks.request = async request => {
    if (request.path === '/api/site' && ++reads === 2) f.set({ html: f.artifacts[FOREIGN].html });
  };
  await assert.rejects(f.provider.restoreLegacy({ targetOrigin: TARGET, expectedCurrentArtifactHash: f.artifacts[NEXT].artifactHash,
    legacySnapshotHash: hash(LEGACY) }), /target-changed/);
  assert.equal(f.posts(), 1); assert.equal(f.get().html, f.artifacts[FOREIGN].html);
});
test('rollback after process restart restores only the verified encrypted previous SHA', async t => {
  const f = setup(t); await f.provider.apply(f.args);
  const restarted = f.create();
  const r = await restarted.rollback(f.rollbackArgs);
  assert.equal(r.sha, SHA); assert.equal(r.basis, 'rollback-readback'); assert.equal(f.posts(), 2);
  assert.equal(f.get().html, f.artifacts[SHA].html);
});
test('restarted rollback uses exact authenticated local snapshot during a complete source outage', async t => {
  const f = setup(t); await f.provider.apply(f.args);
  let attempts = 0;
  const restarted = f.create({ artifactForSha: async () => { attempts++; throw Error('GitHub unavailable'); } });
  const r = await restarted.rollback(f.rollbackArgs);
  assert.equal(r.sha, SHA); assert.equal(f.get().html, f.artifacts[SHA].html); assert.equal(attempts, 0);
});
test('persisted coordinator transaction recovers and rolls back with source completely offline', async t => {
  const { runRepositoryAutoUpdate } = require('../src/core/repository-auto-update');
  const f = setup(t); await f.provider.apply(f.args);
  const descriptor = v => ({ sha: v.sha, releaseId: v.releaseId, artifactHash: v.artifactHash });
  const journal = { version: 1, scope: { repository: 'solviq87-cpu/v6-stock-system', branch: 'dev', targetOrigin: TARGET },
    latestVerified: descriptor(f.artifacts[SHA]), failedShas: [], retryTokens: [], events: [],
    transaction: { sha: NEXT, target: descriptor(f.artifacts[NEXT]), previous: descriptor(f.artifacts[SHA]),
      phase: 'rolling-back', rollbackAttempted: false, idempotencyKey: 'interrupted-attempt' } };
  fs.writeFileSync(path.join(f.stateDir, 'journal.json'), JSON.stringify(journal), { mode: 0o600 });
  let sourceCalls = 0;
  const provider = f.create({ artifactForSha: async () => { sourceCalls++; throw Error('source offline'); } });
  const result = await runRepositoryAutoUpdate({ stateDir: f.stateDir, targetOrigin: TARGET, mode: 'apply' }, {
    source: { detect: async () => { sourceCalls++; throw Error('source offline'); } }, deploy: provider
  });
  assert.equal(result.code, 'rolled-back'); assert.equal(result.deployedSha, SHA);
  assert.equal(f.get().html, f.artifacts[SHA].html); assert.equal(sourceCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'journal.json'))).transaction, null);
});
test('artifact cache is bounded and never caches branch or deployed target evidence', async t => {
  const f = setup(t); let builds = 0;
  const provider = f.create({ artifactForSha: async sha => { builds++; return f.artifacts[sha]; } });
  await provider.expectation({ sha: SHA, targetOrigin: TARGET });
  await provider.expectation({ sha: SHA, targetOrigin: TARGET }); assert.equal(builds, 1);
  for (let i = 1; i <= 9; i++) {
    const sha = i.toString(16).padStart(40, '0'); f.artifacts[sha] = buildWorkBuddyStatic({ sourceFile: path.join(f.dir, 'source.html'), sha });
    await provider.expectation({ sha, targetOrigin: TARGET });
  }
  await provider.expectation({ sha: SHA, targetOrigin: TARGET }); assert.equal(builds, 11);
  assert.equal((await provider.inspect({ targetOrigin: TARGET })).sha, SHA);
  f.set({ html: f.artifacts[NEXT].html });
  assert.equal((await provider.inspect({ targetOrigin: TARGET })).sha, NEXT);
});
test('tampered encrypted snapshot blocks rollback without any POST', async t => {
  const f = setup(t); await f.provider.apply(f.args);
  const file = path.join(f.stateDir, 'snapshots', `${f.artifacts[SHA].artifactHash}.json`);
  const envelope = JSON.parse(fs.readFileSync(file)); envelope.tag = Buffer.alloc(16).toString('base64'); fs.writeFileSync(file, JSON.stringify(envelope));
  await assert.rejects(f.provider.rollback(f.rollbackArgs), /invalid-snapshot/);
  assert.equal(f.posts(), 1);
});
test('wrong decryption credential and missing snapshots block rollback', async t => {
  const f = setup(t); await f.provider.apply(f.args);
  const wrongKey = f.create({ shareCode: 'a-different-private-key' });
  await assert.rejects(wrongKey.rollback(f.rollbackArgs), /invalid-snapshot/);
  fs.rmSync(path.join(f.stateDir, 'snapshots', `${f.artifacts[SHA].artifactHash}.json`));
  await assert.rejects(f.provider.rollback(f.rollbackArgs), /snapshot-not-found/);
  assert.equal(f.posts(), 1);
});
test('foreign target changes block both apply and rollback', async t => {
  const f = setup(t); f.set({ html: f.artifacts[FOREIGN].html });
  await assert.rejects(f.provider.apply(f.args), /target-changed/);
  await assert.rejects(f.provider.rollback(f.rollbackArgs), /target-changed/);
  assert.equal(f.posts(), 0);
});
test('change between snapshot and write is caught by final read check', async t => {
  const f = setup(t); let siteReads = 0;
  f.hooks.request = async request => {
    if (request.path === '/api/site' && ++siteReads === 3) f.set({ html: f.artifacts[FOREIGN].html });
  };
  await assert.rejects(f.provider.apply(f.args), /target-changed/); assert.equal(f.posts(), 0);
});
test('unhealthy or mismatched root blocks writes and fabricated receipts', async t => {
  const f = setup(t); f.hooks.root = () => '<html>different document</html>';
  await assert.rejects(f.provider.apply(f.args), /root-mismatch/); assert.equal(f.posts(), 0);
});
test('failed POST or mismatched readback never returns a publication receipt', async t => {
  const f = setup(t);
  f.hooks.post = async () => ({ statusCode: 200, raw: '{"ok":false}' });
  await assert.rejects(f.provider.apply(f.args), /publish-rejected/);
  f.hooks.post = async () => ({ statusCode: 200, raw: '{"ok":true}' });
  await assert.rejects(f.provider.apply(f.args), /publish-mismatch/); assert.equal(f.posts(), 2);
});
test('transport exceptions redact runtime credentials and arbitrary server errors', async t => {
  const f = setup(t);
  f.hooks.request = async () => { throw Error(`sensitive ${PRIVATE} https://secret-url?sharecode=${PRIVATE}`); };
  await assert.rejects(f.provider.apply(f.args), error => error.message === 'request-failed' && !JSON.stringify(error).includes(PRIVATE));
});
test('malformed release marker and oversized responses fail closed', async t => {
  const f = setup(t); f.set({ html: f.artifacts[SHA].html.replace('dashboard', 'tampered') });
  await assert.rejects(f.provider.inspect({ targetOrigin: TARGET }), /invalid-site-marker/);
  const invalid = createWorkBuddyStaticPublisher(f.config, { requestJson: async () => ({ statusCode: 200, raw: 'x'.repeat(2 * 1024 * 1024 + 1) }) });
  await assert.rejects(invalid.snapshot(), /request-failed/);
});
test('public and symlink ancestor state directories are rejected before requests', async t => {
  const f = setup(t); const alias = path.join(f.dir, 'alias'); fs.symlinkSync(f.stateDir, alias);
  assert.throws(() => f.create({ stateDir: path.join(alias, 'child') }), /unsafe-state-directory/);
  assert.throws(() => f.create({ stateDir: path.join(f.dir, 'public', 'state') }), /unsafe-state-directory/);
  assert.throws(() => f.create({ targetOrigin: 'https://other.example' }), /invalid-provider-config/);
  assert.equal(f.requests.length, 0);
});
test('retention rejects invalid backup files and preserves all evidence without a write', async t => {
  const f = setup(t); const snapshots = path.join(f.stateDir, 'snapshots');
  for (let i = 0; i < 32; i++) fs.writeFileSync(path.join(snapshots, `${i}.json`), '{}', { mode: 0o600 });
  await assert.rejects(f.provider.apply(f.args), /invalid-snapshot/); assert.equal(f.posts(), 0);
  assert.equal(fs.readdirSync(snapshots).length, 32);
});
test('more than 35 publications retain current, rollback predecessor and encrypted legacy within 32 backups', async t => {
  const f = setup(t, true);
  await f.provider.bootstrap({ sha: SHA, expectedLegacyHash: hash(LEGACY) });
  let current = f.artifacts[SHA], previous;
  for (let i = 1; i <= 37; i++) {
    const sha = i.toString(16).padStart(40, '0');
    const next = buildWorkBuddyStatic({ sourceFile: path.join(f.dir, 'source.html'), sha }); f.artifacts[sha] = next;
    await f.provider.apply(f.actionArgs(next, current)); previous = current; current = next;
    const files = fs.readdirSync(path.join(f.stateDir, 'snapshots'));
    assert.ok(files.length <= 32);
    for (const artifactHash of [hash(LEGACY), current.artifactHash, previous.artifactHash]) assert.ok(files.includes(`${artifactHash}.json`));
  }
  assert.equal(f.posts(), 38); assert.equal(fs.readdirSync(path.join(f.stateDir, 'snapshots')).length, 32);
  assert.equal((await f.create().rollback(f.actionArgs(previous, current))).sha, previous.sha);
  assert.equal(f.get().html, previous.html);
  assert.equal((await f.create().rollback(f.actionArgs(current, previous))).sha, current.sha);
  assert.equal(f.get().html, current.html);
});
test('retention halts on authenticated backup tampering rather than deleting it', async t => {
  const f = setup(t); let current = f.artifacts[SHA];
  for (let i = 1; i <= 31; i++) {
    const sha = i.toString(16).padStart(40, '0'); const next = buildWorkBuddyStatic({ sourceFile: path.join(f.dir, 'source.html'), sha });
    f.artifacts[sha] = next; await f.provider.apply(f.actionArgs(next, current)); current = next;
  }
  const file = path.join(f.stateDir, 'snapshots', `${f.artifacts[SHA].artifactHash}.json`);
  const corrupted = JSON.parse(fs.readFileSync(file)); corrupted.tag = Buffer.alloc(16).toString('base64'); fs.writeFileSync(file, JSON.stringify(corrupted));
  const sha = 'f'.repeat(40); const next = buildWorkBuddyStatic({ sourceFile: path.join(f.dir, 'source.html'), sha }); f.artifacts[sha] = next;
  const countBefore = f.posts();
  await assert.rejects(f.provider.apply(f.actionArgs(next, current)), /invalid-snapshot/);
  assert.equal(f.posts(), countBefore); assert.equal(fs.existsSync(file), true);
  assert.equal(fs.readdirSync(path.join(f.stateDir, 'snapshots')).length, 32);
});
test('same-process overlapping mutations are rejected before duplicate remote writes', async t => {
  const f = setup(t); let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  f.hooks.post = async request => { started(); await gate; f.set({ html: request.body.html }); return { statusCode: 200, raw: '{"ok":true}' }; };
  const first = f.provider.apply(f.args); await entered;
  await assert.rejects(f.provider.apply(f.args), /publisher-locked/);
  release(); await first; assert.equal(f.posts(), 1);
});
test('default curl transport passes credential URL only through stdin and rejects redirects', async t => {
  const f = setup(t); const bin = path.join(f.dir, 'bin'); fs.mkdirSync(bin);
  const output = path.join(f.dir, 'safe-invocation.json');
  const fake = `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2); let input='';
process.stdin.on('data', d=>input+=d);process.stdin.on('end',()=>{
  if(JSON.stringify(args)!=='["--disable","--config","-"]')process.exit(2);
  const line=input.split('\\n').find(l=>l.startsWith('url = '));const url=new URL(JSON.parse(line.slice(6)));
  if(url.origin!==${JSON.stringify(TARGET)}||url.searchParams.get('sharecode')!==${JSON.stringify(PRIVATE)})process.exit(3);
  if(!input.includes('max-filesize = 2097152')||input.includes('location'))process.exit(4);
  fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({args,receivedSecretViaStdin:true}));
  process.stdout.write('{"redirect":"https://other.example"}\\nV6_HTTP_STATUS:302');
});`;
  fs.writeFileSync(path.join(bin, 'curl'), fake, { mode: 0o700 });
  const savedPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  const provider = createWorkBuddyStaticPublisher(f.config);
  await assert.rejects(provider.inspect({ targetOrigin: TARGET }), /request-failed/);
  const report = JSON.parse(fs.readFileSync(output));
  assert.deepEqual(report.args, ['--disable', '--config', '-']); assert.equal(report.receivedSecretViaStdin, true);
  assert.equal(JSON.stringify(report).includes(PRIVATE), false);
});
test('real curl preserves exact Unicode HTML through a receiver that decodes split UTF-8 chunks incorrectly', { timeout: 10000 }, async t => {
  const http = require('node:http'); const { spawn } = require('node:child_process');
  const f = setup(t); const sourceFile = path.join(f.dir, 'unicode.html');
  fs.writeFileSync(sourceFile, '<!doctype html><html><head><title>天枢智策</title></head><body>' +
    '低波稳健 中文 😀 𠮷 \\n \\u4e2d "quoted" <p>换行\n制表\t</p>'.repeat(900) + '</body></html>');
  for (const sha of [SHA, NEXT]) f.artifacts[sha] = buildWorkBuddyStatic({ sourceFile, sha });
  let actual = { html: f.artifacts[SHA].html, title: '天枢智策', author: '测试', at: 1 };
  const receivedAscii = [];
  const server = http.createServer((req, res) => {
    let text = '', ascii = true;
    req.on('data', chunk => {
      // Deliberately reproduce the host bug at every byte boundary, independent of TCP packet sizes.
      for (let i = 0; i < chunk.length; i++) { ascii = ascii && chunk[i] < 128; text += chunk.subarray(i, i + 1).toString('utf8'); }
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        try { actual = { ...actual, ...JSON.parse(text), at: actual.at + 1 }; receivedAscii.push(ascii); res.end('{"ok":true}'); }
        catch { res.statusCode = 400; res.end('{"ok":false}'); }
      } else if (req.url.startsWith('/api/site')) res.end(JSON.stringify({ ok: true, published: true, site: actual }));
      else if (req.url.startsWith('/api/health')) res.end('{"ok":true,"published":true}');
      else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(actual.html); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  const originalPath = process.env.PATH;
  const curl = originalPath.split(path.delimiter).map(dir => path.join(dir, 'curl')).find(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
  });
  assert.ok(curl, 'real curl is required');
  const send = options => new Promise((resolve, reject) => {
    const child = spawn(curl, ['--disable', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume(); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error('local curl failed'))); child.stdin.end(options.join('\n') + '\n');
  });
  // Control uses the original serializer and must demonstrate corruption at the real HTTP receiver.
  await send([`url = ${JSON.stringify(`${localOrigin}/api/publish`)}`, 'request = "POST"', 'silent', 'proto = "=http"', 'max-time = 2',
    'header = "Content-Type: application/json"', `data-binary = ${JSON.stringify(JSON.stringify({ html: f.artifacts[NEXT].html }))}`]);
  assert.equal(receivedAscii[0], false); assert.notEqual(actual.html, f.artifacts[NEXT].html); assert.ok(actual.html.includes('\ufffd'));
  actual = { ...actual, html: f.artifacts[SHA].html };
  // Forward the production transport's exact stdin configuration to a loopback-only real curl.
  const bin = path.join(f.dir, 'curl-forwarder'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const {spawn}=require('node:child_process');let input='';process.stdin.on('data',data=>input+=data);process.stdin.on('end',()=>{
const line=input.split('\\n').find(s=>s.startsWith('url = '));const url=new URL(JSON.parse(line.slice(6)));
if(url.origin!==${JSON.stringify(TARGET)})process.exit(3);
input=input.replace(/^url = .+$/m,'url = '+JSON.stringify(${JSON.stringify(localOrigin)}+url.pathname+url.search)).replace('proto = "=https"','proto = "=http"');
const p=spawn(${JSON.stringify(curl)},['--disable','--config','-'],{stdio:['pipe','pipe','pipe']});p.stdout.pipe(process.stdout);p.stderr.resume();p.on('error',()=>process.exit(4));p.on('close',code=>process.exit(code??5));p.stdin.end(input);
});`, { mode: 0o700 });
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`; t.after(() => { process.env.PATH = originalPath; });
  const provider = createWorkBuddyStaticPublisher(f.config);
  const receipt = await provider.apply(f.actionArgs(f.artifacts[NEXT], f.artifacts[SHA]));
  assert.equal(receivedAscii[1], true); assert.equal(actual.html, f.artifacts[NEXT].html);
  assert.equal(receipt.artifactHash, f.artifacts[NEXT].artifactHash); assert.equal(receipt.releaseId, f.artifacts[NEXT].releaseId);
});
