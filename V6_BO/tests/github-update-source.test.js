'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { detectRepositoryUpdate, createGitHubUpdateSource, LIMITS } = require('../src/core/github-update-source');

const SHA = 'a'.repeat(40), NEXT = 'b'.repeat(40), NOW = Date.parse('2026-11-13T12:00:00Z');
const config = { repository: 'solviq87-cpu/v6-stock-system', branch: 'dev', workflowPath: '.github/workflows/v6-ci.yml', requiredJobs: ['verify', 'verify-web'] };
const raw = value => ({ raw: JSON.stringify(value), statusCode: 200 });
const run = (overrides = {}) => ({ id: 45, run_attempt: 1, workflow_id: 9, path: config.workflowPath, event: 'push', head_branch: 'dev', head_sha: SHA,
  repository: { full_name: config.repository }, head_repository: { full_name: config.repository }, created_at: '2026-11-13T10:00:00Z', updated_at: '2026-11-13T10:02:00Z', status: 'completed', conclusion: 'success', ...overrides });
const job = (name, id, overrides = {}) => ({ id, name, run_id: 45, head_sha: SHA, run_attempt: 1, status: 'completed', conclusion: 'success', ...overrides });
function fixture({ runs = [run()], jobs = [job('verify', 1), job('verify-web', 2)], heads = [SHA, SHA], override, sourceConfig = config } = {}) {
  const calls = []; let headIndex = 0;
  const requestJson = async request => {
    calls.push(request);
    assert.equal(request.hostname, 'api.github.com'); assert.equal(request.method, 'GET');
    assert.ok(request.path.startsWith('/repos/solviq87-cpu/v6-stock-system/'));
    assert.ok(request.timeoutMs > 0 && request.timeoutMs <= 12000); assert.equal(request.maxBytes, 2097152);
    if (override) { const response = await override(request, calls.length); if (response !== undefined) return response; }
    if (request.path.includes('/branches/')) return raw({ name: sourceConfig.branch, commit: { sha: heads[Math.min(headIndex++, heads.length - 1)] } });
    const page = Number(new URL(`https://api.github.com${request.path}`).searchParams.get('page'));
    const list = request.path.includes('/jobs?') ? jobs : runs;
    return raw({ total_count: list.length, [list === jobs ? 'jobs' : 'workflow_runs']: list.slice((page - 1) * 100, page * 100) });
  };
  return { calls, detect: () => detectRepositoryUpdate(sourceConfig, { requestJson, now: () => NOW }) };
}

test('matching immutable push run and all successful jobs pass, with sanitized canonical URL', async () => {
  const f = fixture({ runs: [run({ html_url: 'https://user:secret@evil.invalid/' })] });
  const result = await f.detect();
  assert.equal(result.sha, SHA); assert.equal(result.ci.sha, SHA); assert.equal(result.ci.status, 'passed');
  assert.equal(result.ci.runId, 45); assert.equal(result.ci.runAttempt, 1);
  assert.equal(result.ci.url, `https://github.com/${config.repository}/actions/runs/45/attempts/1`);
  assert.equal(f.calls.length, 4); assert.equal(result.ci.jobs.length, 2);
  assert.match(f.calls[1].path, /event=push&head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(f.calls[2].path, /runs\/45\/attempts\/1\/jobs/);
});

for (const [status, conclusion, expected] of [['queued', null, 'pending'], ['completed', 'failure', 'failed'], ['completed', 'cancelled', 'failed']]) {
  test(`latest ${status}/${conclusion} run blocks an older successful run`, async () => {
    const result = await fixture({ runs: [run({ id: 44, created_at: '2026-11-13T09:00:00Z' }), run({ status, conclusion })] }).detect();
    assert.equal(result.ci.status, expected); assert.equal(result.ci.runId, 45);
  });
}

test('latest attempt overrides a previous passing attempt for the same run', async () => {
  const f = fixture({ runs: [run(), run({ run_attempt: 2, status: 'in_progress', conclusion: null })], jobs: [job('verify', 1, { run_attempt: 2, status: 'in_progress', conclusion: null })] });
  const result = await f.detect();
  assert.equal(result.ci.status, 'pending'); assert.equal(result.ci.runAttempt, 2);
  assert.match(f.calls[2].path, /attempts\/2\/jobs/);
});

for (const [label, overrides] of [
  ['SHA', { head_sha: NEXT }], ['branch', { head_branch: 'main' }], ['repository', { repository: { full_name: 'attacker/repo' } }],
  ['fork', { head_repository: { full_name: 'attacker/repo' } }], ['PR event', { event: 'pull_request' }],
  ['workflow path', { path: '.github/workflows/other.yml' }], ['missing date', { created_at: undefined }],
  ['future date', { updated_at: '2026-12-01T00:00:00Z' }], ['reverse dates', { updated_at: '2026-11-13T09:00:00Z' }]
]) {
  test(`run ${label} mismatch fails closed`, async () => {
    const result = await fixture({ runs: [run(overrides)] }).detect();
    assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, 'github-run-identity-invalid');
  });
}

