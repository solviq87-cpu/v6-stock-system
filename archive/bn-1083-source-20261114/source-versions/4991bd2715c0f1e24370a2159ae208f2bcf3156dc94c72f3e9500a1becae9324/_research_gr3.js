// ═══ gr3 轮：接入前最后确认 ═══
//  1. I5 缩量 vs 绝对换手率共线（缩量是不是只是「换手<1%」的另一种说法）
//  2. M6 连板群细分（断板反包 vs 连板非反包的单元格）
//  3. K1 极热惩罚在小盘内是否仍成立（排除市值混淆）
//  4. K1 极热惩罚与 I5 缩量的交叉（两个候选因子是否互相解释）
const fs = require('fs');
const records = JSON.parse(fs.readFileSync('_research_gr_records.json', 'utf8'));
const ztRows = records.filter(r => r.ztToday && !r.yiZi);
const BASE = +(ztRows.filter(r => r.nextZtTouch).length / ztRows.length * 100).toFixed(1);
console.log('[基数] n=' + ztRows.length + ' 触板 ' + BASE + '%');
function rep(rows, label) {
  const n = rows.length;
  if (!n) { console.log(label.padEnd(26), 'n=0'); return { n: 0 }; }
  const ztT = +(rows.filter(r => r.nextZtTouch).length / n * 100).toFixed(1);
  const avg = +(rows.reduce((s, r) => s + r.nextPct, 0) / n).toFixed(2);
  console.log(label.padEnd(26), 'n=' + String(n).padStart(6), '触板', String(ztT).padStart(5) + '%', 'Δ', (ztT - BASE).toFixed(1).padStart(6), '均涨', String(avg).padStart(6) + '%', n < 30 ? '(n<30)' : '');
  return { n, ztT };
}

console.log('\n════ 1·I5 缩量(vRatio<0.8) × 绝对换手率 交叉 ════');
const TB = [[0, 1.5], [1.5, 3], [3, 6], [6, 100]];
for (const [lo, hi] of TB) {
  const sub = ztRows.filter(x => x.turnPct >= lo && x.turnPct < hi);
  if (sub.length < 30) continue;
  console.log('  ── 换手 ' + lo + '~' + (hi === 100 ? '∞' : hi) + '%（n=' + sub.length + '） ──');
  rep(sub.filter(x => x.vRatio < 0.8), '   缩量<0.8');
  rep(sub.filter(x => x.vRatio >= 0.8), '   常轨≥0.8');
}

console.log('\n════ 2·M6 连板群（zt5>=2）细分 ════');
const lbRows = ztRows.filter(x => x.zt5 >= 2);
console.log('连板群 n=' + lbRows.length + ' 基数 ' + rep(lbRows, '连板群全体').ztT + '%');
rep(lbRows.filter(x => x.engulf), '   连板·昨阴今封(断板反包)');
rep(lbRows.filter(x => !x.engulf), '   连板·非反包');
console.log('  对照·首板群：');
const fbRows = ztRows.filter(x => x.zt5 <= 1);
rep(fbRows.filter(x => x.engulf), '   首板·昨阴今封');
rep(fbRows.filter(x => !x.engulf), '   首板·非反包');

console.log('\n════ 3·K1 极热(涨跌比75-85%) × 市值 ════');
const hot = ztRows.filter(x => x.mktUpRatio != null && x.mktUpRatio >= 75 && x.mktUpRatio < 85);
const mild = ztRows.filter(x => x.mktUpRatio != null && x.mktUpRatio < 75);
for (const [lo, hi] of [[0, 100], [100, 500], [500, 1e9]]) {
  const h = hot.filter(x => x.capYi >= lo && x.capYi < hi), m = mild.filter(x => x.capYi >= lo && x.capYi < hi);
  if (h.length < 30 || m.length < 30) { console.log('  ' + lo + '~' + hi + '亿：样本不足（热' + h.length + '/温' + m.length + '）'); continue; }
  console.log('  ── 市值 ' + lo + '~' + (hi === 1e9 ? '∞' : hi) + '亿 ──');
  rep(h, '   极热日');
  rep(m, '   非极热日');
}

console.log('\n════ 4·I5缩量 × K1极热 交叉 ════');
for (const [lo, hi] of [[75, 101], [0, 75]]) {
  const sub = ztRows.filter(x => x.mktUpRatio != null && x.mktUpRatio >= lo && x.mktUpRatio < hi);
  if (sub.length < 30) continue;
  console.log('  ── ' + (hi === 101 ? '极热≥75%' : '非极热<75%') + '（n=' + sub.length + '） ──');
  rep(sub.filter(x => x.vRatio < 0.8), '   缩量<0.8');
  rep(sub.filter(x => x.vRatio >= 0.8), '   常轨≥0.8');
}
