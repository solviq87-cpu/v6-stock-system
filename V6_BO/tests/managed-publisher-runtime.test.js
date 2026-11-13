'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { verifyRuntime, main } = require('../scripts/managed-publisher-runtime');
const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const TARGET = 'https://af3c7822e6aafc135.app.workbuddy.host';
const FAILURE = { ok: false, error: 'managed-runtime-invalid' };
// Independent deployment contract, not a list imported from the verifier.
const FILES = [
  'V6_BO/scripts/managed-publisher-runtime.js', 'V6_BO/scripts/managed-repository-auto-update.js',
  'V6_BO/scripts/repository-auto-update.js', 'V6_BO/scripts/build-workbuddy-static.js',
  'V6_BO/src/core/github-update-source.js', 'V6_BO/src/core/repository-auto-update.js',
  'V6_BO/src/core/workbuddy-static-publisher.js'
];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function mutableWrite(file, bytes, mode = 0o400) {
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, bytes, { mode }); fs.chmodSync(file, mode);
}
function cleanup(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isDirectory()) { fs.chmodSync(directory, 0o700); for (const entry of fs.readdirSync(directory)) cleanup(path.join(directory, entry)); }
  else if (!stat.isSymbolicLink()) fs.chmodSync(directory, 0o600);
}
function fixture(t) {
  // /tmp in some shared test environments contains another worktree's .git;
  // fixtures must actually live outside a worktree, just like deployments.
  const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/var/tmp', 'managed-runtime-'));
  t.after(() => { cleanup(root); fs.rmSync(root, { recursive: true, force: true }); });
  const releaseDir = path.join(root, 'releases', SHA), manifestFile = path.join(releaseDir, 'manifest.json');
  const configFile = path.join(root, 'private-config.json'), markerFile = path.join(root, 'publisher-loaded');
  fs.mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile, '{"schemaVersion":1}', { mode: 0o600 });
  for (const relative of FILES) {
    const file = path.join(releaseDir, relative); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let code = "'use strict'; module.exports = {};\n";
    if (relative.endsWith('/managed-publisher-runtime.js')) code = fs.readFileSync(path.join(__dirname, '../scripts/managed-publisher-runtime.js'));
    if (relative.endsWith('/managed-repository-auto-update.js')) code = `require('node:fs').writeFileSync(${JSON.stringify(markerFile)},'loaded');exports.main=async args=>({code:args[0]==='check'?'update-available':'applied',candidateSha:'${SHA}',privateBody:'DO_NOT_PRINT_PRIVATE_DATA'});\n`;
    fs.writeFileSync(file, code, { mode: 0o400 });
  }
  const manifest = { schemaVersion: 1, sourceSha: SHA, repository: 'solviq87-cpu/v6-stock-system', targetOrigin: TARGET, scope: 'static-frontend-only',
    files: Object.fromEntries(FILES.map(file => [file, digest(fs.readFileSync(path.join(releaseDir, file)))])) };
  let expectedHash;
  function save(raw = JSON.stringify(manifest)) { mutableWrite(manifestFile, raw); expectedHash = digest(raw); return expectedHash; }
  save();
  return { root, releaseDir, manifestFile, configFile, markerFile, manifest, save, get expectedHash() { return expectedHash; },
    file: relative => path.join(releaseDir, relative), args: (mode = 'check', flags = []) => [manifestFile, expectedHash, mode, configFile, ...flags] };
}
async function blocked(f, args = f.args()) {
  let runs = 0;
  assert.deepEqual(await main(args, { runMain: async () => { runs++; throw Error('PRIVATE callback must never run'); } }), FAILURE);
  assert.equal(runs, 0); assert.equal(fs.existsSync(f.markerFile), false);
}

test('a fully verified private release delegates only check or explicit once --apply', async t => {
  const f = fixture(t);
  assert.deepEqual(verifyRuntime(f.manifestFile, f.expectedHash), { releaseDir: f.releaseDir, sourceSha: SHA, entrypoint: f.file(FILES[1]) });
  const calls = [];
  for (const [mode, flags] of [['check', []], ['once', ['--apply']]]) {
    const result = await main(f.args(mode, flags), { runMain: async args => { calls.push(args); return { code: mode === 'check' ? 'update-available' : 'applied', candidateSha: SHA, secret: 'DO_NOT_PRINT_PRIVATE_DATA' }; } });
    assert.deepEqual(result, { code: mode === 'check' ? 'update-available' : 'applied', targetOrigin: TARGET, scope: 'static-frontend-only', candidateSha: SHA });
  }
  assert.deepEqual(calls, [['check', f.configFile], ['once', f.configFile, '--apply']]);
});