test('a branch move clears successful approval and reports the new unverified SHA', async () => {
  const result = await fixture({ heads: [SHA, NEXT] }).detect();
  assert.equal(result.sha, NEXT); assert.equal(result.observedSha, SHA); assert.equal(result.ci.sha, NEXT);
  assert.equal(result.ci.status, 'pending'); assert.equal(result.ci.reason, 'github-branch-moved'); assert.equal(result.ci.runId, null);
});

test('missing push run waits and still rechecks the branch', async () => {
  const f = fixture({ runs: [] }); const result = await f.detect();
  assert.equal(result.ci.status, 'pending'); assert.equal(result.ci.reason, 'github-no-push-run'); assert.equal(f.calls.length, 3);
});

for (const [label, jobs] of [
  ['empty', []], ['missing required job', [job('verify', 1)]],
  ['duplicate names', [job('verify', 1), job('verify', 2), job('verify-web', 3)]],
  ['skipped required job', [job('verify', 1), job('verify-web', 2, { conclusion: 'skipped' })]],
  ['unknown extra job', [job('verify', 1), job('verify-web', 2), job('extra', 3, { conclusion: 'neutral' })]],
  ['job SHA mismatch', [job('verify', 1), job('verify-web', 2, { head_sha: NEXT })]],
  ['wrong attempt', [job('verify', 1), job('verify-web', 2, { run_attempt: 2 })]]
]) {
  test(`${label} jobs cannot pass`, async () => assert.equal((await fixture({ jobs }).detect()).ci.status, 'unknown'));
}

test('failed extra job blocks otherwise successful required jobs', async () => {
  const result = await fixture({ jobs: [job('verify', 1), job('verify-web', 2), job('extra', 3, { conclusion: 'failure' })] }).detect();
  assert.equal(result.ci.status, 'failed');
});

test('all jobs pages are checked, including a failure on the second page', async () => {
  const jobs = [job('verify', 1), job('verify-web', 2), ...Array.from({ length: 99 }, (_, i) => job(`extra-${i}`, i + 3))];
  const passing = fixture({ jobs }); assert.equal((await passing.detect()).ci.status, 'passed'); assert.equal(passing.calls.length, 5);
  jobs[100].conclusion = 'failure'; assert.equal((await fixture({ jobs }).detect()).ci.status, 'failed');
});

test('run pagination does not let an old passing first page mask a newer queued run', async () => {
  const runs = [...Array.from({ length: 100 }, (_, i) => run({ id: i + 100, created_at: '2026-11-13T09:00:00Z' })), run({ status: 'queued', conclusion: null })];
  assert.equal((await fixture({ runs }).detect()).ci.status, 'pending');
});

test('truncated or excessive pagination never passes', async () => {
  for (const body of [{ total_count: 2, workflow_runs: [run()] }, { total_count: 501, workflow_runs: [run()] }, { workflow_runs: [run()] }]) {
    const result = await fixture({ override: request => request.path.includes('/runs?') ? raw(body) : undefined }).detect();
    assert.equal(result.ci.status, 'unknown'); assert.match(result.ci.reason, /^github-pagination-/);
  }
});

test('the shared request budget includes the final immutable-head recheck', async () => {
  const runs = Array.from({ length: 500 }, (_, i) => run({ id: i + 100 }));
  const jobs = Array.from({ length: 101 }, (_, i) => job(i === 0 ? 'verify' : i === 1 ? 'verify-web' : `extra-${i}`, i + 1, { run_id: 599 }));
  const f = fixture({ runs, jobs }); const result = await f.detect();
  assert.equal(f.calls.length, LIMITS.maxRequests); assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, 'github-request-budget-exhausted');
});

