// ms 轮守门：选股硬维度（筹码峰 + 十日量能）——守住「选股全部页面强制过这两维」铁律
// 钉的语义（四项，缺一门就是下结论前少了半个脑袋）：
//   ① 精选池 rebuildPool **必须**接 chipPeakOf + volTenOf —— ls 轮「全页面铺开」时唯独漏了它，
//      同一只票在别的卡片被十日量能判 bad 扣分、回精选池却满分排第一，两把尺子；
//   ② 任一样本不足 helper 返回 null 时必须「不加不减」——判不出不硬判，
//      既不让缺数据的票占便宜，更不拿 0 冒充坏消息错杀；
//   ③ 已算出的结论不得因另一维判不出而被吃掉：chipVol 赋值必须独立于 if (vol)，且用 vol ? … : '' 保护；
//   ④ 必须留痕（chipVolMiss 字段 + 日志统计）—— 静默等于没接。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
// 花括号配平取函数体
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}

// ── ① 精选池必须接硬维度 ──
group('[1] 精选池 rebuildPool 硬维度接线');
const poolIdx = SV.indexOf('async function rebuildPool(');
ok(poolIdx > 0, 'H1 rebuildPool 存在');
const poolBody = bodyAt(SV, poolIdx);
ok(poolBody.length > 1000, 'H2 取到 rebuildPool 函数体');
ok(/A\.chipPeakOf\(k\.rows\)/.test(poolBody), 'H3 精选池接了筹码峰 chipPeakOf');
ok(/A\.volTenOf\(k\.rows\)/.test(poolBody), 'H4 精选池接了十日量能 volTenOf');
ok(/scoreAdj\s*=\s*Math\.max\(0,\s*Math\.min\(100/.test(poolBody) && /score:\s*scoreAdj/.test(poolBody),
  'H5 硬维度结果真的进了入选分数（不是算完扔掉）');

// ── ② 判不出不硬判 ──
group('[2] 样本不足 → 不加不减（判不出不硬判）');
ok(/if \(_chip\) \{/.test(poolBody), 'H6 筹码结论有 null 守卫（芯片=chipPeakOf 返回 null 时不得动分）');
ok(/if \(_vol\) \{/.test(poolBody), 'H7 量能结论有 null 守卫（volTenOf 返回 null 时不得动分）');
ok(/chipVolMiss:/.test(poolBody), 'H8 判不出的票带 chipVolMiss 留痕字段');
ok(/\[pool\] 硬维度（筹码峰\+十日量能）/.test(poolBody), 'H9 池收尾有硬维度日志（扣分/未作结论都看得见）');
ok(!/chipAdj \+= chipPeakOf|_chip.*\?\?\s*0/.test(poolBody), 'H10 无「缺失按 0 处理」类的静默兜底');
// helper 真跑：样本不足必须返回 null，而不是 0 或猜出来的对象
let A = null;
try { A = require('./analysis.js'); } catch (e) {}
if (!A) { try { A = require(path.join(ROOT, 'analysis.js')); } catch (e) {} }
const mkRow = (close, pct, volume) => ({ close, pct, volume, date: '2026-10-27' });
if (A && typeof A.chipPeakOf === 'function') {
  ok(A.chipPeakOf([mkRow(10, 1, 1000)]) === null, 'H11 chipPeakOf 样本<30根 返回 null（不硬判）', typeof A.chipPeakOf([mkRow(10, 1, 1000)]));
  const rows60 = [];
  for (let i = 0; i < 60; i++) rows60.push(mkRow(10 + (i % 7) * 0.1, (i % 3) - 1, 1000 + i * 10));
  const cp = A.chipPeakOf(rows60);
  ok(cp && typeof cp.chipText === 'string' && cp.chipText.length > 0, 'H12 chipPeakOf 有值时 chipText 非空（结论要能显示出来）');
} else {
  ok(false, 'H11/H12 chipPeakOf 不可达（analysis.js 导出丢了）');
}
if (A && typeof A.volTenOf === 'function') {
  ok(A.volTenOf([mkRow(10, 1, 1000)]) === null, 'H13 volTenOf 样本<12根 返回 null（不硬判）');
  const down = [];
  for (let i = 0; i < 20; i++) down.push(mkRow(10 - i * 0.05, -1.2, 5000 + i * 50));
  const vr = A.volTenOf(down);
  ok(vr && vr.verdict === 'bad', 'H14 十日红瘦绿肥能被判 bad（$$下跌放量$$要被扣）', vr ? vr.verdict : 'null');
} else {
  ok(false, 'H13/H14 volTenOf 不可达（analysis.js 导出丢了）');
}

// ── ③ 已算出的结论不得被另一维吃掉 ──
group('[3] chipVol 合并文本不得写在 if (vol) 体内');
const assignLines = SV.split('\n').filter(l => /it\.chipVol = \[|_chipVol = \[/.test(l));
ok(assignLines.length >= 3, 'H15 chipVol 合并处≥3 处（量化选股/竞价共振/盘中强势）', String(assignLines.length));
ok(assignLines.every(l => /vol \? vol\.text : ''/.test(l)),
  'H16 每处 chipVol 都用了 vol 三元保护（vol 为 null 时不再连带丢掉 chip 结论）', assignLines.join(' || ').slice(0, 200));
ok(assignLines.every(l => /^\s*(it\.)?_?chipVol = \[/.test(l)),
  'H17 chipVol 赋值是独立语句（不再嵌在 if (vol) { … } 体内）', assignLines[0] || '');
ok(assignLines.every(l => /chip \? chip\.chipText : ''/.test(l)),
  'H18 chip 侧同样有空值保护（chip 为 null 时不写 undefined）', assignLines.filter(l => !/chip \? chip\.chipText : ''/.test(l)).join(' || ').slice(0, 160));

console.log(`\n── 结果：通过 ${pass} / 失败 ${fail} ──`);
process.exit(fail ? 1 : 0);
