// 扫描器：找出「只有一种输入会走到」的分支（静态确证版）
//
// 这类分支有调用点、看着是活的，但**上游已经把取值域收窄/钳死**，那一支永远走不到。
// 危害：里面的代码从未被执行 = 从未被验证；哪天上游放宽（或换个调用方），
//       最先崩的就是它；而且它平时掩盖了「这个状态其实根本没被处理」。
//
// 三种可静态确证的模式：
//  A **重复 guard**：同一块里前面已 `if (COND) return/continue/throw`，后面再 `if (COND)`
//    → 第二次恒假（条件为真时早走了），整支是死代码。中间若无对条件里变量的赋值。
//  B **else-if 被蕴含**：`if (A) … else if (A && …)` / `else if (A)` → 恒假。
//  C **钳死后判越界**：`v = clamp(x,lo,hi)` / `Math.max(lo,…)` / `Math.min(hi,…)` /
//    `Math.abs(…)` / `?? 0` 之后，同块内又判 `v > hi` / `v < lo` / `v < 0` / `v == null`。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });
const LINES = SV.split('\n');
const out = [];
const hit = (kind, line, why) => out.push({ kind, line, why, text: (LINES[line - 1] || '').trim().slice(0, 130) });

const norm = s => s.replace(/\s+/g, ' ').trim();

