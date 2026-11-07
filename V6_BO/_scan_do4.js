// 扫描器 · do 轮第四遍：收紧判据（先剥注释 + 开头形态判定），只留真冲突
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const L = SV.split('\n');

function noComment(src) {
  return src.split('\n').map(l => {
    const i = l.indexOf('//');
    return i < 0 ? l : l.slice(0, i);
  }).join('\n');
}
const SRC = noComment(SV);
const SL = SRC.split('\n');

function bodyAt(src, openIdx) {
  let d = 0, i = openIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = src.indexOf(c, i + 1); if (i < 0) break; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}
function kind(v) {
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t === 'undefined') return 'undefined';
  if (/^(true|false)$/.test(t)) return '布尔';
  if (/^null$/.test(t)) return 'null';
  if (/^\[/.test(t)) return '数组';
  if (/^[A-Za-z_$][\w$.]*\.(slice|map|filter|concat|sort)\(/.test(t)) return '数组';
  if (/^\{/.test(t) || /^Object\.assign\(/.test(t)) return '对象';
  if (/^-?\d+(\.\d+)?$/.test(t)) return '数字';
  // 字符串拼接：以引号开头，或 引号 + ... +
  if (/^['"`]/.test(t)) return '字符串';
  if (/^[A-Za-z_$][\w$.]*\s*\+/.test(t)) return '拼接(字符串)';
  if (/^(await|Promise)/.test(t)) return '异步';
  return '表达式';
}
const HARD = new Set(['数组', '对象', 'null', '布尔', '数字', '字符串', 'undefined']);

const fns = [];
{
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(SRC))) {
    const oi = SRC.indexOf('{', m.index);
    if (oi < 0) continue;
    fns.push({ name: m[1], body: bodyAt(SRC, oi), line: SRC.slice(0, m.index).split('\n').length });
  }
}
const bad = [];
for (const f of fns) {
  const rets = [...f.body.matchAll(/\breturn\s+([^;]*);/g)].map(x => x[1]);
  if (rets.length < 2) continue;
  const kinds = new Map();
  for (const r of rets) {
    const k = kind(r);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(r.trim().slice(0, 46));
  }
  const hard = [...kinds.keys()].filter(k => HARD.has(k));
  if (hard.length >= 2) bad.push({ f, kinds, hard, rets: rets.length });
}
console.log('函数数', fns.length, '｜返回多种硬类型的', bad.length);
for (const b of bad) {
  console.log('  ⚠ %s()  L%d  (%d 个 return)  →  %s', b.f.name, b.f.line, b.rets, b.hard.join(' / '));
  for (const k of b.hard) console.log('       %s: %s', k.padEnd(10), b.kinds.get(k).slice(0, 2).join('   |   '));
}

// ── 调用方怎么消费：找 `.length` / `.items` / `.ok` / for-of ──
console.log('\n【G】调用点消费方式（看有没有「拿到 null 还当数组用」）');
for (const b of bad) {
  const nm = b.f.name;
  const re = new RegExp('(?:=\\s*|\\()\\s*(?:await\\s+)?' + nm + '\\s*\\(', 'g');
  let m; const rows = [];
  while ((m = re.exec(SRC))) {
    const line = SRC.slice(0, m.index).split('\n').length;
    if (line === b.f.line) continue;
    const l = SL[line - 1] || '';
    rows.push('L' + line + ' ' + l.trim().slice(0, 100));
  }
  if (rows.length) {
    console.log('  · %s()  调用 %d 处', nm, rows.length);
    rows.slice(0, 3).forEach(r => console.log('      ' + r));
  }
}
