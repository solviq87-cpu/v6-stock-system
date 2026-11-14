'use strict';
// Read-only WorkBuddy diagnostics. Do not log raw URLs, credentials, payloads, or exception messages.
// Only the official target can be contacted, and only by GET.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const ORIGIN = 'https://af3c7822e6aafc135.app.workbuddy.host';
const PATHS = Object.freeze(['/', '/api/site', '/api/health', '/api/records']);
const MAX_BYTES = 4 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validCode = value => typeof value === 'string' && value.length > 4 && value.length <= 512
  && /^[A-Za-z0-9._~-]+$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function privateShareCode(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('credential-path-required');
  // Open the checked inode itself: never reread a path after a lstat/open race.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0)
      throw Error('credential-file-permissions-invalid');
    if (stat.size > 1024) throw Error('credential-file-too-large');
    const sharecode = fs.readFileSync(fd, 'utf8').trim();
    if (!validCode(sharecode)) throw Error('credential-invalid');
    return sharecode;
  } finally { fs.closeSync(fd); }
}

async function boundedResponse(res) {
  const length = res.headers?.get?.('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES)
    return { error: 'oversized-response' };
  if (!res.body || !res.body.getReader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) return { error: 'oversized-response' };
    return { bytes: Buffer.from(text, 'utf8') };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) return { error: 'oversized-response' };
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (size > MAX_BYTES) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks) };
}

function httpClassification(status) {
  if (status === 401 || status === 403) return 'access-denied';
  if (status === 404) return 'endpoint-not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server-error';
  if (status >= 300 && status < 400) return 'unexpected-redirect';
  return 'unexpected-http-status';
}

// A readable JSON object is NOT an authenticated historical account or a valid ledger.
// Only a small structural preflight is performed, without revealing or changing any entries.
function inspectRecords(data) {
  if (!Array.isArray(data?.records)) return { recordsArray: false, ledgerStatus: 'records-contract-invalid' };
  const matches = data.records.filter(row => object(row) && row.name === 'v6.app.state');
  const result = { recordsArray: true, recordCount: data.records.length, hasV6State: matches.length > 0 };
  if (matches.length === 0) return { ...result, ledgerStatus: 'missing' };
  if (matches.length !== 1) return { ...result, ledgerStatus: 'duplicate-ambiguous' };
  let ledger = matches[0].content;
  if (typeof ledger === 'string') {
    try { ledger = JSON.parse(ledger); }
    catch { return { ...result, ledgerStatus: 'invalid-json' }; }
  }
  if (!object(ledger) || !Number.isSafeInteger(ledger.revision) || ledger.revision < 0 ||
      typeof ledger.cash !== 'number' || !Number.isFinite(ledger.cash) ||
      !Array.isArray(ledger.positions) || !Array.isArray(ledger.orders))
    return { ...result, ledgerStatus: 'unrecognized-shape' };
  return { ...result, ledgerStatus: 'shape-readable-unverified' };
}

async function audit({ sharecode, request = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (!validCode(sharecode)) return {
    ok: false, code: 'credential-unavailable', status: 'credential-unavailable',
    checkedAt: now(), readOnly: true, accountRecoveryVerified: false,
    productionDeploymentVerified: false, endpoints: []
  };
  const results = [];
  for (const endpoint of PATHS) {
    const url = new URL(endpoint, ORIGIN);
    url.searchParams.set('sharecode', sharecode);
    try {
      const response = await request(url.toString(), {
        method: 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000), referrerPolicy: 'no-referrer',
        headers: { accept: endpoint === '/' ? 'text/html' : 'application/json' }
      });
      const result = { endpoint, httpStatus: response.status, validJson: false };
      // Never read/report potentially private 401/403 HTML or transport errors.
      if (response.status !== 200) {
        result.code = httpClassification(response.status);
        results.push(result);
        continue;
      }
      const payload = await boundedResponse(response);
      if (payload.error) {
        result.error = payload.error;
        results.push(result);
        continue;
      }
      result.byteLength = payload.bytes.length;
      result.sha256 = digest(payload.bytes);
      if (endpoint === '/') {
        result.htmlSha256 = result.sha256;
        results.push(result);
        continue;
      }
      try {
        const data = JSON.parse(payload.bytes.toString('utf8'));
        result.validJson = object(data) && data.ok === true;
        if (result.validJson && endpoint === '/api/site' && object(data.site) &&
            typeof data.site.html === 'string') {
          result.siteHtmlSha256 = digest(Buffer.from(data.site.html, 'utf8'));
          result.siteHtmlBytes = Buffer.byteLength(data.site.html, 'utf8');
          result.publishedFlag = data.published === true;
        }
        if (endpoint === '/api/records' && result.validJson)
          Object.assign(result, inspectRecords(data));
      } catch { result.error = 'unexpected-response-format'; }
      results.push(result);
    } catch (_) {
      // Do not propagate untrusted error messages: they may contain a URL/sharecode.
      results.push({ endpoint, httpStatus: null, validJson: false, error: 'transport-failed' });
    }
  }
  const find = endpoint => results.find(row => row.endpoint === endpoint);
  const root = find('/'), site = find('/api/site'), health = find('/api/health'), records = find('/api/records');
  const htmlMatch = root.htmlSha256 && site.siteHtmlSha256
    ? root.htmlSha256 === site.siteHtmlSha256 : null;
  let code;
  if (records.code === 'endpoint-not-found') code = 'records-endpoint-not-found';
  else if (records.code === 'access-denied') code = 'records-access-denied';
  else if (records.httpStatus !== 200 || records.validJson !== true || !records.recordsArray) code = 'records-unverified';
  else if (records.ledgerStatus === 'missing') code = 'ledger-missing';
  else if (records.ledgerStatus !== 'shape-readable-unverified') code = 'ledger-unverified';
  else if (site.httpStatus !== 200 || site.validJson !== true ||
           health.httpStatus !== 200 || health.validJson !== true ||
           root.httpStatus !== 200) code = 'site-unverified';
  else if (htmlMatch !== true) code = htmlMatch === false ? 'site-html-mismatch' : 'site-html-unverified';
  else code = 'read-only-evidence-collected';
  return {
    ok: code === 'read-only-evidence-collected',
    code, status: 'read-only-diagnostic', checkedAt: now(), target: ORIGIN,
    method: 'GET-only', readOnly: true, accountRecoveryVerified: false,
    authenticatedSessionVerified: false, productionDeploymentVerified: false,
    htmlMatch, endpoints: results
  };
}

async function main() {
  let code;
  try { code = privateShareCode(process.env.V6_WORKBUDDY_SHARECODE_FILE); }
  catch {
    process.stdout.write(JSON.stringify({ ok: false, status: 'credential-unavailable', method: 'GET-only' }) + '\n');
    process.exitCode = 2;
    return;
  }
  const result = await audit({ sharecode: code });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  process.stdout.write('{"ok":false,"error":"internal-failure"}\n');
  process.exitCode = 1;
});
module.exports = { audit, privateShareCode, ORIGIN, PATHS, inspectRecords };
