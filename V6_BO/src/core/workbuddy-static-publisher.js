'use strict';
// This provider publishes only the official service's single static HTML document.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { parseStaticRelease, MAX_BYTES } = require('../../scripts/build-workbuddy-static');
const TARGET = 'https://af3c7822e6aafc135.app.workbuddy.host';
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => a && b && a.sha === b.sha && a.releaseId === b.releaseId && a.artifactHash === b.artifactHash;
function fault(code) { const e = new Error(code); e.code = code; throw e; }
function check(ok, code) { if (!ok) fault(code); }
function privateDir(dir) {
  check(typeof dir === 'string' && path.isAbsolute(dir) && dir === path.resolve(dir), 'unsafe-state-directory');
  let at = path.parse(dir).root;
  for (const part of path.resolve(dir).split(path.sep).filter(Boolean)) {
    check(!/^(?:public|public_html|static|www|wwwroot|htdocs)$/i.test(part), 'unsafe-state-directory');
    at = path.join(at, part);
    try { check(!fs.lstatSync(at).isSymbolicLink(), 'unsafe-state-directory'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  check(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'unsafe-state-directory');
}
function safeRead(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const s = fs.fstatSync(fd);
    check(s.isFile() && s.nlink === 1 && s.uid === process.getuid() && !(s.mode & 0o077) && s.size <= 3 * MAX_BYTES, 'unsafe-snapshot');
    return fs.readFileSync(fd, 'utf8');
  } catch (_) { fault('unsafe-snapshot'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function curlTransport({ targetOrigin, shareCode }) {
  return ({ method, path: route, body, timeoutMs = 12000 }) => new Promise((resolve, reject) => {
    const url = `${targetOrigin}${route}${route.includes('?') ? '&' : '?'}sharecode=${encodeURIComponent(shareCode)}`;
    const options = [`url = ${JSON.stringify(url)}`, `request = ${JSON.stringify(method)}`, 'silent', 'proto = "=https"',
      `max-time = ${Math.max(1, Math.min(12, timeoutMs / 1000))}`, `max-filesize = ${MAX_BYTES}`,
      'write-out = "\\nV6_HTTP_STATUS:%{http_code}"'];
    if (body !== undefined) {
      // Some hosts decode each incoming byte chunk separately. ASCII JSON escapes keep
      // UTF-8 characters intact across those boundaries; JSON.parse restores exact HTML.
      const serialized = JSON.stringify(body).replace(/[\u007f-\uffff]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
      options.push('header = "Content-Type: application/json"', `data-binary = ${JSON.stringify(serialized)}`);
    }
    // Ignore user curlrc files: they may enable redirects, tracing or unsafe TLS.
    const process = spawn('curl', ['--disable', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let chunks = [], length = 0, oversized = false;
    const timer = setTimeout(() => process.kill('SIGKILL'), timeoutMs + 500);
    process.stdout.on('data', data => { length += data.length; if (length > MAX_BYTES + 100) { oversized = true; process.kill('SIGKILL'); } else chunks.push(data); });
    process.stderr.resume(); process.stdin.on('error', () => {});
    process.on('error', () => { clearTimeout(timer); reject(new Error('transport-failed')); });
    process.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || oversized) return reject(new Error('transport-failed'));
      const raw = Buffer.concat(chunks).toString('utf8');
      const match = /\nV6_HTTP_STATUS:(\d{3})$/.exec(raw);
      if (!match) return reject(new Error('transport-failed'));
      resolve({ raw: raw.slice(0, match.index), statusCode: Number(match[1]) });
    });
    process.stdin.end(options.join('\n') + '\n');
  });
}

function createWorkBuddyStaticPublisher(config, dependencies = {}) {
  const { targetOrigin, shareCode, stateDir, artifactForSha } = config || {};
  check(targetOrigin === TARGET && typeof shareCode === 'string' && shareCode.length > 0 && shareCode.length <= 2048 &&
    !/[\r\n\0]/.test(shareCode) && typeof artifactForSha === 'function', 'invalid-provider-config');
  privateDir(stateDir);
  const snapshots = path.join(stateDir, 'snapshots'); privateDir(snapshots);
  const key = crypto.createHash('sha256').update(`v6-workbuddy-snapshots\0${targetOrigin}\0${shareCode}`).digest();
  const transport = dependencies.requestJson || curlTransport({ targetOrigin, shareCode });
  const now = dependencies.now || (() => Date.now());
  const artifacts = new Map();
  let busy = false;
  function target(args) { check(args && args.targetOrigin === targetOrigin, 'target-mismatch'); }
  async function request(method, route, body, deadline) {
    check(['/api/site', '/api/health', '/', '/api/publish'].includes(route) && (method === 'GET' || (method === 'POST' && route === '/api/publish')), 'invalid-route');
    const remaining = deadline - now(); check(remaining > 0, 'phase-timeout');
    let timer;
    try {
      const response = await Promise.race([transport({ method, path: route, ...(body === undefined ? {} : { body }), timeoutMs: Math.min(12000, remaining) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request-timeout')), Math.min(12000, remaining)); })]);
      check(response && response.statusCode === 200 && (typeof response.raw === 'string' || Buffer.isBuffer(response.raw)), 'request-failed');
      const raw = Buffer.isBuffer(response.raw) ? response.raw.toString('utf8') : response.raw;
      check(Buffer.byteLength(raw) <= MAX_BYTES, 'response-too-large');
      if (route === '/') return raw;
      try { return JSON.parse(raw); } catch (_) { fault('invalid-response'); }
    } catch (_) { fault('request-failed'); }
    finally { clearTimeout(timer); }
  }
  function identify(html) {
    check(typeof html === 'string' && Buffer.byteLength(html) > 0 && Buffer.byteLength(html) <= MAX_BYTES, 'invalid-site');
    // Old pages may embed the original access code: preserve them only encrypted.
    if (!/v6-(?:static-release:|repository-sha|static-content-sha256|release-id|target-scope)/i.test(html)) return { artifactHash: digest(html) };
    try { return parseStaticRelease(html); } catch (_) { fault('invalid-site-marker'); }
  }
  async function site(deadline, rawOnly = false) {
    const data = await request('GET', '/api/site', undefined, deadline);
    check(data && data.ok === true && data.published === true && data.site && typeof data.site.html === 'string', 'invalid-site');
    check(Buffer.byteLength(data.site.html) > 0 && Buffer.byteLength(data.site.html) <= MAX_BYTES, 'invalid-site');
    const identity = rawOnly ? { artifactHash: digest(data.site.html) } : identify(data.site.html);
    return { html: data.site.html, title: typeof data.site.title === 'string' ? data.site.title : '',
      author: typeof data.site.author === 'string' ? data.site.author : '', at: typeof data.site.at === 'string' || Number.isFinite(data.site.at) ? data.site.at : null, ...identity };
  }
  async function verify(record, deadline) {
    const root = await request('GET', '/', undefined, deadline);
    check(root === record.html, 'root-mismatch');
    const h = await request('GET', '/api/health', undefined, deadline);
    check(h && h.ok === true && h.published === true, 'unhealthy-target');
    const after = await site(deadline);
    check(after.artifactHash === record.artifactHash && after.html === record.html, 'target-changed');
    return after;
  }
  function backupFile(hash) { check(HASH.test(hash), 'invalid-snapshot'); return path.join(snapshots, `${hash}.json`); }
  function readBackup(hash) {
    try {
      const envelope = JSON.parse(safeRead(backupFile(hash)));
      check(envelope.version === 1, 'invalid-snapshot');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(`${targetOrigin}\0${hash}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
      const value = JSON.parse(plain.toString('utf8')); const identity = identify(value.html);
      check(identity.artifactHash === hash && value.verified === true && identity.sha === value.sha && identity.releaseId === value.releaseId &&
        Number.isSafeInteger(value.createdAt) && value.createdAt >= 0, 'invalid-snapshot');
      return { ...value, ...identity };
    } catch (_) { fault('invalid-snapshot'); }
  }
  function backup(record, protectedHash) {
    const file = backupFile(record.artifactHash);
    const entries = fs.readdirSync(snapshots).map(name => {
      check(/^[a-f0-9]{64}\.json$/.test(name), 'invalid-snapshot');
      return readBackup(name.slice(0, -5));
    });
    check(entries.length <= 32, 'snapshot-limit');
    const existing = entries.find(item => item.artifactHash === record.artifactHash);
    if (existing) { check(existing.html === record.html, 'invalid-snapshot'); return; }
    const latestLegacy = entries.filter(item => !item.sha).sort((a, b) => b.createdAt - a.createdAt || a.artifactHash.localeCompare(b.artifactHash))[0];
    const protectedHashes = new Set([record.artifactHash, protectedHash, latestLegacy && latestLegacy.artifactHash]);
    const createdAt = now(); check(Number.isSafeInteger(createdAt) && createdAt >= 0, 'invalid-snapshot');
    if (entries.length === 32) {
      const evict = entries.filter(item => item.sha && !protectedHashes.has(item.artifactHash))
        .sort((a, b) => a.createdAt - b.createdAt || a.artifactHash.localeCompare(b.artifactHash))[0];
      check(evict, 'snapshot-limit');
      // Only verified, decrypted deployment snapshots are eligible; never raw files.
      fs.unlinkSync(backupFile(evict.artifactHash));
    }
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${targetOrigin}\0${record.artifactHash}`));
    const data = Buffer.concat([cipher.update(JSON.stringify({ ...record, verified: true, createdAt }), 'utf8'), cipher.final()]);
    const payload = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    const temporary = path.join(snapshots, `.${crypto.randomBytes(16).toString('hex')}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, payload); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.linkSync(temporary, file);
      fs.unlinkSync(temporary);
      const directory = fs.openSync(snapshots, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  async function buildArtifact(sha) {
    check(SHA.test(sha), 'invalid-sha');
    let value; try { value = await artifactForSha(sha); } catch (_) { fault('artifact-unavailable'); }
    const html = typeof value === 'string' ? value : value && value.html;
    const identity = identify(html); check(identity.sha === sha, 'artifact-sha-mismatch');
    return { html, ...identity };
  }
  async function artifact(sha) {
    check(SHA.test(sha), 'invalid-sha');
    if (artifacts.has(sha)) return artifacts.get(sha);
    // Only immutable commit artifacts are cached; remote target, branch and CI are never cached.
    const pending = buildArtifact(sha); artifacts.set(sha, pending);
    if (artifacts.size > 8) artifacts.delete(artifacts.keys().next().value);
    try { return await pending; }
    catch (error) { if (artifacts.get(sha) === pending) artifacts.delete(sha); throw error; }
  }
  async function publish(record, deadline) {
    const ack = await request('POST', '/api/publish', { html: record.html, title: record.title || '天枢智策', author: record.author || 'V6' }, deadline);
    check(ack && ack.ok === true, 'publish-rejected');
    const after = await site(deadline); check(after.html === record.html && after.artifactHash === record.artifactHash, 'publish-mismatch');
    await verify(after, deadline); return after;
  }
  function receipt(record, basis) {
    return { sha: record.sha, targetOrigin, receiptId: `wb-${digest(JSON.stringify([record.at, record.artifactHash, basis])).slice(0, 56)}`,
      releaseId: record.releaseId, artifactHash: record.artifactHash, basis, scope: 'static-frontend-only' };
  }
  async function mutate(fn) {
    check(!busy, 'publisher-locked'); busy = true;
    let fd;
    try {
      privateDir(stateDir); privateDir(snapshots);
      fd = fs.openSync(path.join(stateDir, 'publisher.lock'), fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
      const stat = fs.fstatSync(fd); check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && !(stat.mode & 0o077), 'unsafe-state-file');
      const lock = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 5000 });
      check(!lock.error && lock.status === 0, 'publisher-locked');
      return await fn(now() + 45000);
    } catch (error) {
      // All error messages are fixed; response bodies, HTML and credential URLs stay private.
      const codes = new Set(['publisher-locked', 'unsafe-state-directory', 'unsafe-state-file', 'unsafe-snapshot', 'invalid-snapshot', 'snapshot-limit',
        'target-mismatch', 'invalid-sha', 'artifact-unavailable', 'artifact-sha-mismatch', 'artifact-identity-mismatch', 'target-changed', 'unknown-current', 'bootstrap-hash-mismatch',
        'bootstrap-recovery-required', 'invalid-restoration-request', 'not-legacy-snapshot', 'snapshot-not-found', 'request-failed', 'invalid-site', 'invalid-site-marker', 'publish-rejected', 'publish-mismatch', 'root-mismatch', 'unhealthy-target']);
      fault(codes.has(error.code) ? error.code : 'publisher-failed');
    } finally { if (fd !== undefined) fs.closeSync(fd); busy = false; }
  }
  return {
    async expectation(args) {
      target(args); const expected = await artifact(args.sha);
      return { sha: expected.sha, releaseId: expected.releaseId, artifactHash: expected.artifactHash, targetOrigin };
    },
    async snapshot() {
      const current = await site(now() + 45000);
      return { sha: current.sha, releaseId: current.releaseId, artifactHash: current.artifactHash, targetOrigin, scope: 'static-frontend-only' };
    },
    async inspect(args) {
      target(args); const current = await site(now() + 45000); check(SHA.test(current.sha), 'unknown-current');
      return { sha: current.sha, releaseId: current.releaseId, targetOrigin, artifactHash: current.artifactHash, scope: 'static-frontend-only' };
    },
    async health(args) {
      target(args); const deadline = now() + 45000; const current = await site(deadline);
      check(same(current, args), 'target-changed'); await verify(current, deadline);
      return { healthy: true, sha: current.sha, releaseId: current.releaseId, artifactHash: current.artifactHash, targetOrigin, scope: 'static-frontend-only' };
    },
    async apply(args) {
      return mutate(async deadline => {
        target(args); check(SHA.test(args.sha) && SHA.test(args.previousSha), 'invalid-sha');
        const next = await artifact(args.sha); check(same(next, args), 'artifact-identity-mismatch');
        const current = await site(deadline);
        if (same(current, next)) { await verify(current, deadline); return receipt(current, 'already-present'); }
        check(current.sha === args.previousSha && current.releaseId === args.expectedCurrentReleaseId &&
          current.artifactHash === args.expectedCurrentArtifactHash, 'target-changed');
        check(same(current, await artifact(current.sha)), 'target-changed');
        await verify(current, deadline); backup(current, next.artifactHash);
        const before = await site(deadline); check(before.html === current.html, 'target-changed');
        const published = await publish({ ...next, title: current.title, author: current.author }, deadline);
        backup(published, current.artifactHash);
        return receipt(published, 'post-readback');
      });
    },
    async rollback(args) {
      return mutate(async deadline => {
        target(args); check(SHA.test(args.sha) && SHA.test(args.previousSha), 'invalid-sha');
        check(ID.test(args.releaseId) && HASH.test(args.artifactHash), 'artifact-identity-mismatch');
        const current = await site(deadline);
        if (same(current, args)) { await verify(current, deadline); return receipt(current, 'already-restored'); }
        check(current.sha === args.previousSha && current.releaseId === args.expectedCurrentReleaseId &&
          current.artifactHash === args.expectedCurrentArtifactHash, 'target-changed');
        try { fs.lstatSync(backupFile(args.artifactHash)); } catch (_) { fault('snapshot-not-found'); }
        // This authenticated local pre-write snapshot survives source outages and process restarts.
        const saved = readBackup(args.artifactHash); check(same(saved, args), 'invalid-snapshot');
        const before = await site(deadline); check(before.html === current.html, 'target-changed');
        return receipt(await publish(saved, deadline), 'rollback-readback');
      });
    },
    async restoreLegacy(args) {
      return mutate(async deadline => {
        target(args);
        check(HASH.test(args.expectedCurrentArtifactHash) && HASH.test(args.legacySnapshotHash), 'invalid-restoration-request');
        const saved = readBackup(args.legacySnapshotHash);
        check(!saved.sha && !saved.releaseId, 'not-legacy-snapshot');
        // Explicit operator-supplied preimages allow recovery of even malformed release markers.
        // This path never infers a commit identity and is never called by automatic polling.
        const current = await site(deadline, true);
        check(current.artifactHash === args.expectedCurrentArtifactHash, 'target-changed');
        const before = await site(deadline, true);
        check(before.artifactHash === args.expectedCurrentArtifactHash && before.html === current.html, 'target-changed');
        const restored = await publish(saved, deadline);
        const evidence = receipt(restored, 'legacy-manual-restore');
        return { receiptId: evidence.receiptId, targetOrigin, artifactHash: restored.artifactHash, scope: 'static-frontend-only' };
      });
    },
    async bootstrap({ sha, expectedLegacyHash }) {
      return mutate(async deadline => {
        check(HASH.test(expectedLegacyHash), 'bootstrap-hash-mismatch');
        const legacy = await site(deadline);
        check(!legacy.sha && legacy.artifactHash === expectedLegacyHash, 'bootstrap-hash-mismatch');
        const next = await artifact(sha);
        await verify(legacy, deadline); backup(legacy, next.artifactHash);
        const before = await site(deadline); check(before.html === legacy.html, 'target-changed');
        try {
          const published = await publish({ ...next, title: legacy.title, author: legacy.author }, deadline);
          backup(published, legacy.artifactHash);
          return receipt(published, 'bootstrap-readback');
        }
        catch (_) {
          // The only allowed recovery write restores this exact encrypted legacy page.
          let actual; try { actual = await site(deadline); } catch (_) { fault('bootstrap-recovery-required'); }
          if (actual.artifactHash === legacy.artifactHash) fault('bootstrap-recovery-required');
          if (actual.artifactHash !== next.artifactHash) fault('bootstrap-recovery-required');
          const saved = readBackup(expectedLegacyHash);
          const beforeRestore = await site(deadline);
          if (beforeRestore.artifactHash !== next.artifactHash) fault('bootstrap-recovery-required');
          try { await publish(saved, deadline); } catch (_) { fault('bootstrap-recovery-required'); }
          fault('bootstrap-recovery-required');
        }
      });
    }
  };
}

module.exports = { createWorkBuddyStaticPublisher, TARGET };
