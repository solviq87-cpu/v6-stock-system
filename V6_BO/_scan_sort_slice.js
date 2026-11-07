// 体检扫描器：排序与截断（2026-10-06 新角度）
//
// 为什么单独查这个：排序错了**不会报错、不会崩、结果看着也有东西**，
//   只是"最该在前面的没在前面"—— 用户只会觉得"你推荐的质量不稳定"，没人会想到是 sort 坏了。
//
// A. 比较器可能返回 NaN
//    `(b.x || 0) - (a.x || 0)` 这类写法是安全的；但 `b.x - a.x`（x 可能 undefined/null）会得 NaN，
//    V8 的 Array#sort 遇到 NaN 比较器结果当成 0（不交换）→ 数组**保持原顺序**，
//    而"原顺序"是上游拼接出来的、毫无意义的顺序 → 排序形同虚设。
//    更隐蔽的是**部分**元素缺字段：只有一部分比较返回 NaN，结果是"局部有序、整体混乱"。
//
// B. 先截断后过滤（名额被废票占掉）
//    `list.slice(0, 10).filter(ok)` → 10 个名额里若有 7 个不合格，只剩 3 个，
//    而第 11~30 名里明明还有合格的。正确顺序是先 filter 再 slice。
//    例外：有意限制"候选池规模"时先截断是合理的（要人工复核），所以这里只列出来供判断。
//
// C. 排序键被 `||` 吃掉：0 与 null 同路（真 0 分的票和没算出来的票排在一起）
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

const FILES = ['server.js', 'analysis.js', 'learnall.js', 'ztpre.js', 'holdings.js', 'myrules.js', 'nextplan.js'];

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

console.log('══ A. 比较器里直接相减、且没有 || 兜底的字段（可能 NaN）══\n');
let nA = 0;
for (const f of FILES) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  // 抓 .sort((a, b) => 一行内的减法
  for (const m of code.matchAll(/\.sort\(\s*\([^)]*\)\s*=>[^\n]*?([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*-\s*([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)/g)) {
    const seg = m[0];
    if (/\|\|/.test(seg)) continue;            // 已经有 || 兜底
    if (/Number\.isFinite|==\s*null|!=\s*null/.test(seg)) continue;
    const ln = lineOf(code, m.index);
    console.log(`  ${f}:${ln}  →  ${seg.trim().slice(0, 120)}`);
    nA++;
  }
}
if (!nA) console.log('  （无）');

console.log('\n══ B. 先 slice 后 filter（名额可能被废票占掉）══\n');
let nB = 0;
for (const f of FILES) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  // 形如 .slice(0, N).filter(  或  .slice(0,N) 后紧跟 .filter(
  for (const m of code.matchAll(/\.slice\(\s*[\w$.\[\]]*\s*,\s*\d+\s*\)\s*\.filter\(/g)) {
    const ln = lineOf(code, m.index);
    const raw = code.split('\n')[ln - 1].trim();
    console.log(`  ${f}:${ln}  →  ${raw.slice(0, 130)}`);
    nB++;
  }
  // 跨行：slice(0,N) 结尾，下一行以 .filter( 开头
  const lines = code.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/\.slice\(\s*[\w$.\[\]]*\s*,\s*\d+\s*\)\s*$/.test(lines[i]) && /^\s*\.filter\(/.test(lines[i + 1])) {
      console.log(`  ${f}:${i + 1}  →  ${lines[i].trim().slice(0, 90)} ⏎ .filter(`);
      nB++;
    }
  }
}
if (!nB) console.log('  （无）');

console.log('\n══ C. 排序键用 || 兜底（0 与 null 排在一起）══\n');
let nC = 0;
for (const f of FILES) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  for (const m of code.matchAll(/\.sort\(\s*\([^)]*\)\s*=>[^\n]*?\(\s*([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\|\|/g)) {
    const ln = lineOf(code, m.index);
    console.log(`  ${f}:${ln}  →  ${m[0].trim().slice(0, 110)}   [字段 ${m[1]}.${m[2]}]`);
    nC++;
  }
}
if (!nC) console.log('  （无）');

console.log('\n══ D. 排序后截断：TOP N 的 N 是硬编码还是配置 ══\n');
const seen = new Set();
for (const f of FILES) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const code = stripNoise(src);
  for (const m of code.matchAll(/\.slice\(\s*0\s*,\s*(\d+)\s*\)/g)) {
    const key = f + ':' + m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const ln = lineOf(code, m.index);
    console.log(`  ${f}:${ln}  slice(0, ${m[1]})`);
  }
}
