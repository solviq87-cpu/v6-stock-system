#!/usr/bin/env node
'use strict';
// Deliberately separate from the original historical collectors and lastPx.
const path = require('node:path');
const {collectCenterHistory} = require('../src/core/intelligence-history');
if (require.main === module) (async () => {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 5 || args[4] !== '--allow-research-fetch' || !path.isAbsolute(args[3]))
      throw Error('用法: collect-center-history.js <1至3只代码逗号分隔> <起日> <止日> <私有绝对目录> --allow-research-fetch');
    const result = await collectCenterHistory({symbols: args[0].split(','), start: args[1], end: args[2],
      root: args[3], allowNetwork: true});
    process.stdout.write(JSON.stringify(result) + '\n');
    if (['collection-blocked', 'daily-attempt-limit'].includes(result.status)) process.exitCode = 1;
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
})();
