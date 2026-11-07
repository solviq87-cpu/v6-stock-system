// 扫描器：形参默认值 / `x || dflt` 兜底，是否**从来没生效过**
// 「只有一种输入会走到」的另一种形态：函数声明里写了默认值，但全项目所有调用点
// 都老老实实传了该位置的实参 → 默认值这支**一次都没走过**。
// 危害：默认值从未被执行 = 从未被验证；哪天有人新增一个漏传的调用点，
//       接上的就是一个没人检查过的值（而且它会静默生效，不报错）。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });   // 剥注释，保留字符串
const LINES = SV.split('\n');

// ── 收集带默认值的形参 ─────────────────────────────────────────────
// 只认顶层/普通函数声明（跳过箭头，箭头调用点难对齐）
const decls = [];
const reDecl = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
for (let i = 0; i < LINES.length; i++) {
  const m = LINES[i].match(reDecl);
  if (!m) continue;
  const name = m[1];
  const params = splitParams(m[2]);
  params.forEach((p, idx) => {
    const dm = p.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
    if (dm) decls.push({ name, idx, pname: dm[1], dflt: dm[2].trim(), line: i + 1 });
  });
}
function splitParams(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ── 收集调用点：name( ... ) 的实参个数 ──────────────────────────────
const calls = {};   // name -> [argCount...]
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  for (const d of decls) {
    // 跳过声明行本身；只认 `name(` 且前面不是 . 也不是函数关键字
    const re = new RegExp('(?<![.\\w$])' + d.name + '\\s*\\(');
    let m, pos = 0;
    while ((m = re.exec(l.slice(pos)))) {
      const abs = pos + m.index + m[0].length;
      // 从 abs 起做括号配对，取实参个数
      const { args, end } = readArgs(l, abs);
      if (end > 0) {
        // ⛔ 声明行自己会被 `name(` 匹配到，必须排除（否则"调用点"永远 ≥1 且参数齐全）
        if (i + 1 !== d.line) (calls[d.name] = calls[d.name] || []).push({ args, line: i + 1 });
        pos = abs + end;
      } else { pos = abs; }
    }
  }
}
function readArgs(l, from) {
  let depth = 1, cur = '', args = [], i = from;
  for (; i < l.length && depth > 0; i++) {
    const ch = l[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    if (ch === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (depth !== 0) return { args: null, end: -1 };      // 跨行调用，交给人工
  if (cur.trim()) args.push(cur.trim());
  // 空参数列表 `()` → 0 个
  return { args: args.filter(a => a !== ''), end: i - from };
}

// ── 判定：所有调用点的实参个数都 > 该形参位置 → 默认值永不生效 ──────
console.log('=== 形参默认值「从未生效」候选 ===');
let n = 0;
for (const d of decls) {
  const cs = calls[d.name] || [];
  if (!cs.length) continue;
  const alwaysPassed = cs.every(c => c.args.length > d.idx);
  if (!alwaysPassed) continue;
  // 排除：尾随 undefined / 空串 这种"显式不传"的写法
  const explicitUndef = cs.some(c => {
    const a = c.args[d.idx];
    return a === 'undefined' || a === 'null';
  });
  if (explicitUndef) continue;
  n++;
  console.log(`\nL${d.line}  function ${d.name}(…) 第 ${d.idx + 1} 个形参 \`${d.pname}\` 默认 \`${d.dflt}\``);
  console.log(`   调用点 ${cs.length} 处，全部传了实参（最少 ${Math.min(...cs.map(c => c.args.length))} 个）` +
    ` → 默认分支从未走过`);
  const sample = cs.slice(0, 3).map(c => `L${c.line}:${c.args.length}参`).join('  ');
  console.log(`   例: ${sample}${cs.length > 3 ? ' …' : ''}`);
}
if (!n) console.log('（无）');
