// 2026-10-20 归因分析（每日回测配套，独立重算不覆盖 _backtest_nd.js 主表）
// 口径与 _verify_report_1016.js 完全一致：auczt 非 void、nd.nextPct 有限；环境层按 breadth upRatio。
// 新增：市值档（流通市值 floatCap，当日快照近似）、10-20 第 2 日 iq 权重重构样本、旧版 nd 漂移计数。
const fs = require('fs');
const path = require('path');
const root = __dirname;

const st = JSON.parse(fs.readFileSync(path.join(root, 'stats.json'), 'utf8'));
let breadth = {};
try { breadth = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8')); } catch (e) {}
let snapRows = [];
try { snapRows = (JSON.parse(fs.readFileSync(path.join(root, 'stocks_snapshot.json'), 'utf8'))).rows || []; } catch (e) {}

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
const envOf = s => envLayerOf(breadth[normDate(s.date)] ? breadth[normDate(s.date)].upRatio : null);

const auc = st.signals.filter(s => s.type === 'auczt' && !s.void && s.nd && typeof s.nd.nextPct === 'number');
console.log('auczt filled n =', auc.length, '（主表同口径）');

// ---------- 0) 旧版 nd 漂移计数（解释日报数字位移） ----------
const aucAll = st.signals.filter(s => s.type === 'auczt' && !s.void && s.nd);
const oldNd = aucAll.filter(s => s.nd.openGap === undefined);
console.log('\n[0] auczt 旧版 nd（openGap===undefined，随缓存补齐会被 resolveNextDay 重算）:', oldNd.length,
  '| 信号日:', [...new Set(oldNd.map(s => s.date))].sort().join(','));

// ---------- 1) 梯队二分 ----------
const TIER_TAGS = new Set(['连板惯性', '板块龙头', '板块中军', '昨日板块涨停效应', '今日板块涨停效应']);
const hasTier = s => (s.paths || []).some(p => TIER_TAGS.has(p));
function rate(arr, pred) { return arr.length ? +(arr.filter(pred).length / arr.length * 100).toFixed(1) : null; }
const withT = auc.filter(hasTier), noT = auc.filter(s => !hasTier(s));
console.log('\n[1] 梯队二分：有梯队 n=%d 次日+3%%=%s%% | 无梯队 n=%d 次日+3%%=%s%%（差距 %s pp）',
  withT.length, rate(withT, s => s.nd.nextPct >= 3), noT.length, rate(noT, s => s.nd.nextPct >= 3),
  withT.length && noT.length ? (rate(withT, s => s.nd.nextPct >= 3) - rate(noT, s => s.nd.nextPct >= 3)).toFixed(1) : 'n/a');

// ---------- 2) 两半窗 ----------
const dates = [...new Set(auc.map(s => s.date))].sort();
const midDate = dates[Math.floor(dates.length / 2) - 1];
const h1 = auc.filter(s => s.date <= midDate), h2 = auc.filter(s => s.date > midDate);
console.log('[2] 半窗切分: H1(<=%s) n=%d, H2 n=%d', midDate, h1.length, h2.length);
console.log('    有梯队 H1 n=%d +3%%=%s%% | H2 n=%d +3%%=%s%%',
  h1.filter(hasTier).length, rate(h1.filter(hasTier), s => s.nd.nextPct >= 3),
  h2.filter(hasTier).length, rate(h2.filter(hasTier), s => s.nd.nextPct >= 3));
console.log('    无梯队 H1 n=%d +3%%=%s%% | H2 n=%d +3%%=%s%%',
  h1.filter(s => !hasTier(s)).length, rate(h1.filter(s => !hasTier(s)), s => s.nd.nextPct >= 3),
  h2.filter(s => !hasTier(s)).length, rate(h2.filter(s => !hasTier(s)), s => s.nd.nextPct >= 3));

// ---------- 3) 环境分层 × 梯队 ----------
for (const L of ['普跌', '退潮', '普涨', '未知']) {
  const lay = auc.filter(s => envOf(s) === L);
  if (!lay.length) { console.log('[3] %s n=0', L); continue; }
  const wt = lay.filter(hasTier), nt = lay.filter(s => !hasTier(s));
  console.log('[3] %s n=%d | 有梯队 n=%d +3%%=%s%% | 无梯队 n=%d +3%%=%s%%',
    L, lay.length, wt.length, rate(wt, s => s.nd.nextPct >= 3), nt.length, rate(nt, s => s.nd.nextPct >= 3));
}

// ---------- 4) prob/score 均值 ----------
function avg(arr, f) { return arr.length ? +(arr.reduce((a, s) => a + (f(s) || 0), 0) / arr.length).toFixed(1) : null; }
console.log('\n[4] 有梯队 prob均=%s score均=%s | 无梯队 prob均=%s score均=%s',
  avg(withT, s => s.prob), avg(withT, s => s.score), avg(noT, s => s.prob), avg(noT, s => s.score));

// ---------- 5) 因子覆盖率 + 命中 ----------
console.log('\n[5] 因子覆盖率与次日+3%命中（基线 12.8%）：');
const tagN = {};
for (const s of auc) for (const p of (s.paths || [])) (tagN[p] = tagN[p] || []).push(s);
const rows = Object.entries(tagN).map(([t, arr]) => ({ t, n: arr.length, cov: +(arr.length / auc.length * 100).toFixed(1), hit: rate(arr, s => s.nd.nextPct >= 3) }));
rows.sort((a, b) => b.cov - a.cov);
for (const r of rows) console.log('    %-12s n=%-3d 覆盖%5.1f%%  命中%5.1f%%', r.t, r.n, r.cov, r.hit);

// ---------- 6) 日内型 ----------
console.log('\n[6] 次日盘中最高>=3%%: %s%% | 收盘>=3%%: %s%% | 均涨幅 %s%% | 最高>=5%%: %s%%',
  rate(auc, s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 3),
  rate(auc, s => s.nd.nextPct >= 3), avg(auc, s => s.nd.nextPct),
  rate(auc, s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 5));

// ---------- 7) prob 分档 ----------
console.log('\n[7] prob 分档（当日封板 resolved / 次日收盘+3% / 次日最高+3%）：');
let lowShare = 0;
for (const [lo, hi] of [[30, 40], [40, 50], [50, 60], [60, 101]]) {
  const b = auc.filter(s => s.prob >= lo && s.prob < hi);
  if (!b.length) { console.log('    prob %d-%d n=0', lo, hi); continue; }
  const daySeal = b.filter(s => s.resolved && s.resolved.limitUp).length;
  const ndClose = b.filter(s => s.nd.nextPct >= 3).length;
  const ndMax = b.filter(s => typeof s.nd.maxGain === 'number' && s.nd.maxGain >= 3).length;
  if (lo === 30) lowShare = +(b.length / auc.length * 100).toFixed(1);
  console.log('    prob %d-%d n=%d | 当日封板 %s%% | 次日收盘+3%% %s%% | 次日最高+3%% %s%%',
    lo, hi, b.length, (daySeal / b.length * 100).toFixed(1), (ndClose / b.length * 100).toFixed(1), (ndMax / b.length * 100).toFixed(1));
}
console.log('    prob<40 占比 %s%%（低概率段灌水检验：该段次日+3%% 若≈基线 12.8%% 即无排序价值）', lowShare);

// ---------- 8) 市值档（流通市值，当日快照近似；含有/无梯队拆分） ----------
const floatCap = new Map(snapRows.map(r => [r.code, r.floatCap]));
const capBucket = c => { if (!(c > 0)) return '缺数据'; if (c < 50e8) return '<50亿'; if (c < 100e8) return '50-100亿'; if (c < 300e8) return '100-300亿'; return '>=300亿'; };
console.log('\n[8] 流通市值档 × 次日+3%（快照近似，跨期股本变动未复权）：');
for (const bk of ['<50亿', '50-100亿', '100-300亿', '>=300亿', '缺数据']) {
  const b = auc.filter(s => capBucket(floatCap.get(s.code)) === bk);
  if (!b.length) continue;
  const wt = b.filter(hasTier), nt = b.filter(s => !hasTier(s));
  console.log('    %-9s n=%-3d +3%%=%s%% | 有梯队 n=%d %s%% | 无梯队 n=%d %s%%',
    bk, b.length, rate(b, s => s.nd.nextPct >= 3), wt.length, rate(wt, s => s.nd.nextPct >= 3), nt.length, rate(nt, s => s.nd.nextPct >= 3));
}
const caps = auc.map(s => floatCap.get(s.code)).filter(c => c > 0).sort((a, b) => a - b);
console.log('    市值中位 %s 亿（10-14 轮为 75 亿→后轮 98 亿，见历轮报告）', caps.length ? (caps[Math.floor(caps.length / 2)] / 1e8).toFixed(0) : 'n/a');

// ---------- 9) 今日 18 条（iq 权重重构后第 2 日样本） ----------
const today = st.signals.filter(s => s.type === 'auczt' && !s.void && s.date === '20261020');
const tRes = today.filter(s => s.resolved && typeof s.resolved.limitUp === 'boolean');
const seal = tRes.filter(s => s.resolved.limitUp).length;
console.log('\n[9] 10-20 当日 auczt n=%d（待回填，无 nd）| 当日封板(resolved) %s/%s = %s%%',
  today.length, seal, tRes.length, tRes.length ? (seal / tRes.length * 100).toFixed(1) : 'n/a');
const pb = { '>=55': 0, '45-55': 0, '40-45': 0, '<40': 0 };
for (const s of today) { if (s.prob >= 55) pb['>=55']++; else if (s.prob >= 45) pb['45-55']++; else if (s.prob >= 40) pb['40-45']++; else pb['<40']++; }
console.log('    prob 分布:', JSON.stringify(pb), '| 过 55 闸门（ZT_INFER_PUSH_PROB 严格大于）:', today.filter(s => s.prob > 55).length, '条');
const sealed = today.filter(s => s.resolved && s.resolved.limitUp), unsealed = today.filter(s => s.resolved && s.resolved.limitUp === false);
console.log('    封板组 prob 均=%s（n=%d）| 未封板组 prob 均=%s（n=%d）',
  avg(sealed, s => s.prob), sealed.length, avg(unsealed, s => s.prob), unsealed.length);

// ---------- 10) J1 触发条件 ----------
console.log('\n[10] J1（题材梯队加权）复检触发条件「有梯队 H2 n>=30」：H2 有梯队 n=%d → %s',
  h2.filter(hasTier).length, h2.filter(hasTier).length >= 30 ? '达到，可复检' : '未达，维持不接');

// ---------- 11) yier / lianban 健康 ----------
for (const ty of ['yier', 'lianban']) {
  const arr = st.signals.filter(s => s.type === ty && !s.void && s.nd && typeof s.nd.nextPct === 'number');
  const pend = st.signals.filter(s => s.type === ty && !s.void && !(s.nd && typeof s.nd.nextPct === 'number')).length;
  const envs = {};
  for (const L of ['普跌', '退潮', '普涨', '未知']) { const l = arr.filter(s => envOf(s) === L); envs[L] = l.length ? `${l.length}:${rate(l, s => s.nd.nextPct >= 3)}%` : '0'; }
  const ol = arr.filter(s => s.nd.oneLine === true).length;
  console.log('\n[11] %s n=%d（待回填 %d）+3%%=%s%% 涨停=%s%% 一字板=%d | 分层(次数:命中) %s',
    ty, arr.length, pend, rate(arr, s => s.nd.nextPct >= 3), rate(arr, s => s.nd.limitUp), ol, JSON.stringify(envs));
}