test('duplicate run-attempt records cannot hide a conflicting failure', async () => {
  const result = await fixture({ runs: [run(), run({ conclusion: 'failure' })] }).detect();
  assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, 'github-run-identity-invalid');
});

test('a stalled injected request is aborted at the per-request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let aborted = false;
  const pending = detectRepositoryUpdate(config, { now: () => NOW, requestJson: ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
  } });
  await Promise.resolve(); t.mock.timers.tick(12000);
  const result = await pending;
  assert.equal(aborted, true); assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, 'github-timeout');
});

test('elapsed total deadline blocks the final head request even below the request-count limit', async t => {
  let elapsed = 0; t.mock.method(performance, 'now', () => elapsed);
  const f = fixture({ override: (_request, number) => { if (number === 3) elapsed = 45001; } });
  const result = await f.detect();
  assert.equal(f.calls.length, 3); assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, 'github-timeout');
});

for (const [statusCode, reason] of [[401, 'github-auth-required'], [403, 'github-api-denied'], [429, 'github-api-denied'], [302, 'github-redirect-blocked'], [500, 'github-api-unavailable']]) {
  test(`HTTP ${statusCode} emits a fixed safe error`, async () => {
    const result = await fixture({ override: () => ({ raw: '{"message":"SECRET https://user:pass@evil.invalid"}', statusCode }) }).detect();
    assert.equal(result.ci.status, 'unknown'); assert.equal(result.ci.reason, reason); assert.doesNotMatch(JSON.stringify(result), /SECRET|user:pass|evil/);
  });
}

test('raw wire body is mandatory and parsed wrapper disagreement blocks approval', async () => {
  const branch = { name: 'dev', commit: { sha: SHA } };
  for (const response of [{ json: branch }, Object.create({ raw: JSON.stringify(branch) }), { raw: JSON.stringify({ name: 'main', commit: { sha: NEXT } }), json: branch }, { raw: 'invalid json' }]) {
    const result = await fixture({ override: () => response }).detect(); assert.equal(result.ci.status, 'unknown'); assert.equal(result.sha, null);
  }
});

test('oversized raw body and arbitrary transport errors are sanitized', async () => {
  const oversized = await fixture({ override: () => ({ raw: ' '.repeat(LIMITS.maxBytes + 1) }) }).detect();
  assert.equal(oversized.ci.reason, 'github-response-too-large');
  const result = await fixture({ override: () => { throw Object.assign(new Error('secret_token https://user:password@evil.invalid'), { code: 'github-private-token' }); } }).detect();
  assert.equal(result.ci.reason, 'github-transport-failed'); assert.doesNotMatch(JSON.stringify(result), /secret_token|password|evil/);
});

test('untrusted job diagnostics do not echo URLs with credentials or arbitrary status strings', async () => {
  const result = await fixture({ jobs: [job('verify', 1), job('verify-web', 2), job('https://user:password@evil.invalid', 3, { status: 'private-secret', conclusion: 'another-secret' })] }).detect();
  assert.equal(result.ci.status, 'unknown'); assert.doesNotMatch(JSON.stringify(result), /password|evil|private-secret|another-secret/);
});

test('branch names are encoded as a single fixed API path segment', async () => {
  const sourceConfig = { ...config, branch: 'release/v6' };
  const f = fixture({ sourceConfig, runs: [run({ head_branch: sourceConfig.branch })] });
  assert.equal((await f.detect()).ci.status, 'passed'); assert.match(f.calls[0].path, /branches\/release%2Fv6$/);
});

test('invalid config and header injection reject before any request; factory exposes detect', async () => {
  for (const bad of [{ ...config, repository: 'https://evil.invalid/a' }, { ...config, workflowPath: '../evil.yml' }, { ...config, branch: '../main' }, { ...config, requiredJobs: ['verify', 'verify'] }]) {
    await assert.rejects(detectRepositoryUpdate(bad), { code: 'github-config-invalid' });
  }
  await assert.rejects(detectRepositoryUpdate(config, { token: 'secret\r\nHost: evil' }), { code: 'github-config-invalid' });
  const source = createGitHubUpdateSource(config, { now: () => NOW, requestJson: async () => ({ raw: '{}', statusCode: 401 }) });
  assert.equal((await source.detect()).ci.reason, 'github-auth-required');
});
