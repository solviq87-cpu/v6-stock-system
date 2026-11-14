#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { simulatePaperIntents } = require('../src/core/paper-intent-simulator');
function read(file) {
  const p = path.resolve(file), st = fs.lstatSync(p);
  if (st.isSymbolicLink() || !st.isFile() || st.size > 100 * 1024 * 1024) throw new Error('输入文件无效或超过100MB');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 4) throw new Error('用法: npm run paper:simulate-intents -- <intent-plan.json> <market-snapshot.json> <account-summary.json> <new-result.json>');
  const [planFile, marketFile, accountFile, outputFile] = args.map(x => path.resolve(x));
  if (new Set([planFile, marketFile, accountFile, outputFile]).size !== 4) throw new Error('输入输出文件必须互不相同');
  const result = simulatePaperIntents(read(planFile), read(marketFile), read(accountFile));
  const fd = fs.openSync(outputFile, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  process.stdout.write(JSON.stringify({ outputFile, mode: result.mode, fills: result.metrics.filledCount,
    blocked: result.metrics.blockedCount, cash: result.cash, canTrade: false, brokerConnected: false }, null, 2) + '\n');
  return result;
}
if (require.main === module) { try { main(); } catch (e) { process.stderr.write(`纸面模拟撮合失败：${e.message}\n`); process.exitCode = 1; } }
module.exports = { main };
