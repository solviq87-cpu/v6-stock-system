'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { cpuSnapshot, cpuObservation, inspectResources } = require('../deploy/windows-host/host-audit');
const cpu = (user, idle, model = 'fixture') => ({ model, times: { user, idle, nice: 0, sys: 0, irq: 0 } });
const snap = (rows, at) => cpuSnapshot({ cpus: () => rows }, () => at);
const before = snap([cpu(100, 200), cpu(200, 300)], 100);
const good = snap([cpu(125, 275), cpu(275, 325)], 300);
const unknown = x => assert.equal(x.status, 'not-observed');
test('H01.9 host CPU utilization uses actual counter deltas and sample window, not number of threads', () => {
  assert.deepEqual(cpuObservation(before, good), { scope: 'os-visible-logical-cpus', status: 'observed', logicalCpus: 2, sampleMs: 200, busyPct: 50 });
  const busy = cpuObservation(before, snap([cpu(200, 200), cpu(300, 300)], 300));
  assert.equal(busy.busyPct, 100); assert.equal(busy.status, 'saturated-in-sample');
});
test('H01.9 short, zero-progress, rolled-back or changed CPU counters stay unknown', () => {
  for (const after of [snap([cpu(125, 275), cpu(275, 325)], 199), snap([cpu(100, 200), cpu(200, 300)], 300),
    snap([cpu(99, 275), cpu(275, 325)], 300), snap([cpu(125, 275, 'changed'), cpu(275, 325)], 300), snap([cpu(125, 275)], 300), null]) {
    unknown(cpuObservation(before, after)); assert.equal(cpuObservation(before, after).busyPct, null);
  }
  assert.equal(snap([cpu(-1, 2)], 100), null);
});
function resources({ total = 1000, free = 400, stat = { bsize: 10n, blocks: 100n, bavail: 40n }, at = 1234 } = {}) {
  return inspectResources(before, { osApi: { cpus: () => [cpu(125, 275), cpu(275, 325)], totalmem: () => total,
    freemem: () => free, homedir: () => '/private/fixture' }, fsApi: { statfsSync: () => stat }, mono: () => 300, clock: () => at });
}
test('H01.8/9 memory and disk expose separately scoped observed bytes and never invent GPU evidence', () => {
  const r = resources(); assert.equal(r.cpu.busyPct, 50); assert.equal(r.memory.freeBytes, 400); assert.equal(r.disk.availableBytes, 400);
  assert.equal(r.observedAt, 1234); assert.equal(r.gpu.status, 'not-observed'); assert.equal(r.gpu.vramUsedBytes, null);
  assert.equal(r.automaticAction, false); assert.equal(r.continuousMonitoring, false); assert.equal(r.processResourceBudgetCertified, false);
  assert.doesNotMatch(JSON.stringify(r), /private\/fixture/);
});
test('H01.8/9 actual zero free resources differ from invalid or missing measurement', () => {
  const r = resources({ free: 0, stat: { bsize: 10n, blocks: 100n, bavail: 0n } });
  assert.equal(r.memory.freeBytes, 0); assert.equal(r.memory.status, 'no-free-bytes-observed');
  assert.equal(r.disk.availableBytes, 0); assert.equal(r.disk.status, 'no-available-bytes');
  for (const invalid of [{ free: 2000, stat: { bsize: 10n, blocks: 100n, bavail: 101n } }, { total: 0, stat: { bsize: 10n, blocks: 10000000000000000n, bavail: 1n } }]) {
    const q = resources(invalid); unknown(q.memory); unknown(q.disk); assert.equal(q.disk.availableBytes, null);
  }
});
test('H01.9 unavailable OS sources fail independently and do not leak raw error details', () => {
  const bad = () => { throw Error('secret private path'); };
  const r = inspectResources(before, { osApi: { cpus: bad, totalmem: bad, homedir: bad }, fsApi: { statfsSync: bad }, clock: bad });
  unknown(r.cpu); unknown(r.memory); unknown(r.disk); assert.equal(r.observedAt, null); assert.doesNotMatch(JSON.stringify(r), /secret|private path/);
});
test('H01.9 real local Node OS and filesystem sample is read-only and bounded', async () => {
  const start = cpuSnapshot(); await new Promise(r => setTimeout(r, 150)); const r = inspectResources(start);
  assert.equal(r.readOnly, true); assert.equal(r.gpu.utilizationPct, null);
  if (r.cpu.busyPct !== null) assert.ok(r.cpu.busyPct >= 0 && r.cpu.busyPct <= 100);
  if (r.memory.totalBytes !== null) assert.ok(r.memory.freeBytes <= r.memory.totalBytes);
  if (r.disk.totalBytes !== null) assert.ok(r.disk.availableBytes <= r.disk.totalBytes);
});
