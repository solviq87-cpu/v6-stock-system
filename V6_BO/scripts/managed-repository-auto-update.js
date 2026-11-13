#!/usr/bin/env node
'use strict';
// A fixed, reviewed runtime reads the publisher role from the CI-approved commit.
// It never checks out or executes candidate code.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify, TextDecoder } = require('node:util');
const execute = promisify(execFile);
const original = require('./repository-auto-update');
const { createGitHubUpdateSource } = require('../src/core/github-update-source');
const { TARGET } = require('../src/core/workbuddy-static-publisher');
const { peekPendingRepositoryUpdate } = require('../src/core/repository-auto-update');
const REPOSITORY = 'solviq87-cpu/v6-stock-system';
const BRANCH = 'dev';
const OWNER_PATH = 'V6_BO/config/repository-auto-update-owner.json';
const SHA = /^[a-f0-9]{40}$/;
const CODES = new Set(['publisher-not-owner', 'owner-unavailable', 'owner-invalid', 'ci-blocked', 'source-head-changed', 'source-unavailable',
  'recovery-ownership-unverified',
  'usage', 'managed-update-blocked', 'credential-required', 'up-to-date', 'applied', 'recovered', 'rolled-back', 'recovery-required',
  'needs-provider', 'update-available', 'failed-sha-blocked', 'locked', 'lock-unavailable', 'unverified-current', 'invalid-source-evidence',
  'invalid-config', 'unsafe-state-directory', 'unsafe-state-file', 'invalid-state', 'state-scope-mismatch', 'invalid-clock', 'updater-error']);
