// 体检扫描器（2026-10-06）：两类「不报错但结果悄悄错一半」的操作
//  ① 遍历数组/集合时**就地修改**它：
//     · for (const x of arr) { arr.push(y) }  → 新元素也被遍历到，可能无限增长
//     · for (const x of arr) { arr.splice(i,1) } / 用索引循环里删 → **漏项**（跳过了下一个）
//     · Map/Set 遍历中 delete 是安全的，不报
//  ② String.replace 不带 /g：只替换**第一处**，字符串里有多处时静默漏替换
//     （清洗文本、脱敏、去掉某个标记时尤其致命 —— 看着处理过了，其实还剩一半）
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['server.js', 'analysis.js', 'holdings.js', 'logic.js', 'learnall.js', 'ztpre.js', 'em.js', 'myrules.js', 'nextplan.js', 'bazi.js'];

let total = 0;
for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, 'utf8');
  const code = stripNoise(raw, { keepStrings: true });
  const lines = raw.split('\n');
  const at = i => code.slice(0, i).split('\n').length;
  const hits = [];

  // ---------- ① 遍历中就改 ----------
  const forRe = /for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+([A-Za-z_$][\w$.]*)\s*\)\s*\{/g;
  let m;
  while ((m = forRe.exec(code))) {
    const varName = m[1], coll = m[2];
    const root = coll.split('.')[0];
    // 取这个 for 块的源码（花括号配平）
    let d = 0, j = m.index + m[0].length - 1, end = -1;
    for (; j < code.length; j++) {
      if (code[j] === '{') d++;
      else if (code[j] === '}') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const body = code.slice(m.index + m[0].length, end);
    const mutRe = new RegExp('\\b' + root.replace(/\$/g, '\\$') + '\\s*\\.\\s*(push|splice|shift|unshift|pop|sort|reverse)\\s*\\(', 'g');
    const mut = [...body.matchAll(mutRe)].map(x => x[1]);
    if (!mut.length) continue;
    // sort/reverse 就地排序在遍历中不危险（遍历的是快照语义），但仍然就地改数组
    const risky = mut.filter(x => x !== 'sort' && x !== 'reverse');
    if (!risky.length) continue;
    hits.push({ ln: at(m.index), kind: '①遍历中就改', txt: lines[at(m.index) - 1].trim().slice(0, 130), op: [...new Set(risky)].join('/') });
  }

  // ---------- ② replace 不带 /g ----------
  const repRe = /\.replace\s*\(/g;
  while ((m = repRe.exec(code))) {
    let d = 0, j = m.index + m[0].length - 1, end = -1;
    for (; j < code.length; j++) {
      if (code[j] === '(') d++;
      else if (code[j] === ')') { d--; if (d === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const call = code.slice(m.index, end + 1);
    const arg1 = call.slice(m[0].length, call.indexOf(',') < 0 ? call.length : call.indexOf(','));
    const seg = call.slice(call.indexOf(',') + 1, call.lastIndexOf(','));  // 第一个参数（可能是含逗号的对象/正则）
    // 正则字面量：看有没有 g
    const reLit = arg1.match(/^\s*\/.*\/([gimsuy]*)\s*$/);
    if (reLit) { if (!reLit[1].includes('g')) hits.push({ ln: at(m.index), kind: '②replace非全局', txt: lines[at(m.index) - 1].trim().slice(0, 130), op: '正则无 /g' }); continue; }
    // 字符串字面量：只替换第一处
    if (/^\s*['"`]/.test(arg1)) hits.push({ ln: at(m.index), kind: '②replace非全局', txt: lines[at(m.index) - 1].trim().slice(0, 130), op: '字符串 → 只换第一处' });
  }

  if (hits.length) {
    console.log('\n===== ' + f + '（' + hits.length + ' 处待复核）=====');
    const by = {};
    for (const h of hits) (by[h.kind] = by[h.kind] || []).push(h);
    for (const k of Object.keys(by).sort()) {
      console.log('\n-- ' + k + ' ' + by[k].length + ' 处 --');
      const seen = new Set();
      for (const h of by[k]) {
        if (seen.has(h.ln + h.op)) continue; seen.add(h.ln + h.op);
        console.log('  L' + h.ln + ' [' + h.op + ']  ' + h.txt);
      }
    }
    total += hits.length;
  } else console.log('\n===== ' + f + '：无命中 =====');
}
console.log('\n合计待复核 ' + total + ' 处');
