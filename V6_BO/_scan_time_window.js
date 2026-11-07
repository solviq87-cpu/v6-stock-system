// 时间窗扫描器（本轮角度：时间窗的「开闭 / 重叠 / 缝隙」）。
// 守门测试 _test_time_window.js 只钉住已确认修复的那几处；这个扫描器负责把全项目
// 所有【日内时刻窗口】列成一张清单（时长/TTL 那类 `Date.now() - x < 5*60*1000` 不算），
// 逐条标注它靠什么守交易日，供下一轮继续查：
//   A. 窗口块清单（锚点 → 窗口表达式 → 交易日守门方式）
//   B. 恒真 / 恒假的窗口（同一条 && 链上，上界不大于下界）
//   C. 只判星期几、不判法定假日的时间窗（休市日照开）
//   D. 不可达守卫（先要求 t 不小于 A，紧接着又判 t 小于 B，且 B 不大于 A）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const lines = src.split('\n');

const { stripNoise } = require('./_codescan.js');
const codeLines = stripNoise(src).split('\n');   // 复用项目内已有的剥离器：注释/字符串/正则字面量都涂成空格，行数与列位置不变


// 日内时刻窗口：变量是 t / m / mins / sod（排除 .t 之类的属性访问），且不是 TTL 时长比较
const VAR = '(?<![.\\w])(t|m|mins|sod)(?![\\w])';
// auctionPhase / 竞价实时刷新用的是「当天秒数」(`s >= 9 * 3600 + 15 * 60`)，单独列一类
const WIN = new RegExp(VAR + '\\s*(>=|<=|>|<)\\s*\\d|(?<![.\\w])s\\s*(>=|<=|>|<)\\s*\\d+\\s*\\*\\s*3600');
const isTTL = l => /Date\.now\(\)|\*\s*1000|ms\b|msSince|ageMs/.test(l);

const ANCHOR = /^\s*(?:function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|\(|function)|(?:setInterval|setTimeout)\s*\()/;

// ── A. 窗口块清单 ───────────────────────────────────────────────────────────
console.log('═══ A. 日内时刻窗口清单（锚点 → 窗口 → 交易日守门）═══');
let cur = '(文件开头)';
const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const a = ANCHOR.exec(codeLines[i] || '');
  if (a) cur = (a[1] || a[2] || ('setInterval/setTimeout@' + (i + 1)));
  const cl = codeLines[i] || '';
  if (!WIN.test(cl) || isTTL(cl)) continue;
  const from = Math.max(0, i - 45);
  const ctx = codeLines.slice(from, i + 1).join('\n');
  const guard = /isTradeDay\s*\(/.test(ctx) ? 'isTradeDay ✅'
    : /(getDay\(\)|dow|wd)\s*(?:===|!==|>=|<=|>|<)/.test(ctx) ? '仅星期几 ⚠️' : '无守门 ❌';
  const expr = lines[i].trim().slice(0, 92);
  blocks.push({ name: cur, line: i + 1, expr, guard, code: cl });
  console.log(`  ${String(i + 1).padStart(5)}  [${cur}]  ${guard}  ${expr}`);
}
console.log(`  共 ${blocks.length} 处`);

// ── B. 恒真 / 恒假窗口 ──────────────────────────────────────────────────────
console.log('\n═══ B. 恒真 / 恒假窗口（同一条 && 链上，上界不大于下界）═══');
const val = t => {
  let v = 0, m;
  const re = /(\d+)\s*\*\s*(60|3600)/g;
  while ((m = re.exec(t))) v += (+m[1]) * (+m[2]);
  const rest = t.replace(/\d+\s*\*\s*(?:60|3600)/g, '');
  const add = /\+\s*(\d+)/.exec(rest);
  if (add) v += +add[1];
  if (!/\d+\s*\*\s*(?:60|3600)/.test(t)) v += (+(/(\d+)/.exec(t) || [0, 0])[1]);
  return v;
};
let b = 0;
for (const blk of blocks) {
  if (/\|\|/.test(blk.code)) continue;                 // OR 型守卫不是区间，跳过
  const mm = [...blk.code.matchAll(new RegExp(VAR + '\\s*(>=|<=|>|<)\\s*([\\d\\s*+]+)', 'g'))];
  if (mm.length < 2) continue;
  const lo = mm.find(x => x[2] === '>=' || x[2] === '>');
  const hi = mm.find(x => x[2] === '<=' || x[2] === '<');
  if (!lo || !hi) continue;
  const lv = val(lo[3]), hv = val(hi[3]);
  if (hv <= lv) { b++; console.log(`  ⚠️ 行 ${blk.line} [${blk.name}] 下界 ${lv} ≥ 上界 ${hv} → 窗口恒不成立：${blk.expr}`); }
}
console.log(b ? `  小计 ${b} 处` : '  无（所有窗口的下界都严格小于上界）');

// ── C. 只判星期几、不判法定假日 ─────────────────────────────────────────────
console.log('\n═══ C. 只判星期几、不判法定假日的时间窗（休市日照开）═══');
let c = 0;
for (const blk of blocks) {
  if (blk.guard === '仅星期几 ⚠️') { c++; console.log(`  ${blk.guard} 行 ${blk.line} [${blk.name}] ${blk.expr}`); }
}
console.log(c ? `  小计 ${c} 处（休市日会照样开，需逐条判性质）` : '  无（全部走 isTradeDay，休市日一律关）');

// ── D. 不可达守卫 ───────────────────────────────────────────────────────────
console.log('\n═══ D. 不可达守卫（先要求 t 不小于 A，紧接着又判 t 小于 B，且 B 不大于 A）═══');
let d = 0;
for (let i = 0; i < lines.length; i++) {
  const cl = codeLines[i] || '';
  const mHi = new RegExp('^\\s*if \\(.*?' + VAR + '\\s*(?:>=|>)\\s*([\\d\\s*+]+)').exec(cl);
  if (!mHi) continue;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    const cl2 = codeLines[j] || '';
    const mLo = new RegExp('^\\s*if \\(.*?' + VAR + '\\s*(?:<=|<)\\s*([\\d\\s*+]+)').exec(cl2);
    if (!mLo) continue;
    if (val(mLo[2]) <= val(mHi[2])) {
      d++; console.log(`  ⚠️ 行 ${i + 1} 要求 t ≥ ${val(mHi[2])}，行 ${j + 1} 又判 t < ${val(mLo[2])} → 后者永假（死分支）`);
    }
  }
}
console.log(d ? `  小计 ${d} 处` : '  无');

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由 _test_time_window.js 钉死。）');
