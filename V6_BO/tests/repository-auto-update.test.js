'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { runRepositoryAutoUpdate } = require('../src/core/repository-auto-update');
const OLD = 'a'.repeat(40), NEXT = 'b'.repeat(40), NEWER = 'c'.repeat(40);
const ORIGIN = 'https://af3c7822e6aafc135.app.workbuddy.host';
const version = sha => ({ sha, releaseId: `release-${sha[0]}`, artifactHash: require('node:crypto').createHash('sha256').update(`fixture:${sha}`).digest('hex'), targetOrigin: ORIGIN });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-updater-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { stateDir: dir, targetOrigin: ORIGIN, mode: 'apply' };
  const calls = [];
  let actual = version(OLD);
  let head = NEXT;
  const source = { detect: async () => ({ sha: head, ci: { status: 'passed', sha: head } }) };
  const deploy = {
    expectation: async ({ sha }) => version(sha),
    inspect: async () => ({ ...actual }),
    health: async args => ({ healthy: true, ...version(args.sha) }),
    apply: async args => { calls.push(['apply', args]); actual = version(args.sha); return { receiptId: 'apply-1', ...actual }; },
    rollback: async args => { calls.push(['rollback', args]); actual = version(args.sha); return { receiptId: 'rollback-1', ...actual }; }
  };
  const run = overrides => runRepositoryAutoUpdate({ ...config, ...overrides }, { source, deploy, now: () => 10 });
  return { dir, config, source, deploy, calls, run, setActual: v => { actual = v; }, setHead: v => { head = v; }, journal: () => JSON.parse(fs.readFileSync(path.join(dir, 'journal.json'), 'utf8')) };
}