function fault(code) { const error = new Error(code); error.code = code; throw error; }
function parsePublisherOwner(input) {
  try {
    if ((!Buffer.isBuffer(input) && typeof input !== 'string') || Buffer.byteLength(input) > 1024) fault('owner-invalid');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.isBuffer(input) ? input : Buffer.from(input));
    const owner = JSON.parse(raw);
    const keys = ['schemaVersion', 'publisher', 'repository', 'branch', 'targetOrigin', 'scope'];
    // This small document has only scalar fields: counting key tokens also rejects duplicates.
    const tokens = [...raw.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(match => JSON.parse(match[1]));
    if (!owner || Array.isArray(owner) || Object.keys(owner).length !== keys.length || tokens.length !== keys.length ||
      new Set(tokens).size !== keys.length || keys.some(key => !Object.hasOwn(owner, key)) || owner.schemaVersion !== 1 ||
      !['managed-task', 'github-actions'].includes(owner.publisher) || owner.repository !== REPOSITORY || owner.branch !== BRANCH ||
      owner.targetOrigin !== TARGET || owner.scope !== 'static-frontend-only') fault('owner-invalid');
    return owner;
  } catch (_) { fault('owner-invalid'); }
}
async function readPublisherOwner(config, sha, dependencies = {}) {
  if (!SHA.test(sha) || config.repository !== REPOSITORY || config.branch !== BRANCH || config.targetOrigin !== TARGET) fault('owner-invalid');
  let raw;
  try {
    raw = dependencies.readGitOwner ? await dependencies.readGitOwner({ sha, path: OWNER_PATH, timeoutMs: 12000, maxBytes: 1024 }) :
      (await execute('git', ['-C', config.repositoryRoot || path.resolve(__dirname, '../..'), 'show', `${sha}:${OWNER_PATH}`],
        { encoding: 'buffer', timeout: 12000, maxBuffer: 1024, windowsHide: true })).stdout;
  } catch (_) {
    try {
      const url = `https://raw.githubusercontent.com/${REPOSITORY}/${sha}/${OWNER_PATH}`;
      const response = dependencies.fetchOwner ? await dependencies.fetchOwner({ url, sha, path: OWNER_PATH, timeoutMs: 12000, maxBytes: 1024 }) :
        (await execute('curl', ['--disable', '--fail', '--silent', '--proto', '=https', '--max-redirs', '0', '--max-time', '12',
          '--max-filesize', '1024', '--write-out', '\n%{http_code}', url],
        { encoding: 'buffer', timeout: 12500, maxBuffer: 1028, windowsHide: true })).stdout;
      if (dependencies.fetchOwner) {
        if (!response || response.statusCode !== 200 || (!Buffer.isBuffer(response.raw) && typeof response.raw !== 'string')) fault('owner-unavailable');
        raw = response.raw;
      } else {
        const cut = response.length - 4;
        if (cut < 0 || response[cut] !== 10 || response.subarray(cut + 1).toString() !== '200') fault('owner-unavailable');
        raw = response.subarray(0, cut);
      }
    } catch (_) { fault('owner-unavailable'); }
  }
  return parsePublisherOwner(raw);
}
function candidateValid(value) {
  return value && value.repository === REPOSITORY && value.branch === BRANCH && SHA.test(value.sha) &&
    value.ci && value.ci.status === 'passed' && value.ci.sha === value.sha;
}
function result(code, sha) {
  return { code, ...(SHA.test(sha) ? { candidateSha: sha } : {}), targetOrigin: TARGET, scope: 'static-frontend-only' };
}
function sanitize(value) {
  const out = result(CODES.has(value && value.code) ? value.code : 'managed-update-blocked', value && value.candidateSha);
  if (SHA.test(value && value.deployedSha)) out.deployedSha = value.deployedSha;
  if (/^[A-Za-z0-9_.:-]{1,160}$/.test(value && value.receiptId || '')) out.receiptId = value.receiptId;
  return out;
}
async function runForPublisher(args, expectedPublisher, expectedSha, dependencies = {}) {
  try {
    if (!['managed-task', 'github-actions'].includes(expectedPublisher) ||
      (expectedPublisher === 'github-actions' && !SHA.test(expectedSha)) ||
      (expectedSha !== undefined && !SHA.test(expectedSha))) return result('usage');
    const options = original.parseArgs(args);
    if (!['check', 'once'].includes(options.mode)) return result('usage');
    const config = original.loadConfig(options.configFile);
    const env = dependencies.env || process.env;
    const pending = peekPendingRepositoryUpdate(config);
    const run = dependencies.runMain || original.main;
    if (pending) {
      if (pending.publisherOwner !== expectedPublisher) return result('recovery-ownership-unverified', pending.sha);
      // This source can never approve a new deployment if another process clears the
      // transaction between peek and lock acquisition. Frozen recovery needs no source.
      const recoverySource = () => ({ detect: async () => { fault('source-unavailable'); } });
      return sanitize(await run(args, { ...dependencies, env, sourceFactory: recoverySource, publisherOwner: expectedPublisher }));
    }
    const sourceFactory = dependencies.sourceFactory || createGitHubUpdateSource;
    const source = sourceFactory(config, { token: env.GITHUB_TOKEN || undefined });
    let reviewed;
    try { reviewed = await source.detect({ repository: REPOSITORY, branch: BRANCH }); }
    catch (_) { return result('source-unavailable'); }
    if (expectedSha !== undefined && reviewed && reviewed.sha !== expectedSha) return result('source-head-changed', reviewed.sha);
    if (!candidateValid(reviewed)) return result('ci-blocked', reviewed && reviewed.sha);
    const owner = await readPublisherOwner(config, reviewed.sha, dependencies);
    if (owner.publisher !== expectedPublisher) return result('publisher-not-owner', reviewed.sha);
    // The original CLI reads credentials before its coordinator calls detect. Recheck
    // here as well, so role/head/CI rejection happens before any credential access.
    let rechecked;
    try { rechecked = await source.detect({ repository: REPOSITORY, branch: BRANCH }); }
    catch (_) { return result('source-unavailable', reviewed.sha); }
    if (rechecked && rechecked.sha !== reviewed.sha) return result('source-head-changed', rechecked.sha);
    if (!candidateValid(rechecked)) return result('ci-blocked', reviewed.sha);
    let pinFailure;
    const pinnedFactory = () => ({ detect: async request => {
      const latest = await source.detect(request);
      if (!latest || latest.sha !== reviewed.sha) { pinFailure = 'source-head-changed'; fault(pinFailure); }
      if (!candidateValid(latest)) { pinFailure = 'ci-blocked'; fault(pinFailure); }
      return latest;
    } });
    const output = await run(args, { ...dependencies, env, sourceFactory: pinnedFactory, publisherOwner: expectedPublisher });
    return pinFailure ? result(pinFailure, reviewed.sha) : sanitize(output);
  } catch (error) { return result(CODES.has(error && error.code) ? error.code : 'managed-update-blocked'); }
}
function main(args, dependencies = {}) { return runForPublisher(args, 'managed-task', undefined, dependencies); }
if (require.main === module) main(process.argv.slice(2)).then(output => {
  process.stdout.write(JSON.stringify(output) + '\n');
  if (!['up-to-date', 'applied', 'recovered', 'update-available'].includes(output.code)) process.exitCode = 2;
});
module.exports = { main, runForPublisher, parsePublisherOwner, readPublisherOwner, OWNER_PATH };
