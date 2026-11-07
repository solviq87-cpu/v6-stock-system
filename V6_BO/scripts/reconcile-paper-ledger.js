#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { reconcilePaperLedger } = require('../src/core/paper-ledger-reconciliation');
function readJson(file) {
  const full = path.resolve(file);
  const st = fs.lstatSync(full);
  if (st.isSymbolicLink() || !st.isFile() || st.size > 50 * 1024 * 1024) throw new Error(`输入文件不安全：${file}`);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}
function main(args) {
  if (args.length !== 2) throw new Error('用法：npm run reconcile:paper-ledger -- <orders.json> <paper-account.json>');
  const orders = readJson(args[0]);
  const account = readJson(args[1]);
  const report = reconcilePaperLedger(orders, account);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.ok) process.exitCode = 2;
}
try { main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`对账失败：${error.message}\n`); process.exitCode = 1; }