test('read-only executable files and sealed private directories are valid', async t => {
  const f = fixture(t);
  fs.chmodSync(f.manifestFile, 0o500); for (const relative of FILES) fs.chmodSync(f.file(relative), 0o500);
  for (const relative of ['V6_BO/scripts', 'V6_BO/src/core', 'V6_BO/src', 'V6_BO', '']) fs.chmodSync(path.join(f.releaseDir, relative), 0o500);
  assert.equal(verifyRuntime(f.manifestFile, f.expectedHash).sourceSha, SHA);
});

test('real CLI loads the verified private entrypoint and strips extra output data', t => {
  const f = fixture(t);
  const cli = spawnSync(process.execPath, [f.file(FILES[0]), ...f.args()], { encoding: 'utf8', timeout: 10000 });
  assert.equal(cli.status, 0); assert.equal(cli.stderr, ''); assert.equal(fs.readFileSync(f.markerFile, 'utf8'), 'loaded');
  assert.deepEqual(JSON.parse(cli.stdout), { code: 'update-available', targetOrigin: TARGET, scope: 'static-frontend-only', candidateSha: SHA });
  assert.equal(cli.stdout.includes('DO_NOT_PRINT'), false); assert.equal(cli.stdout.includes(f.root), false);
});

test('CLI never loads even a valid entrypoint when a later dependency fails integrity', t => {
  const f = fixture(t); mutableWrite(f.file(FILES.at(-1)), "throw Error('DO_NOT_PRINT_PRIVATE_DATA');\n");
  const cli = spawnSync(process.execPath, [f.file(FILES[0]), ...f.args()], { encoding: 'utf8', timeout: 10000 });
  assert.equal(cli.status, 1); assert.equal(cli.stderr, ''); assert.deepEqual(JSON.parse(cli.stdout), FAILURE);
  assert.equal(fs.existsSync(f.markerFile), false); assert.equal(cli.stdout.includes(f.root), false);
});

test('wrong manifest pins, tampered bytes, missing code and unmanifested modules block delegation', async t => {
  for (const variant of ['pin', 'manifest-bytes', 'code-bytes', 'missing', 'unlisted-module']) {
    const f = fixture(t); let args;
    if (variant === 'pin') { args = f.args(); args[1] = '0'.repeat(64); }
    if (variant === 'manifest-bytes') mutableWrite(f.manifestFile, JSON.stringify(f.manifest) + '\n');
    if (variant === 'code-bytes') mutableWrite(f.file(FILES[3]), 'module.exports={tampered:true};');
    if (variant === 'missing') fs.unlinkSync(f.file(FILES[4]));
    if (variant === 'unlisted-module') fs.writeFileSync(path.join(f.releaseDir, 'package.json'), '{"type":"module"}', { mode: 0o400 });
    await blocked(f, args);
    assert.throws(() => verifyRuntime(f.manifestFile, args ? args[1] : f.expectedHash), error => error.code === 'managed-runtime-invalid' && !error.message.includes(f.root));
  }
});

test('pinned but invalid schemas, extra fields, duplicate keys and unknown paths are rejected', async t => {
  const variants = [
    f => { f.manifest.extra = 'DO_NOT_PRINT_PRIVATE_DATA'; },
    f => { f.manifest.schemaVersion = 2; }, f => { f.manifest.sourceSha = OTHER; },
    f => { f.manifest.repository = 'other/repo'; }, f => { f.manifest.targetOrigin = 'https://foreign.invalid'; },
    f => { f.manifest.scope = 'backend'; },
    f => { delete f.manifest.files[FILES[0]]; f.manifest.files['../outside.js'] = 'a'.repeat(64); },
    f => { f.manifest.files['V6_BO/scripts/extra.js'] = 'a'.repeat(64); },
    f => { delete f.manifest.files[FILES[5]]; },
    f => { f.manifest.files[FILES[5]] = 'A'.repeat(64); },
    f => { f.manifest.files = []; }
  ];
  for (const mutate of variants) { const f = fixture(t); mutate(f); f.save(); await blocked(f); }
  for (const encode of [
    f => JSON.stringify(f.manifest).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    f => JSON.stringify(f.manifest).replace('"files":{', `"files":{${JSON.stringify(FILES[0])}:"${f.manifest.files[FILES[0]]}",`),
    () => '{invalid-json', () => ' '.repeat(16385)
  ]) { const f = fixture(t); f.save(encode(f)); await blocked(f); }
});

test('symlink leaves or ancestors cannot redirect the runtime or private config', async t => {
  for (const variant of ['module', 'manifest', 'ancestor', 'config']) {
    const f = fixture(t); let args;
    if (variant === 'ancestor') {
      const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.root, alias, 'dir');
      args = f.args(); args[0] = path.join(alias, 'releases', SHA, 'manifest.json');
    } else {
      const file = variant === 'module' ? f.file(FILES[5]) : variant === 'manifest' ? f.manifestFile : f.configFile;
      const outside = path.join(f.root, `${variant}-target`); fs.renameSync(file, outside); fs.symlinkSync(outside, file);
    }
    await blocked(f, args);
  }
});

