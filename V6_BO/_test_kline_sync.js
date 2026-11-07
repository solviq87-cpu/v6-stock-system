// 守门 _test_kline_sync.js（ho 轮：日K 与线上保持一致）
// 静态分析 server.js：验证 pullKlineDownstream 已定义、从「线上」回拉（非本地上游）、
// 合并进 S.klines 并写回 .kline_cache、带 isReplica() 闸门防回环、按票节流；
// 且 /api/kline 与 /api/kline-marks 两个 GET 路由都已接线触发。
// 不依赖网络、不 require 主程序（主程序副作用大），用 brace-balance 抽函数体再 new Function 校验语法。

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// —— 抽函数体：跳过 字符串/模板串/注释 的 brace-balance ——
function findFuncBody(src, fnName) {
  const idx = src.indexOf('function ' + fnName + '(');
  if (idx < 0) return null;
  let i = src.indexOf('{', idx);
  if (i < 0) return null;
  let depth = 0, inStr = false, inTmpl = false, inLineC = false, inBlockC = false, escaped = false;
  let q = '';
  for (let j = i; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (inLineC) { if (ch === '\n') inLineC = false; continue; }
    if (inBlockC) { if (ch === '*' && nx === '/') { inBlockC = false; j++; } continue; }
    if (escaped) { escaped = false; continue; }
    if (inStr) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === q) inStr = false;
      continue;
    }
    if (inTmpl) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '`') inTmpl = false;
      continue;
    }
    if (ch === '/' && nx === '/') { inLineC = true; j++; continue; }
    if (ch === '/' && nx === '*') { inBlockC = true; j++; continue; }
    if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
    if (ch === '`') { inTmpl = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

const body = findFuncBody(SRC, 'pullKlineDownstream');

ok('pullKlineDownstream 已定义且能抽出函数体', !!body, '未找到函数');
if (!body) { console.log(`\n结果：${pass} 通过 / ${fail} 失败`); process.exit(fail ? 1 : 0); }

ok('函数体语法合法（new Function 可编译）', (() => {
  try { new Function('async function pullKlineDownstream(code){' + body + '\n}\nreturn pullKlineDownstream;'); return true; }
  catch (e) { return false; }
})(), '语法错误');

ok('从「线上」回拉：调用 _syncGet(\'/api/kline', body.indexOf("_syncGet('/api/kline") >= 0,
  '应拉取线上 /api/kline，而非本地 em.fetchKline');
ok('合并进内存 S.klines：调用 klineSet(', body.indexOf('klineSet(') >= 0);
ok('写回磁盘缓存：引用 KLINE_CACHE', body.indexOf('KLINE_CACHE') >= 0);
ok('副本闸门：函数内含 isReplica() 守卫（防线上向自己回环）', /if\s*\(\s*!isReplica\(\)\s*\)\s*return/.test(body));
ok('按票节流：使用 lastOkAtByCode', body.indexOf('lastOkAtByCode') >= 0);
ok('失败静默：catch 内只记日志不抛（含 _syncLog）', body.indexOf('_syncLog') >= 0);
ok('防重入：busy 标志', body.indexOf('_pullKline.busy') >= 0);

// —— 路由接线：至少两个 GET 路由触发 ——
const callCount = (SRC.match(/pullKlineDownstream\(/g) || []).length;
ok('接线站点 = 定义1 + 调用≥3（/api/kline、/api/kline-marks、analyzeStock）', callCount >= 4,
  '实际 ' + callCount + ' 处');
ok('/api/kline GET 路由触发回拉', SRC.indexOf("p === '/api/kline' && req.method === 'GET'") >= 0 && SRC.indexOf("if (isReplica()) { try { await pullKlineDownstream(code); }") >= 0);
ok('/api/kline-marks GET 路由触发回拉', SRC.indexOf("p === '/api/kline-marks' && req.method === 'GET'") >= 0 && SRC.indexOf('pullKlineDownstream(code).catch(() => {})') >= 0);

// —— 版本一致（前端同源口径，缺则无限 reload）——
const srvVer = (SRC.match(/const APP_VER = '([0-9a-z]+)'/) || [])[1];
const idxVer = (fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').match(/const APP_VER = '([0-9a-z]+)'/) || [])[1];
ok('两端 APP_VER 一致（server=' + srvVer + ' / index=' + idxVer + '）', srvVer && srvVer === idxVer, '不一致');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
