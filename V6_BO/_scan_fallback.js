// 扫描器（cl 轮 · 兜底路径从来没被真跑过一次）。
// catch 块里的代码【只有真出错时才执行】—— 平时永远不走，测试也几乎不覆盖。
// 于是里面引用了不存在的函数、少写了一个字段、返回类型和主路径不一致，谁都不会发现；
// 等到线上真出事那天，它会在最需要兜底的时刻再崩一次（而且崩在 catch 里 = 没人接得住）。
// 查三类：
//   ① 非空 catch 里调用了不存在的函数
//   ② catch 里 return 的对象，字段与主路径 return 的对象不一致（消费端读到 undefined）
//   ③ catch 里 return 的类型与主路径不同（主路径给数组、兜底给 null/undefined）
// 只读，不改任何东西。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function stripComments(src) {
  return src.split('\n').map(l => {
    let out = '', inS = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inS) { out += c; if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; out += c; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      out += c;
    }
    return out;
  }).join('\n');
}
const CLEAN = stripComments(SV);
const lineOf = i => CLEAN.slice(0, i).split('\n').length;

// ── 已定义标识符：函数声明 / const|let|var / 类 / 【各种函数的形参】──────────
const defined = new Set();
for (const m of CLEAN.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
for (const m of CLEAN.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
for (const m of CLEAN.matchAll(/(?:^|\s)class\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of CLEAN.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function)?\s*\(/g)) defined.add(m[1]);
// ⛔ 形参：function(a,b) / (a,b)=> / a=> / async(a,b)=>
for (const m of CLEAN.matchAll(/function\s*\(([^)]*)\)/g))
  for (const p of m[1].split(',')) { const n = p.trim().split(/[\s=]/)[0].replace(/[{}\[\].]/g, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); }
for (const m of CLEAN.matchAll(/\(([^)]*)\)\s*=>/g))
  for (const p of m[1].split(',')) { const n = p.trim().split(/[\s=]/)[0].replace(/[{}\[\].]/g, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); }
for (const m of CLEAN.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
// 解构形参 {a,b} 与 [a,b]
for (const m of CLEAN.matchAll(/[{[]([^}\]]*)[}\]]\s*=>/g))
  for (const p of m[1].split(',')) { const n = p.trim().split(/[\s=:]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(n)) defined.add(n); }

const BUILTIN = new Set(['console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Math', 'Date', 'Promise', 'Error',
  'Set', 'Map', 'RegExp', 'Boolean', 'Symbol', 'BigInt', 'isFinite', 'isNaN', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'require', 'process', 'Buffer', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new',
  'await', 'case', 'do', 'else', 'in', 'of', 'instanceof', 'delete', 'void', 'throw', 'null', 'undefined', 'true', 'false']);

