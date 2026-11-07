#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { freezeHealthBaseline, evaluateFactorHealth } = require('../src/core/factor-health');
function safe(file) {
  const absolute = path.resolve(file);
  let at = path.parse(absolute).root;
  for (const part of absolute.slice(at.length).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    try { if (fs.lstatSync(at).isSymbolicLink()) throw Error('禁止符号链接'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return absolute;
}
function read(file) {
  const fd = fs.openSync(safe(file), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error('输入文件类型或大小无效');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function writeNew(file, result) {
  file = safe(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(file), '.factor-health-'));
  try {
    const temp = path.join(stage, 'report.json'), fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.linkSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function main(args) {
  const [mode, ...files] = args;
  let result;
  if (mode === 'freeze' && files.length === 2) result = freezeHealthBaseline(read(files[0]));
  else if (mode === 'evaluate' && files.length === 3) result = evaluateFactorHealth(read(files[0]), read(files[1]));
  else throw Error('用法: factor-health.js freeze <基线输入JSON> <新冻结JSON> | evaluate <冻结JSON> <快照JSON> <新报告JSON>');
  writeNew(files.at(-1), result);
  return { ok: true, mode, canTrade: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))); }
  catch (e) { console.error(JSON.stringify({ ok: false, error: String(e.message).slice(0, 180) })); process.exitCode = 1; }
}
module.exports = { main };
