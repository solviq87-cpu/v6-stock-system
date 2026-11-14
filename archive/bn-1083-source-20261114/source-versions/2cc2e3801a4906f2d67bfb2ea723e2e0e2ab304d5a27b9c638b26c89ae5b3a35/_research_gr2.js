// ═══ gr2 轮：薄样本敏感性与共线性复测（基于 _research_gr_records.json 缓存） ═══
//  A. I5 缩量阈值敏感性（gr 里 <0.6 只有 n=64）
//  B. K1 市场环境细分档（极冷/极热边界敏感性）
//  C. M7 创新高 × rangePos 共线性（是否只是 gq 位置因子的另一种说法）
//  D. 向上缺口 × 创新高 共线性
//  E. M6 昨阴今封 的独立性（分连板档 / 分市值档内是否仍成立）
//  F. P4 KDJ 低阈值（K<15）
//  G. J13 试攻 分市值档稳健性
const fs = require('fs');
const records = JSON.parse(fs.readFileSync('_research_gr_records.json', 'utf8'));
const ztRows = records.filter(r => r.ztToday && !r.yiZi);
const BASE = { n: ztRows.length, ztT: +(ztRows.filter(r => r.nextZtTouch).length / ztRows.length * 100).toFixed(1) };
console.log('[缓存] 全宇宙', records.length, '| 涨停日切片', JSON.stringify(BASE));

function rep(rows, label) {
  const n = rows.length;
  if (!n) { console.log(label.padEnd(30), 'n=0'); return { n: 0 }; }
  const ztT = +(rows.filter(r => r.nextZtTouch).length / n * 100).toFixed(1);
  const avg = +(rows.reduce((s, r) => s + r.nextPct, 0) / n).toFixed(2);
  const flag = n < 30 ? '  (n<30 不判)' : '';
  console.log(label.padEnd(30), 'n=' + String(n).padStart(6), '触板', String(ztT).padStart(5) + '%', 'Δ', (ztT - BASE.ztT).toFixed(1).padStart(6), '均涨', String(avg).padStart(6) + '%', flag);
  return { n, ztT, avg };
}
function halves(rows, label) {
  const dates = rows.map(r => r.date).sort();
  const mid = dates[Math.floor(dates.length / 2)];
  const a = rows.filter(r => r.date <= mid), b = rows.filter(r => r.date > mid);
  if (a.length < 30 || b.length < 30) { console.log('   半窗：样本不足（' + a.length + '/' + b.length + '）'); return; }
  const ra = a.filter(r => r.nextZtTouch).length / a.length * 100, rb = b.filter(r => r.nextZtTouch).length / b.length * 100;
  const ba = a.length, bb = b.length;
  const same = (ra > BASE.ztT) === (rb > BASE.ztT);
  console.log('   半窗：前半 ' + ra.toFixed(1) + '%(n=' + ba + ') vs 后半 ' + rb.toFixed(1) + '%(n=' + bb + ') → ' + (same ? '同向' : '背离'));
}

console.log('\n════ A·I5 缩量阈值敏感性（量比20日中位） ════');
for (const th of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  const r = rep(ztRows.filter(x => x.vRatio < th), 'vRatio<' + th);
  if (r.n >= 60) halves(ztRows.filter(x => x.vRatio < th), '');
}

console.log('\n════ B·K1 市场环境细分（涨跌家数比） ════');
const MK = [[0, 15], [15, 20], [20, 25], [25, 40], [40, 60], [60, 75], [75, 85], [85, 101]];
for (const [lo, hi] of MK) {
  const rows = ztRows.filter(x => x.mktUpRatio != null && x.mktUpRatio >= lo && x.mktUpRatio < hi);
  const r = rep(rows, lo + '~' + (hi === 101 ? '100' : hi) + '%');
  if (r.n >= 60) halves(rows, '');
}

console.log('\n════ C·M7 创新高 × rangePos 共线性 ════');
// rangePos 用 20 日位置复算（records 里没带 rangePos，用 brk20+收盘位置近似：直接重算）
// 简化：用「收盘是否创20日新高」与「是否半山腰」交叉 —— 半山腰定义需要 rangePos，从 kline 重算太贵，
// 改用代理：未创新高 & 收盘>MA20？不严谨。直接交叉 brk20 × capYi 看是否只是市值效应。
const capBk = r => r.capYi < 100 ? '<100亿' : r.capYi < 500 ? '100-500亿' : '≥500亿';
for (const cb of ['<100亿', '100-500亿', '≥500亿']) {
  const sub = ztRows.filter(x => capBk(x) === cb);
  if (sub.length < 30) continue;
  console.log('  ── ' + cb + '（n=' + sub.length + '） ──');
  rep(sub.filter(x => x.brk20), '   创新高');
  rep(sub.filter(x => !x.brk20), '   未创新高');
}
// 首板内（zt5<=1）是否仍成立 —— 排除连板高度混淆
console.log('  ── 仅首板群（zt5<=1，排除连板动量混淆） ──');
const firstOnly = ztRows.filter(x => x.zt5 <= 1);
rep(firstOnly.filter(x => x.brk20), '   首板·创新高');
rep(firstOnly.filter(x => !x.brk20), '   首板·未创新高');

console.log('\n════ D·向上缺口 × 创新高 共线性 ════');
for (const g of [true, false]) {
  const sub = ztRows.filter(x => x.gapUp === g);
  if (sub.length < 30) continue;
  console.log('  ── ' + (g ? '向上缺口' : '无缺口/低开') + '（n=' + sub.length + '） ──');
  rep(sub.filter(x => x.brk20), '   ×创新高');
  rep(sub.filter(x => !x.brk20), '   ×未创新高');
}

console.log('\n════ E·M6 昨阴今封 独立性 ════');
for (const cb of ['<100亿', '100-500亿', '≥500亿']) {
  const sub = ztRows.filter(x => capBk(x) === cb);
  if (sub.length < 30) continue;
  console.log('  ── ' + cb + '（n=' + sub.length + '） ──');
  rep(sub.filter(x => x.engulf), '   昨阴今封(反包)');
  rep(sub.filter(x => !x.engulf), '   非反包');
}
console.log('  ── 仅首板群 ──');
rep(firstOnly.filter(x => x.engulf), '   首板·昨阴今封');
rep(firstOnly.filter(x => !x.engulf), '   首板·非反包');
// 反包 vs 单纯昨阴（昨阴但没收过昨高）
const yinOnly = ztRows.filter(x => !x.engulf && x.pct < 0);
void yinOnly;

console.log('\n════ F·P4 KDJ 低阈值 ════');
for (const th of [10, 15, 20, 25]) {
  rep(ztRows.filter(x => x.kdvK != null && x.kdvK < th), 'K<' + th);
}
rep(ztRows.filter(x => x.kdvK != null && x.kdvK >= 20 && x.kdvK < 50), 'K20-50（对照）');

console.log('\n════ G·J13 试攻 分市值 ════');
for (const cb of ['<100亿', '100-500亿', '≥500亿']) {
  const sub = ztRows.filter(x => capBk(x) === cb);
  if (sub.length < 30) continue;
  console.log('  ── ' + cb + ' ──');
  rep(sub.filter(x => x.tryAttack), '   有试攻');
  rep(sub.filter(x => !x.tryAttack), '   无试攻');
}
