'use strict';

const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const LIMITS = Object.freeze({ timeoutMs: 12000, totalTimeoutMs: 45000, maxBytes: 2 * 1024 * 1024, maxRequests: 8, maxPages: 5, perPage: 100 });
const SHA = /^[a-f0-9]{40}$/;
const ERROR_CODES = new Set(['github-timeout', 'github-transport-unavailable', 'github-response-too-large', 'github-transport-failed',
  'github-response-invalid', 'github-auth-required', 'github-api-denied', 'github-redirect-blocked', 'github-api-unavailable',
  'github-response-disagreement', 'github-request-budget-exhausted', 'github-branch-invalid', 'github-pagination-invalid',
  'github-pagination-incomplete', 'github-run-identity-invalid', 'github-job-identity-invalid']);
const JOB_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending', 'completed']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale', 'neutral', 'skipped']);
const own = (value, key) => value && Object.prototype.hasOwnProperty.call(value, key);
function failure(code) { const error = new Error(code); error.code = code; return error; }
function validate(config, deps) {
  if (!config || typeof config.repository !== 'string' || config.repository.length > 200 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) ||
      config.repository.split('/').some(part => part === '.' || part === '..') ||
      typeof config.branch !== 'string' || !config.branch.length || config.branch.length > 200 || /[\s\x00-\x1f\x7f~^:?*\[\\]/.test(config.branch) ||
      config.branch.includes('..') || config.branch.includes('@{') || config.branch.startsWith('/') || config.branch.endsWith('/') ||
      !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(config.workflowPath || '') ||
      !Array.isArray(config.requiredJobs) || !config.requiredJobs.length || config.requiredJobs.length > 50 ||
      new Set(config.requiredJobs).size !== config.requiredJobs.length || config.requiredJobs.some(name => typeof name !== 'string' || !name.length || name.length > 200)) throw failure('github-config-invalid');
  if ((deps.token !== undefined && (typeof deps.token !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(deps.token))) ||
      (deps.requestJson !== undefined && typeof deps.requestJson !== 'function') ||
      (deps.now !== undefined && typeof deps.now !== 'function')) throw failure('github-config-invalid');
}

// curl honors the host's proxy configuration. Headers travel over stdin, never argv;
// redirects are disabled so Authorization cannot cross the fixed GitHub API host.
function requestGitHub({ path, timeoutMs, maxBytes, token, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--disable', '--silent', '--show-error', '--proto', '=https', '--max-redirs', '0',
      '--connect-timeout', String(Math.min(5, timeoutMs / 1000)), '--max-time', String(timeoutMs / 1000),
      '--max-filesize', String(maxBytes), '--header', '@-', '--write-out', '\n%{http_code}', `https://api.github.com${path}`],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let length = 0; const chunks = []; let settled = false;
    const finish = (err, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); err ? reject(err) : resolve(value); };
    const abort = () => { child.kill('SIGKILL'); finish(failure('github-timeout')); };
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(failure('github-transport-unavailable')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes + 4) { child.kill('SIGKILL'); finish(failure('github-response-too-large')); }
      else chunks.push(chunk);
    });
    child.on('close', code => {
      if (code !== 0) return finish(failure(code === 28 ? 'github-timeout' : code === 63 ? 'github-response-too-large' : 'github-transport-failed'));
      const output = Buffer.concat(chunks); const cut = output.length - 4;
      if (cut < 0 || output[cut] !== 10 || !/^\d{3}$/.test(output.subarray(cut + 1).toString())) return finish(failure('github-response-invalid'));
      finish(null, { raw: output.subarray(0, cut), statusCode: Number(output.subarray(cut + 1).toString()) });
    });
    child.stdin.end(`Accept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\nUser-Agent: v6-ci-gated-update\n${token ? `Authorization: Bearer ${token}\n` : ''}`);
    if (signal.aborted) abort();
  });
}

