#!/usr/bin/env node
'use strict';
// V6 WorkBuddy read-only checks. Never prints a sharecode, token, response body, or request URL.
// Not a deployment, auth/backup validation, migration, or write probe.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const TARGET = 'https://af3c7822e6aafc135.app.workbuddy.host';
const MAX_BYTES = 8 * 1024 * 1024;
const PATHS = Object.freeze(['/', '/api/site', '/api/health', '/api/records']);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function readShareCode(env=process.env) {
  let value = env.V6_WORKBUDDY_SHARECODE;
  if (!value && env.V6_WORKBUDDY_SHARECODE_FILE) {
    const file = env.V6_WORKBUDDY_SHARECODE_FILE;
    if (!path.isAbsolute(file)) throw Error('credential-invalid');
    // The secret must not be replaced by a symlink or opened from a group-readable file.
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 512) throw Error('credential-invalid');
      value = fs.readFileSync(fd, 'utf8').trim();
    } finally { fs.closeSync(fd); }
  }
  if (!value) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(value)) throw Error('credential-invalid');
  return value;
}
async function boundedText(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_BYTES) throw Error('response-too-large');
  if (!response.body) return '';
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) throw Error('response-too-large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function statusCode(status) {
  if (status === 401 || status === 403) return 'access-denied';
  if (status === 404) return 'endpoint-not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server-error';
  return 'unexpected-status';
}
async function safeGet(route, secret, fetchImpl) {
  const u = new URL(route, TARGET);
  u.searchParams.set('sharecode', secret);
  let response;
  try {
    response = await fetchImpl(u.href, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Accept: route === '/' ? 'text/html' : 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
  } catch (_) { return { status: null, code: 'transport-unverified' }; }
  if (!response || !Number.isSafeInteger(response.status)) return { status: null, code: 'transport-unverified' };
  const summary = { status: response.status, code: response.ok ? 'http-ok' : statusCode(response.status) };
  if (!response.ok) return summary;
  try { return { ...summary, body: await boundedText(response) }; }
  catch (_) { return { status: response.status, code: 'response-unreadable' }; }
}
function endpointSummary(result) { return { status: result.status, code: result.code }; }
function recordSummary(text) {
  try {
    const data = JSON.parse(text);
    if (!isObject(data) || data.ok !== true || !Array.isArray(data.records)) return { contract: 'unrecognized' };
    const ledger = data.records.filter(r => isObject(r) && r.name === 'v6.app.state');
    if (ledger.length > 1) return { contract: 'recognized', ledger: 'duplicate-ambiguous' };
    if (!ledger.length) return { contract: 'recognized', ledger: 'not-returned' };
    let content = ledger[0].content;
    if (typeof content === 'string') {
      try { content = JSON.parse(content); }
      catch (_) { return { contract: 'recognized', ledger: 'invalid-json' }; }
    }
    if (!isObject(content)) return { contract: 'recognized', ledger: 'invalid-json-object' };
    return { contract: 'recognized', ledger: 'parseable-not-validated' };
  } catch (_) { return { contract: 'unrecognized-or-corrupt' }; }
}
async function diagnose({ env=process.env, fetchImpl=fetch, now=() => new Date().toISOString() }={}) {
  const result = { schemaVersion: 1, checkedAt: now(), targetOrigin: TARGET,
    readOnly: true, productionDeploymentVerified: false, accountRecoveryVerified: false,
    serverLoginVerified: false };
  let credential;
  try { credential = readShareCode(env); }
  catch (_) { return { ...result, code: 'credential-invalid', requests: 0 }; }
  if (!credential) return { ...result, code: 'credential-required', requests: 0 };
  const responses = {};
  for (const route of PATHS) responses[route] = await safeGet(route, credential, fetchImpl);
  result.requests = PATHS.length;
  result.endpoints = {
    root: endpointSummary(responses['/']), site: endpointSummary(responses['/api/site']),
    health: endpointSummary(responses['/api/health']), records: endpointSummary(responses['/api/records'])
  };
  if (typeof responses['/'].body === 'string') result.rootHtml = {
    sizeBytes: Buffer.byteLength(responses['/'].body), sha256: hash(responses['/'].body)
  };
  if (typeof responses['/api/site'].body === 'string') {
    try {
      const data = JSON.parse(responses['/api/site'].body);
      if (isObject(data) && data.ok === true && isObject(data.site) && typeof data.site.html === 'string') {
        result.siteHtml = { sizeBytes: Buffer.byteLength(data.site.html), sha256: hash(data.site.html), publishedFlag: data.published === true };
        if (result.rootHtml) result.htmlEquality = result.rootHtml.sha256 === result.siteHtml.sha256 ? 'matching-bytes' : 'different-bytes';
      } else result.siteContract = 'unrecognized';
    } catch (_) { result.siteContract = 'unrecognized'; }
  }
  const records = responses['/api/records'];
  if (typeof records.body === 'string') result.dataService = recordSummary(records.body);
  if (records.code === 'endpoint-not-found') result.code = 'records-endpoint-not-found';
  else if (records.code === 'access-denied') result.code = 'records-access-denied';
  else if (records.code !== 'http-ok') result.code = 'records-unverified';
  else if (result.dataService?.contract !== 'recognized') result.code = 'records-contract-unrecognized';
  else if (result.dataService.ledger === 'not-returned') result.code = 'ledger-not-returned';
  else if (result.dataService.ledger !== 'parseable-not-validated') result.code = 'ledger-unverified';
  else if (result.htmlEquality === 'different-bytes') result.code = 'site-html-different';
  else result.code = 'readonly-evidence-collected';
  return result;
}
async function main() {
  const result = await diagnose();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!['readonly-evidence-collected', 'records-endpoint-not-found', 'records-access-denied', 'ledger-not-returned'].includes(result.code)) process.exitCode = 2;
}
if (require.main === module) main().catch(() => {
  process.stderr.write(JSON.stringify({ code: 'readonly-diagnostic-failed', readOnly: true }) + '\n');
  process.exitCode = 1;
});
module.exports = { TARGET, PATHS, readShareCode, safeGet, recordSummary, diagnose };
