// 扫描器：系统对外承诺的时限 —— 到期那一刻到底发生了什么（co 轮）
// ① 找出所有「过期/失效/超时」判据
// ② 看紧随其后返回的文案，有没有把「为什么失效」说清楚
// ③ 找出所有对外承诺的时限数字（文案里写的 vs 代码里判的，是否同一个数）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = path.join(ROOT, 'server.js');
const src = fs.readFileSync(SV, 'utf8');
const lines = src.split(/\r?\n/);

function stripLine(s) {
  let out = '', i = 0, q = null;
  while (i < s.length) {
    const c = s[i];
    if (q) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') break;
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    out += c; i++;
  }
  return out;
}

// ── ① 过期判据 ────────────────────────────────────────────────
// 形如：Date.now() > x.exp   /  x.exp < now   /  now - t > TTL
const EXPIRE_RE = /(Date\.now\(\)\s*>\s*[\w.]*(?:exp|Exp|EXP|until|deadline)[\w.]*)|([\w.]*(?:exp|Exp|EXP)\s*<\s*(?:now|Date\.now\(\)))|(now\s*-\s*[\w.]+\s*>\s*[A-Z_][A-Z0-9_]*)|(Date\.now\(\)\s*-\s*[\w.]+\s*>\s*[A-Z_][A-Z0-9_]*)/;
console.log('=== ① 过期判据点 ===');
const hits = [];
lines.forEach((raw, i) => {
  const s = stripLine(raw);
  if (!s.trim()) return;
  if (EXPIRE_RE.test(s)) hits.push({ i: i + 1, s: s.trim() });
});
console.log('共 ' + hits.length + ' 处');
for (const h of hits) console.log('  L' + h.i + ': ' + h.s.slice(0, 120));

// ── ② 每个过期分支后面有没有说清原因 ──────────────────────────
console.log('\n=== ② 过期分支的返回文案（看有没有"过期/失效/作废/超时"字样）===');
const WHY_RE = /过期|失效|作废|超时|已过|不再有效|请重新/;
let noWhy = 0;
lines.forEach((raw, i) => {
  const s = stripLine(raw);
  if (!s.trim()) return;
  if (!EXPIRE_RE.test(s)) return;
  // 往后看 8 行，找 return / json(res
  let why = null;
  for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
    const t = stripLine(lines[j]);
    if (WHY_RE.test(t)) { why = t.trim().slice(0, 130); break; }
    if (/^\s*(return|json\(res)\s*[,;]?/.test(t) && !/过期|失效|作废|超时/.test(t)) { why = 'NONE:' + t.trim().slice(0, 100); break; }
  }
  const bad = !why || why.indexOf('NONE:') === 0;
  if (bad) noWhy++;
  console.log('  ' + (bad ? '⚠️' : '  ') + ' L' + (i + 1) + ' → ' + (why || '(8行内未见返回)'));
});
console.log('\n没说清原因的过期分支 = ' + noWhy + ' 处');

// ── ③ 对外承诺的时限：文案里的数字 vs 代码里的数字 ─────────────
console.log('\n=== ③ 对外承诺的时限（文案里出现的"X分钟/X小时/X天有效"）===');
const PROMISE_RE = /(?:有效期|有效|可用|内有效)[^'"`]{0,10}?(\d+)\s*(分钟|小时|天|秒)/;
const PROMISE_RE2 = /(\d+)\s*(分钟|小时|天)(?:内)?(?:有效|后|过期|失效)/;
const found = new Map();
lines.forEach((raw, i) => {
  const s = raw;   // 这里要保留字符串内容（文案在字符串里），只剥注释行
  const st = stripLine(raw);
  if (!st.trim()) return;                       // 纯注释行跳过
  const m = s.match(PROMISE_RE) || s.match(PROMISE_RE2);
  if (m) {
    const k = m[1] + m[2];
    if (!found.has(k)) found.set(k, []);
    found.get(k).push('L' + (i + 1) + ': ' + st.trim().slice(0, 100));
  }
});
for (const [k, v] of [...found.entries()].sort()) {
  console.log('  承诺「' + k + '」 ×' + v.length);
  v.slice(0, 3).forEach(x => console.log('     ', x));
}

// ── ④ 代码里实际判的时限常量 ─────────────────────────────────
console.log('\n=== ④ 代码里实际使用的时限（分钟级及以上）===');
const TL_RE = /(\d+)\s*\*\s*(?:60\s*\*\s*1000|3600\s*\*\s*1000|24\s*\*\s*3600\s*\*\s*1000|86400000|1000)/g;
const tl = new Map();
lines.forEach((raw, i) => {
  const st = stripLine(raw);
  if (!st.trim()) return;
  let m;
  TL_RE.lastIndex = 0;
  while ((m = TL_RE.exec(st))) {
    const n = Number(m[1]);
    const unit = /24\s*\*\s*3600|86400000/.test(m[0]) ? '天' : (/3600/.test(m[0]) ? '小时' : (/60\s*\*\s*1000/.test(m[0]) ? '分钟' : '秒'));
    if (unit === '秒' && n < 30) continue;
    const k = n + unit;
    if (!tl.has(k)) tl.set(k, []);
    tl.get(k).push(i + 1);
  }
});
for (const [k, v] of [...tl.entries()].sort((a, b) => {
  const pa = parseInt(a[0]), pb = parseInt(b[0]);
  return pa - pb;
})) {
  console.log('  ' + k.padEnd(8) + ' ×' + v.length + '  L' + v.slice(0, 6).join(','));
}