// ── 切块：函数体（花括号配对，先跳形参表）─────────────────────────────
const blocks = [];
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  const isFnDecl = /^(?:async\s+)?function\s*[\w$]*\s*\(/.test(l);
  const isArrow = /^(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?\(?[^=]*\)\s*=>\s*\{/.test(l) ||
    /^(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?[\w$]+\s*=>\s*\{/.test(l);
  if (!isFnDecl && !isArrow) continue;
  let start = i;
  if (isFnDecl) {                       // ⛔ 先跳过形参表（默认参数 `extra = {}` 的花括号会骗计数）
    let d = 0, j = i;
    for (; j < LINES.length; j++) {
      for (const ch of LINES[j]) { if (ch === '(') d++; else if (ch === ')') d--; }
      if (d === 0) { start = j; break; }
    }
  }
  let depth = 0, end = start;
  for (let j = start; j < LINES.length && j < start + 500; j++) {
    for (const ch of LINES[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && j > start) { end = j; break; }
  }
  blocks.push({ start, end });
}
const blockOf = i => blocks.find(b => i >= b.start && i <= b.end);

// ── A：重复 guard ──────────────────────────────────────────────────
// 收集形如 `if (COND) return…;`（单行）或 `if (COND) {` 且首行后续紧邻 return 的 guard
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  const m = l.match(/^\s*\}\s*else\s+if\s*\((.*)\)\s*\{?\s*$/) || l.match(/^\s*if\s*\((.*)\)\s*\{?\s*$/);
  if (!m) continue;
  const cond = norm(m[1]);
  if (cond.length < 4) continue;
  const blk = blockOf(i);
  if (!blk) continue;
  // 往上找同一块（不跨块）里有没有"同样的条件 + 提前退出"
  for (let j = i - 1; j >= blk.start && j > i - 60; j--) {
    const p = LINES[j];
    const pm = p.match(/^\s*if\s*\((.*)\)\s*(?:\{\s*)?(?:return|continue|throw|break)\b/) ||
      p.match(/^\s*if\s*\((.*)\)\s*(?:return|continue|throw|break)\b/);
    if (!pm) continue;
    if (norm(pm[1]) !== cond) continue;
    // 中间有没有对条件里出现的标识符重新赋值？
    const idents = [...cond.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map(x => x[0]);
    let reassigned = false;
    for (let k = j + 1; k < i; k++) {
      const seg = LINES[k];
      for (const id of idents) {
        if (new RegExp('(?:^|[^.\\w$])' + id.replace(/\$/g, '\\$') + '\\s*(?:=[^=]|[+*/-]=|\\+\\+|--|\\.push\\(|\\.set\\()').test(seg)) { reassigned = true; break; }
      }
      if (reassigned) break;
    }
    if (reassigned) break;
    hit('A', i + 1, `L${j + 1} 已经 \`if (${cond})\` 提前退出，此处同一条件恒为假`);
    break;
  }
}

// ── B：else-if 被上一层 if 蕴含 ────────────────────────────────────
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  if (!/^\s*\}?\s*else\s+if\s*\(/.test(l)) continue;
  const cur = norm((l.match(/else\s+if\s*\((.*)\)\s*\{?\s*$/) || [])[1] || '');
  if (cur.length < 6) continue;
  for (let j = i - 1; j >= 0 && j > i - 60; j--) {
    const p = LINES[j];
    if (/^\s*\}?\s*else\s+if\s*\(/.test(p)) continue;
    const pm = p.match(/^\s*if\s*\((.*)\)\s*\{?\s*$/);
    if (!pm) continue;
    const prev = norm(pm[1]);
    if (prev && cur.includes(prev) && prev.length >= 6) hit('B', i + 1, `上一层 if 的条件 \`${prev}\` 已蕴含此处 → 恒假`);
    break;
  }
}

// ── C：钳死后判越界 ────────────────────────────────────────────────
function rangeOf(rhs) {
  let m = rhs.match(/^(?:_?clamp\w*)\(\s*[^,]+,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (m) return { lo: +m[1], hi: +m[2] };
  m = rhs.match(/^Math\.max\(\s*(-?\d+(?:\.\d+)?)\s*,\s*Math\.min\(\s*(-?\d+(?:\.\d+)?)\s*,/);
  if (m) return { lo: +m[1], hi: +m[2] };
  m = rhs.match(/^Math\.min\(\s*(-?\d+(?:\.\d+)?)\s*,\s*Math\.max\(\s*(-?\d+(?:\.\d+)?)\s*,/);
  if (m) return { lo: +m[2], hi: +m[1] };
  m = rhs.match(/^Math\.max\(\s*(-?\d+(?:\.\d+)?)\s*,\s*[^)]*\)$/);
  if (m) return { lo: +m[1], hi: Infinity };
  m = rhs.match(/^Math\.min\(\s*(-?\d+(?:\.\d+)?)\s*,\s*[^)]*\)$/);
  if (m) return { lo: -Infinity, hi: +m[1] };
  if (/^Math\.(abs|round|floor|ceil|trunc)\(/.test(rhs)) return { lo: 0, hi: Infinity };
  return null;
}
const assigns = [];
for (let i = 0; i < LINES.length; i++) {
  const m = LINES[i].match(/(?:^|[^.\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/);
  if (!m) continue;
  const name = m[1], rhs = norm(m[2]).replace(/;$/, '');
  const r = rangeOf(rhs);
  if (r) { assigns.push({ name, line: i, block: blockOf(i), range: r }); continue; }
  if (/(\?\?\s*0$|\|\|\s*0$)/.test(rhs)) assigns.push({ name, line: i, block: blockOf(i), range: { lo: 0, hi: Infinity }, nul: true });
}
for (let i = 0; i < LINES.length; i++) {
  const blk = blockOf(i);
  if (!blk) continue;
  for (const a of assigns) {
    if (a.block !== blk || a.line >= i) continue;
    const esc = a.name.replace(/\$/g, '\\$');
    let m = LINES[i].match(new RegExp('\\b' + esc + '\\s*(>=|>|<=|<)\\s*(-?\\d+(?:\\.\\d+)?)'));
    if (m && a.range) {
      const op = m[1], n = +m[2];
      let always = null;
      if (op === '>' && a.range.hi !== Infinity && n >= a.range.hi) always = false;
      if (op === '>=' && a.range.hi !== Infinity && n > a.range.hi) always = false;
      if (op === '<' && a.range.lo !== -Infinity && n <= a.range.lo) always = false;
      if (op === '<=' && a.range.lo !== -Infinity && n < a.range.lo) always = false;
      if (op === '>' && a.range.lo !== -Infinity && n < a.range.lo) always = true;
      if (op === '<' && a.range.hi !== Infinity && n > a.range.hi) always = true;
      if (always !== null) hit('C', i + 1, `\`${a.name}\` 在 L${a.line + 1} 已被钳到 [${a.range.lo}, ${a.range.hi}] → \`${a.name} ${op} ${n}\` 恒 ${always}`);
    }
    if (a.nul) {
      m = LINES[i].match(new RegExp('\\b' + esc + '\\s*===?\\s*(?:null|undefined)|isNaN\\(\\s*' + esc + '\\s*\\)'));
      if (m) hit('C', i + 1, `\`${a.name}\` 在 L${a.line + 1} 已用 ??0 / ||0 兜底 → 此处判空恒假`);
    }
  }
}

console.log('=== 「只有一种输入会走到」的分支候选（静态确证）===');
if (!out.length) console.log('（无）');
const g = {};
for (const o of out) (g[o.kind] = g[o.kind] || []).push(o);
for (const k of Object.keys(g).sort()) {
  console.log(`\n【${k}】${g[k].length} 处`);
  for (const o of g[k]) console.log(`  L${o.line}: ${o.why}\n        ${o.text}`);
}
