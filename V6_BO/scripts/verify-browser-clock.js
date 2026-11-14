'use strict';
// Verify the installed test driver's clock before trusting temporal browser checks.
// The controlled embedder makes the upstream #37700 regression deterministic,
// without Chromium, network, application data or changes to business time gates.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const packageFile = require.resolve('playwright-core/package.json');
const version = require(packageFile).version;
const { source } = require(path.join(path.dirname(packageFile), 'lib/generated/clockSource.js'));
const context = { module: { exports: {} }, console };
vm.runInNewContext(source, context, { filename: 'installed-playwright-clock.js' });
let nativeTicks = 0;
const controller = new context.ClockController({
  performanceNow: () => nativeTicks,
  dateNow: () => 0,
  setTimeout(callback, delay) {
    let cancelled = false;
    if (!delay) queueMicrotask(() => { if (!cancelled) callback(); });
    return () => { cancelled = true; };
  },
  setInterval: () => () => {}
});
(async () => {
  const observed = [];
  controller.install(1000000);
  controller.resume();
  controller.addTimer({ type: 'Timeout', delay: 10, args: [], func() {
    nativeTicks = 500; // Async/native work advances while a fake timer is running.
    observed.push(controller.now());
  } });
  await controller.runFor(100);
  observed.push(controller.now());
  assert.equal(observed.length, 2);
  assert.ok(observed[1] >= observed[0], `Browser clock moved backward (${version}): ${observed.join(' -> ')}`);
  console.log(JSON.stringify({ passed: true, driver: version, observed, offline: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
