#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { probePublicQuotes } = require('../src/core/public-quote-probe');
function safe(file) {
  const absolute = path.resolve(file); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('禁止符号链接'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return absolute;
}
function publish(file, result) {
  file = safe(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(file), '.public-quote-probe-'));
  try {
    const temp = path.join(stage, 'result.json'), fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.linkSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
async function main(args) {
  const [code, file, sourceList, ...extra] = args;
  if (!code || !file || extra.length) throw Error('用法: public-quote-probe.js <沪深A股代码> <新报告JSON> [tencent,eastmoney,sina]');
  const destination = safe(file);
  if (fs.existsSync(destination)) throw Error('报告已存在，拒绝覆盖');
  const result = await probePublicQuotes({ code, providers: sourceList === undefined ? undefined : sourceList.split(',') });
  publish(destination, result);
  return { ok: true, sources: result.sources.map(s => ({ id: s.id, status: s.status })), canTrade: false, paidServicesUsed: false };
}
if (require.main === module) main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(e => {
  console.error(JSON.stringify({ ok: false, error: String(e.message).slice(0, 180) })); process.exitCode = 1;
});
module.exports = { main };
