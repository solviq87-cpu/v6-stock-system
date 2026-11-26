'use strict';
// Ensure future workflow edits do not silently remove the per-push GitHub checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const workflow = name => fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
const section = (src, from, to) => {
  const start = src.indexOf('\n  ' + from + ':\n');
  const end = src.indexOf('\n  ' + to + ':\n', start + 1);
  assert.ok(start >= 0 && end > start, 'Missing GitHub event ' + from + ' or ' + to);
  return src.slice(start, end);
};

test('every push of a nonarchive V6 code branch invokes full CI', () => {
  const src = workflow('v6-ci.yml');
  const push = section(src, 'push', 'pull_request');
  assert.match(push, /branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
  assert.doesNotMatch(push, /^\s+paths:/m, 'V6 CI must not skip documentation or script commits');
  assert.match(src, /^  workflow_dispatch:\s*$/m);
  assert.match(src, /^  verify:\s*$/m);
  assert.match(src, /^  verify-web:\s*$/m);
  assert.match(src, /npm test/);
  assert.match(src, /npm run check/);
});

test('UI changes on any code branch get a browser check per push', () => {
  const src = workflow('v6-ui-browser.yml');
  const push = section(src, 'push', 'pull_request');
  const pr = section(src, 'pull_request', 'workflow_dispatch');
  assert.match(push, /branches:\s*\['\*\*',\s*'!archive\/\*\*'\]/);
  assert.doesNotMatch(push, /^\s+paths(?:-ignore)?:/m, 'A required browser check must run for backend-only pushes too');
  assert.doesNotMatch(pr, /^\s+paths(?:-ignore)?:/m, 'A required browser check must not leave non-UI PRs pending');
  assert.match(pr, /branches:\s*\[[^\n]*\bdev\b/);
  assert.match(src, /^  visual-geometry:\s*$/m);
});

test('publisher ownership and release safety checks are unchanged', () => {
  const release = workflow('workbuddy-auto-update.yml');
  const owner = JSON.parse(fs.readFileSync(path.join(root, 'V6_BO/config/repository-auto-update-owner.json'), 'utf8'));
  assert.equal(owner.publisher, 'managed-task');
  assert.match(release, /workflows:\s*\[V6 CI\]/);
  assert.match(release, /branches:\s*\[dev\]/);
});

test('stacked audit and integration fixes run the full PR gate set on the target branch', () => {
  for (const name of ['v6-ci.yml', 'v6-pr-commit-coverage.yml', 'v6-ui-browser.yml']) {
    const src = workflow(name);
    const event = src.match(/\n  pull_request:\n([\s\S]*?)(?=\n(?:  [A-Za-z_]+:|[A-Za-z_]+:)|$)/)?.[1];
    assert.ok(event, name + ': pull_request configuration missing');
    const names = event.match(/branches:\s*\[([^\]]+)\]/)?.[1].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
    assert.ok(names, name + ': reviewed branch list missing');
    for (const target of ['dev', 'main', 'feat/**', 'fix/**', 'chore/**', 'audit/**', 'integration/**'])
      assert.ok(names.includes(target), name + ': required PR gate omits ' + target);
    assert.doesNotMatch(event, /^\s+paths(?:-ignore)?:/m, name + ': stacked backend fixes must not omit checks');
  }
});

// Exercise the actual inline workflow scripts with isolated API doubles. A
// legal PR may carry 64 tested commits plus one GitHub-generated merge commit.
const { MAX_COMMITS } = require('../scripts/verify-pr-commit-statuses');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const shaOf = n => n.toString(16).padStart(40, '0');
function smokeScript(stepName) {
  const lines = workflow('v6-per-commit-smoke.yml').split('\n');
  const step = lines.findIndex(line => line.trim() === '- name: ' + stepName);
  const start = lines.findIndex((line, i) => i > step && line.trim() === 'script: |');
  assert.ok(step >= 0 && start > step);
  const indent = lines[start].match(/^ */)[0].length + 2;
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].startsWith(' '.repeat(indent)))) end++;
  assert.ok(end > start + 1);
  return new AsyncFunction('github', 'context', 'core', 'process', lines.slice(start + 1, end).map(line => line.slice(indent)).join('\n'));
}
function summaryCore(outputs = {}) {
  return { setOutput: (name, value) => { outputs[name] = JSON.parse(value); }, summary: { addRaw() { return this; }, async write() {} } };
}
const smokeRepo = { owner: 'solviq87-cpu', repo: 'v6-stock-system' };

