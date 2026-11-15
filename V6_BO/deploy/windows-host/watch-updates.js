#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const updater = require('./safe-updater.js');
const INTERVAL_MS = 15 * 60 * 1000;

function failure(code) { const error = new Error(code); error.code = code; throw error; }
function lockWatcher(root) {
  const dir = root + '.updater';
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = fs.lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) failure('unsafe-watcher-state');
  const fd = fs.openSync(path.join(dir, 'watcher.lock'), fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o077)) { fs.closeSync(fd); failure('unsafe-watcher-lock'); }
  const result = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 2000 });
  if (result.error || result.status !== 0) { fs.closeSync(fd); failure('watcher-already-running'); }
  return () => fs.closeSync(fd);
}

function parseArgs(args) {
  let apply = false;
  const rest = [];
  for (const flag of args) {
    if (flag === '--apply') { if (apply) failure('watcher-usage'); apply = true; }
    else rest.push(flag);
  }
  // Reuse the updater's strict private path and duplicate flag validation.
  const options = updater.parseArgs([apply ? 'apply' : 'check', ...rest]);
  if (options.approveSensitive) failure('watcher-sensitive-approval-rejected');
  return options;
}

function execute(options, deps = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}), ...(process.env.V6_MODEL_PYTHON ? { V6_MODEL_PYTHON: process.env.V6_MODEL_PYTHON } : {}) };
  return new Promise(resolve => {
    // A terminal Ctrl+C must reach the watcher, not interrupt a child's switch.
    const child = (deps.spawn || spawn)(process.execPath, [path.join(__dirname, 'safe-updater.js'), options.action, '--home', options.root], { env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '', overflow = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (output.length + chunk.length > 65536) overflow = true; else output += chunk; });
    child.on('error', () => resolve({ code: 'watcher-child-unavailable' }));
    child.on('close', (_exitCode, signal) => {
      if (signal) { resolve({ code: 'watcher-update-interrupted', interrupted: true }); return; }
      try {
        const value = JSON.parse(output);
        const code = !overflow && /^[a-z][a-z0-9-]{1,70}$/.test(value.code) ? value.code : 'watcher-invalid-receipt';
        // Avoid forwarding arbitrary child output or private diagnostics.
        resolve({ code, ...(typeof value.candidateSha === 'string' && /^[a-f0-9]{40}$/.test(value.candidateSha) ? { candidateSha: value.candidateSha } : {}) });
      } catch { resolve({ code: 'watcher-invalid-receipt' }); }
    });
  });
}

async function watch(options, deps = {}) {
  const release = lockWatcher(options.root);
  let stopped = false, finishWait, interrupted = false;
  const stop = () => { stopped = true; finishWait?.(); };
  const signals = deps.signals || process;
  signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
  const report = deps.report || (value => process.stdout.write(JSON.stringify(value) + '\n'));
  try {
    report({ code: 'watcher-started', mode: options.action === 'apply' ? 'apply' : 'dry-run', intervalSeconds: 900 });
    while (!stopped) {
      const result = await (deps.execute || execute)(options);
      interrupted ||= result.interrupted === true;
      report({ checkedAt: new Date().toISOString(), ...result });
      if (stopped) break;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, INTERVAL_MS);
        finishWait = () => { clearTimeout(timer); resolve(); };
        if (deps.afterCheck) deps.afterCheck(stop);
      });
      finishWait = undefined;
    }
    report({ code: 'watcher-stopped', inFlightUpdateInterrupted: interrupted });
  } finally {
    signals.removeListener('SIGINT', stop); signals.removeListener('SIGTERM', stop);
    release();
  }
}

if (require.main === module) {
  Promise.resolve().then(() => watch(parseArgs(process.argv.slice(2)))).catch(error => {
    const code = /^[a-z][a-z0-9-]{1,70}$/.test(error.code || '') ? error.code : 'watcher-failed';
    process.stdout.write(JSON.stringify({ code }) + '\n'); process.exitCode = 2;
  });
}
module.exports = { parseArgs, lockWatcher, watch, execute };
