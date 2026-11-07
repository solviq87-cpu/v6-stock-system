// 空值语义扫描器（本轮角度：把「取不到」当成「确实没有」）。
// 守门测试 _test_empty_semantics.js 只钉住已确认修复的那几处；这个扫描器负责把全项目
// 所有【把结果池写空 / 写空值】的位置列成清单，逐条标注它有没有"数据是否就绪"的守卫，
// 供下一轮继续判：
//   A. 结果池被写空的赋值点（是否守了 marketReady / 其它就绪判据）
//   B. catch 里返回空值的降级分支（把"取不到"降级成"确实没有"的地方）
//   C. 「取不到就不覆盖」的正面样例（源头保护，不许退化）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src);
const lines = src.split('\n');
const codeLines = code.split('\n');

const POOLS = ['bigMoney', 'pre', 'buzhang', 'review', 'nextplan', 'myrules', 'ztPre', 'steadyUp', 'trendPool', 'candidatePool', 'ztPool', 'sectors'];

console.log('═══ A. 结果池被写空的赋值点（是否有「数据就绪」守卫）═══');
let a = 0, unguarded = 0;
for (let i = 0; i < lines.length; i++) {
  const cl = codeLines[i] || '';
  if (/^\s*\/\//.test(lines[i])) continue;                       // 纯注释行
  const m = new RegExp('S\\.(' + POOLS.join('|') + ')\\s*=\\s*(\\{[^}]*\\}|\\[\\])').exec(cl);
  if (!m) continue;
  const emptyish = /items: \[\]|plan: null|empty: '|=\s*\[\];/.test(cl);
  if (!emptyish) continue;
  a++;
  const guarded = /marketReady\(\)/.test(cl);
  const nearGuard = !guarded && /marketReady\(\)|klines\.size|S\.stocks\.length|files\.length|out\.length \|\||\.length \|\|/.test(
    (codeLines.slice(Math.max(0, i - 3), i + 1).join('\n')));
  if (!guarded && !nearGuard) unguarded++;
  console.log(`  ${String(i + 1).padStart(5)}  S.${m[1]}  ${guarded ? '已守 marketReady ✅' : (nearGuard ? '附近有长度判据 ～' : '无守卫 ❌')}   ${lines[i].trim().slice(0, 92)}`);
}
console.log(`  共 ${a} 处，其中无守卫 ${unguarded} 处`);

console.log('\n═══ B. catch 里返回空值的降级分支（"取不到"→"确实没有"的制造点）═══');
let b = 0;
for (let i = 0; i < lines.length; i++) {
  const cl = codeLines[i] || '';
  const m = /\}\s*catch[^{]*\{\s*return\s*(\[\]|\{\}|null|0)\s*;/.exec(cl);
  if (!m) continue;
  b++;
  // 回溯 6 行，看这个 catch 属于哪个函数
  let owner = '(未知)';
  for (let j = i; j >= Math.max(0, i - 40); j--) {
    const fm = /^(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>))/.exec(codeLines[j] || '');
    if (fm) { owner = fm[1] || fm[2]; break; }
  }
  console.log(`  ${String(i + 1).padStart(5)}  [${owner}] catch → return ${m[1]}   ${lines[i].trim().slice(0, 80)}`);
}
console.log(b ? `  小计 ${b} 处（需逐条判：调用方是否把它当成"确实没有"）` : '  无');

console.log('\n═══ C. 正面样例：源头「取不到就不覆盖」的保护不许退化 ═══');
const guards = [
  ['涨停池', /if \(zt && zt\.length\) \{[\s\S]{0,60}?S\.ztPool = zt;/],
  ['板块池', /if \(ind && con && ind\.length && con\.length\)/],
  ['趋势池（学习库为空直接返回，不覆盖）', /if \(!db \|\| !db\.n\) return \{ ok: false,/],
  ['大盘 beta（非数据时段宁缺勿错）', /if \(!\(\(?opt && opt\.force\)?\)? && !betaWindowOpen\(\)\) return null;/],
];
for (const [name, re] of guards) {
  console.log(`  ${re.test(src) ? '✅' : '❌ 已退化'} ${name}`);
}

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由 _test_empty_semantics.js 钉死。）');
