'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { main, parsePublisherOwner, readPublisherOwner, OWNER_PATH } = require('../scripts/managed-repository-auto-update');
const { main: githubMain } = require('../scripts/github-repository-auto-update');
const originalCli = require('../scripts/repository-auto-update');
const { peekPendingRepositoryUpdate, runRepositoryAutoUpdate } = require('../src/core/repository-auto-update');
const { TARGET } = require('../src/core/workbuddy-static-publisher');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const OWNER = { schemaVersion: 1, publisher: 'managed-task', repository: 'solviq87-cpu/v6-stock-system', branch: 'dev', targetOrigin: TARGET, scope: 'static-frontend-only' };
function candidate(sha = A, status = 'passed') { return { repository: OWNER.repository, branch: OWNER.branch, sha, ci: { sha, status } }; }
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-updater-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { schemaVersion: 1, repository: OWNER.repository, branch: OWNER.branch, targetOrigin: TARGET,
    stateDir: path.join(dir, 'state'), workflowPath: '.github/workflows/v6-ci.yml', requiredJobs: ['verify', 'verify-web'], intervalMs: 60000 };
  const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const seen = { credentialReads: 0, ownerReads: 0, sourceReads: 0, writes: 0, providerCreates: 0 };
  const env = { GITHUB_TOKEN: undefined };
  Object.defineProperty(env, 'V6_WORKBUDDY_SHARECODE', { get() { seen.credentialReads++; return 'fixture-private-access'; } });
  let actual = B;
  const identity = sha => ({ sha, releaseId: `r-${sha}`, artifactHash: sha + sha.slice(0, 24), targetOrigin: TARGET });
  const provider = { expectation: async ({ sha }) => identity(sha), inspect: async () => identity(actual),
    health: async () => ({ ...identity(actual), healthy: true }),
    apply: async args => { seen.writes++; actual = args.sha; return { ...identity(actual), receiptId: 'verified-receipt' }; },
    rollback: async () => assert.fail('healthy deployment must not roll back') };
  const dependencies = { env, sourceFactory: () => ({ detect: async () => { seen.sourceReads++; return candidate(); } }),
    readGitOwner: async request => { seen.ownerReads++; assert.equal(request.sha, A); assert.equal(request.path, OWNER_PATH); return JSON.stringify(OWNER); },
    fetchOwner: async () => assert.fail('local owner available'), providerFactory: () => { seen.providerCreates++; return provider; } };
  return { dir, config, file, seen, env, dependencies, provider, identity, setActual: sha => { actual = sha; },
    run: (flags = ['check']) => main([flags[0], file, ...flags.slice(1)], dependencies) };
}
test('strict owner contract rejects unknown/missing/extra/duplicate/oversized and mismatched authority fields', () => {
  assert.deepEqual(parsePublisherOwner(JSON.stringify(OWNER)), OWNER);
  assert.equal(parsePublisherOwner(JSON.stringify({ ...OWNER, publisher: 'github-actions' })).publisher, 'github-actions');
  const { scope, ...missing } = OWNER;
  for (const input of ['{broken', JSON.stringify(missing), JSON.stringify({ ...OWNER, extra: true }), JSON.stringify({ ...OWNER, publisher: 'unknown' }),
    JSON.stringify({ ...OWNER, branch: 'main' }), JSON.stringify({ ...OWNER, repository: 'other/repo' }), JSON.stringify({ ...OWNER, targetOrigin: 'https://other.example' }),
    JSON.stringify({ ...OWNER, scope: 'backend' }), JSON.stringify({ ...OWNER, schemaVersion: '1' }), `[${JSON.stringify(OWNER)}]`,
    JSON.stringify(OWNER).replace('{', '{"publisher":"github-actions",'), ' '.repeat(1025), Buffer.from([0xff, 0xfe])]) {
    assert.throws(() => parsePublisherOwner(input), error => error.code === 'owner-invalid' && error.message === 'owner-invalid');
  }
});
test('CI must pass for the exact latest repository SHA before owner or credential access', async t => {
  for (const value of [candidate(A, 'failed'), candidate(A, 'pending'), candidate(A, 'unknown'), { ...candidate(), ci: { status: 'passed', sha: B } },
    { ...candidate(), repository: 'other/repo' }, { ...candidate(), branch: 'main' }, null]) {
    const f = setup(t); f.dependencies.sourceFactory = () => ({ detect: async () => value });
    assert.equal((await f.run(['once', '--apply'])).code, 'ci-blocked');
    assert.equal(f.seen.ownerReads, 0); assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0);
  }
});
test('unknown owner and missing owner fail closed before secret reads or target operations', async t => {
  const f = setup(t); f.dependencies.readGitOwner = async () => JSON.stringify({ ...OWNER, publisher: 'unknown' });
  assert.equal((await f.run(['once', '--apply'])).code, 'owner-invalid');
  f.dependencies.readGitOwner = async () => { throw Error('missing local object'); };
  f.dependencies.fetchOwner = async () => ({ statusCode: 404, raw: 'private error text' });
  assert.equal((await f.run(['once', '--apply'])).code, 'owner-unavailable');
  assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0);
});
test('role switch to github-actions immediately blocks managed publisher without reading credentials', async t => {
  const f = setup(t); f.dependencies.readGitOwner = async () => JSON.stringify({ ...OWNER, publisher: 'github-actions' });
  assert.equal((await f.run(['once', '--apply'])).code, 'publisher-not-owner');
  assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0); assert.equal(f.seen.writes, 0);
});
test('branch head or CI movement after owner review blocks before credential access', async t => {
  for (const next of [candidate(B), candidate(A, 'pending')]) {
    const f = setup(t); let calls = 0;
    f.dependencies.sourceFactory = () => ({ detect: async () => ++calls === 1 ? candidate() : next });
    assert.equal((await f.run(['once', '--apply'])).code, next.sha === B ? 'source-head-changed' : 'ci-blocked');
    assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0); assert.equal(f.seen.writes, 0);
  }
});
test('in-main detect is pinned to reviewed immutable owner SHA and blocks a late move without writing', async t => {
  const f = setup(t); let calls = 0;
  f.dependencies.sourceFactory = () => ({ detect: async () => ++calls < 3 ? candidate() : candidate(B) });
  assert.equal((await f.run(['once', '--apply'])).code, 'source-head-changed');
  assert.equal(calls, 3); assert.equal(f.seen.writes, 0);
});
test('check and once without --apply reuse real coordinator in check mode with zero target writes', async t => {
  const f = setup(t);
  assert.equal((await f.run(['check'])).code, 'update-available');
  assert.equal((await f.run(['once'])).code, 'update-available'); assert.equal(f.seen.writes, 0);
  assert.equal(f.seen.sourceReads, 6); assert.ok(f.seen.credentialReads > 0);
});
test('explicit once applies through existing durable coordinator and repeated run verifies no-op', async t => {
  const f = setup(t);
  assert.equal((await f.run(['once', '--apply'])).code, 'applied');
  assert.equal((await f.run(['once', '--apply'])).code, 'up-to-date'); assert.equal(f.seen.writes, 1);
  const journal = JSON.parse(fs.readFileSync(path.join(f.config.stateDir, 'journal.json')));
  assert.equal(journal.latestVerified.sha, A); assert.equal(journal.transaction, null);
  assert.equal(journal.events.find(event => event.code === 'apply-receipt').receiptId, 'verified-receipt');
});
test('only check/once are allowed and watch/bootstrap/recovery never reach source or credentials', async t => {
  const f = setup(t);
  for (const flags of [['watch', '--apply'], ['bootstrap', '--apply', '--expected-legacy-hash', 'a'.repeat(64)],
    ['restore-legacy', '--apply', '--expected-current-hash', 'a'.repeat(64), '--legacy-snapshot-hash', 'a'.repeat(64)], ['check', '--apply']]) {
    assert.equal((await f.run(flags)).code, 'usage');
  }
  assert.equal(f.seen.sourceReads, 0); assert.equal(f.seen.credentialReads, 0);
});
test('owner raw fallback is bound to reviewed SHA fixed HTTPS path and rejects redirects/oversize', async t => {
  const f = setup(t);
  const deps = { readGitOwner: async () => { throw Error('not fetched'); }, fetchOwner: async request => {
    assert.equal(request.url, `https://raw.githubusercontent.com/${OWNER.repository}/${A}/${OWNER_PATH}`);
    assert.equal(request.timeoutMs, 12000); assert.equal(request.maxBytes, 1024);
    return { statusCode: 200, raw: Buffer.from(JSON.stringify(OWNER)) };
  } };
  assert.deepEqual(await readPublisherOwner(f.config, A, deps), OWNER);
  await assert.rejects(readPublisherOwner(f.config, 'dev', deps), /owner-invalid/);
  await assert.rejects(readPublisherOwner(f.config, A, { ...deps, fetchOwner: async () => ({ statusCode: 302, raw: JSON.stringify(OWNER) }) }), /owner-unavailable/);
  await assert.rejects(readPublisherOwner(f.config, A, { ...deps, fetchOwner: async () => ({ statusCode: 200, raw: ' '.repeat(1025) }) }), /owner-invalid/);
});
test('local git owner is read from immutable commit even when working tree role differs', async t => {
  const f = setup(t); const repo = path.join(f.dir, 'fixture-repo'); fs.mkdirSync(repo);
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'fixture']);
  const file = path.join(repo, OWNER_PATH); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(OWNER));
  git(['add', '.']); git(['commit', '-m', 'isolated owner fixture']); const sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(file, JSON.stringify({ ...OWNER, publisher: 'github-actions' }));
  assert.deepEqual(await readPublisherOwner({ ...f.config, repositoryRoot: repo }, sha, { fetchOwner: async () => assert.fail('immutable object exists') }), OWNER);
  assert.equal(JSON.parse(fs.readFileSync(file)).publisher, 'github-actions');
});
test('transport errors and injected unexpected result fields never reach sanitized output', async t => {
  const f = setup(t); f.dependencies.readGitOwner = async () => { throw Error('SECRET_BODY'); };
  f.dependencies.fetchOwner = async () => { throw Error('SECRET_TOKEN'); };
  const failure = await f.run(['once', '--apply']); assert.equal(failure.code, 'owner-unavailable'); assert.doesNotMatch(JSON.stringify(failure), /SECRET/);
  f.dependencies.readGitOwner = async () => JSON.stringify(OWNER);
  f.dependencies.runMain = async () => ({ code: 'up-to-date', deployedSha: A, raw: 'SECRET_BODY', credential: 'SECRET_TOKEN' });
  const success = await f.run(['once', '--apply']); assert.equal(success.code, 'up-to-date'); assert.doesNotMatch(JSON.stringify(success), /SECRET/);
});
test('GitHub actual entry requires an approved full SHA and rejects gate A when head is B before credentials', async t => {
  const f = setup(t); const args = ['once', f.file, '--apply'];
  for (const sha of [undefined, 'dev', A.slice(0, 12)]) {
    f.env.V6_APPROVED_PUBLISHER_SHA = sha; assert.equal((await githubMain(args, f.dependencies)).code, 'usage');
  }
  f.env.V6_APPROVED_PUBLISHER_SHA = A;
  f.dependencies.sourceFactory = () => ({ detect: async () => candidate(B) });
  assert.equal((await githubMain(args, f.dependencies)).code, 'source-head-changed');
  assert.equal(f.seen.ownerReads, 0); assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0);
});
test('GitHub owner and late detection both bind to the approved gate SHA', async t => {
  const f = setup(t); f.env.V6_APPROVED_PUBLISHER_SHA = A; const args = ['once', f.file, '--apply'];
  assert.equal((await githubMain(args, f.dependencies)).code, 'publisher-not-owner'); assert.equal(f.seen.credentialReads, 0);
  f.dependencies.readGitOwner = async () => JSON.stringify({ ...OWNER, publisher: 'github-actions' });
  let calls = 0; f.dependencies.sourceFactory = () => ({ detect: async () => ++calls < 3 ? candidate() : candidate(B) });
  assert.equal((await githubMain(args, f.dependencies)).code, 'source-head-changed'); assert.equal(f.seen.writes, 0);
  f.dependencies.sourceFactory = () => ({ detect: async () => candidate() });
  assert.equal((await githubMain(args, f.dependencies)).code, 'applied');
  assert.equal(f.seen.writes, 1);
});
async function interruptOwnedUpdate(t, f, publisherOwner) {
  const moduleFile = require.resolve('../src/core/repository-auto-update');
  const config = { ...f.config, mode: 'apply', ...(publisherOwner === undefined ? {} : { publisherOwner }) };
  const script = `const {runRepositoryAutoUpdate}=require(${JSON.stringify(moduleFile)});
const identity=sha=>({sha,releaseId:'r-'+sha,artifactHash:sha+sha.slice(0,24),targetOrigin:${JSON.stringify(TARGET)}});
runRepositoryAutoUpdate(${JSON.stringify(config)},{source:{detect:async()=>(${JSON.stringify(candidate())})},deploy:{
expectation:async({sha})=>identity(sha),inspect:async()=>identity(${JSON.stringify(B)}),health:async({sha})=>({healthy:true,...identity(sha)}),
apply:async()=>{process.stdout.write('APPLY_ENTERED\\n');await new Promise(()=>setInterval(()=>{},1000));},rollback:async()=>{throw Error('unexpected')}
}});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let entered = false, output = '';
  for await (const bytes of child.stdout) { output += bytes.toString(); if (output.includes('APPLY_ENTERED')) { entered = true; break; } }
  assert.equal(entered, true, 'the actual coordinator must persist apply-started before interruption');
  child.kill('SIGKILL'); await once(child, 'exit'); f.setActual(A);
  return peekPendingRepositoryUpdate(f.config);
}
test('owned interrupted transaction recovers or rolls back before newer CI pending/failed/source outage checks', async t => {
  for (const status of ['pending', 'failed', 'offline']) {
    for (const healthy of [true, false]) {
      const f = setup(t); assert.deepEqual(await interruptOwnedUpdate(t, f, 'managed-task'), { sha: A, publisherOwner: 'managed-task' });
      let sourceFactories = 0, rollbacks = 0;
      f.dependencies.sourceFactory = () => { sourceFactories++; return { detect: async () => {
        if (status === 'offline') throw Error('source unavailable'); return candidate('c'.repeat(40), status);
      } }; };
      f.dependencies.readGitOwner = async () => assert.fail('frozen recovery never fetches current owner');
      f.provider.health = async args => ({ ...f.identity(args.sha), healthy: args.sha !== A || healthy });
      f.provider.rollback = async args => { rollbacks++; assert.equal(args.sha, B); f.setActual(B); return { ...f.identity(B), receiptId: 'restored-previous' }; };
      const out = await f.run(['once', '--apply']);
      assert.equal(out.code, healthy ? 'recovered' : 'rolled-back'); assert.equal(out.deployedSha, healthy ? A : B);
      assert.equal(sourceFactories, 0); assert.equal(f.seen.sourceReads, 0); assert.equal(f.seen.writes, 0);
      assert.equal(rollbacks, healthy ? 0 : 1); assert.ok(f.seen.credentialReads > 0);
      assert.equal(peekPendingRepositoryUpdate(f.config), null);
    }
  }
});
test('different publisher and old unowned transactions never read credentials or get automatically adopted', async t => {
  for (const owner of ['github-actions', undefined]) {
    const f = setup(t); await interruptOwnedUpdate(t, f, owner);
    assert.equal((await f.run(['once', '--apply'])).code, 'recovery-ownership-unverified');
    assert.equal(f.seen.credentialReads, 0); assert.equal(f.seen.providerCreates, 0); assert.equal(f.seen.sourceReads, 0);
  }
});
test('peek is read-only and a transaction cleared after peek cannot authorize a new candidate', async t => {
  const f = setup(t);
  assert.equal(peekPendingRepositoryUpdate(f.config), null); assert.equal(fs.existsSync(f.config.stateDir), false);
  await interruptOwnedUpdate(t, f, 'managed-task');
  f.dependencies.runMain = async (args, dependencies) => {
    const file = path.join(f.config.stateDir, 'journal.json'); const journal = JSON.parse(fs.readFileSync(file)); journal.transaction = null;
    fs.writeFileSync(file, JSON.stringify(journal)); return originalCli.main(args, dependencies);
  };
  assert.equal((await f.run(['once', '--apply'])).code, 'source-unavailable'); assert.equal(f.seen.writes, 0); assert.equal(f.seen.sourceReads, 0);
});
test('coordinator rechecks frozen owner under lock and invalid owner records fail closed', async t => {
  const f = setup(t); await interruptOwnedUpdate(t, f, 'managed-task');
  const mismatch = await runRepositoryAutoUpdate({ ...f.config, mode: 'apply', publisherOwner: 'github-actions' }, {
    source: { detect: async () => assert.fail('ownership mismatch must not read source') },
    deploy: { expectation: async () => assert.fail('must not build'), inspect: async () => assert.fail('must not inspect'),
      health: async () => assert.fail('must not check'), apply: async () => assert.fail('must not apply'), rollback: async () => assert.fail('must not roll back') }
  });
  assert.equal(mismatch.code, 'recovery-ownership-unverified');
  const file = path.join(f.config.stateDir, 'journal.json'); const journal = JSON.parse(fs.readFileSync(file));
  journal.transaction.publisherOwner = 'unknown-publisher'; fs.writeFileSync(file, JSON.stringify(journal));
  assert.throws(() => peekPendingRepositoryUpdate(f.config), /invalid-state/);
  assert.equal((await f.run(['once', '--apply'])).code, 'invalid-state'); assert.equal(f.seen.credentialReads, 0);
  assert.equal((await runRepositoryAutoUpdate({ ...f.config, publisherOwner: 'unknown-publisher' })).code, 'invalid-config');
});