test('writable/readable-by-others runtime files, unsafe directories and hard links are rejected', async t => {
  for (const variant of ['writable-code', 'public-code', 'writable-manifest', 'public-manifest', 'public-root', 'public-directory', 'hardlink-code', 'hardlink-manifest', 'public-config', 'hardlink-config']) {
    const f = fixture(t);
    const modes = { 'writable-code': [f.file(FILES[2]), 0o600], 'public-code': [f.file(FILES[2]), 0o444], 'writable-manifest': [f.manifestFile, 0o600], 'public-manifest': [f.manifestFile, 0o440],
      'public-root': [f.releaseDir, 0o750], 'public-directory': [f.file('V6_BO/src/core'), 0o755], 'public-config': [f.configFile, 0o644] };
    if (modes[variant]) fs.chmodSync(...modes[variant]);
    else fs.linkSync(variant === 'hardlink-code' ? f.file(FILES[2]) : variant === 'hardlink-manifest' ? f.manifestFile : f.configFile, path.join(f.root, 'second-link'));
    await blocked(f);
  }
});

test('runtime ownership must match the invoking user', async t => {
  const f = fixture(t), actual = process.getuid(); t.mock.method(process, 'getuid', () => actual + 1);
  await blocked(f);
});

test('git worktrees, wrong release locations and noncanonical manifest paths fail closed', async t => {
  for (const marker of ['directory', 'file']) {
    const f = fixture(t); const git = path.join(f.root, '.git');
    if (marker === 'directory') fs.mkdirSync(git, { mode: 0o700 }); else fs.writeFileSync(git, 'gitdir: elsewhere', { mode: 0o600 });
    await blocked(f);
  }
  for (const variant of ['relative', 'parent-traversal', 'filename', 'release-parent']) {
    const f = fixture(t), args = f.args();
    if (variant === 'relative') args[0] = 'manifest.json';
    if (variant === 'parent-traversal') args[0] = `${f.releaseDir}/../${SHA}/manifest.json`;
    if (variant === 'filename') { const other = path.join(f.releaseDir, 'runtime-manifest.json'); fs.renameSync(f.manifestFile, other); args[0] = other; }
    if (variant === 'release-parent') { const other = path.join(f.root, 'unreviewed'); fs.renameSync(path.dirname(f.releaseDir), other); args[0] = path.join(other, SHA, 'manifest.json'); }
    await blocked(f, args);
  }
});

test('unsupported modes, flags and unsafe config paths never delegate', async t => {
  const f = fixture(t);
  for (const args of [f.args('once'), f.args('check', ['--apply']), f.args('watch', ['--apply']), f.args('bootstrap', ['--apply']),
    f.args('once', ['--apply', '--apply']), f.args('check', ['--unknown']), [...f.args(), 'extra'], [f.manifestFile, 'short', 'check', f.configFile],
    [f.manifestFile, f.expectedHash, 'check', 'relative.json'], [f.manifestFile, f.expectedHash, 'once', f.configFile, '--apply', '--expected-legacy-hash', 'a'.repeat(64)]]) await blocked(f, args);
});

test('delegated exceptions and unexpected output are sanitized without leaking details', async t => {
  const f = fixture(t);
  for (const runMain of [async () => { throw Error(`${f.root}: DO_NOT_PRINT_PRIVATE_DATA`); }, async () => ({ code: 'DO_NOT_PRINT_PRIVATE_DATA', path: f.root })]) assert.deepEqual(await main(f.args(), { runMain }), FAILURE);
});

test('recovery outcomes retain only bounded known evidence fields', async t => {
  const f = fixture(t), receiptId = `wb-${'c'.repeat(56)}`;
  assert.deepEqual(await main(f.args(), { runMain: async () => ({ code: 'recovery-ownership-unverified', candidateSha: SHA, deployedSha: OTHER,
    receiptId, publisherOwner: 'managed-task', recoveryOnly: true, privateBody: 'DO_NOT_PRINT_PRIVATE_DATA', targetOrigin: 'https://foreign.invalid' }) }),
  { code: 'recovery-ownership-unverified', targetOrigin: TARGET, scope: 'static-frontend-only', candidateSha: SHA, deployedSha: OTHER, receiptId, publisherOwner: 'managed-task', recoveryOnly: true });
  const output = await main(f.args(), { runMain: async () => ({ code: 'up-to-date', receiptId: 'DO_NOT_PRINT_PRIVATE_DATA', candidateSha: f.root, deployedSha: 'invalid', publisherOwner: 'DO_NOT_PRINT_PRIVATE_DATA', recoveryOnly: 'DO_NOT_PRINT_PRIVATE_DATA' }) });
  assert.deepEqual(output, { code: 'up-to-date', targetOrigin: TARGET, scope: 'static-frontend-only' });
});
