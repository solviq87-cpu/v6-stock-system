// 扫描器 · do 轮第五遍：只统计「顶层缩进(≤2空格)的 return」，排掉嵌套闭包
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const SRC = SV.split('\n').map(l => { const i = l.indexOf('//'); return i < 0 ? l : l.slice(0, i); }).join('\n');
const SL = SRC.split('\n');
const OL = SV.split('\n');

function kind(v) {
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t === 'undefined') return 'undefined';
  if (/^(true|false)$/.test(t)) return '布尔';
  if (/^null$/.test(t)) return 'null';
  if (/^\[/.test(t)) return '数组';
  if (/^[A-Za-z_$][\w$.]*\.(slice|map|filter|concat|sort)\(/.test(t)) return '数组';
  if (/^\{/.test(t) || /^Object\.assign\(/.test(t)) return '对象';
  if (/^-?\d+(\.\d+)?$/.test(t)) return '数字';
  if (/^['"`]/.test(t)) return '字符串';
  if (/^[A-Za-z_$][\w$.]*\s*\+/.test(t)) return '拼接';
  if (/^(await|Promise|\()/.test(t)) return '异步/括号';
  return '表达式';
}
const HARD = new Set(['数组', '对象', 'null', '布尔', '数字', '字符串', 'undefined']);

// 顶层函数边界：从 `function xxx(` 到下一个 `^}`
const starts = [];
SL.forEach((l, i) => { if (/^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(l)) starts.push(i); });
const bad = [];
for (const s of starts) {
  let e = s + 1;
  while (e < SL.length && !/^}/.test(SL[e])) e++;
  const name = (SL[s].match(/function\s+([A-Za-z_$][\w$]*)/) || [])[1];
  const rets = [];
  for (let i = s + 1; i < e; i++) {
    const m = SL[i].match(/^\s{0,2}return\s+(.*);\s*$/);
    if (m) rets.push({ v: m[1], line: i + 1 });
  }
  if (rets.length < 2) continue;
  const kinds = new Map();
  for (const r of rets) { const k = kind(r.v); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(r); }
  const hard = [...kinds.keys()].filter(k => HARD.has(k));
  if (hard.length >= 2) bad.push({ name, line: s + 1, kinds, hard, n: rets.length });
}
console.log('顶层函数 %d 个 ｜返回多种硬类型的 %d 个\n', starts.length, bad.length);
for (const b of bad) {
  console.log('  ⚠ %s()  L%d  (%d 个顶层 return)  →  %s', b.name, b.line, b.n, b.hard.join(' / '));
  for (const k of b.hard) {
    for (const r of b.kinds.get(k).slice(0, 3)) console.log('       L%-5d %-9s %s', r.line, k, r.v.trim().slice(0, 70));
  }
}
