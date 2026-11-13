#!/usr/bin/env node
'use strict';
// The task pins this launcher's digest independently of the manifest. No code
// from the mutable checkout is loaded before the complete private release passes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const REPOSITORY = 'solviq87-cpu/v6-stock-system';
const TARGET = 'https://af3c7822e6aafc135.app.workbuddy.host';
const SCOPE = 'static-frontend-only';
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const FILES = Object.freeze([
  'V6_BO/scripts/managed-publisher-runtime.js',
  'V6_BO/scripts/managed-repository-auto-update.js',
  'V6_BO/scripts/repository-auto-update.js',
  'V6_BO/scripts/build-workbuddy-static.js',
  'V6_BO/src/core/github-update-source.js',
  'V6_BO/src/core/repository-auto-update.js',
  'V6_BO/src/core/workbuddy-static-publisher.js'
]);
const ENTRYPOINT = FILES[1];
const DIRECTORIES = Object.freeze(['', 'V6_BO', 'V6_BO/scripts', 'V6_BO/src', 'V6_BO/src/core']);
const CODES = new Set(['publisher-not-owner', 'owner-unavailable', 'owner-invalid', 'ci-blocked', 'source-head-changed', 'source-unavailable',
  'usage', 'managed-update-blocked', 'credential-required', 'up-to-date', 'applied', 'recovered', 'rolled-back', 'recovery-required',
  'needs-provider', 'update-available', 'failed-sha-blocked', 'locked', 'lock-unavailable', 'unverified-current', 'invalid-source-evidence',
  'invalid-config', 'unsafe-state-directory', 'unsafe-state-file', 'invalid-state', 'state-scope-mismatch', 'invalid-clock', 'updater-error',
  'recovery-ownership-unverified']);
const failure = () => ({ ok: false, error: 'managed-runtime-invalid' });
function invalid() { const error = new Error('managed-runtime-invalid'); error.code = 'managed-runtime-invalid'; throw error; }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const uid = () => typeof process.getuid === 'function' ? process.getuid() : invalid();

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || path.resolve(value) !== value) invalid();
  return value;
}
function ancestors(file) {
  absolute(file);
  const parts = file.split(path.sep).filter(Boolean);
  let cursor = path.parse(file).root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) invalid();
    // .git can be a directory or a linked-worktree marker file.
    if (stat.isDirectory()) {
      try { fs.lstatSync(path.join(cursor, '.git')); invalid(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
function privateDirectory(directory) {
  const stat = fs.lstatSync(directory), mode = stat.mode & 0o7777;
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid() || ![0o700, 0o500].includes(mode)) invalid();
}
function readPrivateFile(file, modes, limit) {
  ancestors(file);
  const before = fs.lstatSync(file);
  const acceptable = stat => stat.isFile() && stat.uid === uid() && stat.nlink === 1 && modes.includes(stat.mode & 0o7777) && stat.size > 0 && stat.size <= limit;
  if (!acceptable(before)) invalid();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!acceptable(opened) || opened.dev !== before.dev || opened.ino !== before.ino) invalid();
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (!acceptable(after) || bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) invalid();
    return bytes;
  } finally { fs.closeSync(fd); }
}
function verifyRuntime(manifestFile, expectedHash) {
  try {
    absolute(manifestFile);
    if (!HASH.test(expectedHash || '') || path.basename(manifestFile) !== 'manifest.json') invalid();
    const releaseDir = path.dirname(manifestFile);
    if (!SHA.test(path.basename(releaseDir)) || path.basename(path.dirname(releaseDir)) !== 'releases') invalid();
    ancestors(releaseDir);
    privateDirectory(releaseDir);
    const raw = readPrivateFile(manifestFile, [0o400, 0o500], 16384);
    if (hash(raw) !== expectedHash) invalid();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (!Buffer.from(text).equals(raw)) invalid();
    const manifest = JSON.parse(text);
    const keys = ['schemaVersion', 'sourceSha', 'repository', 'targetOrigin', 'scope', 'files'];
    const tokens = [...text.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(match => JSON.parse(match[1]));
    if (!manifest || Array.isArray(manifest) || Object.keys(manifest).length !== keys.length || keys.some(key => !Object.hasOwn(manifest, key)) ||
        tokens.length !== keys.length + FILES.length || new Set(tokens).size !== tokens.length || manifest.schemaVersion !== 1 ||
        !SHA.test(manifest.sourceSha || '') || path.basename(releaseDir) !== manifest.sourceSha || manifest.repository !== REPOSITORY ||
        manifest.targetOrigin !== TARGET || manifest.scope !== SCOPE || !manifest.files || Array.isArray(manifest.files) ||
        Object.keys(manifest.files).length !== FILES.length || FILES.some(file => !Object.hasOwn(manifest.files, file) || !HASH.test(manifest.files[file] || ''))) invalid();
    // Reject unmanifested modules/package metadata as well as unexpected dirs.
    const allowed = new Set([...DIRECTORIES.filter(Boolean), ...FILES, 'manifest.json']);
    for (const relative of DIRECTORIES) {
      const directory = path.join(releaseDir, relative);
      privateDirectory(directory);
      for (const entry of fs.readdirSync(directory)) if (!allowed.has(relative ? `${relative}/${entry}` : entry)) invalid();
    }
    for (const relative of FILES) {
      const bytes = readPrivateFile(path.join(releaseDir, relative), [0o400, 0o500], 2 * 1024 * 1024);
      if (hash(bytes) !== manifest.files[relative]) invalid();
    }
    return { releaseDir, sourceSha: manifest.sourceSha, entrypoint: path.join(releaseDir, ENTRYPOINT) };
  } catch (_) { invalid(); }
}
function sanitize(value) {
  if (!value || !CODES.has(value.code)) return failure();
  const output = { code: value.code, targetOrigin: TARGET, scope: SCOPE };
  if (SHA.test(value.candidateSha || '')) output.candidateSha = value.candidateSha;
  if (SHA.test(value.deployedSha || '')) output.deployedSha = value.deployedSha;
  if (/^wb-[a-f0-9]{56}$/.test(value.receiptId || '')) output.receiptId = value.receiptId;
  if (['managed-task', 'github-actions'].includes(value.publisherOwner)) output.publisherOwner = value.publisherOwner;
  if (typeof value.recoveryOnly === 'boolean') output.recoveryOnly = value.recoveryOnly;
  return output;
}
async function main(args, dependencies = {}) {
  try {
    if (!Array.isArray(args)) invalid();
    const [manifestFile, expectedHash, mode, configFile, ...flags] = args;
    if (mode === 'check' ? flags.length !== 0 : mode !== 'once' || flags.length !== 1 || flags[0] !== '--apply') invalid();
    absolute(configFile);
    const runtime = verifyRuntime(manifestFile, expectedHash);
    readPrivateFile(configFile, [0o400, 0o600], 16384);
    // Only after every hash and permission check may any publisher code load.
    const runMain = dependencies.runMain || require(runtime.entrypoint).main;
    if (typeof runMain !== 'function') invalid();
    return sanitize(await runMain([mode, configFile, ...flags]));
  } catch (_) { return failure(); }
}
if (require.main === module) main(process.argv.slice(2)).then(output => {
  process.stdout.write(JSON.stringify(output) + '\n');
  if (output.ok === false) process.exitCode = 1;
  else if (!['up-to-date', 'applied', 'recovered', 'update-available'].includes(output.code)) process.exitCode = 2;
});
module.exports = { verifyRuntime, main };
