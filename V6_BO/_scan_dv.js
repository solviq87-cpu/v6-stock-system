// dv 轮侦察：那些"静默跳过"（continue / 空 return / 空 catch），跳过时有没有留下为什么
// 判据：跳过的前两行里有没有「计数 ++ / 日志 / 收集原因 push / 累加到某个跳过变量」；
//       没有 = 完全静默 —— 调用方拿到的结果里少了东西，却没有任何地方说少了、为什么少。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const lines = src.split('\n');

// 关键路径关键词：这些函数跳过东西必须留痕（结论会被拿去推送/交易/对账）
const CORE = /push|Push|paper|Paper|signal|Signal|signal|probe|audit|learn|emp|scan|Scan|zt|trend|cand|gov|review|auction|resolve|news|recall/;

function fnNameOf(l) {
  let m = l.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
  if (m) return m[1];
  m = l.match(/^const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
  if (m) return m[1];
  m = l.match(/^const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function/);
  if (m) return m[1];
  return null;
}

let curFn = '(顶层)';
const conts = [], bareRet = [], silentCatch = [];
// 留痕判据：自增计数 / console / 收集原因 / 明确的跳过变量
const TRACE = /(\+\+|\+=|console\.|\.push\(|[Ss]kip|[Rr]ej|[Rr]eason|why|drop|[Dd]ropped|miss|Miss|fail|Fail)/;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const fn = fnNameOf(l);
  if (fn) curFn = fn;

  // ① continue
  if (/\bcontinue\s*;/.test(l)) {
    const ctx = lines.slice(Math.max(0, i - 3), i).join('\n');
    conts.push({ fn: curFn, line: i + 1, traced: TRACE.test(ctx), raw: l.trim().slice(0, 60) });
  }
  // ② 光秃秃的 return;（在函数体中间，不是最后的兜底）
  if (/^\s*return\s*;\s*$/.test(l)) {
    const ctx = lines.slice(Math.max(0, i - 3), i).join('\n');
    const nxt = (lines[i + 1] || '').trim();
    bareRet.push({ fn: curFn, line: i + 1, traced: TRACE.test(ctx), nextIsBrace: nxt === '}' });
  }
  // ③ 写了但什么都不做的 catch（单行空 / 只有注释）
  const cm = l.match(/^\s*\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*(\/\*[^*]*\*\/\s*)?\}\s*$/);
  if (cm) silentCatch.push({ fn: curFn, line: i + 1, raw: l.trim().slice(0, 60) });
  const cm2 = l.match(/^\s*\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*$/);
  if (cm2) {
    // 多行：往后 3 行里若没有可执行语句（只有空白/注释/}），也算静默
    const body = lines.slice(i + 1, i + 4).join('\n');
    if (!/[a-zA-Z_$]\s*\(|console|=|\+\+/.test(body)) silentCatch.push({ fn: curFn, line: i + 1, raw: l.trim().slice(0, 60) + ' …(多行空)' });
  }
}

function agg(arr) {
  const m = new Map();
  for (const x of arr) {
    const k = x.fn;
    if (!m.has(k)) m.set(k, { fn: k, total: 0, silent: 0, lines: [] });
    const e = m.get(k);
    e.total++;
    if (!x.traced) { e.silent++; e.lines.push(x.line); }
  }
  return [...m.values()].sort((a, b) => b.silent - a.silent);
}

console.log('=== dv 轮侦察：静默跳过 ===\n');
console.log(`continue 共 ${conts.length} 处（完全静默 ${conts.filter(x => !x.traced).length}）`);
console.log(`裸 return; 共 ${bareRet.length} 处（完全静默 ${bareRet.filter(x => !x.traced).length}）`);
console.log(`空 catch 共 ${silentCatch.length} 处\n`);

function show(title, arr, isCatch) {
  console.log(`【${title}】按函数聚合（静默数降序，取前 12）`);
  const g = isCatch
    ? (() => { const m = new Map(); for (const x of arr) { if (!m.has(x.fn)) m.set(x.fn, { fn: x.fn, total: 0, silent: 0, lines: [] }); const e = m.get(x.fn); e.total++; e.silent++; e.lines.push(x.line); } return [...m.values()].sort((a, b) => b.silent - a.silent); })()
    : agg(arr);
  for (const e of g.slice(0, 12)) {
    if (!e.silent) continue;
    const core = CORE.test(e.fn) ? '★核心' : '     ';
    console.log(`  ${core} ${e.fn.padEnd(26)} 静默 ${String(e.silent).padStart(2)}/${String(e.total).padStart(2)}  行 ${e.lines.slice(0, 8).join(',')}${e.lines.length > 8 ? '…' : ''}`);
  }
  console.log('');
}

show('continue：跳过不留痕', conts, false);
show('裸 return;：中途退出不留痕', bareRet.filter(x => !x.nextIsBrace), false);
show('空 catch：吞掉异常不留痕', silentCatch, true);

// 关键路径上的完全静默 continue（最该修的）
console.log('【最该修的：核心路径上的完全静默 continue】');
const worst = conts.filter(x => !x.traced && CORE.test(x.fn));
for (const x of worst.slice(0, 15)) {
  console.log(`  ${x.fn} : ${x.line}  ${x.raw}`);
}
console.log(`\n  合计 ${worst.length} 处`);