test('large merge smoke selector covers the actual 58-commit merge and maximum PR plus merge', async () => {
  const select = smokeScript('Obtain the full forward commit range, not a truncated webhook list');
  async function run(count, alter = () => {}, alterPayload = () => {}) {
    const shas = Array.from({ length: count }, (_, i) => shaOf(i + 2));
    const after = shas.at(-1), before = shaOf(1), outputs = {};
    const context = { repo: smokeRepo, sha: after, payload: { before, after, forced: false } };
    const data = { status: 'ahead', ahead_by: count, commits: shas.map(sha => ({ sha })) };
    alter(data); alterPayload(context.payload);
    const github = { rest: { repos: { async compareCommits(args) {
      assert.deepEqual(args, { ...smokeRepo, base: before, head: after, per_page: 100, page: 1 });
      return { data };
    } } } };
    await select(github, context, summaryCore(outputs), { env: {} });
    assert.deepEqual(outputs.shas, shas);
    assert.deepEqual(outputs.matrix, { include: shas.map(sha => ({ sha })) });
  }
  assert.equal(MAX_COMMITS, 64);
  await run(32); await run(58); await run(MAX_COMMITS + 1);
  await assert.rejects(run(MAX_COMMITS + 2), /over-.*-commit-push/);
  await assert.rejects(run(58, data => data.commits.pop()), /incomplete-or-wrong-commit-range/);
  await assert.rejects(run(58, data => { data.commits[0] = data.commits[1]; }), /invalid-sha-matrix/);
  await assert.rejects(run(58, data => { data.status = 'diverged'; }), /nonforward/);
  await assert.rejects(run(58, () => {}, payload => { payload.forced = true; }), /unsafe-or-forced-push/);
});

test('large merge smoke status writer requires every exact job and rejects truncated or oversized evidence', async () => {
  const publish = smokeScript('Attach one truthful status per tested SHA');
  const shas = Array.from({ length: MAX_COMMITS + 1 }, (_, i) => shaOf(i + 2));
  async function run(targets, alter = () => {}, expectedFailure = null) {
    const calls = [];
    const jobs = [{ name: 'select', status: 'completed', conclusion: 'success' }, ...targets.map(sha => ({ name: 'per-sha-' + sha, status: 'completed', conclusion: 'success' })), { name: 'per-commit-evidence', status: 'in_progress', conclusion: null }];
    const data = { total_count: jobs.length, jobs };
    alter(data);
    const github = { rest: { actions: { async listJobsForWorkflowRunAttempt(args) {
      assert.deepEqual(args, { ...smokeRepo, run_id: 123, attempt_number: 2, per_page: 100, page: 1 });
      return { data };
    } }, repos: { async createCommitStatus(args) { calls.push(args); } } } };
    const invocation = publish(github, { repo: smokeRepo, runId: 123 }, summaryCore(), { env: { COVERAGE_SHAS: JSON.stringify(targets), GITHUB_RUN_ATTEMPT: '2' } });
    if (expectedFailure) await assert.rejects(invocation, expectedFailure); else await invocation;
    return calls;
  }
  const ok = await run(shas);
  assert.equal(ok.length, shas.length);
  assert.ok(ok.every((call, i) => call.sha === shas[i] && call.state === 'success' && call.context === 'v6/per-commit-smoke' && call.target_url.endsWith('/runs/123/attempts/2')));
  assert.deepEqual(await run([...shas, shaOf(100)], () => {}, /invalid-coverage-targets/), []);
  assert.deepEqual(await run(shas, data => { data.total_count++; }, /job-records-not-complete/), []);
  const missing = await run(shas, data => { data.jobs.splice(1, 1); data.total_count--; }, /per-sha-smoke-failed:1/);
  assert.equal(missing.length, shas.length);
  assert.equal(missing[0].state, 'failure');
  assert.ok(missing.slice(1).every(call => call.state === 'success'));
});
