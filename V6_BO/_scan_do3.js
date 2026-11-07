// 扫描器 · do 轮第三遍：同一个函数的多个 return 分支，返回的是不是同一种东西。
//   「同一个键在不同分支里被赋成不同类型」在函数层面就是：调用方拿到手的可能是
//   数组 / 对象 / null / 布尔 —— 而调用方往往只按其中一种写（`.length` / `.items` / `.ok`）。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const L = SV.split('\n');

// 按花括号配对取函数体（跳过形参表与字符串）
function bodyAt(src, openIdx) {
  let d = 0, i = openIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = src.indexOf(c, i + 1); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; i++; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}
function kind(v) {
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t === 'undefined') return '空(undefined)';
  if (/^(true|false)$/.test(t)) return '布尔';
  if (/^null$/.test(t)) return 'null';
  if (/^\{/.test(t) || /^Object\.assign\(/.test(t)) return '对象';
  if (/^\[/.test(t) || /\.(slice|map|filter|concat)\(/.test(t)) return '数组';
  if (/^-?\d/.test(t)) return '数字';
  if (/^['"`]/.test(t)) return '字符串';
  if (/^(await|=\>)/.test(t)) return '异步/箭头';
  return '表达式:' + t.slice(0, 26);
}

const fns = [];
{
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(SV))) {
    const oi = SV.indexOf('{', m.index);
    if (oi < 0) continue;
    fns.push({ name: m[1], body: bodyAt(SV, oi), line: SV.slice(0, m.index).split('\n').length });
  }
}
console.log('顶层/嵌套函数数:', fns.length);

const bad = [];
for (const f of fns) {
  const rets = [...f.body.matchAll(/\breturn\s+([^;]*);/g)].map(x => x[1]);
  if (rets.length < 2) continue;
  const kinds = new Map();
  for (const r of rets) {
    const k = kind(r);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(r.trim().slice(0, 50));
  }
  // 只报「明确冲突」：数组/对象/null/布尔/字符串/数字 之间有 2 种以上
  const hard = [...kinds.keys()].filter(k => !k.startsWith('表达式') && k !== '异步/箭头');
  if (hard.length >= 2) bad.push({ f, kinds, hard });
}
console.log('\n【F】同一函数返回多种明确类型的（' + bad.length + ' 个）');
for (const b of bad) {
  console.log('  ⚠ %s()  L%d  →  %s', b.f.name, b.f.line, b.hard.join(' / '));
  for (const k of b.hard) console.log('       %s: %s', k.padEnd(14), b.kinds.get(k).slice(0, 2).join('  |  '));
}

// ── G. 只看「被当作数组消费」的调用点：函数既返回数组又返回 null/布尔 ──
console.log('\n【G】其中：调用方直接 .length / for-of / .map 消费的（返回 null 会炸或静默 0）');
const risky = [];
for (const b of bad) {
  const nm = b.f.name;
  if (!/^(scan|pre|build|get|load|fetch|pick|list|find|collect|read|make|calc|compute)/i.test(nm)) continue;
  const re = new RegExp('\\b' + nm + '\\s*\\(', 'g');
  let m; let hits = 0; const samples = [];
  while ((m = re.exec(SV))) {
    const line = SV.slice(0, m.index).split('\n').length;
    if (line === b.f.line) continue;
    hits++;
    if (samples.length < 3) samples.push('L' + line + ': ' + L[line - 1].trim().slice(0, 90));
  }
  if (!hits) continue;
  risky.push({ nm, hits, samples, hard: b.hard });
}
for (const r of risky) {
  console.log('  ⚠ %s()  调用 %d 处 → 返回类型 %s', r.nm, r.hits, r.hard.join('/'));
  r.samples.forEach(s => console.log('       ' + s));
}
