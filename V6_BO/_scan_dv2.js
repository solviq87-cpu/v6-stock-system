// dv 轮实证：命中率的分母到底是谁 —— 被 empTable 静默跳过的样本有多少
// empTable 里两处 continue 都不计数、不留痕：
//   ① !s.nd || s.void || s.prob == null || !isFinite(s.prob)
//   ② !isLiveSample(s)（回测样本 / 事后样本：type∈{zt,review} 或登记时已封板）
// 于是面板上「55 档实测 60%（n=30）」的 n 是**跳完之后剩下的**，
// 而样本库 1959 条里另外那 1900 多条去哪了，任何地方都不说。
const fs = require('fs');
const path = require('path');
const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
const sigs = st.signals || [];

const POST_HOC_TYPES = new Set(['zt', 'review']);
const isBacktest = s => !!(s && s.resolved && s.resolved.mode === '历史回测');
const isPostHoc = s => {
  if (!s || isBacktest(s)) return false;
  return POST_HOC_TYPES.has(s.type) ||
    !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5);
};
const isLive = s => !isBacktest(s) && !isPostHoc(s);

let noNd = 0, isVoid = 0, noProb = 0, backtest = 0, posthoc = 0, pass = 0;
const byType = {};
for (const s of sigs) {
  const t = s.type || '(无)';
  byType[t] = byType[t] || { total: 0, pass: 0 };
  byType[t].total++;
  if (!s.nd) { noNd++; continue; }
  if (s.void) { isVoid++; continue; }
  if (s.prob == null || !isFinite(s.prob)) { noProb++; continue; }
  if (isBacktest(s)) { backtest++; continue; }
  if (isPostHoc(s)) { posthoc++; continue; }
  pass++;
  byType[t].pass++;
}

console.log('=== dv 轮实证：empTable 静默跳过了多少样本 ===\n');
console.log('样本库 S.learn.signals 共 ' + sigs.length + ' 条');
console.log('  ├ 跳过① 缺次日口径 s.nd        : ' + noNd);
console.log('  ├ 跳过① 已作废 s.void          : ' + isVoid);
console.log('  ├ 跳过① 缺原始概率 s.prob      : ' + noProb);
console.log('  ├ 跳过② 历史回测样本          : ' + backtest);
console.log('  ├ 跳过② 事后样本（zt/review/已封板）: ' + posthoc);
console.log('  └ 真正进档（命中率的分母）      : ' + pass +
  '  → 占样本库 ' + (pass / sigs.length * 100).toFixed(1) + '%');
console.log('\n⛔ 面板上每个档位显示的 n 都来自这 ' + pass + ' 条，' +
  '被跳过的 ' + (sigs.length - pass) + ' 条既不计数也不说明。\n');

console.log('【按信号类型：各类型的存活率】');
const rows = Object.keys(byType).map(k => ({ t: k, ...byType[k] }))
  .sort((a, b) => b.total - a.total);
for (const r of rows) {
  const pct = (r.pass / r.total * 100).toFixed(0);
  console.log('  ' + r.t.padEnd(14) + ' 总 ' + String(r.total).padStart(5) +
    ' → 进档 ' + String(r.pass).padStart(5) + '（' + String(pct).padStart(3) + '%）' +
    (r.pass === 0 && r.total > 50 ? '  ⛔ 整类被跳过（该类型的实测档永远是空的）' : ''));
}

// 关键：有没有"整类被跳过"的类型
const dead = rows.filter(r => r.pass === 0 && r.total >= 20);
console.log('\n⛔ 整类零存活（样本不少却一条都进不了档）：' +
  (dead.length ? dead.map(r => `${r.t}(${r.total}条)`).join('、') : '无'));
