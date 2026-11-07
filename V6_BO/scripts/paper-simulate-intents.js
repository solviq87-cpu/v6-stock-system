#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { simulatePaperIntents } = require('../src/core/paper-intent-simulator');
function read(file) {
  const p = path.resolve(file), st = fs.lstatSync(p);
  if (st.isSymbolicLink() || !st.isFile() || st.size > 100 * 1024 * 1024) throw new Error('输入文件无效或超过100MB');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeResultAtomic(outputFile, result) {
  const target = path.resolve(outputFile);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('拒绝覆盖非普通结果文件或符号链接');
    throw new Error('结果文件已存在，拒绝覆盖');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = path.join(dir, `.${path.basename(target)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    // link is atomic and fails if another process created the target meanwhile.
    fs.linkSync(temp, target);
    fs.unlinkSync(temp);
    try { const d = fs.openSync(dir, 'r'); fs.fsyncSync(d); fs.closeSync(d); } catch {}
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch {}
  }
  return target;
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 4) throw new Error('用法: npm run paper:simulate-intents -- <intent-plan.json> <market-snapshot.json> <account-summary.json> <new-result.json>');
  const [planFile, marketFile, accountFile, outputFile] = args.map(x => path.resolve(x));
  if (new Set([planFile, marketFile, accountFile, outputFile]).size !== 4) throw new Error('输入输出文件必须互不相同');
  const result = simulatePaperIntents(read(planFile), read(marketFile), read(accountFile));
  writeResultAtomic(outputFile, result);
  process.stdout.write(JSON.stringify({ outputFile, mode: result.mode, fills: result.metrics.filledCount,
    blocked: result.metrics.blockedCount, cash: result.cash, canTrade: false, brokerConnected: false }, null, 2) + '\n');
  return result;
}
if (require.main === module) { try { main(); } catch (e) { process.stderr.write(`纸面模拟撮合失败：${e.message}\n`); process.exitCode = 1; } }
module.exports = { main, writeResultAtomic };