test('check is the default, passed CI alone never claims deployment', async t => {
  const f = fixture(t);
  const out = await runRepositoryAutoUpdate({ stateDir: f.dir, targetOrigin: ORIGIN }, { source: f.source, deploy: f.deploy });
  assert.equal(out.code, 'update-available'); assert.equal(out.deployedSha, OLD); assert.deepEqual(f.calls, []);
});
test('apply verifies target SHA, records real receipt and no-ops next poll', async t => {
  const f = fixture(t);
  assert.equal((await f.run()).code, 'applied');
  assert.equal((await f.run()).code, 'up-to-date');
  assert.equal(f.calls.length, 1);
  const j = f.journal(); assert.equal(j.latestVerified.sha, NEXT); assert.equal(j.transaction, null);
  assert.equal(j.events.find(e => e.code === 'apply-receipt').receiptId, 'apply-1');
  assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(f.dir, 'journal.json')).mode & 0o777, 0o600);
});
for (const ci of [undefined, { status: 'pending', sha: NEXT }, { status: 'failed', sha: NEXT }, { status: 'unknown', sha: NEXT }, { status: 'passed' }, { status: 'passed', sha: OLD }]) {
  test(`blocks missing/pending/failing/unbound CI: ${JSON.stringify(ci)}`, async t => {
    const f = fixture(t); f.source.detect = async () => ({ sha: NEXT, ci });
    assert.equal((await f.run()).code, 'ci-blocked'); assert.equal(f.calls.length, 0);
  });
}
test('missing provider is explicit, never a deployment result', async t => {
  const f = fixture(t);
  assert.equal((await runRepositoryAutoUpdate(f.config, { source: f.source })).code, 'needs-provider');
});
test('unknown unhealthy or wrong-origin current release blocks all writes', async t => {
  const f = fixture(t);
  f.deploy.health = async () => ({ healthy: false, sha: OLD, targetOrigin: ORIGIN });
  assert.equal((await f.run()).code, 'unverified-current');
  f.setActual({ sha: OLD, releaseId: 'release-old', targetOrigin: 'https://other.example' });
  assert.equal((await f.run()).code, 'unverified-current'); assert.equal(f.calls.length, 0);
});
test('wrong SHA after apply rolls back and circuit-breaks repeated deploys', async t => {
  const f = fixture(t);
  f.deploy.apply = async args => { f.calls.push(['apply', args]); return { receiptId: 'receipt', ...version(NEXT) }; };
  assert.equal((await f.run()).code, 'rolled-back');
  assert.equal((await f.run()).code, 'failed-sha-blocked');
  assert.equal(f.calls.length, 1); assert.deepEqual(f.journal().failedShas, [NEXT]);
});
test('throw after partial apply inspects and rolls back; exceptions never enter journal', async t => {
  const f = fixture(t);
  f.deploy.apply = async args => {
    f.calls.push(['apply', args]); f.setActual(version(NEXT));
    throw new Error('SHARECODE_SECRET_NEVER_LOG');
  };
  const out = await f.run(); assert.equal(out.code, 'rolled-back'); assert.equal(out.deployedSha, OLD);
  assert.deepEqual(f.calls.map(c => c[0]), ['apply', 'rollback']);
  assert.equal(JSON.stringify(f.journal()).includes('SHARECODE_SECRET_NEVER_LOG'), false);
});
test('failed health rolls back to immediately verified version, not an older journal version', async t => {
  const f = fixture(t);
  f.deploy.health = async ({ sha }) => ({ healthy: sha !== NEXT, ...version(sha) });
  assert.equal((await f.run()).code, 'rolled-back'); assert.equal(f.calls[1][1].sha, OLD);
  assert.equal(f.journal().latestVerified.sha, OLD);
});
test('receipt with another origin triggers rollback even when deployed candidate is healthy', async t => {
  const f = fixture(t); const apply = f.deploy.apply;
  f.deploy.apply = async args => ({ ...await apply(args), targetOrigin: 'https://other.example' });
  assert.equal((await f.run()).code, 'rolled-back'); assert.equal(f.calls.length, 2);
});
test('new branch head during apply cannot replace chosen SHA', async t => {
  const f = fixture(t); const apply = f.deploy.apply;
  f.deploy.apply = async args => { f.setHead(NEWER); return apply(args); };
  assert.equal((await f.run()).candidateSha, NEXT);
  assert.equal(f.calls[0][1].sha, NEXT);
  assert.equal((await f.run()).candidateSha, NEWER); assert.equal(f.calls[1][1].sha, NEWER);
});
test('retry token permits one explicit attempt only', async t => {
  const f = fixture(t);
  f.deploy.apply = async () => { throw new Error('offline'); };
  assert.equal((await f.run()).code, 'rolled-back');
  const retry = { retryFailedSha: NEXT, retryToken: 'manual-attempt-1' };
  assert.equal((await f.run(retry)).code, 'rolled-back');
  assert.equal((await f.run(retry)).code, 'failed-sha-blocked');
});
test('failed rollback is never automatically repeated on subsequent polls', async t => {
  const f = fixture(t);
  f.deploy.health = async ({ sha }) => ({ healthy: sha === OLD, ...version(sha) });
  f.deploy.rollback = async args => { f.calls.push(['rollback', args]); throw new Error('offline'); };
  assert.equal((await f.run()).code, 'recovery-required');
  assert.equal((await f.run()).code, 'recovery-required');
  assert.deepEqual(f.calls.map(c => c[0]), ['apply', 'rollback']);
});
test('corrupt and target-mismatched state is preserved without writes', async t => {
  const f = fixture(t); await f.run({ mode: 'check' });
  const before = fs.readFileSync(path.join(f.dir, 'journal.json'), 'utf8');
  assert.equal((await f.run({ targetOrigin: 'https://other.example' })).code, 'state-scope-mismatch');
  assert.equal(fs.readFileSync(path.join(f.dir, 'journal.json'), 'utf8'), before);
  fs.writeFileSync(path.join(f.dir, 'journal.json'), '{invalid');
  assert.equal((await f.run()).code, 'invalid-state');
  assert.equal(fs.readFileSync(path.join(f.dir, 'journal.json'), 'utf8'), '{invalid');
});
test('symlink journal and unsafe shared directory block updates without replacing evidence', async t => {
  const f = fixture(t);
  const file = path.join(f.dir, 'journal.json');
  fs.symlinkSync(path.join(f.dir, 'missing-evidence'), file);
  assert.equal((await f.run()).code, 'unsafe-state-file');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true); assert.equal(f.calls.length, 0);
  fs.unlinkSync(file); fs.chmodSync(f.dir, 0o755);
  assert.equal((await f.run()).code, 'unsafe-state-directory'); assert.equal(f.calls.length, 0);
});
test('symlink ancestors and public state paths are rejected', async t => {
  const f = fixture(t); const alias = `${f.dir}-alias`;
  fs.symlinkSync(f.dir, alias); t.after(() => fs.unlinkSync(alias));
  assert.equal((await f.run({ stateDir: path.join(alias, 'nested') })).code, 'unsafe-state-directory');
  assert.equal((await f.run({ stateDir: path.join(f.dir, 'public', 'private') })).code, 'unsafe-state-directory');
  assert.equal(f.calls.length, 0);
});
test('same commit with another artifact or release is never an up-to-date deployment', async t => {
  for (const changed of [{ artifactHash: 'd'.repeat(64) }, { releaseId: 'manual-release' }]) {
    const f = fixture(t); f.setActual({ ...version(NEXT), ...changed });
    let expectations = 0; f.deploy.expectation = async ({ sha }) => { expectations++; return version(sha); };
    assert.equal((await f.run()).code, 'unverified-current'); assert.equal(f.calls.length, 0);
    assert.equal(expectations, 1);
  }
});
test('failed partial apply cannot call a manual release with the old SHA rolled back', async t => {
  const f = fixture(t);
  f.deploy.apply = async args => {
    f.calls.push(['apply', args]);
    f.setActual({ ...version(OLD), releaseId: 'manual-release', artifactHash: 'd'.repeat(64) });
    throw Error('partial write then another operator changed release');
  };
  assert.equal((await f.run()).code, 'recovery-required');
  assert.equal((await f.run()).code, 'recovery-required');
  assert.deepEqual(f.calls.map(c => c[0]), ['apply']);
  assert.equal(f.journal().transaction.phase, 'rolling-back');
});
test('manual same-SHA candidate artifact after apply is neither accepted nor overwritten', async t => {
  const f = fixture(t); const apply = f.deploy.apply;
  f.deploy.apply = async args => {
    const receipt = await apply(args); f.setActual({ ...version(NEXT), artifactHash: 'e'.repeat(64) }); return receipt;
  };
  assert.equal((await f.run()).code, 'recovery-required'); assert.equal(f.calls.length, 1);
});
test('rollback readback must restore exact prior identity, not another artifact with its SHA', async t => {
  const f = fixture(t);
  f.deploy.health = async ({ sha }) => ({ healthy: sha === OLD, ...version(sha) });
  f.deploy.rollback = async args => {
    f.calls.push(['rollback', args]); f.setActual({ ...version(OLD), artifactHash: 'e'.repeat(64) });
    return { receiptId: 'rollback-wrong-content', ...version(OLD) };
  };
  assert.equal((await f.run()).code, 'recovery-required'); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][1].artifactHash, version(NEXT).artifactHash);
  assert.equal(f.calls[1][1].expectedCurrentArtifactHash, version(NEXT).artifactHash);
  assert.equal(f.calls[1][1].artifactHash, version(OLD).artifactHash);
});
test('repeated unchanged poll evidence is deduplicated in the durable journal', async t => {
  const f = fixture(t); f.setHead(OLD);
  for (let i = 0; i < 20; i++) assert.equal((await f.run()).code, 'up-to-date');
  assert.equal(f.journal().events.length, 1);
});

