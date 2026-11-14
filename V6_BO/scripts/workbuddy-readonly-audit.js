'use strict';
// Safe field verification for the CURRENT WorkBuddy target. GET only, no secrets in logs.
// To run: V6_WORKBUDDY_SHARECODE_FILE=/private/path (mode 0600) node scripts/workbuddy-readonly-audit.js
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const ORIGIN = 'https://af3c7822e6aafc135.app.workbuddy.host';
const PATHS = Object.freeze(['/api/site', '/api/health', '/api/records', '/']);
const MAX_BYTES = 4 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validCode = value => typeof value === 'string' && value.length > 4 && value.length <= 512
  && /^[a-zA-Z0-9._~\-]+$/.test(value);

function privateShareCode(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('credential-path-required');
  // Open first with no-follow, then check the actual descriptor. This avoids
  // the lstat -> read path-swap race, and never prints file or secret contents.
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); }
  catch { throw Error('credential-file-permissions-invalid'); }
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

async function audit({ sharecode, request = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (!validCode(sharecode)) return { ok: false, status: 'credential-unavailable', checkedAt: now(), endpoints: [] };
  const results = [];
  for (const endpoint of PATHS) {
    const url = new URL(endpoint, ORIGIN);
    url.searchParams.set('sharecode', sharecode);
    let response;
    try {
      response = await request(url.toString(), {
        method: 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000), referrerPolicy: 'no-referrer',
        headers: { accept: endpoint === '/' ? 'text/html' : 'application/json' }
      });
      const result = { endpoint, httpStatus: response.status, validJson: false };
      const payload = await boundedResponse(response);
      if (payload.error) {
        result.error = payload.error;
      } else {
        result.byteLength = payload.bytes.length;
        result.sha256 = digest(payload.bytes);
        if (endpoint === '/') {
          // HTML is untrusted. Only emit type/digest; never print or execute it.
          result.htmlDocument = response.status === 200 && /<!doctype html|<html/i.test(payload.bytes.toString('utf8').slice(0,512));
        } else if (response.status === 200) {
          try {
            const data = JSON.parse(payload.bytes.toString('utf8'));
            result.validJson = !!data && typeof data === 'object' && !Array.isArray(data) && data.ok === true;
            if (endpoint === '/api/site' && result.validJson && typeof data.site?.html === 'string') {
              result.siteHtmlSha256 = digest(Buffer.from(data.site.html,'utf8'));
              result.siteHtmlBytes = Buffer.byteLength(data.site.html,'utf8');
            }
            if (endpoint === '/api/records' && result.validJson) {
              result.recordsArray = Array.isArray(data.records);
              if (result.recordsArray) {
                result.recordCount = data.records.length;
                const matches = data.records.filter(x => x && typeof x === 'object' && x.name === 'v6.app.state');
                result.hasV6State = matches.length > 0;
                if (matches.length === 0) result.ledgerStatus = 'not-returned';
                else if (matches.length > 1) result.ledgerStatus = 'duplicate-ambiguous';
                else {
                  let account=matches[0].content;
                  try {
                    if (typeof account === 'string') account=JSON.parse(account);
                    result.ledgerStatus = account && typeof account === 'object' && !Array.isArray(account)
                      ? 'parseable-not-validated' : 'invalid-account-format';
                  } catch { result.ledgerStatus = 'invalid-account-json'; }
                }
              } else result.ledgerStatus = 'contract-unrecognized';
            }
          } catch { result.error = 'unexpected-response-format'; }
        }
      }
      results.push(result);
    } catch (error) {
      // Never log URLs, response bodies or exception messages (they may include sharecode).
      results.push({ endpoint, httpStatus: null, validJson: false, error: 'transport-failed' });
    }
  }
  const apis = results.filter(x => x.endpoint !== '/');
  const root = results.find(x => x.endpoint === '/');
  const site = results.find(x => x.endpoint === '/api/site');
  const pageIntegrity = root?.httpStatus === 200 && root.htmlDocument && site?.siteHtmlSha256
    ? (root.sha256 === site.siteHtmlSha256 ? 'matching-bytes' : 'different-bytes') : 'unverified';
  return {
    ok: apis.every(x => x.httpStatus === 200 && x.validJson && !x.error)
      && results.find(x => x.endpoint === '/api/records')?.recordsArray === true,
    pageIntegrity,
    accountRecoveryVerified: false,
    serverLoginVerified: false,
    status: 'read-only-diagnostic',
    checkedAt: now(), target: ORIGIN, method: 'GET-only',
    endpoints: results
  };
}

async function main() {
  let code;
  try { code = privateShareCode(process.env.V6_WORKBUDDY_SHARECODE_FILE); }
  catch { process.stdout.write(JSON.stringify({ ok: false, status: 'credential-unavailable', method: 'GET-only' }) + '\n'); process.exitCode = 2; return; }
  const result = await audit({ sharecode: code });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { process.stdout.write('{"ok":false,"error":"internal-failure"}\n');process.exitCode = 1; });
module.exports = { audit, privateShareCode, ORIGIN, PATHS };
