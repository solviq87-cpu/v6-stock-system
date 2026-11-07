#!/usr/bin/env node
'use strict';
/** Read-only CLI: reconcile a strategy replay JSON and paper replay JSON. */
const fs = require('node:fs');
const path = require('node:path');
const { reconcileStrategyWithPaper } = require('../src/core/strategy-paper-reconciliation');
function readJson(file) {
  const absolute = path.resolve(process.cwd(), file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('输入文件不存在或超过100MB限制');
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}
function main(args) {
  if (args.length !== 2) throw new Error('用法: node scripts/reconcile-strategy-paper.js <strategy-replay.json> <paper-replay.json>');
  const result = reconcileStrategyWithPaper(readJson(args[0]), readJson(args[1]));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`对账失败：${error.message}\n`); process.exitCode = 1; }
}
module.exports = { main };
