#!/usr/bin/env node
'use strict';

// Explicit local-file report only: no provider calls, writes or scheduler.
const { readSectorRelationsCaptureInput } = require('../src/core/sector-relations-capture-bridge');
const { analyzeSectorRelations } = require('../src/strategy/sector-relations');

function main(argv = process.argv.slice(2)) {
  if (argv.length < 3 || argv.length > 4 || !/^\d{13}$/.test(argv[2] || ''))
    throw Error('用法: sector-relations-capture-report.js <私有采集根目录> <私有交易日历JSON> <asOf毫秒> [sectorIds的JSON数组]');
  const [captureRoot, calendarFile, clock, selection] = argv;
  const input = readSectorRelationsCaptureInput({ captureRoot, calendarFile, asOf: Number(clock),
    ...(selection !== undefined ? { sectorIds: JSON.parse(selection) } : {}) });
  const report = analyzeSectorRelations({ asOf: input.asOf, tradeDates: input.tradeDates,
    history: input.sectorHistory, current: input.sectorCurrent });
  return { schemaVersion: 1, mode: 'sector-relations-capture-report-research-only', input, report,
    canTrade: false, canNotify: false, verifiedLive: false, weightsChanged: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(main())); }
  catch { console.error(JSON.stringify({ status: 'blocked-invalid-capture-evidence', canTrade: false })); process.exitCode = 1; }
}
module.exports = { main };