function parseResponse(response) {
  if (!response || !own(response, 'raw') || (!Buffer.isBuffer(response.raw) && typeof response.raw !== 'string')) throw failure('github-response-invalid');
  if (Buffer.byteLength(response.raw) > LIMITS.maxBytes) throw failure('github-response-too-large');
  const status = own(response, 'statusCode') ? response.statusCode : 200;
  if (status !== 200) throw failure(status === 401 ? 'github-auth-required' : status === 403 || status === 429 ? 'github-api-denied' : status >= 300 && status < 400 ? 'github-redirect-blocked' : 'github-api-unavailable');
  let parsed;
  try { parsed = JSON.parse(response.raw.toString()); } catch { throw failure('github-response-invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('github-response-invalid');
  // Injected transports cannot substitute a convenient parsed body for wire bytes.
  for (const key of ['json', 'data', 'body']) {
    if (key in response && JSON.stringify(response[key]) !== JSON.stringify(parsed)) throw failure('github-response-disagreement');
  }
  return parsed;
}

async function detectRepositoryUpdate(config, deps = {}) {
  validate(config, deps);
  const now = deps.now || Date.now; const checkedAt = now();
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) throw failure('github-config-invalid');
  const result = { repository: config.repository, branch: config.branch, sha: null, checkedAt,
    ci: { status: 'unknown', reason: 'github-unverified', sha: null, runId: null, runAttempt: null, url: null, workflowPath: config.workflowPath, jobs: [] } };
  const deadline = performance.now() + LIMITS.totalTimeoutMs; let requests = 0;
  const request = async path => {
    if (++requests > LIMITS.maxRequests) throw failure('github-request-budget-exhausted');
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw failure('github-timeout');
    const timeoutMs = Math.max(1, Math.floor(Math.min(LIMITS.timeoutMs, remaining)));
    const controller = new AbortController(); let timer;
    try {
      return parseResponse(await Promise.race([
        Promise.resolve().then(() => (deps.requestJson || requestGitHub)({ method: 'GET', hostname: 'api.github.com', path, timeoutMs, maxBytes: LIMITS.maxBytes, token: deps.token, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('github-timeout')); }, timeoutMs); })
      ]));
    } finally { clearTimeout(timer); }
  };
  const repoPath = `/repos/${config.repository.split('/').map(encodeURIComponent).join('/')}`;
  const readHead = async () => {
    const branch = await request(`${repoPath}/branches/${encodeURIComponent(config.branch)}`);
    if (branch.name !== config.branch || !SHA.test(branch.commit?.sha || '')) throw failure('github-branch-invalid');
    return branch.commit.sha;
  };
  const pages = async (path, field) => {
    const all = []; let expected = null;
    for (let page = 1; page <= LIMITS.maxPages; page++) {
      const body = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=${LIMITS.perPage}&page=${page}`);
      if (!Array.isArray(body[field]) || body[field].length > LIMITS.perPage || !Number.isSafeInteger(body.total_count) || body.total_count < 0 || body.total_count > LIMITS.maxPages * LIMITS.perPage ||
          (expected !== null && expected !== body.total_count)) throw failure('github-pagination-invalid');
      expected = body.total_count; all.push(...body[field]);
      if (all.length > expected) throw failure('github-pagination-invalid');
      if (all.length === expected) return all;
      if (body[field].length !== LIMITS.perPage) throw failure('github-pagination-incomplete');
    }
    throw failure('github-pagination-incomplete');
  };
  try {
    result.sha = await readHead();
    result.ci.sha = result.sha;
    const runs = await pages(`${repoPath}/actions/workflows/${encodeURIComponent(config.workflowPath.split('/').pop())}/runs?branch=${encodeURIComponent(config.branch)}&event=push&head_sha=${result.sha}`, 'workflow_runs');
    let latest = null; const attempts = new Set();
    for (const run of runs) {
      const createdAt = Date.parse(run?.created_at); const updatedAt = Date.parse(run?.updated_at);
      if (!run || run.repository?.full_name !== config.repository || run.head_repository?.full_name !== config.repository || run.head_branch !== config.branch || run.head_sha !== result.sha ||
          run.event !== 'push' || run.path !== config.workflowPath || !Number.isSafeInteger(run.id) || run.id <= 0 ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0 || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt) ||
          createdAt <= 0 || createdAt > updatedAt || updatedAt > checkedAt + 60000 || !Number.isSafeInteger(run.workflow_id) || run.workflow_id <= 0 || attempts.has(`${run.id}:${run.run_attempt}`)) throw failure('github-run-identity-invalid');
      attempts.add(`${run.id}:${run.run_attempt}`);
      if (latest && latest.workflow_id !== run.workflow_id) throw failure('github-run-identity-invalid');
      if (!latest || createdAt > Date.parse(latest.created_at) || (createdAt === Date.parse(latest.created_at) && (run.id > latest.id || (run.id === latest.id && run.run_attempt > latest.run_attempt)))) latest = run;
    }
    if (!latest) { result.ci.status = 'pending'; result.ci.reason = 'github-no-push-run'; }
    else {
      Object.assign(result.ci, { runId: latest.id, runAttempt: latest.run_attempt, url: `https://github.com/${config.repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}` });
      const jobs = await pages(`${repoPath}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs`, 'jobs');
      const names = new Set(); const ids = new Set();
      for (const job of jobs) {
        if (!job || typeof job.name !== 'string' || !job.name.length || job.name.length > 200 || names.has(job.name) || !Number.isSafeInteger(job.id) || job.id <= 0 || ids.has(job.id) ||
            job.run_id !== latest.id || job.head_sha !== result.sha || (job.run_attempt !== undefined && job.run_attempt !== latest.run_attempt)) throw failure('github-job-identity-invalid');
        names.add(job.name); ids.add(job.id);
        const safeName = /[\x00-\x1f\x7f]|:\/\/|@/.test(job.name) || (deps.token && job.name.includes(deps.token)) ? '[redacted job name]' : job.name;
        result.ci.jobs.push({ name: safeName, status: JOB_STATUSES.has(job.status) ? job.status : 'unknown', conclusion: CONCLUSIONS.has(job.conclusion) ? job.conclusion : null });
      }
      const failed = ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'];
      const pending = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
      if (failed.includes(latest.conclusion) || jobs.some(job => failed.includes(job.conclusion))) Object.assign(result.ci, { status: 'failed', reason: 'github-ci-failed' });
      else if (pending.includes(latest.status) || jobs.some(job => pending.includes(job.status))) Object.assign(result.ci, { status: 'pending', reason: 'github-ci-pending' });
      else if (latest.status === 'completed' && latest.conclusion === 'success' && jobs.length && config.requiredJobs.every(name => names.has(name)) && jobs.every(job => job.status === 'completed' && job.conclusion === 'success')) Object.assign(result.ci, { status: 'passed', reason: 'github-ci-passed' });
      else Object.assign(result.ci, { status: 'unknown', reason: 'github-ci-incomplete' });
    }
    const currentSha = await readHead();
    if (currentSha !== result.sha) {
      result.observedSha = result.sha; result.sha = currentSha;
      result.ci = { status: 'pending', reason: 'github-branch-moved', sha: currentSha, runId: null, runAttempt: null, url: null, workflowPath: config.workflowPath, jobs: [] };
    }
  } catch (error) {
    result.ci.status = 'unknown';
    result.ci.reason = ERROR_CODES.has(error?.code) ? error.code : 'github-transport-failed';
  }
  return result;
}

function createGitHubUpdateSource(config, deps = {}) { validate(config, deps); return { detect: () => detectRepositoryUpdate(config, deps) }; }
module.exports = { detectRepositoryUpdate, createGitHubUpdateSource, LIMITS };
