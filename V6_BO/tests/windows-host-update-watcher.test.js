'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { parseArgs, lockWatcher, watch } = require('../deploy/windows-host/watch-updates.js');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-update-watch-'));
  fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'installation');
}
test('watcher defaults to dry-run, requires explicit apply, and never retains standing sensitive approval', () => {
  assert.equal(parseArgs([]).action, 'check');
  assert.equal(parseArgs(['--apply']).action, 'apply');
  assert.throws(() => parseArgs(['--apply', '--approve-sensitive', 'a'.repeat(40)]), /watcher-sensitive-approval-rejected/);
  assert.throws(() => parseArgs(['--home', '/mnt/c/private-app']), /unsafe-update-path/);
});
test('only one watcher can hold a private installation watcher lock and release allows restart', t => {
  const root = setup(t), release = lockWatcher(root);
  assert.throws(() => lockWatcher(root), /watcher-already-running/);
  release(); const next = lockWatcher(root); next();
});
test('world-readable and linked watcher locks are rejected without truncating their contents', t => {
  const root = setup(t); fs.mkdirSync(root + '.updater', { mode: 0o700 });
  const file = path.join(root + '.updater', 'watcher.lock'); fs.writeFileSync(file, 'keep-me', { mode: 0o644 }); fs.chmodSync(file, 0o644);
  assert.throws(() => lockWatcher(root), /unsafe-watcher-lock/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep-me');
  fs.chmodSync(file, 0o600); fs.linkSync(file, path.join(root + '.updater', 'shared-lock'));
  assert.throws(() => lockWatcher(root), /unsafe-watcher-lock/);
});
test('SIGTERM waits for the in-flight updater rather than interrupting a backup/switch and releases the watcher lock', async t => {
  const root = setup(t), signals = new EventEmitter(), reports = [];
  let complete, invoked = false;
  const running = watch({ action: 'apply', root }, { signals, report: value => reports.push(value), execute: () => { invoked = true; return new Promise(resolve => { complete = resolve; }); } });
  assert.equal(invoked, true); signals.emit('SIGTERM');
  assert.throws(() => lockWatcher(root), /watcher-already-running/);
  complete({ code: 'local-update-installed' }); await running;
  assert.equal(reports.at(-1).inFlightUpdateInterrupted, false);
  const release = lockWatcher(root); release();
});
test('one check is observable and pause results do not trigger a hidden apply action', async t => {
  const root = setup(t), calls = [], reports = [];
  await watch({ action: 'check', root }, { signals: new EventEmitter(), report: value => reports.push(value), execute: async options => { calls.push(options.action); return { code: 'updates-paused' }; }, afterCheck: stop => stop() });
  assert.deepEqual(calls, ['check']); assert.equal(reports[1].code, 'updates-paused');
  assert.equal(reports[0].intervalSeconds, 900);
});
test('terminal process-group SIGINT stops the watcher without killing its detached in-flight updater', async t => {
  const root = setup(t), file = path.join(path.dirname(root), 'terminal-fixture.js');
  const modulePath = require.resolve('../deploy/windows-host/watch-updates.js');
  fs.writeFileSync(file, `const {spawn}=require('node:child_process');
const watcher=require(${JSON.stringify(modulePath)});
watcher.watch({root:${JSON.stringify(root)},action:'apply'},{execute:options=>watcher.execute(options,{spawn:(command,args,opts)=>{
 const child=spawn(command,['-e',"console.error('UPDATER_READY');setTimeout(()=>console.log(JSON.stringify({code:'fixture-completed'})),250)"],{...opts,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',chunk=>process.stderr.write(chunk)); return child;
}})}).catch(()=>process.exitCode=1);`);
  const child = spawn(process.execPath, [file], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } });
  let output = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('updater readiness timeout')), 3000);
    child.stderr.on('data', chunk => { if (String(chunk).includes('UPDATER_READY')) { clearTimeout(timeout); resolve(); } });
    child.on('error', reject);
  });
  process.kill(-child.pid, 'SIGINT');
  const exit = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  assert.equal(exit.code, 0); assert.equal(exit.signal, null);
  const receipts = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(receipts[1].code, 'fixture-completed');
  assert.equal(receipts.at(-1).inFlightUpdateInterrupted, false);
});
