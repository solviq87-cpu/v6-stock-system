// 长跑容器体检扫描器（本轮角度：清理口径是否与写入口径一致）。
// ao 轮只查了「有没有清理」，这里深入一层查「清理得对不对」：
//   · 写入按 A 表达式存键、清理按 B 表达式删键 → 永远删不掉，容器缓慢无界增长；
//   · 日期键口径不一致（写入 todayStr、清理用别的格式）→ 同上；
//   · 只在一条分支上清理（成功路径清、失败/提前 return 的分支不清）。
// 这类故障不报错，只表现为跑几天后内存涨、或者「明明该过期了却还在」。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const L = stripNoise(src, { keepStrings: true }).split('\n');

// ---- 收集长跑容器 ----
const names = new Set();
for (const l of L) {
  let m = /const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Map|Set)\s*\(\s*\)/.exec(l);
  if (m) names.add(m[1]);
  m = /(S\.[A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Map|Set)\s*\(\s*\)/.exec(l);
  if (m) names.add(m[1]);
  m = /const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Map\s*\(/.exec(l);
  if (m) names.add(m[1]);
}

const rows = [];
for (const n of [...names].sort()) {
  const esc = n.replace(/\./g, '\\.');
  const reSet = new RegExp('\\b' + esc + '\\.(?:set|add)\\s*\\(\\s*([^,)]+)');
  const reDel = new RegExp('\\b' + esc + '\\.delete\\s*\\(\\s*([^)]+)');
  const reReset = new RegExp('\\b' + esc + '\\s*=\\s*(?:new (?:Map|Set)\\s*\\(|[\\[])');
  const reIter = new RegExp('\\b' + esc + '\\.(?:clear|entries|forEach)\\s*\\(');
  const wKeys = new Set(), dKeys = new Set(), wLines = [], dLines = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    let m = reSet.exec(l);
    if (m) { wKeys.add(m[1].trim()); wLines.push(i + 1); }
    m = reDel.exec(l);
    if (m) { dKeys.add(m[1].trim()); dLines.push(i + 1); }
    if (reReset.test(l) || reIter.test(l)) dLines.push(i + 1);
  }
  if (!wLines.length) continue;
  rows.push({ n, wKeys: [...wKeys], dKeys: [...dKeys], wLines, dLines });
}

console.log('═══ A. 长跑容器：写入点 / 清理点 ═══');
for (const r of rows) {
  const noClear = r.dLines.length === 0;
  console.log(`  ${(r.n + '                       ').slice(0, 24)} 写 ${String(r.wLines.length).padStart(3)} 处 / 清 ${String(r.dLines.length).padStart(2)} 处` +
    (noClear ? '   ⚠️ 完全没有清理点' : ''));
}

console.log('\n═══ B. 键口径对照：清理用的键表达式在写入侧出现过吗 ═══');
// 迭代式清理（for (const [k] of X) X.delete(k)）与整体重建都算"口径天然一致"，单独标注
const ITER_KEY = ['k', 'key', 'code', 'c', 'id', 'fp', 'tk', 'name'];
let b = 0;
for (const r of rows) {
  if (!r.dKeys.length) continue;
  const orphan = r.dKeys.filter(k => !r.wKeys.includes(k) && !ITER_KEY.includes(k));
  if (!orphan.length) continue;
  b++;
  console.log(`  ⚠️ ${r.n}：清理用的键在写入侧找不到同款 → ${orphan.join(' | ')}`);
  console.log(`      写入键：${r.wKeys.slice(0, 6).join(' | ')}`);
}
console.log(b ? `  小计 ${b} 处可疑` : '  ✅ 无（清理键要么是迭代变量，要么与写入键同款）');

console.log('\n═══ C. 有写入但完全没有清理点的容器 ═══');
let c = 0;
for (const r of rows) {
  if (r.dLines.length) continue;
  c++;
  console.log(`  ⚠️ ${r.n}  写于行 ${r.wLines.slice(0, 8).join(',')}${r.wLines.length > 8 ? '…' : ''}`);
}
console.log(c ? `  小计 ${c} 个（需人工确认是否有 TTL / 上限守卫）` : '  ✅ 无');

console.log('\n═══ D. 只在部分分支清理（成功清、失败/提前 return 不清）═══');
// 找 `X.delete(` 所在行的缩进与所在函数，看同函数里有没有 return 早于它
let d = 0;
for (const r of rows) {
  for (const ln of r.dLines) {
    const i = ln - 1;
    // 往上找函数头
    let h = -1;
    for (let k = i; k >= 0; k--) { if (/^\s*(async\s+)?function\s+\w+/.test(L[k])) { h = k; break; } }
    if (h < 0) continue;
    const body = L.slice(h, i).join('\n');
    if (/\breturn\b/.test(body)) {
      d++;
      console.log(`  · ${r.n} 行 ${ln} 的清理之前，所在函数里有提前 return（行 ${h + 1} 起）`);
      break;
    }
  }
}
console.log(d ? `  小计 ${d} 个（需人工确认那条 return 分支是否也需要清理）` : '  ✅ 无');

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由守门测试钉死。）');
