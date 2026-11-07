// 扫描器：说了两种结果、其实只有一种会被执行（cx 轮）
//
// 三种形态：
//  A **多义假值**：函数在不同分支返回 null / false / undefined / 0 / '' / [] 等多种"假值"，
//    语义本该不同（"没数据" vs "出错了" vs "被闸门拦了"），但调用点一律 `if (!x)` / `if (x)`，
//    → 所有假值被压成同一种处理。另一种结果从此没有被执行过。
//  B **返回对象里表达"另一种结局"的字段没人读**：partial / skipped / limited / truncated /
//    degraded / stale / usedFallback / reason / why / undo … 产出却零读取点。
//  C **返回多种形状**：同一函数有的分支 `return {ok:true, data}`，有的 `return null`，
//    调用点只处理对象那一种。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const SV = stripNoise(fs.readFileSync('./server.js', 'utf8'), { keepStrings: true });
const HTML = fs.readFileSync('./public/index.html', 'utf8');
const LINES = SV.split('\n');

// ── 切函数（花括号配对，先跳形参表）──────────────────────────────────
const fns = [];
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  const isDecl = /^(?:async\s+)?function\s+([\w$]*)\s*\(/.test(l);
  const isArrow = /^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>\s*\{/.test(l);
  if (!isDecl && !isArrow) continue;
  const name = (l.match(/function\s+([\w$]*)\s*\(/) || l.match(/^(?:const|let|var)\s+([\w$]+)/) || [])[1] || '?';
  let start = i;
  if (isDecl) {
    let d = 0, j = i;
    for (; j < LINES.length; j++) {
      for (const ch of LINES[j]) { if (ch === '(') d++; else if (ch === ')') d--; }
      if (d === 0) { start = j; break; }
    }
  }
  let depth = 0, end = start;
  for (let j = start; j < LINES.length && j < start + 400; j++) {
    for (const ch of LINES[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && j > start) { end = j; break; }
  }
  fns.push({ name, start, end });
}
const fnOf = i => fns.find(f => i >= f.start && i <= f.end);

// ── A：多义假值 ──────────────────────────────────────────────────
console.log('=== A 多义假值：同一个函数返回 ≥2 种不同的假值 ===');
const FALSY = { 'null': 'null', 'false': 'false', 'undefined': 'undefined', '[]': '空数组', '""': "空串", "''": '空串', '0': '0' };
let aN = 0;
for (const f of fns) {
  const kinds = new Map();     // 假值 -> 行号
  for (let i = f.start; i <= f.end; i++) {
    // ⛔ 只认缩进 <=2 的顶层 return：嵌套箭头/回调里的 return 不是这个函数的返回（实测误报 govFilter）
    const ind = LINES[i].match(/^\s*/)[0].length;
    if (ind > 2) continue;
    const m = LINES[i].match(/(?:^|[^.\w$])return\s+(null|false|undefined|\[\]|""|''|0)\s*;/);
    if (!m) continue;
    if (!kinds.has(m[1])) kinds.set(m[1], i + 1);
  }
  if (kinds.size < 2) continue;
  // 调用点怎么判的？
  const callRe = new RegExp('(?<![.\\w$])' + f.name.replace(/\$/g, '\\$') + '\\s*\\(');
  let truthy = 0, exact = 0, total = 0, samples = [];
  for (let i = 0; i < LINES.length; i++) {
    if (i >= f.start && i <= f.end) continue;
    if (!callRe.test(LINES[i])) continue;
    total++;
    if (/\b(?:if|while)\s*\(\s*!?\s*[\w$.]*/.test(LINES[i]) && new RegExp('!\\s*\\(?[^()]*' + f.name).test(LINES[i])) truthy++;
    if (new RegExp('[=!]==?\\s*(?:null|false|undefined|0)').test(LINES[i])) exact++;
    if (samples.length < 3) samples.push((i + 1) + ': ' + LINES[i].trim().slice(0, 90));
  }
  if (!total) continue;
  aN++;
  console.log(`\nL${f.start + 1} ${f.name}() 返回 ${[...kinds.keys()].join(' / ')}` +
    `  (${[...kinds.entries()].map(([k, v]) => k + '@L' + v).join(' ')})`);
  console.log(`   调用点 ${total} 处；用真值判断 ${truthy}、显式区分 ${exact}`);
  for (const s of samples) console.log('     ' + s);
}
if (!aN) console.log('（无）');

// ── B：返回对象里"另一种结局"的字段没人读 ──────────────────────────
console.log('\n=== B 返回对象里表达"另一种结局"的字段，产出却零读取 ===');
const KEYS = ['partial', 'skipped', 'skipReason', 'limited', 'truncated', 'degraded', 'stale',
  'usedFallback', 'fallback', 'reason', 'why', 'undo', 'rollback', 'changed', 'dry',
  'cap', 'blocked', 'throttled', 'merged', 'note', 'hitCap', 'cut'];
let bN = 0;
for (const k of KEYS) {
  // 产出：return { ... k: ... }（允许跨行，看到配对 } 为止）
  const produced = [];
  for (let i = 0; i < LINES.length; i++) {
    if (!/return\s*\{/.test(LINES[i])) continue;
    let depth = 0, seg = '';
    for (let j = i; j < LINES.length && j < i + 40; j++) {
      seg += LINES[j] + '\n';
      for (const ch of LINES[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && j >= i) break;
    }
    if (new RegExp('(?:^|[{,\\s])' + k + '\\s*:').test(seg)) produced.push(i + 1);
  }
  if (!produced.length) continue;
  // 读取：server.js 与前端
  const readRe = new RegExp('\\.' + k + '\\b|[\\[\'"]' + k + '[\'"\\]]|\\{\\s*[^}]*\\b' + k + '\\b[^}]*\\}\\s*=');
  const reads = (SV.match(new RegExp('\\.' + k + '\\b', 'g')) || []).length;
  const readsHtml = (HTML.match(new RegExp('\\.' + k + '\\b', 'g')) || []).length;
  if (reads + readsHtml > 0) continue;
  bN++;
  console.log(`\n\`${k}\`：产出 ${produced.length} 处（L${produced.slice(0, 6).join(' L')}${produced.length > 6 ? ' …' : ''}），` +
    `但 server.js 与前端都**没有任何 \`.${k}\` 读取点**`);
}
if (!bN) console.log('（无）');

// ── C：同一函数返回"对象"与"裸假值"两种形状 ─────────────────────────
console.log('\n=== C 同一函数既有 `return {…}` 又有裸假值/裸标量 ===');
let cN = 0;
for (const f of fns) {
  let objRet = 0, bare = [];
  for (let i = f.start; i <= f.end; i++) {
    const ind = LINES[i].match(/^\s*/)[0].length;
    if (ind > 2) continue;
    if (/return\s*\{/.test(LINES[i]) || /return\s*\(\s*\{/.test(LINES[i])) objRet++;
    const m = LINES[i].match(/(?:^|[^.\w$])return\s+(null|false|undefined|\[\])\s*;/);
    if (m) bare.push(m[1] + '@L' + (i + 1));
  }
  if (!objRet || !bare.length) continue;
  cN++;
  console.log(`L${f.start + 1} ${f.name}()：对象返回 ${objRet} 处，裸值 ${bare.join(' ')}`);
}
if (!cN) console.log('（无）');
