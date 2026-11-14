'use strict';
// Safe field verification for the CURRENT WorkBuddy target. GET only, no secrets in logs.
// To run: V6_WORKBUDDY_SHARECODE_FILE=/private/path (mode 0600) node scripts/workbuddy-readonly-audit.js
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const ORIGIN = 'https://af3c7822e6aafc135.app.workbuddy.host';
const PATHS = Object.freeze(['/api/site', '/api/health', '/api/records']);
const MAX_BYTES = 4 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const validCode = value => typeof value === 'string' && value.length > 4 && value.length <= 512
  && /^[a-zA-Z0-9._~\-]+$/.test(value);

function privateShareCode(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('credential-path-required');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw Error('credential-file-permissions-invalid');
  if (stat.size > 1024) throw Error('credential-file-too-large');
  const sharecode = fs.readFileSync(file, 'utf8').trim();
  if (!validCode(sharecode)) throw Error('credential-invalid');
  return sharecode;
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
        headers: { accept: 'application/json' }
      });
      const result = { endpoint, httpStatus: response.status, validJson: false };
      const payload = await boundedResponse(response);
      if (payload.error) {
        result.error = payload.error;
      } else {
        result.byteLength = payload.bytes.length;
        result.sha256 = digest(payload.bytes);
        if (response.status === 200) {
          try {
            const data = JSON.parse(payload.bytes.toString('utf8'));
            result.validJson = !!data && typeof data === 'object' && data.ok === true;
            if (endpoint === '/api/records' && result.validJson) {
              result.recordsArray = Array.isArray(data.records);
              if (result.recordsArray) {
                result.recordCount = data.records.length;
                result.hasV6State = data.records.some(x => x && x.name === 'v6.app.state');
              }
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
  return {
    ok: results.every(x => x.httpStatus === 200 && x.validJson && !x.error)
      && results.find(x => x.endpoint === '/api/records')?.recordsArray === true,
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