function child(config, action) {
  const modulePath = require.resolve('../src/core/repository-auto-update');
  const script = `const { runRepositoryAutoUpdate }=require(${JSON.stringify(modulePath)});\n` +
    `const config=${JSON.stringify(config)}; const sha=${JSON.stringify(NEXT)}; const old=${JSON.stringify(OLD)}; const origin=config.targetOrigin;\n` +
    `const version=sha=>({sha,releaseId:'release-'+sha[0],artifactHash:require('node:crypto').createHash('sha256').update('fixture:'+sha).digest('hex'),targetOrigin:origin});\n` +
    `runRepositoryAutoUpdate(config,{source:{detect:async()=>({sha,ci:{status:'passed',sha}})},deploy:{expectation:async({sha})=>version(sha),inspect:async()=>version(old),health:async({sha})=>({healthy:true,...version(sha)}),apply:async()=>{${action}},rollback:async()=>{throw Error('unexpected')}}}).then(r=>process.stdout.write(JSON.stringify(r)+'\\n'));`;
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitForApply(childProcess) {
  let output = '';
  for await (const data of childProcess.stdout) {
    output += data.toString(); if (output.includes('APPLY_ENTERED')) return;
  }
  throw Error('child did not reach apply');
}
test('actual processes share kernel lock; killed writer recovers durable candidate without redeploy', async t => {
  const f = fixture(t);
  const p = child(f.config, `process.stdout.write('APPLY_ENTERED\\n');await new Promise(()=>{setInterval(()=>{},1000)});`);
  t.after(() => { if (p.exitCode === null) p.kill('SIGKILL'); });
  await waitForApply(p);
  assert.equal((await f.run()).code, 'locked');
  const interrupted = f.journal(); assert.equal(interrupted.transaction.sha, NEXT);
  p.kill('SIGKILL'); await once(p, 'exit');
  f.setHead(NEWER); f.setActual(version(NEXT));
  assert.equal((await f.run()).code, 'recovered');
  assert.equal(f.calls.length, 0); assert.equal(f.journal().transaction, null);
  assert.equal(f.journal().latestVerified.sha, NEXT);
});
test('crash before actual apply conservatively reconciles previous SHA and blocks replay', async t => {
  const f = fixture(t);
  const p = child(f.config, `process.stdout.write('APPLY_ENTERED\\n');await new Promise(()=>{setInterval(()=>{},1000)});`);
  t.after(() => { if (p.exitCode === null) p.kill('SIGKILL'); });
  await waitForApply(p); p.kill('SIGKILL'); await once(p, 'exit');
  assert.equal((await f.run()).code, 'rolled-back'); assert.equal(f.calls.length, 0);
  assert.equal((await f.run()).code, 'failed-sha-blocked');
});
test('restart rejects a foreign artifact with the interrupted candidate SHA', async t => {
  const f = fixture(t);
  const p = child(f.config, `process.stdout.write('APPLY_ENTERED\\n');await new Promise(()=>{setInterval(()=>{},1000)});`);
  t.after(() => { if (p.exitCode === null) p.kill('SIGKILL'); });
  await waitForApply(p); p.kill('SIGKILL'); await once(p, 'exit');
  f.setActual({ ...version(NEXT), artifactHash: 'e'.repeat(64) });
  assert.equal((await f.run()).code, 'recovery-required'); assert.equal(f.calls.length, 0);
  assert.equal(f.journal().transaction.target.artifactHash, version(NEXT).artifactHash);
});
