#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { dependencies } = require('./host-runtime.js');

function inspectUnits(user) {
  const args = [...(user ? ['--user'] : []), 'list-unit-files', '--type=service', '--type=timer', '--no-legend', '--no-pager'];
  const result = spawnSync('systemctl', args, { encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024 });
  if (result.error || result.status !== 0) return { scope: user ? 'user' : 'system', inspected: false, code: 'systemd-unavailable' };
  const units = result.stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => /tian.?shu|v6|stock/i.test(parts[0] || ''));
  return { scope: user ? 'user' : 'system', inspected: true, matchingUnits: units.map(([unit, state]) => ({ unit, state })) };
}

if (require.main === module) {
  console.log(JSON.stringify({ code: 'host-audit', dependencies: dependencies(), services: [inspectUnits(false), inspectUnits(true)],
    tasksChanged: false, startupVerified: false, phoneConnected: false }));
}
module.exports = { inspectUnits };