// ── 取函数体（跳过形参表、跳过字符串里的花括号）──────────────────────
function fnBodyOf(name) {
  const a = CLEAN.search(new RegExp('^(async\\s+)?function ' + name + '\\(', 'm'));
  if (a < 0) return null;
  let p = CLEAN.indexOf('(', a), pd = 0, k = p;
  for (; k < CLEAN.length; k++) {
    if (CLEAN[k] === '(') pd++; else if (CLEAN[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = CLEAN.indexOf('{', k);
  if (open < 0) return null;
  let d = 0, inStr = null;
  for (let j = open; j < CLEAN.length; j++) {
    const c = CLEAN[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return { start: a, end: j + 1, body: CLEAN.slice(a, j + 1), off: a }; }
  }
  return null;
}
// 在某个区间里找 catch 块（返回 {start,end,body}）
function catchBlocksIn(src, baseOff) {
  const out = [];
  const re = /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\))?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let d = 0, i = m.index + m[0].length - 1, inStr = null, st = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '{') { d++; if (d === 1) st = i + 1; }
      else if (c === '}') { d--; if (d === 0) break; }
    }
    out.push({ absStart: baseOff + st, absEnd: baseOff + i, body: src.slice(st, i), errName: m[1] || '' });
  }
  return out;
}
// 取 return 后面的表达式（到分号或换行，括号配对）
function returnExprs(src, baseOff) {
  const out = [];
  const re = /\breturn\s+/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    if (src[i] === ';' || src[i] === '\n') { out.push({ txt: '', off: baseOff + m.index }); continue; }
    let inStr = null, d = 0, st = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { d--; if (d < 0) break; }
      else if ((c === ';' || c === '\n') && d === 0) break;
    }
    out.push({ txt: src.slice(st, i).trim(), off: baseOff + m.index });
  }
  return out;
}
// 对象字面量的顶层键
function objKeys(txt) {
  if (!txt || txt[0] !== '{') return null;
  let d = 0, cur = '', keys = [], inStr = null;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (inStr) { if (c === inStr) inStr = null; cur += c; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') { d--; if (d === 0) break; }
    if (d === 1 && (c === ',' || c === '\n')) {
      const mm = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(cur);
      if (mm) keys.push(mm[1]);
      cur = '';
      continue;
    }
    if (d === 1) cur += c;
  }
  const mm = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(cur);
  if (mm) keys.push(mm[1]);
  return keys;
}
const shapeOf = txt => {
  if (!txt) return 'void';
  if (txt[0] === '{') return 'object';
  if (txt[0] === '[') return 'array';
  if (/^(null|undefined)$/.test(txt)) return txt;
  if (/^(true|false)$/.test(txt)) return 'boolean';
  if (/^-?[\d.]+$/.test(txt)) return 'number';
  if (/^(['"`])/.test(txt)) return 'string';
  return 'other';
};

// ── ① 非空 catch 里调用不存在的函数 ──────────────────────────
const allCatches = catchBlocksIn(CLEAN, 0);
const nonEmpty = allCatches.filter(b => b.body.trim().length > 0);
console.log(`\n【兜底路径普查】catch 共 ${allCatches.length} 个，非空 ${nonEmpty.length} 个（空 catch ${allCatches.length - nonEmpty.length} 个属"静默失败"那一类）`);
const bad = [];
for (const b of nonEmpty) {
  for (const mm of b.body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = mm[2];
    if (BUILTIN.has(n) || defined.has(n) || n === b.errName) continue;
    bad.push({ line: lineOf(b.absStart), name: n, ctx: b.body.replace(/\s+/g, ' ').slice(0, 80) });
  }
}
console.log(`\n【① 非空 catch 里调用了不存在的函数】${bad.length} 处`);
for (const b of bad) console.log(`  ⛔ 行${b.line}  ${b.name}()  ← ${b.ctx}`);

// ── ②③ catch 里 return 的形状 / 字段 与主路径是否一致 ──────────────
const fnNames = [...CLEAN.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
let shapeBad = 0, keyBad = 0;
for (const fn of fnNames) {
  const fb = fnBodyOf(fn);
  if (!fb) continue;
  const cbs = catchBlocksIn(fb.body, fb.off);
  if (!cbs.length) continue;
  const inCatch = new Set();
  for (const cb of cbs) for (let i = cb.absStart; i < cb.absEnd; i++) inCatch.add(i);
  const rets = returnExprs(fb.body, fb.off);
  const mainR = rets.filter(r => !inCatch.has(r.off));
  const catchR = rets.filter(r => inCatch.has(r.off));
  if (!mainR.length || !catchR.length) continue;

  const mainShapes = new Set(mainR.map(r => shapeOf(r.txt)));
  for (const r of catchR) {
    const sh = shapeOf(r.txt);
    if (!mainShapes.has(sh) && mainShapes.size === 1) {
      // ⛔ 主路径清一色一种类型，兜底却给了另一种（且不是 "没值" 这种合理兜底）
      const ms = [...mainShapes][0];
      if (!(ms === 'object' && (sh === 'null' || sh === 'undefined'))) {
        shapeBad++;
        console.log(`  ⛔ ${fn}()：主路径返回 ${ms}，catch 里返回 ${sh}  ← 行${lineOf(r.off)}: ${r.txt.slice(0, 70)}`);
      }
    }
    const mk = mainR.map(x => objKeys(x.txt)).filter(Boolean);
    const ck = objKeys(r.txt);
    if (ck && mk.length) {
      const allMain = new Set([].concat(...mk));
      const miss = ck.filter(k => !allMain.has(k));   // 兜底里出现了主路径没有的键（多半拼错）
      if (miss.length && ck.length >= 2) {
        keyBad++;
        console.log(`  ⛔ ${fn}()：catch 里 return 的字段 ${miss.join(',')} 主路径从没写过 ← 行${lineOf(r.off)}`);
      }
    }
  }
}
console.log(`\n【② 兜底 return 类型与主路径不一致】${shapeBad} 处`);
console.log(`【③ 兜底 return 字段主路径从没写过】${keyBad} 处`);
console.log('\n（说明：静态普查，"未定义"也可能是动态注入/模块导出，需人工确认）');
