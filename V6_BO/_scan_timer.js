// 体检扫描器（2026-10-06）：定时器调度体检
// 查三类问题：
//  ① 同一个函数被两个及以上定时器驱动 —— 若 guard 名字不同就不会互斥，
//     到点会**并发跑两次**（尤其是会写盘的聚合函数，等于双倍磁盘写 + 双倍数据源请求）
//  ② 定时器里跑的主函数，init 启动链里没有补跑 —— 「只挂定时器不挂启动链」
//     这条规矩已经犯过三次（computeBreadth / klineBackfill / scanTrendUniverse），
//     后果是重启后头一个周期整块空白，且没有任何报错
//  ③ 定时器里 await 了慢函数却没有 guard 保护（可能堆积）
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const code = stripNoise(src, { keepStrings: true });
const at = i => code.slice(0, i).split('\n').length;

// ① 收集每个 setInterval 的 {guard名, 行号, 块内调用的函数}
const timers = [];
const re = /setInterval\s*\(/g;
let m;
while ((m = re.exec(code))) {
  let d = 0, j = m.index + m[0].length - 1, end = -1;
  for (; j < code.length; j++) {
    if (code[j] === '(') d++;
    else if (code[j] === ')') { d--; if (d === 0) { end = j; break; } }
  }
  if (end < 0) continue;
  const raw = src.slice(m.index, end + 1);
  const blk = code.slice(m.index, end + 1);
  const gm = blk.match(/guard\(\s*'([^']+)'/);
  const calls = new Set();
  for (const c of blk.matchAll(/\b([a-z][\w$]{2,})\s*\(/g)) calls.add(c[1]);
  // 去掉语法关键字与常见内置
  for (const k of ['setinterval', 'settimeout', 'guard', 'async', 'return', 'catch', 'function', 'console', 'new', 'date', 'math', 'json', 'object', 'promise', 'string', 'number', 'array', 'if', 'for', 'while', 'typeof', 'parseint', 'parsefloat', 'isfinite', 'set']) calls.delete(k);
  const ms = (blk.match(/,\s*(\d+)\s*\)/) || [])[1];
  timers.push({ ln: at(m.index), guard: gm ? gm[1] : null, ms: ms ? +ms : null, calls: [...calls], raw: raw.replace(/\s+/g, ' ').slice(0, 90) });
}

console.log('===== ① 同一函数被多个定时器驱动 =====');
const byFn = new Map();
for (const t of timers) for (const c of t.calls) {
  if (!byFn.has(c)) byFn.set(c, []);
  byFn.get(c).push(t);
}
let hit = 0;
for (const [fn, ts] of [...byFn.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (ts.length < 2) continue;
  const guards = new Set(ts.map(t => t.guard));
  const dup = ts.length > 1 && guards.size > 1;
  console.log(`  ${dup ? '⚠️ 并发' : '  ·   '} ${fn}()  出现 ${ts.length} 次  guard=${[...guards].join('|')}  行 ${ts.map(t => 'L' + t.ln).join(' ')}`);
  if (dup) hit++;
}
console.log('  → 不同 guard 名（不会互斥）的重复函数: ' + hit + ' 个');

console.log('\n===== ② 只挂定时器、启动链没补跑 =====');
// init 函数体：从 "async function init()" 到文件里下一个顶层 "// ----" 之后的 listen 之间；
// 简单取 init 起点后 4000 字符 + 全文搜 setTimeout 补跑
const ii = src.indexOf('async function init()');
const initBody = src.slice(ii, ii + 9000);
const bootExtra = [...src.matchAll(/setTimeout\(\s*\(\)\s*=>\s*\{?\s*([^,]{0,80})/g)].map(x => x[1]).join(' ');
const miss = [];
const SKIP = /^(tick|captureAuction|fetchMarketBeta|refreshGlobal|refreshSectorsZT|rebuildPool|scanBigMoney|HD|runViewIdleSweep|pullHoldingsDownstream|refreshNews|computeReview|scanPreBreakout|scanSimilarPush|scanTrendUniverse|scanSteadyUp|scanZtPre|computeNextPlan|computeMyRules)$/;
for (const t of timers) {
  for (const c of t.calls) {
    if (!/^[A-Za-z]/.test(c)) continue;
    if (initBody.includes(c + '(') || bootExtra.includes(c + '(')) continue;
    miss.push({ fn: c, ln: t.ln, ms: t.ms });
  }
}
const seen = new Set();
for (const x of miss) {
  if (seen.has(x.fn)) continue; seen.add(x.fn);
  console.log(`  ⚠️ ${x.fn}() 只在定时器里跑（L${x.ln}${x.ms ? ' 每 ' + Math.round(x.ms / 1000) + 's' : ''}），init 启动链里没看到`);
}
if (!seen.size) console.log('  无');

console.log('\n===== ③ 定时器清单（按间隔）=====');
for (const t of timers.slice().sort((a, b) => (a.ms || 0) - (b.ms || 0))) {
  console.log(`  L${String(t.ln).padStart(5)} ${String(t.ms == null ? 'var' : Math.round(t.ms / 1000) + 's').padStart(6)} guard=${(t.guard || '-').padEnd(14)} ${t.raw}`);
}
console.log('\n定时器共 ' + timers.length + ' 个');
