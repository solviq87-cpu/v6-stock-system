'use strict';

// Offline coordinator: providers own authenticated I/O, never shell commands or git pulls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const same = (a, b) => a && b && a.sha === b.sha && a.releaseId === b.releaseId && a.artifactHash === b.artifactHash;
const validVersion = v => v && SHA.test(v.sha) && ID.test(v.releaseId) && HASH.test(v.artifactHash);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function assert(ok, code) { if (!ok) fail(code); }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function configuration(input) {
  const c = { repository: 'solviq87-cpu/v6-stock-system', branch: 'dev', mode: 'check', ...input };
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository), 'invalid-config');
  assert(typeof c.branch === 'string' && /^[A-Za-z0-9_/-]+$/.test(c.branch) && !c.branch.includes('//'), 'invalid-config');
  assert(['check', 'apply'].includes(c.mode) && typeof c.stateDir === 'string' && path.isAbsolute(c.stateDir), 'invalid-config');
  let origin; try { origin = new URL(c.targetOrigin); } catch (_) { fail('invalid-config'); }
  assert(origin.protocol === 'https:' && origin.origin === c.targetOrigin && !origin.username && !origin.password, 'invalid-config');
  if (c.retryFailedSha !== undefined || c.retryToken !== undefined) {
    assert(SHA.test(c.retryFailedSha) && ID.test(c.retryToken), 'invalid-config');
  }
  assert(c.publisherOwner === undefined || ['managed-task', 'github-actions'].includes(c.publisherOwner), 'invalid-config');
  return c;
}
function privateDirectory(dir, { create = true } = {}) {
  assert(dir === path.resolve(dir), 'unsafe-state-directory');
  const parts = path.resolve(dir).split(path.sep).filter(Boolean);
  assert(!parts.some(part => /^(?:public|public_html|static|www|wwwroot|htdocs)$/i.test(part)), 'unsafe-state-directory');
  let parent = path.parse(dir).root;
  for (const part of parts) {
    parent = path.join(parent, part);
    try { assert(!fs.lstatSync(parent).isSymbolicLink(), 'unsafe-state-directory'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let st;
  try { st = fs.lstatSync(dir); }
  catch (error) { if (!create && error.code === 'ENOENT') return false; throw error; }
  assert(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0 && st.uid === process.getuid(), 'unsafe-state-directory');
  return true;
}
function openPrivate(file, flags) {
  let fd;
  try { fd = fs.openSync(file, flags | fs.constants.O_NOFOLLOW, 0o600); }
  catch (e) { if (e.code === 'ELOOP') fail('unsafe-state-file'); throw e; }
  const st = fs.fstatSync(fd);
  if (!st.isFile() || (st.mode & 0o077) || st.uid !== process.getuid() || st.nlink !== 1) {
    fs.closeSync(fd); fail('unsafe-state-file');
  }
  return fd;
}
function atomicSave(file, record) {
  const temporary = `${file}.${crypto.randomBytes(12).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openPrivate(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function readState(file, scope) {
  try { fs.lstatSync(file); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { version: 1, scope, latestVerified: null, transaction: null, failedShas: [], retryTokens: [], events: [] };
  }
  const fd = openPrivate(file, fs.constants.O_RDONLY);
  let state;
  try {
    assert(fs.fstatSync(fd).size < 16 * 1024 * 1024, 'invalid-state');
    try { state = JSON.parse(fs.readFileSync(fd, 'utf8')); } catch (_) { fail('invalid-state'); }
  } finally { fs.closeSync(fd); }
  assert(state && state.version === 1 && fingerprint(state.scope) === fingerprint(scope), 'state-scope-mismatch');
  assert(Array.isArray(state.events) && Array.isArray(state.failedShas) && state.failedShas.every(s => SHA.test(s)) &&
    Array.isArray(state.retryTokens) && state.retryTokens.every(s => ID.test(s)), 'invalid-state');
  assert(state.latestVerified === null || validVersion(state.latestVerified), 'invalid-state');
  if (state.transaction !== null) {
    const t = state.transaction;
    assert(t && SHA.test(t.sha) && validVersion(t.target) && t.target.sha === t.sha && validVersion(t.previous) && ID.test(t.idempotencyKey) &&
      ['applying', 'rolling-back'].includes(t.phase) && typeof t.rollbackAttempted === 'boolean', 'invalid-state');
    assert(same(t.previous, state.latestVerified), 'invalid-state');
    assert(t.publisherOwner === undefined || ['managed-task', 'github-actions'].includes(t.publisherOwner), 'invalid-state');
  }
  return state;
}

// Read only an atomically written, validated journal. A missing directory stays absent.
// The coordinator rechecks ownership under its kernel lock before any recovery write.
function peekPendingRepositoryUpdate(input) {
  const c = configuration(input);
  if (!privateDirectory(c.stateDir, { create: false })) return null;
  const state = readState(path.join(c.stateDir, 'journal.json'), {
    repository: c.repository, branch: c.branch, targetOrigin: c.targetOrigin
  });
  return state.transaction ? { sha: state.transaction.sha,
    ...(state.transaction.publisherOwner === undefined ? {} : { publisherOwner: state.transaction.publisherOwner }) } : null;
}

/**
 * source.detect({repository,branch}) -> {sha,ci:{status,sha}}; CI must bind to the exact SHA.
 * expectation({sha,targetOrigin}) and inspect return {sha,releaseId,artifactHash,targetOrigin}.
 * health returns {healthy,...descriptor}; apply/rollback return {receiptId,...descriptor}.
 * Writes receive target descriptor + previousSha + expectedCurrentReleaseId/ArtifactHash.
 * All pollers for one target MUST use the same private local stateDir and Linux flock.
 */
async function runRepositoryAutoUpdate(input, dependencies = {}) {
  let fd;
  try {
    const c = configuration(input);
    const { source, deploy, now = () => Date.now() } = dependencies;
    privateDirectory(c.stateDir);
    fd = openPrivate(path.join(c.stateDir, 'updater.lock'), fs.constants.O_CREAT | fs.constants.O_RDWR);
    // flock(2) follows the shared open-file description. Parent FD retains the lock
    // after this helper exits; close/process death releases it without stale PID logic.
    const lock = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
    if (lock.error || lock.status !== 0) return { code: lock.status === 1 ? 'locked' : 'lock-unavailable' };
    const file = path.join(c.stateDir, 'journal.json');
    const scope = { repository: c.repository, branch: c.branch, targetOrigin: c.targetOrigin };
    const state = readState(file, scope);
    const result = (code, extra = {}) => ({ code, mode: c.mode, targetOrigin: c.targetOrigin, ...extra });
    const record = (code, detail = {}) => {
      const at = now(); assert(Number.isFinite(at), 'invalid-clock');
      const last = state.events.at(-1);
      if (!last || fingerprint({ ...last, at: 0 }) !== fingerprint({ at: 0, code, ...detail })) {
        state.events.push({ at, code, ...detail });
        if (state.events.length > 2048) state.events.splice(0, state.events.length - 2048);
      }
      atomicSave(file, state);
    };
    const hasRead = deploy && typeof deploy.expectation === 'function' && typeof deploy.inspect === 'function' && typeof deploy.health === 'function';
    const hasWrite = hasRead && typeof deploy.apply === 'function' && typeof deploy.rollback === 'function';
    async function inspect() {
      const v = await deploy.inspect({ targetOrigin: c.targetOrigin });
      assert(validVersion(v) && v.targetOrigin === c.targetOrigin, 'invalid-target-evidence');
      return { sha: v.sha, releaseId: v.releaseId, artifactHash: v.artifactHash };
    }
    async function expectation(sha) {
      const v = await deploy.expectation({ sha, targetOrigin: c.targetOrigin });
      assert(validVersion(v) && v.sha === sha && v.targetOrigin === c.targetOrigin, 'invalid-target-evidence');
      return { sha: v.sha, releaseId: v.releaseId, artifactHash: v.artifactHash };
    }
    async function verify(version) {
      const health = await deploy.health({ ...version, targetOrigin: c.targetOrigin });
      assert(health && health.healthy === true && same(health, version) && health.targetOrigin === c.targetOrigin, 'unhealthy-target');
      const after = await inspect();
      assert(same(after, version), 'target-changed');
      return after;
    }
    function receipt(value, version) {
      assert(value && value.targetOrigin === c.targetOrigin && same(value, version) && ID.test(value.receiptId), 'invalid-action-receipt');
      return { receiptId: value.receiptId, ...version, targetOrigin: c.targetOrigin };
    }
    function writeArgs(desired, current, idempotencyKey) {
      return { ...desired, previousSha: current.sha, expectedCurrentReleaseId: current.releaseId,
        expectedCurrentArtifactHash: current.artifactHash, idempotencyKey, targetOrigin: c.targetOrigin };
    }
    function rejectCandidate(t) {
      if (!state.failedShas.includes(t.sha)) state.failedShas.push(t.sha);
    }
    function finish(version, code) {
      const t = state.transaction;
      state.latestVerified = version; state.transaction = null;
      record(code, { sha: t.sha, deployedSha: version.sha });
      return result(code, { candidateSha: t.sha, deployedSha: version.sha });
    }
    async function rollback() {
      const t = state.transaction;
      t.phase = 'rolling-back'; rejectCandidate(t); record('rollback-reconcile', { sha: t.sha });
      let actual;
      try { actual = await inspect(); } catch (_) { return result('recovery-required'); }
      if (same(actual, t.previous)) {
        try { await verify(actual); return finish(actual, 'rolled-back'); } catch (_) { return result('recovery-required'); }
      }
      if (!same(actual, t.target) || t.rollbackAttempted) return result('recovery-required');
      t.rollbackAttempted = true; record('rollback-started', { sha: t.previous.sha });
      try {
        const r = receipt(await deploy.rollback(writeArgs(t.previous, t.target, `${t.idempotencyKey}:rollback`)), t.previous);
        record('rollback-receipt', r);
      } catch (_) { record('rollback-action-failed'); }
      try {
        actual = await inspect(); assert(same(actual, t.previous), 'rollback-mismatch');
        await verify(actual); return finish(actual, 'rolled-back');
      } catch (_) { return result('recovery-required'); }
    }
    // Reconcile the immutable in-flight SHA before observing a newer branch head.
    if (state.transaction) {
      if (state.transaction.publisherOwner !== c.publisherOwner) return result('recovery-ownership-unverified');
      if (!hasRead || (c.mode === 'apply' && !hasWrite)) return result('needs-provider');
      if (c.mode !== 'apply') return result('recovery-required', { candidateSha: state.transaction.sha });
      const t = state.transaction;
      if (t.phase === 'rolling-back') return await rollback();
      let actual;
      try { actual = await inspect(); } catch (_) { return result('recovery-required'); }
      if (same(actual, t.target)) {
        try { await verify(actual); return finish(actual, 'recovered'); } catch (_) { return await rollback(); }
      }
      // Never repeat a write whose outcome is unknown, even if the old release remains.
      if (same(actual, t.previous)) return await rollback();
      return result('recovery-required');
    }
    if (!source || typeof source.detect !== 'function') return result('needs-provider');
    let candidate;
    try { candidate = await source.detect({ repository: c.repository, branch: c.branch }); } catch (_) { return result('source-unavailable'); }
    if (!candidate || !SHA.test(candidate.sha)) return result('invalid-source-evidence');
    const sha = candidate.sha;
    if (!candidate.ci || candidate.ci.sha !== sha || candidate.ci.status !== 'passed') {
      record('ci-blocked', { sha }); return result('ci-blocked', { candidateSha: sha });
    }
    if (!hasRead || (c.mode === 'apply' && !hasWrite)) return result('needs-provider', { candidateSha: sha });
    let current, desired;
    try {
      desired = await expectation(sha); current = await inspect();
      assert(same(current, current.sha === sha ? desired : await expectation(current.sha)), 'unexpected-current');
      await verify(current);
    } catch (_) { return result('unverified-current', { candidateSha: sha }); }
    state.latestVerified = current;
    if (same(current, desired)) { record('up-to-date', { sha }); return result('up-to-date', { deployedSha: sha }); }
    if (state.failedShas.includes(sha)) {
      if (c.mode !== 'apply' || c.retryFailedSha !== sha || !c.retryToken || state.retryTokens.includes(c.retryToken)) {
        record('failed-sha-blocked', { sha }); return result('failed-sha-blocked', { candidateSha: sha });
      }
      state.retryTokens.push(c.retryToken); record('retry-consumed', { sha });
    }
    if (c.mode !== 'apply') { record('update-available', { sha }); return result('update-available', { candidateSha: sha, deployedSha: current.sha }); }
    const t = { sha, target: desired, previous: current, phase: 'applying', rollbackAttempted: false,
      ...(c.publisherOwner === undefined ? {} : { publisherOwner: c.publisherOwner }),
      idempotencyKey: `v6-${crypto.randomBytes(16).toString('hex')}` };
    state.transaction = t; record('apply-started', { sha, previousSha: current.sha, idempotencyKey: t.idempotencyKey });
    try {
      const r = receipt(await deploy.apply(writeArgs(desired, current, t.idempotencyKey)), desired);
      record('apply-receipt', r);
      const actual = await inspect(); assert(same(actual, desired), 'apply-mismatch'); await verify(actual);
      return finish(actual, 'applied');
    } catch (_) {
      return await rollback();
    }
  } catch (e) {
    const allowed = new Set(['invalid-config', 'unsafe-state-directory', 'unsafe-state-file', 'invalid-state', 'state-scope-mismatch', 'invalid-clock']);
    return { code: allowed.has(e.code) ? e.code : 'updater-error' };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

module.exports = { runRepositoryAutoUpdate, peekPendingRepositoryUpdate };
