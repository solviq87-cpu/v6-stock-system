// 复验 20261016 报告补充口径数字（独立重算，不覆盖 _backtest_nd.js 主表）
const fs = require('fs');
const path = require('path');
const root = __dirname;

const st = JSON.parse(fs.readFileSync(path.join(root, 'stats.json'), 'utf8'));
let breadth = {};
try { breadth = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8')); } catch (e) {}

function normDate(d) {
  if (!d) return d;
  if (typeof d === 'string' && /^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}
function envLayerOf(upRatio) {
  if (upRatio == null || Number.isNaN(upRatio)) return '未知';
  if (upRatio < 40) return '普跌';
  if (upRatio > 52) return '普涨';
  return '退潮';
}

// 与 _backtest_nd.js 同口径：auczt、非 void、nd.nextPct 有限
const auc = st.signals.filter(s => s.type === 'auczt' && !s.void && s.nd && typeof s.nd.nextPct === 'number');
console.log('filled n =', auc.length);

// 题材梯队标签（报告定义）
const TIER_TAGS = new Set(['连板惯性', '板块龙头', '板块中军', '昨日板块涨停效应', '今日板块涨停效应']);
const hasTier = s => (s.paths || []).some(p => TIER_TAGS.has(p));

function rate(arr, pred) { return arr.length ? +(arr.filter(pred).length / arr.length * 100).toFixed(1) : null; }

// 1) 梯队二分
const withT = auc.filter(hasTier), noT = auc.filter(s => !hasTier(s));
console.log('\n[1] 梯队二分：有梯队 n=%d +3%%=%s%% | 无梯队 n=%d +3%%=%s%%',
  withT.length, rate(withT, s => s.nd.nextPct >= 3), noT.length, rate(noT, s => s.nd.nextPct >= 3));

// 2) 两半窗（按信号日中位数切）
const dates = [...new Set(auc.map(s => s.date))].sort();
const midDate = dates[Math.floor(dates.length / 2) - 1]; // H1 截止日（含）
const h1 = auc.filter(s => s.date <= midDate), h2 = auc.filter(s => s.date > midDate);
console.log('[2] 半窗切分: H1(<=%s) n=%d, H2 n=%d', midDate, h1.length, h2.length);
console.log('    有梯队 H1 n=%d +3%%=%s%% | H2 n=%d +3%%=%s%%',
  h1.filter(hasTier).length, rate(h1.filter(hasTier), s => s.nd.nextPct >= 3),
  h2.filter(hasTier).length, rate(h2.filter(hasTier), s => s.nd.nextPct >= 3));
console.log('    无梯队 H1 n=%d +3%%=%s%% | H2 n=%d +3%%=%s%%',
  h1.filter(s => !hasTier(s)).length, rate(h1.filter(s => !hasTier(s)), s => s.nd.nextPct >= 3),
  h2.filter(s => !hasTier(s)).length, rate(h2.filter(s => !hasTier(s)), s => s.nd.nextPct >= 3));

// 3) 环境分层 × 梯队
for (const L of ['普跌', '退潮', '普涨', '未知']) {
  const lay = auc.filter(s => envLayerOf(breadth[normDate(s.date)] ? breadth[normDate(s.date)].upRatio : null) === L);
  if (!lay.length) { console.log('[3] %s n=0', L); continue; }
  const wt = lay.filter(hasTier), nt = lay.filter(s => !hasTier(s));
  console.log('[3] %s n=%d | 有梯队 n=%d +3%%=%s%% | 无梯队 n=%d +3%%=%s%%',
    L, lay.length, wt.length, rate(wt, s => s.nd.nextPct >= 3), nt.length, rate(nt, s => s.nd.nextPct >= 3));
}

// 4) prob/score 均值
function avg(arr, f) { return arr.length ? +(arr.reduce((a, s) => a + (f(s) || 0), 0) / arr.length).toFixed(1) : null; }
console.log('\n[4] 有梯队 prob均=%s score均=%s | 无梯队 prob均=%s score均=%s',
  avg(withT, s => s.prob), avg(withT, s => s.score), avg(noT, s => s.prob), avg(noT, s => s.score));

// 5) 因子覆盖率 + 命中率（+3% 口径）
console.log('\n[5] 因子覆盖率与次日+3%命中：');
const tagN = {};
for (const s of auc) for (const p of (s.paths || [])) (tagN[p] = tagN[p] || []).push(s);
const rows = Object.entries(tagN).map(([t, arr]) => ({ t, n: arr.length, cov: +(arr.length / auc.length * 100).toFixed(1), hit: rate(arr, s => s.nd.nextPct >= 3) }));
rows.sort((a, b) => b.cov - a.cov);
for (const r of rows) console.log('    %-12s n=%-3d 覆盖%5.1f%%  命中%5.1f%%', r.t, r.n, r.cov, r.hit);

// 6) 日内型：maxGain>=3 vs nextPct>=3
console.log('\n[6] 次日盘中最高>=3%%: %s%% (n=%d) | 收盘>=3%%: %s%% | 均涨幅 %s | 最高>=5%%: %s%%',
  rate(auc, s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 3),
  auc.filter(s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 3).length,
  rate(auc, s => s.nd.nextPct >= 3),
  avg(auc, s => s.nd.nextPct),
  rate(auc, s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 5));

// 7) prob 分档：当日封板(resolved.limitUp) vs 次日(nextPct>=3)
console.log('\n[7] prob 分档（30-40/40-50/50-60/60+）：');
for (const [lo, hi] of [[30, 40], [40, 50], [50, 60], [60, 101]]) {
  const b = auc.filter(s => s.prob >= lo && s.prob < hi);
  if (!b.length) { console.log('    prob %d-%d n=0', lo, hi); continue; }
  const daySeal = b.filter(s => s.resolved && s.resolved.limitUp).length;
  const ndClose = b.filter(s => s.nd.nextPct >= 3).length;
  const ndMax = b.filter(s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 3).length;
  console.log('    prob %d-%d n=%d | 当日封板 %s%% | 次日收盘+3%% %s%% | 次日最高+3%% %s%%',
    lo, hi, b.length, (daySeal / b.length * 100).toFixed(1), (ndClose / b.length * 100).toFixed(1), (ndMax / b.length * 100).toFixed(1));
}
