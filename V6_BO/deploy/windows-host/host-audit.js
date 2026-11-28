#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { dependencies } = require('./host-runtime.js');
const os = require('node:os'), fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');

function inspectUnits(user) {
  const args = [...(user ? ['--user'] : []), 'list-unit-files', '--type=service', '--type=timer', '--no-legend', '--no-pager'];
  const result = spawnSync('systemctl', args, { encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024 });
  if (result.error || result.status !== 0) return { scope: user ? 'user' : 'system', inspected: false, code: 'systemd-unavailable' };
  const units = result.stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => /tian.?shu|v6|stock/i.test(parts[0] || ''));
  return { scope: user ? 'user' : 'system', inspected: true, matchingUnits: units.map(([unit, state]) => ({ unit, state })) };
}

const safeCount = n => Number.isSafeInteger(n) && n >= 0;
const cpuKeys = ['user', 'nice', 'sys', 'idle', 'irq'];
const attempt = fn => { try { return fn(); } catch { return null; } };
function cpuSnapshot(osApi = os, mono = () => performance.now()) {
  return attempt(() => {
    const rows = osApi.cpus(), at = mono();
    if (!Array.isArray(rows) || !rows.length || rows.length > 4096 || !Number.isFinite(at) || at < 0) return null;
    if (rows.some(row => typeof row?.model !== 'string' || !cpuKeys.every(k => safeCount(row.times?.[k])))) return null;
    return { at, rows: rows.map(row => ({ model: row.model, times: cpuKeys.map(k => row.times[k]) })) };
  });
}
function cpuObservation(before, after) {
  const unavailable = { scope: 'os-visible-logical-cpus', status: 'not-observed', logicalCpus: null, sampleMs: null, busyPct: null };
  if (!before || !after || before.rows.length !== after.rows.length || after.at - before.at < 100) return unavailable;
  let total = 0, idle = 0;
  for (let i = 0; i < before.rows.length; i++) {
    const a = before.rows[i], b = after.rows[i];
    if (a.model !== b.model) return unavailable;
    for (let k = 0; k < cpuKeys.length; k++) {
      const delta = b.times[k] - a.times[k];
      if (!safeCount(delta)) return unavailable;
      total += delta; if (cpuKeys[k] === 'idle') idle += delta;
    }
  }
  if (!safeCount(total) || total === 0 || !safeCount(idle) || idle > total) return unavailable;
  return { ...unavailable, status: idle === 0 ? 'saturated-in-sample' : 'observed', logicalCpus: after.rows.length,
    sampleMs: Math.round(after.at - before.at), busyPct: Math.round(10000 * (total - idle) / total) / 100 };
}
function inspectResources(before, { osApi = os, fsApi = fs, mono = () => performance.now(), clock = Date.now } = {}) {
  const cpu = cpuObservation(before, cpuSnapshot(osApi, mono));
  const memory = attempt(() => {
    const totalBytes = osApi.totalmem(), freeBytes = osApi.freemem();
    if (!safeCount(totalBytes) || totalBytes === 0 || !safeCount(freeBytes) || freeBytes > totalBytes) return null;
    return { totalBytes, freeBytes, status: freeBytes === 0 ? 'no-free-bytes-observed' : 'observed' };
  });
  const disk = attempt(() => {
    const st = fsApi.statfsSync(osApi.homedir(), { bigint: true });
    if (!['bsize','blocks','bavail'].every(k => typeof st?.[k] === 'bigint' && st[k] >= 0n) || st.bsize === 0n || st.blocks === 0n || st.bavail > st.blocks) return null;
    const total = st.bsize * st.blocks, available = st.bsize * st.bavail;
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { totalBytes: Number(total), availableBytes: Number(available), status: available === 0n ? 'no-available-bytes' : 'observed' };
  });
  const now = attempt(clock);
  return { scope: 'one-shot-local-host-audit', observedAt: safeCount(now) && now > 0 ? now : null, cpu,
    memory: { scope: 'os-reported-free-not-application-budget', ...(memory || { status: 'not-observed', totalBytes: null, freeBytes: null }) },
    disk: { scope: 'home-filesystem-unprivileged-available', ...(disk || { status: 'not-observed', totalBytes: null, availableBytes: null }) },
    gpu: { status: 'not-observed', utilizationPct: null, vramTotalBytes: null, vramUsedBytes: null, reason: 'no-verified-local-probe' },
    continuousMonitoring: false, processResourceBudgetCertified: false, automaticAction: false, readOnly: true };
}
async function runAudit() {
  const before = cpuSnapshot();
  const report = { code: 'host-audit', dependencies: dependencies(), services: [inspectUnits(false), inspectUnits(true)],
    tasksChanged: false, startupVerified: false, phoneConnected: false };
  // One bounded local sample, no supplier/network request or monitoring loop.
  if (before && performance.now() - before.at < 120) await delay(120);
  return { ...report, resources: inspectResources(before) };
}
if (require.main === module) runAudit().then(report => console.log(JSON.stringify(report))).catch(() => {
  console.log(JSON.stringify({ code: 'host-audit-failed', tasksChanged: false, startupVerified: false, phoneConnected: false }));
  process.exitCode = 2;
});
module.exports = { inspectUnits, cpuSnapshot, cpuObservation, inspectResources, runAudit };
