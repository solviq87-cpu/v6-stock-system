'use strict';
/** Research projections only. This module never writes an account, parameter pack or trial ledger. */
const crypto = require('node:crypto');
const { scorecards } = require('./research-workspace-analytics');
const { SYSTEMS } = require('./independent-strategy-attribution');
const { assessGlobalTrialBudget } = require('./factor-global-trial-budget');
const { validateDataset, validateBacktestConfig } = require('./historical-validation');
const { ledgerBacktest } = require('../strategy/research-v2-position-ledger-backtest');
const { universeObservation } = require('./historical-universe');
const { assertUnadjustedExecutionPriceBasis } = require('./historical-execution-price-basis');
const { isTestSample } = require('../../public/nova/shortline/sample-quality.mjs');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const stamp = x => Number.isSafeInteger(x) && x >= 0 && x <= 8640000000000000 - 86400000;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const mean = xs => { if (!xs.length) return null; const sum = xs.reduce((a, b) => a + b, 0); return finite(sum) ? sum / xs.length : xs.reduce((a, b) => a + b / xs.length, 0); };
const variance = xs => { const m = mean(xs); return xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : null; };
const flags = { researchOnly: true, canTrade: false, canNotify: false, productionWeightsChanged: false, autoPromotion: false };
const report = fields => ({ schemaVersion: 1, ...fields, ...flags });
const unavailable = (reason, extra = {}) => report({ status: 'not-evaluated', reason, ...extra });
// Observation-purpose isolation is separate from the ORIGINAL production paper
// settlement source "V6 模拟成交". Never discard legitimate paper receipts merely
// because their display label contains the Chinese word for simulation.
function testObservation(row) {
  return !!row && (isTestSample(row) || row.simulated === true || row.synthetic === true || row.mock === true || row.sampleSet === 'demo' ||
    ['source', 'sampleSource', 'provider', 'provenance'].some(k => /synthetic|fixture|mock|demo|simulated|教学|测试|(?:^|[-_:/ .])test(?:$|[-_:/ .])/i.test(String(row[k] || ''))) ||
    /^合成验证股票/.test(row.name || ''));
}
const costs = ({ feeBps = 8, slippageBps = 10, sellTaxBps = 5 } = {}) => {
  if (![feeBps, slippageBps, sellTaxBps].every(x => finite(x) && x >= 0 && x <= 1000)) throw Error('费用/滑点必须为 0 至 1000 基点的有限数值');
  return { feeBps, slippageBps, sellTaxBps };
};
function distribution(values) {
  const xs = values.slice().sort((a, b) => a - b), wins = xs.filter(x => x > 0), losses = xs.filter(x => x < 0);
  const tailCount = xs.length ? Math.max(1, Math.ceil(xs.length * .05)) : 0;
  return { n: xs.length, mean: mean(xs), winRatePct: xs.length ? 100 * wins.length / xs.length : null,
    averageWin: mean(wins), averageLoss: mean(losses), payoff: wins.length && losses.length ? mean(wins) / -mean(losses) : null,
    lossCount: losses.length, flatCount: xs.filter(x => x === 0).length, minimum: xs[0] ?? null, maximum: xs.at(-1) ?? null,
    tailMean5Pct: mean(xs.slice(0, tailCount)), tailCount, units: 'percentage-points-per-observation' };
}

/** Public row contract: original verdict, explicit source/version/time/cost and a gated outcome.
 * The same candidate's executable paper outcome is available even for a rejected signal.
 * A rejected signal contributes cash (zero exposure), while unknown never becomes a rejection. */
function commonCohorts(rows, { asOf = Date.now(), horizon = 5 } = {}) {
  if (!Array.isArray(rows) || rows.length > 100000 || !stamp(asOf) || ![1, 5, 20, 60].includes(horizon)) throw Error('共同样本参数无效');
  const candidates = new Map(), exclusions = {};
  const skip = reason => { exclusions[reason] = (exclusions[reason] || 0) + 1; };
  for (const r of rows) {
    if (!r || !SYSTEMS.includes(r.system) || r.horizon !== horizon) { skip('other-system-or-horizon'); continue; }
    if (!/^\d{6}$/.test(r.symbol || '') || !date(r.signalDate) || !date(r.entryDate) || !date(r.exitDate) || r.entryDate <= r.signalDate || r.exitDate <= r.entryDate ||
        !['eastmoney', 'tencent', 'native-replay'].includes(r.provider) || r.priceBasis !== 'unadjusted' || typeof r.version !== 'string' || !r.version || r.version.length > 256 ||
        typeof r.regime !== 'string' || !r.regime || r.regime.length > 80 || !/^[a-f0-9]{64}$/.test(r.costFingerprint || '') || !/^[a-f0-9]{64}$/.test(r.scopeFingerprint || '') ||
        !stamp(r.signalAt) || !stamp(r.recordedAt) || !stamp(r.outcomeKnownAt) || r.signalAt > r.recordedAt ||
        new Date(r.signalAt + 28800000).toISOString().slice(0, 10) !== r.signalDate || r.signalAt < Date.parse(r.signalDate + 'T15:00:00+08:00') ||
        r.recordedAt >= Date.parse(r.entryDate + 'T09:30:00+08:00') || r.outcomeKnownAt < Date.parse(r.exitDate + 'T15:10:00+08:00')) { skip('invalid-time-source-or-contract'); continue; }
    if (Math.max(r.signalAt, r.recordedAt, r.outcomeKnownAt) > asOf) { skip('not-yet-known'); continue; }
    const key = JSON.stringify([r.symbol, r.signalDate, r.provider, r.scopeFingerprint, r.horizon]);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(r);
  }
  const groups = new Map();
  for (const candidate of candidates.values()) {
    const bySystem = new Map(); let ambiguous = false;
    for (const r of candidate) {
      const prior = bySystem.get(r.system);
      if (prior && hash(prior) !== hash(r)) ambiguous = true;
      else bySystem.set(r.system, r);
    }
    if (ambiguous) { skip('ambiguous-version-or-duplicate'); continue; }
    if (!SYSTEMS.every(s => bySystem.has(s))) { skip('missing-system'); continue; }
    const ordered = SYSTEMS.map(s => bySystem.get(s)), r = ordered[0];
    if (ordered.some(x => !['pass', 'fail'].includes(x.verdict))) { skip('unknown-verdict'); continue; }
    if (ordered.some(x => x.status !== 'paper-estimate' || !finite(x.netReturnPct) || !finite(x.priceReturnPct))) { skip('unverified-execution-or-outcome'); continue; }
    const signature = x => JSON.stringify([x.signalAt, x.entryDate, x.exitDate, x.regime, x.costFingerprint, x.scopeFingerprint, x.priceBasis]);
    if (ordered.some(x => signature(x) !== signature(r) || Math.abs(x.netReturnPct - r.netReturnPct) > 1e-8 || Math.abs(x.priceReturnPct - r.priceReturnPct) > 1e-8)) { skip('different-window-cost-or-environment'); continue; }
    const versions = Object.fromEntries(ordered.map(x => [x.system, x.version]));
    const key = hash([r.provider, r.regime, r.horizon, r.costFingerprint, r.scopeFingerprint, versions]);
    if (!groups.has(key)) groups.set(key, { id: key, provider: r.provider, regime: r.regime, horizon, versions,
      costFingerprint: r.costFingerprint, scopeFingerprint: r.scopeFingerprint, rows: [] });
    groups.get(key).rows.push({ symbol: r.symbol, signalDate: r.signalDate, entryDate: r.entryDate, exitDate: r.exitDate,
      outcomeKnownAt: Math.max(...ordered.map(x => x.outcomeKnownAt)), netReturnPct: r.netReturnPct, priceReturnPct: r.priceReturnPct,
      benchmarkReturnPct: ordered.every(x => finite(x.benchmarkReturnPct) && Math.abs(x.benchmarkReturnPct - r.benchmarkReturnPct) < 1e-8) ? r.benchmarkReturnPct : null,
      verdicts: Object.fromEntries(ordered.map(x => [x.system, x.verdict])), evidence: ordered.map(x => x.runId || x.evidenceId || null) });
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.signalDate.localeCompare(b.signalDate) || a.symbol.localeCompare(b.symbol));
  return { groups: [...groups.values()], exclusions, candidateCount: candidates.size, inputRows: rows.length, asOf, horizon };
}

function workspaceStatisticalRows(events, { asOf = Date.now(), ...feeOptions } = {}) {
  if (!Array.isArray(events) || events.length > 50000 || !stamp(asOf)) throw Error('统计事件输入无效');
  const fee = costs(feeOptions), valid = [], exclusions = { testEvents: 0, testBars: 0, testSystems: 0, testBenchmarks: 0 };
  for (const e of events) {
    if (e?.kind !== 'analysis' || !stamp(e.recordedAt) || !stamp(e.data?.asOf) || e.recordedAt > asOf || e.data.asOf > e.recordedAt || !Array.isArray(e.data.systems) || !Array.isArray(e.data.bars)) continue;
    if (testObservation(e) || testObservation(e.data)) { exclusions.testEvents++; continue; }
    const d = e.data, bars = d.bars.filter(b => { if (testObservation(b)) { exclusions.testBars++; return false; } return true; });
    const systems = d.systems.filter(s => { if (testObservation(s) || testObservation(d.nativeInputs?.[s.id])) { exclusions.testSystems++; return false; } return true; });
    let benchmarkSeries = d.benchmarkSeries;
    if (testObservation(benchmarkSeries)) { exclusions.testBenchmarks++; benchmarkSeries = null; }
    else if (benchmarkSeries?.bars) benchmarkSeries = { ...benchmarkSeries, bars: benchmarkSeries.bars.filter(b => {
      if (testObservation(b)) { exclusions.testBenchmarks++; return false; } return true;
    }) };
    valid.push({ ...e, data: { ...d, bars, systems, benchmarkSeries } });
  }
  const originals = new Map(valid.map(e => [e.hash, e]));
  // Use the existing scorecard's next-open, status, corporate-action and price-limit gates.
  // This projection asks what the candidate exposure would return; it does not alter the signal.
  const projected = valid.map(e => ({ ...e, data: { ...e.data, systems: e.data.systems.map(s => ({ ...s, verdict: 'pass' })) } }));
  const card = scorecards(projected, { asOf, ...fee });
  const scopeFingerprint = hash(['workspace-first-receipt', ...[...new Set(valid.map(e => e.data.symbol))].sort()]);
  const result = card.observations.map(o => {
    const event = originals.get(o.runId), d = event?.data, system = d?.systems.find(s => s.id === o.system);
    return { ...o, verdict: system?.verdict ?? 'unknown', version: system?.version, provider: d?.provider, priceBasis: d?.priceBasis,
      regime: d?.regime || 'unknown', signalAt: d?.asOf, recordedAt: event?.recordedAt,
      outcomeKnownAt: Math.max(o.entryOutcomeRecordedAt || 0, o.exitOutcomeRecordedAt || 0), costFingerprint: hash(fee), scopeFingerprint };
  });
  Object.defineProperty(result, 'sourceExclusions', { value: exclusions, enumerable: false });
  return result;
}
function researchSignalDays(events, { asOf = Date.now() } = {}) {
  if (!Array.isArray(events) || events.length > 50000 || !stamp(asOf)) throw Error('研究信号日输入无效');
  const days = new Set();
  for (const e of events) {
    const d = e?.data;
    if (e?.kind !== 'analysis' || testObservation(e) || testObservation(d) || !stamp(e.recordedAt) || e.recordedAt > asOf ||
        !stamp(d?.asOf) || d.asOf > e.recordedAt || !date(d.tradeDate) || d.schemaVersion !== 1 || d.researchOnly !== true || d.canTrade !== false ||
        d.priceBasis !== 'unadjusted' || !['tencent', 'eastmoney'].includes(d.provider) || !/^[a-f0-9]{64}$/.test(d.observationHash || '') ||
        new Date(d.asOf + 28800000).toISOString().slice(0, 10) !== d.tradeDate || !Array.isArray(d.bars)) continue;
    const closed = Date.parse(d.tradeDate + 'T15:10:00+08:00'), dayEnd = Date.parse(d.tradeDate + 'T23:59:59.999+08:00');
    // A later/holiday recalculation is not another research session. A late
    // first receipt cannot backfill the global trial budget's historical clock.
    if (e.recordedAt > dayEnd || d.asOf < closed) continue;
    if (d.bars.some(b => b?.date === d.tradeDate && !testObservation(b) && stamp(b.knownAt) && b.knownAt >= closed && b.knownAt <= d.asOf &&
        ['open', 'high', 'low', 'close'].every(k => finite(b[k]) && b[k] > 0) && b.high >= Math.max(b.open, b.close, b.low) &&
        b.low <= Math.min(b.open, b.close, b.high) && finite(b.volume) && b.volume >= 0)) days.add(d.tradeDate);
  }
  return [...days].sort();
}
function seriesFor(group, predicate) {
  const dates = new Map();
  for (const r of group.rows) {
    const key = [r.entryDate, r.exitDate].join('/');
    if (!dates.has(key)) dates.set(key, { entryDate: r.entryDate, exitDate: r.exitDate, returns: [] });
    dates.get(key).returns.push(predicate(r) ? r.netReturnPct : 0);
  }
  return [...dates.values()].map(x => ({ entryDate: x.entryDate, exitDate: x.exitDate, value: mean(x.returns) })).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}
function nonOverlapping(series) {
  const out = []; let end = '';
  for (const r of series) if (r.entryDate > end) { out.push(r); end = r.exitDate; }
  return out;
}
function strategyCompetition(rows, options = {}) {
  const common = commonCohorts(rows, options);
  const groups = common.groups.map(group => {
    const dates = new Set(group.rows.map(r => r.signalDate)), symbols = new Set(group.rows.map(r => r.symbol));
    const systems = SYSTEMS.map(system => {
      const selected = group.rows.filter(r => r.verdicts[system] === 'pass'), series = seriesFor(group, r => r.verdicts[system] === 'pass');
      return { system, commonSamples: group.rows.length, passed: selected.length, rejected: group.rows.length - selected.length,
        exposurePct: 100 * selected.length / group.rows.length, commonDateCount: series.length,
        meanNetReturnPct: mean(series.map(x => x.value)), selectedOutcome: distribution(selected.map(r => r.netReturnPct)),
        series, nonOverlappingPeriods: nonOverlapping(series).length };
    });
    const enough = group.rows.length >= 30 && dates.size >= 10 && group.regime !== 'unknown';
    const ordered = systems.slice().sort((a, b) => b.meanNetReturnPct - a.meanNetReturnPct || a.system.localeCompare(b.system));
    for (const system of systems) system.rank = enough ? 1 + ordered.filter(x => x.meanNetReturnPct > system.meanNetReturnPct).length : null;
    return { ...group, rows: undefined, commonSamples: group.rows.length, commonDates: dates.size, distinctSymbols: symbols.size,
      status: group.regime === 'unknown' ? 'unknown-environment' : enough ? 'descriptive-only' : 'insufficient-common-samples', systems,
      estimator: 'equal-candidate exposure then equal-window mean; rejected signal holds cash; shared mature denominator' };
  });
  return report({ status: groups.length ? 'research-only' : 'not-evaluated', groups, exclusions: common.exclusions,
    commonSamples: common.groups.reduce((n, g) => n + g.rows.length, 0), source: 'first-server-receipt-workspace-evidence', asOf: common.asOf,
    reason: groups.length ? null : '四策略缺少同版本、时点、成本、环境及已成熟可核验的共同样本',
    limitations: ['所有数值是共同候选的纸面暴露估计，不是账户净值', '未知不按失败或零收益填入；不同版本与环境分别比较', '重叠持有区间不构成独立收益观测，排名不触发生产调权'] });
}

function correlation(a, b) {
  const ma = mean(a), mb = mean(b), va = a.reduce((n, x) => n + (x - ma) ** 2, 0), vb = b.reduce((n, x) => n + (x - mb) ** 2, 0);
  return va > 0 && vb > 0 ? a.reduce((n, x, i) => n + (x - ma) * (b[i] - mb), 0) / Math.sqrt(va * vb) : null;
}
function fusionStudy(rows, options = {}) {
  const common = commonCohorts(rows, options);
  const groups = common.groups.map(g => {
    const masks = Object.fromEntries(SYSTEMS.map(s => [s, g.rows.map(r => Number(r.verdicts[s] === 'pass'))]));
    const pairs = [];
    for (let i = 0; i < SYSTEMS.length; i++) for (let j = i + 1; j < SYSTEMS.length; j++) {
      const a = SYSTEMS[i], b = SYSTEMS[j], joint = g.rows.filter(r => r.verdicts[a] === 'pass' && r.verdicts[b] === 'pass');
      const either = g.rows.filter(r => r.verdicts[a] === 'pass' || r.verdicts[b] === 'pass');
      pairs.push({ a, b, signalCorrelation: correlation(masks[a], masks[b]), returnCorrelation: correlation(
        masks[a].map((x, k) => x * g.rows[k].netReturnPct), masks[b].map((x, k) => x * g.rows[k].netReturnPct)),
        intersection: joint.length, union: either.length, jaccard: either.length ? joint.length / either.length : null,
        exclusiveA: g.rows.filter(r => r.verdicts[a] === 'pass' && r.verdicts[b] === 'fail').length,
        exclusiveB: g.rows.filter(r => r.verdicts[b] === 'pass' && r.verdicts[a] === 'fail').length,
        exclusiveAOutcome: distribution(g.rows.filter(r => r.verdicts[a] === 'pass' && r.verdicts[b] === 'fail').map(r => r.netReturnPct)),
        exclusiveBOutcome: distribution(g.rows.filter(r => r.verdicts[b] === 'pass' && r.verdicts[a] === 'fail').map(r => r.netReturnPct)) });
    }
    const votes = r => SYSTEMS.filter(s => r.verdicts[s] === 'pass').length;
    const models = [1, 2, 3, 4].map(minVotes => ({ id: `votes-${minVotes}`, members: SYSTEMS, minVotes,
      predicate: r => votes(r) >= minVotes }));
    for (const omitted of SYSTEMS) {
      const members = SYSTEMS.filter(s => s !== omitted);
      models.push({ id: `without-${omitted}`, members, minVotes: 2, predicate: r => members.filter(s => r.verdicts[s] === 'pass').length >= 2 });
    }
    const variants = models.map(({ predicate, ...m }) => {
      const series = seriesFor(g, predicate), selected = g.rows.filter(predicate);
      return { ...m, commonSamples: g.rows.length, passed: selected.length, meanNetReturnPct: mean(series.map(x => x.value)),
        outcome: distribution(selected.map(r => r.netReturnPct)), series };
    });
    const baseline = variants.find(x => x.id === 'votes-3');
    for (const v of variants) if (v.id.startsWith('without-')) v.deltaFromMajorityPct = v.meanNetReturnPct - baseline.meanNetReturnPct;
    return { id: g.id, regime: g.regime, versions: g.versions, commonSamples: g.rows.length, pairs, variants,
      voteHistogram: [0, 1, 2, 3, 4].map(count => ({ votes: count, n: g.rows.filter(r => votes(r) === count).length })) };
  });
  return report({ status: groups.length ? 'descriptive-only' : 'not-evaluated', groups, exclusions: common.exclusions,
    reason: groups.length ? null : '缺少四策略共同成熟样本', promotion: 'never',
    limitations: ['融合及消融使用相同候选与现金分母；不选择最优变体', '常数信号或收益的相关系数未知；重叠样本不用于显著性声明', '八种研究变体均须计入后续试验披露，不变更生产四策略'] });
}

// Bailey & López de Prado (2014), equations (2), (3): unannualized Sharpe.
// https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
function normalCDF(x) {
  const z = Math.abs(x), t = 1 / (1 + .2316419 * z);
  const p = 1 - Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t * (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
}
function inverseNormal(p) {
  if (!(p > 0 && p < 1)) throw Error('正态分位数参数无效');
  let lo = -9, hi = 9;
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (normalCDF(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function sharpe(xs) { const v = variance(xs), m = mean(xs); return finite(v) && v > 0 && finite(m) ? m / Math.sqrt(v) : null; }
function deflatedSharpe({ returns, trialSharpes, independentTrials, completeTrialHistory = false, independentObservations = false } = {}) {
  if (!Array.isArray(returns) || returns.length > 10000 || returns.some(x => !finite(x)) ||
      !Array.isArray(trialSharpes) || trialSharpes.length > 10000 || trialSharpes.some(x => !finite(x)) ||
      !Number.isSafeInteger(independentTrials) || independentTrials < 1 || independentTrials > 10000) throw Error('DSR 数值参数无效');
  if (!completeTrialHistory || !independentObservations || trialSharpes.length < independentTrials || returns.length < 30)
    return unavailable('需要完整试验收益、明确有效独立试验数及至少 30 个非重叠独立观测');
  const sr = sharpe(returns), m = mean(returns), m2 = mean(returns.map(x => (x - m) ** 2));
  if (sr === null || !(m2 > 0)) return unavailable('收益方差为零，Sharpe 与 DSR 未定义');
  const skew = mean(returns.map(x => (x - m) ** 3)) / m2 ** 1.5;
  const kurtosis = mean(returns.map(x => (x - m) ** 4)) / m2 ** 2;
  const trialVariance = variance(trialSharpes), gamma = .5772156649015329;
  if (independentTrials > 1 && !(finite(trialVariance) && trialVariance > 0)) return unavailable('多次试验 Sharpe 方差缺失或退化');
  const expectedMaximumSharpe = independentTrials === 1 ? 0 : Math.sqrt(trialVariance) *
    ((1 - gamma) * inverseNormal(1 - 1 / independentTrials) + gamma * inverseNormal(1 - 1 / (independentTrials * Math.E)));
  const denominator = 1 - skew * sr + (kurtosis - 1) / 4 * sr * sr;
  if (!(denominator > 0) || !finite(denominator)) return unavailable('非正态矩修正分母无效');
  const z = (sr - expectedMaximumSharpe) * Math.sqrt(returns.length - 1) / Math.sqrt(denominator);
  if (!finite(z)) return unavailable('DSR 数值范围超出有限浮点精度');
  return report({ status: 'evaluated', probability: normalCDF(z), z, observedSharpe: sr, expectedMaximumSharpe,
    observations: returns.length, independentTrials, disclosedTrials: trialSharpes.length, trialSharpeVariance: trialVariance,
    skewness: skew, kurtosis, momentEstimator: 'population-central-moments; sample-standard-deviation Sharpe',
    units: 'Sharpe per observation; returns may be decimals or percentage points consistently',
    reference: 'https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf',
    limitations: ['有效独立试验数是显式研究假设，不由保留下来的赢家推断', '期望最大值使用论文极值近似；小试验数近似误差更大', '此概率不是实盘成功概率或交易许可'] });
}
function combinations(n, k, from = 0, prefix = [], out = []) {
  if (!k) out.push(prefix); else for (let i = from; i <= n - k; i++) combinations(n, k - 1, i + 1, [...prefix, i], out);
  return out;
}
/** Bailey et al.: CSCV, all half-block train/test splits, OOS rank/(N+1), logit <= 0.
 * Exact ties use mid-ranks and average all tied IS winners, avoiding column-order bias. */
function probabilityOfBacktestOverfitting({ matrix, blocks = 8, completeTrialHistory = false, independentObservations = false } = {}) {
  if (!Array.isArray(matrix) || matrix.length > 10000 || !Number.isInteger(blocks) || blocks < 4 || blocks > 10 || blocks % 2 ||
      matrix.some(r => !Array.isArray(r) || r.length < 1 || r.length > 100 || r.some(x => !finite(x))) ||
      matrix.some(r => r.length !== matrix[0].length)) throw Error('PBO 共同收益矩阵无效');
  if (!completeTrialHistory || !independentObservations || matrix.length < blocks * 4 || matrix.length % blocks || matrix[0]?.length < 2)
    return unavailable('需要完整候选、非重叠同步收益及可等分为偶数区块的至少每块 4 个观测');
  const size = matrix.length / blocks, n = matrix[0].length, splits = combinations(blocks, blocks / 2), results = [];
  for (const split of splits) {
    const selected = new Set(split), inside = [], outside = [];
    matrix.forEach((r, i) => (selected.has(Math.floor(i / size)) ? inside : outside).push(r));
    const ins = Array.from({ length: n }, (_, j) => sharpe(inside.map(r => r[j])));
    const outs = Array.from({ length: n }, (_, j) => sharpe(outside.map(r => r[j])));
    if (ins.some(x => x === null) || outs.some(x => x === null)) return unavailable('至少一个分割中的候选收益方差为零', { totalSplits: splits.length, validSplits: results.length });
    const best = Math.max(...ins), winners = ins.flatMap((x, i) => Math.abs(x - best) <= 1e-12 ? [i] : []);
    const ranks = winners.map(i => {
      const less = outs.filter(x => x < outs[i] - 1e-12).length, equal = outs.filter(x => Math.abs(x - outs[i]) <= 1e-12).length;
      const rank = less + (equal + 1) / 2, w = rank / (n + 1);
      return { candidate: i, relativeRank: w, logit: Math.log(w / (1 - w)) };
    });
    results.push({ trainingBlocks: split, winners: ranks, failureFraction: mean(ranks.map(x => Number(x.logit <= 0))) });
  }
  return report({ status: 'evaluated', probability: mean(results.map(x => x.failureFraction)), blocks, observations: matrix.length,
    candidates: n, totalSplits: splits.length, splits: results, method: 'CSCV-all-combinations-Sharpe-midrank',
    reference: 'https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf',
    limitations: ['条件概率针对所披露的搜索空间；缺少被淘汰试验会低估选择风险', '输入必须是不重叠同期收益，不接受重叠标签冒充独立日收益'] });
}
function blockBootstrap(values, { seed = 20261126, blockLength = 5, replications = 500, confidence = .95 } = {}) {
  if (!Array.isArray(values) || values.length > 10000 || values.some(x => !finite(x)) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isInteger(blockLength) || blockLength < 1 || !Number.isInteger(replications) || replications < 100 || replications > 5000 || !finite(confidence) || confidence <= .5 || confidence >= 1)
    throw Error('区块 bootstrap 参数无效');
  if (values.length < 30 || blockLength * 2 > values.length) return unavailable('至少需要 30 个同期观测及两个完整区块');
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const estimates = [];
  for (let b = 0; b < replications; b++) {
    const sampled = [];
    while (sampled.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let j = 0; j < blockLength && sampled.length < values.length; j++) sampled.push(values[(start + j) % values.length]);
    }
    estimates.push(mean(sampled));
  }
  estimates.sort((a, b) => a - b);
  const q = p => { const at = (estimates.length - 1) * p, lo = Math.floor(at), weight = at - lo; return estimates[lo] * (1 - weight) + estimates[Math.ceil(at)] * weight; };
  return report({ status: 'evaluated', estimate: mean(values), interval: [q((1 - confidence) / 2), q((1 + confidence) / 2)],
    confidence, seed, blockLength, replications, observations: values.length, method: 'circular-moving-block-percentile',
    limitations: ['保留区块内依赖；区块长度为预先指定假设，置信区间不校正搜索选择', '结构变化、共同冲击与极少数尾部事件可能未被充分覆盖'] });
}

function tradeExpectation(rows = [], { asOf = Date.now() } = {}) {
  if (!Array.isArray(rows) || rows.length > 100000 || !stamp(asOf)) throw Error('成交分布输入无效');
  const accepted = [], seen = new Set(), excluded = {};
  const skip = reason => { excluded[reason] = (excluded[reason] || 0) + 1; };
  const identities = new Map(), conflicted = new Set();
  const identity = row => row?.manualDecision ? 'manual/' + row.manualDecision.reconciliationId : row?.paperSettlement ?
    [row.paperSettlement.accountId, row.paperSettlement.exitEventId].join('/') : null;
  for (const row of rows) {
    const key = identity(row); if (!key) continue;
    const value = row.sourceFingerprint;
    if (identities.has(key) && identities.get(key) !== value) conflicted.add(key); else identities.set(key, value);
  }
  for (const row of rows) {
    if (!row || ['demo', 'test'].includes(row.sampleSet) || row.quality === '演示样本' || row.blackSwan === true || row.extreme === true || row.replicable === false || row.repeatable === false) { skip('isolated-sample'); continue; }
    if (conflicted.has(identity(row))) { skip('conflicting-settlement'); continue; }
    if (row.manualDecision) {
      const p = row.manualDecision, hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
      if (row.source !== 'V6 本人人工执行账本' || p.brokerVerified !== false || !stamp(p.reconciledAt) || p.reconciledAt > asOf ||
          !hex(p.reconciliationId) || !hex(p.statementHash) || row.sourceFingerprint !== require('./research-workspace-store').digest(p) || !Array.isArray(p.fills) || !p.fills.length ||
          !Number.isFinite(Date.parse(row.createdAt)) || Date.parse(row.createdAt) < p.reconciledAt || Date.parse(row.createdAt) > asOf ||
          p.fills.some(f => !stamp(f.executedAt) || !stamp(f.recordedAt) || f.executedAt > f.recordedAt || f.recordedAt > p.reconciledAt || !hex(f.id) ||
            ![f.quantity, f.priceUnits, f.amountCents, f.feeCents].every(Number.isSafeInteger) || f.quantity <= 0 || f.priceUnits <= 0 || f.amountCents <= 0 || f.feeCents < 0 ||
            !['buy', 'sell'].includes(f.side) || Number((BigInt(f.quantity) * BigInt(f.priceUnits) + 50n) / 100n) !== f.amountCents) ||
          new Set(p.fills.map(f => f.id)).size !== p.fills.length) { skip('invalid-manual-reconciliation'); continue; }
      const buys = p.fills.filter(f => f.side === 'buy'), sells = p.fills.filter(f => f.side === 'sell'), sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
      let balance = 0, last = 0, sequence = true;
      for (const f of p.fills) { balance += f.side === 'buy' ? f.quantity : -f.quantity; if (balance < 0 || f.executedAt < last) sequence = false; last = f.executedAt; }
      const basis = sum(buys, 'amountCents') + sum(buys, 'feeCents'), net = sum(sells, 'amountCents') - sum(sells, 'feeCents') - basis;
      if (!buys.length || !sells.length || balance !== 0 || !sequence || sum(buys, 'quantity') !== sum(sells, 'quantity') ||
          sum(buys, 'amountCents') !== p.buyAmountCents || sum(sells, 'amountCents') !== p.sellAmountCents || sum(buys, 'feeCents') !== p.buyFeeCents || sum(sells, 'feeCents') !== p.sellFeeCents ||
          net !== p.netPnlCents || !(basis > 0) || !Number.isSafeInteger(basis) || !Number.isSafeInteger(net) || !/^\d{6}$/.test(row.code || '') ||
          row.shares !== sum(buys, 'quantity') || !finite(row.costBasis) || Math.abs(row.costBasis * 100 - basis) > .01 ||
          !finite(row.pnlAmount) || Math.abs(row.pnlAmount * 100 - net) > .01 || !finite(row.pnl) || Math.abs(row.pnl - 100 * net / basis) > .011) { skip('invalid-manual-reconciliation'); continue; }
      const key = 'manual/' + p.reconciliationId;
      if (seen.has(key)) { skip('duplicate-settlement'); continue; }
      seen.add(key); accepted.push({ key, source: 'reconciled-manual-import', net: 100 * net / basis, realizedCents: net, costBasisCents: basis, exitTimestamp: sells.at(-1).executedAt, symbol: row.code });
      continue;
    }
    const p = row.paperSettlement;
    if (!p || row.source !== 'V6 模拟成交' || row.sourceFingerprint !== hash(p)) { skip('no-verified-settlement-projection'); continue; }
    if (!stamp(p.exitTimestamp) || p.exitTimestamp > asOf || !Number.isFinite(Date.parse(row.createdAt)) || Date.parse(row.createdAt) < p.exitTimestamp || Date.parse(row.createdAt) > asOf) { skip('not-yet-known'); continue; }
    const key = [p.accountId, p.exitEventId].join('/');
    if (seen.has(key)) { skip('duplicate-settlement'); continue; }
    const ints = [p.exitQuantity, p.exitGrossCents, p.exitFeeCents, p.costBasisCents, p.realizedCents];
    if (!['pool', 'pre'].includes(p.accountId) || !p.exitEventId || !p.exitOrderId || !/^\d{6}$/.test(p.symbol || '') || !date(p.tradeDate) || p.tradeDate !== new Date(p.exitTimestamp + 28800000).toISOString().slice(0, 10) || !ints.every(Number.isSafeInteger) ||
        p.exitQuantity <= 0 || p.exitGrossCents <= 0 || p.exitFeeCents < 0 || p.costBasisCents <= 0 || !finite(p.exitPrice) || p.exitPrice <= 0 ||
        Math.abs(p.exitGrossCents - Math.round(p.exitQuantity * p.exitPrice * 100)) > 1 ||
        p.realizedCents !== p.exitGrossCents - p.exitFeeCents - p.costBasisCents || !Array.isArray(p.entryFills) || !p.entryFills.length ||
        p.entryFills.some(f => !f.eventId || !f.orderId || ![f.quantity, f.grossCents, f.costCents].every(Number.isSafeInteger) || f.quantity <= 0 || f.grossCents <= 0 || f.costCents < f.grossCents ||
          !finite(f.price) || f.price <= 0 || !stamp(f.time) || f.time >= p.exitTimestamp ||
          new Date(f.time + 28800000).toISOString().slice(0, 10) >= p.tradeDate || Math.abs(f.grossCents - Math.round(f.price * f.quantity * 100)) > 1) ||
        new Set(p.entryFills.map(f => f.eventId)).size !== p.entryFills.length ||
        p.entryFills.reduce((n, f) => n + f.quantity, 0) !== p.exitQuantity || p.entryFills.reduce((n, f) => n + f.costCents, 0) !== p.costBasisCents) { skip('invalid-settlement-reconciliation'); continue; }
    const net = 100 * p.realizedCents / p.costBasisCents;
    if (row.code !== p.symbol || row.shares !== p.exitQuantity || !finite(row.pnl) || Math.abs(row.pnl - net) > .011 ||
        !finite(row.pnlAmount) || Math.abs(row.pnlAmount * 100 - p.realizedCents) > .01 || !finite(row.costBasis) || Math.abs(row.costBasis * 100 - p.costBasisCents) > .01) { skip('inconsistent-projection'); continue; }
    seen.add(key); accepted.push({ key, source: 'verified-simulation-settlements', net, realizedCents: p.realizedCents, costBasisCents: p.costBasisCents, exitTimestamp: p.exitTimestamp, symbol: p.symbol });
  }
  const sources = [...new Set(accepted.map(r => r.source))];
  const summarize = entries => ({ ...distribution(entries.map(r => r.net)), realizedAmount: entries.reduce((n, r) => n + r.realizedCents, 0) / 100,
    costBasisAmount: entries.reduce((n, r) => n + r.costBasisCents, 0) / 100,
    weightedNetReturnPct: entries.length ? 100 * entries.reduce((n, r) => n + r.realizedCents, 0) / entries.reduce((n, r) => n + r.costBasisCents, 0) : null });
  // Manual declarations and authoritative simulation receipts retain separate populations.
  const homogeneous = sources.length <= 1 ? accepted : [];
  return report({ status: accepted.length ? 'descriptive-only' : 'not-evaluated', source: sources.length === 1 ? sources[0] : 'separate-settlement-sources',
    reason: accepted.length ? null : '尚无可核对费用、成本基数及结算回执的模拟成交', ...distribution(accepted.map(r => r.net)),
    ...summarize(homogeneous), n: accepted.length, totalVerifiedSettlements: accepted.length, groups: sources.map(source => ({ source, ...summarize(accepted.filter(r => r.source === source)) })),
    distinctSymbols: new Set(accepted.map(r => r.symbol)).size, excluded,
    brokerVerified: false, limitations: ['模拟结算、本人申报对账与信号纸面标签分源，不能合并为券商认证实盘业绩', '按结算事件去重；未平仓收益不填零', '聚合成交存在同股、同期及仓位依赖，不把逐笔数量当作独立样本'] });
}

/** Server-owned private paths only. No default guesses: the existing worker's
 * operator config owns cycle.modelDir/captureDir (the example path is not evidence).
 * Existing private JSON reader and GLOBAL archive gate are reused verbatim. */
function readEvolutionTrialInputs({ modelDir, captureDir, configFile, signalDays, asOf = Date.now() } = {}) {
  if (!stamp(asOf)) throw Error('试验档案读取时点无效');
  const fs = require('node:fs'), path = require('node:path'), { readJson } = require('./forward-tracking-store');
  const { safeNew } = require('../../scripts/factor-shadow-evolution');
  if (configFile) {
    const config = require('./factor-research-agent').validateConfig(readJson(configFile));
    modelDir = config.cycle.modelDir; captureDir = config.cycle.captureDir;
  }
  const packFingerprint = hash(require('../../strategies/extended-factor-pack.json'));
  if (!modelDir) return { ...unavailable('现有 factor agent 配置未提供 cycle.modelDir；示例目录不作为真实档案来源'), trialReports: [], signalDays: [], packFingerprint };
  safeNew(path.join(modelDir, '.evolution-read-guard'));
  if (captureDir) signalDays = require('./factor-maturity-manifest').discoverCaptures(captureDir, { now: asOf }).map(x => x.date);
  if (!Array.isArray(signalDays)) signalDays = [];
  const day = new Date(asOf + 28800000).toISOString().slice(0, 10);
  if (signalDays.some(d => !date(d) || d > day)) throw Error('试验研究日包含未来或无效日期');
  const names = fs.existsSync(modelDir) ? fs.readdirSync(modelDir).filter(n => /^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(n)) : [];
  if (names.length > 500) throw Error('试验档案超过 500 项');
  let bytes = 0;
  const trialReports = names.sort().map(name => {
    const file = safeNew(path.join(modelDir, name)); bytes += fs.statSync(file).size;
    if (bytes > 64 * 1024 * 1024) throw Error('在线试验档案总大小超过 64 MiB');
    const value = readJson(file), { fingerprint, ...payload } = value;
    if (hash(payload) !== fingerprint || name !== `shadow-${value.trainingEnd}-${fingerprint.slice(0, 12)}.json` || value.mode !== 'v6-factor-shadow-evolution-v1' ||
        value.canTrade !== false || value.productionWeightsChanged !== false) throw Error('原试验档案完整性或模式无效');
    return value;
  });
  let budget;
  try {
    budget = require('../../scripts/factor-shadow-worker').globalTrialBudget(modelDir, signalDays);
    if (hash(budget) !== hash(assessGlobalTrialBudget(trialReports, signalDays, packFingerprint))) throw Error('读取过程中试验档案发生变化');
  } catch (e) { budget = unavailable(e.message); }
  return report({ status: budget.status === 'not-evaluated' ? 'not-evaluated' : 'observed', trialReports, signalDays, packFingerprint, budget,
    source: 'existing-factor-shadow-worker-immutable-archives', archiveCount: trialReports.length,
    limitations: ['原 shadow 档案保留成功、失败和监控，不另建或重置试验账本', '旧档案没有首次落盘时间，保守审查所有现存试验；不可宣称历史时点已知',
      '现有档案的 IC 汇总不是共同净收益矩阵；缺全部 trial 收益时 DSR/PBO 不可评估'] });
}

function boundedHistory(history) {
  const ds = validateDataset(history); assertUnadjustedExecutionPriceBasis(history); validateBacktestConfig(history, ds.barsPerStock);
  if (ds.stocks > 20 || ds.barsPerStock > 600 || ds.stocks * ds.barsPerStock > 6000) throw Error('交互诊断最多 20 只、600 根且总计 6000 根历史');
  return ds;
}
function ledgerOptions(history) {
  const stocks = history.stocks.map(s => ({ ...s, bars: s.bars.map(b => {
    const open = Date.parse(b.date + 'T09:30:00+08:00');
    // Translate verified source fields into the EXISTING ledger's limit names.
    // Do not replace supplied ledger fields or infer IPO/no-limit execution.
    if (b.upperLimit === undefined && b.lowerLimit === undefined && stamp(b.limitKnownAt) && b.limitKnownAt <= open && b.noPriceLimit === false &&
        finite(b.limitUpPrice) && finite(b.limitReferencePrice) && finite(b.limitPct))
      return { ...b, upperLimit: b.limitUpPrice, lowerLimit: Math.round(b.limitReferencePrice * (1 - b.limitPct / 100) * 100) / 100 };
    return b;
  }) }));
  return { stocks, source: history.source, start: history.start ?? 27, end: history.end ?? history.stocks[0].bars.length - 1,
    initialCash: history.initialCash ?? 100000, topN: history.topN ?? 3, holdDays: history.holdDays ?? 1, ...costs(history),
    maxPositionPct: history.maxPositionPct ?? 100, stopLossPct: history.stopLossPct ?? null, feeSchedules: history.feeSchedules ?? null,
    riskPolicy: history.riskPolicy ?? null, universeHistory: history.universeHistory ?? null, settlements: history.settlements ?? null,
    maxDrawdownPausePct: history.maxDrawdownPausePct ?? null, maxDailyLossPausePct: history.maxDailyLossPausePct ?? null,
    maxParticipationPct: history.maxParticipationPct ?? null, minPriorTurnover: history.minPriorTurnover ?? null };
}
function executionEvidence(history) {
  if (['fixture', 'simulated'].includes(history.source)) return { status: 'synthetic-model-assumptions', verified: false };
  const start = history.start ?? 27, end = history.end ?? history.stocks[0].bars.length - 1;
  let missing = 0;
  for (const stock of history.stocks) for (const b of stock.bars.slice(start + 1, end + 1)) {
    const openAt = Date.parse(b.date + 'T09:30:00+08:00');
    const up = finite(b.limitReferencePrice) ? Math.round(b.limitReferencePrice * (1 + b.limitPct / 100) * 100) / 100 : null;
    if (!stamp(b.statusKnownAt) || b.statusKnownAt > openAt || ![b.suspended, b.tradable, b.isST].every(x => typeof x === 'boolean') ||
        !stamp(b.corporateActionKnownAt) || b.corporateActionKnownAt > openAt || !(b.corporateAction === false || b.corporateAction?.type === 'cash-and-shares') ||
        !stamp(b.limitKnownAt) || b.limitKnownAt > openAt || b.noPriceLimit !== false || !finite(b.limitReferencePrice) || b.limitReferencePrice <= 0 ||
        !finite(b.limitPct) || b.limitPct <= 0 || b.limitPct > 30 || !finite(b.limitUpPrice) || Math.abs(b.limitUpPrice - up) > .011) missing++;
  }
  return missing ? { status: 'not-evaluated', missingSessionMetadata: missing, reason: '开盘前状态、除权或涨跌停来源不足；不能把默认规则或未知公司行为当成可成交' } :
    { status: 'point-in-time-inputs-present', verified: false };
}
function ledgerSummary(id, result) {
  return { id, status: 'research-only', metrics: result.metrics, statistics: result.statistics, equity: result.equity,
    closedTrades: result.trades.length, openPositions: result.openPositions, filled: result.orders.filter(o => o.status === 'filled').length,
    blocked: result.orders.filter(o => o.status === 'blocked').length, orders: result.orders, warnings: result.warnings, assumptions: result.assumptions };
}
function benchmarkComparison(history, { frozenUniverse = history?.frozenUniverse, buyHold = history?.buyHold, indexProxy = history?.indexProxy } = {}) {
  if (!history) return unavailable('需要封存行情及同窗执行输入');
  boundedHistory(history);
  const options = ledgerOptions(history), dates = history.stocks[0].bars.map(b => b.date), signalDate = dates[options.start];
  const evidence = executionEvidence(history);
  const firstClose = Date.parse(signalDate + 'T15:00:00+08:00'), symbols = history.stocks.map(s => String(s.symbol || s.code));
  const membership = frozenUniverse && Array.isArray(frozenUniverse.symbols) && frozenUniverse.symbols.length &&
    new Set(frozenUniverse.symbols).size === frozenUniverse.symbols.length && frozenUniverse.symbols.every(s => symbols.includes(s)) &&
    stamp(frozenUniverse.knownAt) && frozenUniverse.knownAt <= firstClose && typeof frozenUniverse.source === 'string' && frozenUniverse.source.length > 0;
  const hold = (id, ids) => ({ ...ledgerSummary(id, ledgerBacktest({ ...options, holdDays: Math.max(1, options.end - options.start - 1),
    topN: ids.length, maxPositionPct: Math.min(options.maxPositionPct, 100 / ids.length), selectCandidates: (_, day) => day === options.start ? ids : [] })),
    targetUniverse: ids, targetWeightPct: 100 / ids.length, positionCapPct: Math.min(options.maxPositionPct, 100 / ids.length) });
  const entries = [ledgerSummary('cash', ledgerBacktest({ ...options, selectCandidates: () => [] }))];
  entries.push(membership && evidence.status !== 'not-evaluated' ? hold('frozen-equal-weight', frozenUniverse.symbols) : { id: 'frozen-equal-weight', ...unavailable(evidence.reason || '缺少窗口开始前冻结的股票池、来源及首次可知时间') });
  const declared = x => x && symbols.includes(x.symbol) && stamp(x.knownAt) && x.knownAt <= firstClose && typeof x.source === 'string' && x.source.length;
  entries.push(declared(buyHold) && evidence.status !== 'not-evaluated' ? hold('buy-and-hold', [buyHold.symbol]) : { id: 'buy-and-hold', ...unavailable(evidence.reason || '缺少事先声明的买入持有标的及时间') });
  const proxyStock = history.stocks.find(s => String(s.symbol || s.code) === indexProxy?.symbol);
  const proxyRules = indexProxy?.executionRules;
  const verifiedProxy = declared(indexProxy) && indexProxy.tradable === true && indexProxy.assetType === 'etf' &&
    proxyRules?.tPlus1 === true && proxyRules.lotSize === 100 && finite(proxyRules.limitPct) && proxyRules.limitPct === proxyStock?.limitPct &&
    proxyRules.feeFingerprint === hash(options.feeSchedules || costs(history)) && typeof proxyRules.source === 'string' && proxyRules.source.length > 0;
  entries.push(verifiedProxy && evidence.status !== 'not-evaluated' ? hold('index-proxy', [indexProxy.symbol]) :
    { id: 'index-proxy', ...unavailable('原始指数不能当可成交资产；需同池可交易指数 ETF、费用与规则证据') });
  return report({ status: 'research-only', entries, window: { signalDate, entryDate: dates[options.start + 1], endDate: dates[options.end] },
    costModel: { ...costs(history), feeSource: history.feeSchedules ? 'dated-fee-schedule' : 'proportional-per-side',
      feeSchedules: history.feeSchedules || null, feeFingerprint: hash(history.feeSchedules || costs(history)) }, scope: symbols, frozenUniverse: membership ? frozenUniverse : null, executionEvidence: evidence,
    engine: 'existing-research-v2-position-ledger-backtest', dataFingerprint: hash(history),
    limitations: ['次日开盘、整手、T+1、涨跌停、流动性、公司行为及账户风控均复用原研究账本',
      '等权为初始目标权重，整手与不可成交会留下现金；不按事后表现换股', '窗口末卖出受阻仍持仓估值，不伪造成交或扣成已结算收益', 'ETF 费用和限制必须由该工具原始输入提供；股票默认制度不构成 ETF 规则认证'] });
}

function sensitivityStudy(history, { scenarios } = {}) {
  if (!history) return unavailable('需要封存行情才可运行参数扰动');
  boundedHistory(history);
  const evidence = executionEvidence(history);
  if (evidence.status === 'not-evaluated') return unavailable(evidence.reason, { executionEvidence: evidence, variants: [], inspectedConfigurations: 0 });
  const base = ledgerOptions(history), pack = require('../../strategies/a-share-strategy-pack.json');
  const baselineFamily = pack.strategies[0]?.family || pack.strategies[0]?.name;
  const definitions = scenarios || [
    { id: 'baseline' }, { id: 'fees-2x', feeMultiplier: 2 }, { id: 'slippage-2x', slippageMultiplier: 2 },
    { id: 'delay-1', delay: 1 }, { id: 'delay-2', delay: 2 }, { id: 'holding-plus-1', holdDays: base.holdDays + 1 },
    { id: 'holding-plus-2', holdDays: base.holdDays + 2 }, { id: 'entry-50', minScore: 50 }, { id: 'entry-60', minScore: 60 },
    { id: 'exit-stop-5', stopLossPct: 5 }, { id: 'exit-stop-8', stopLossPct: 8 },
    { id: 'liquidity-1pct', maxParticipationPct: 1 }, { id: 'liquidity-5pct', maxParticipationPct: 5 },
    { id: 'weights-minus-20pct', family: baselineFamily, weightMultiplier: .8 }, { id: 'weights-plus-20pct', family: baselineFamily, weightMultiplier: 1.2 }
  ];
  if (!Array.isArray(definitions) || !definitions.length || definitions.length > 30 || new Set(definitions.map(s => s.id)).size !== definitions.length) throw Error('扰动列表为空、重复或超过 30 项');
  const allowed = new Set(['id', 'feeMultiplier', 'slippageMultiplier', 'delay', 'holdDays', 'minScore', 'stopLossPct', 'maxParticipationPct', 'minPriorTurnover', 'family', 'weightMultiplier']);
  for (const s of definitions) {
    if (!s || typeof s.id !== 'string' || !s.id || Object.keys(s).some(k => !allowed.has(k)) ||
      ['feeMultiplier', 'slippageMultiplier', 'weightMultiplier'].some(k => s[k] !== undefined && (!finite(s[k]) || s[k] < .1 || s[k] > 5)) ||
      s.delay !== undefined && (!Number.isInteger(s.delay) || s.delay < 0 || s.delay > 5) ||
      s.holdDays !== undefined && (!Number.isInteger(s.holdDays) || s.holdDays < 1 || s.holdDays > 60) ||
      ['minScore', 'stopLossPct', 'maxParticipationPct'].some(k => s[k] !== undefined && (!finite(s[k]) || s[k] <= 0 || s[k] > 100)) ||
      s.minPriorTurnover !== undefined && (!finite(s.minPriorTurnover) || s.minPriorTurnover < 0 || s.minPriorTurnover > 1e18) ||
      s.weightMultiplier !== undefined && !pack.strategies.some(p => (p.family || p.name) === s.family)) throw Error('扰动数值或模型家族无效');
  }
  const { historicalStock } = require('../strategy/historical-session');
  const { evaluateCandidate } = require('../strategy/research-v2-strategy-service');
  const { validateFeed } = require('../strategy/feed-quality');
  const variants = definitions.map(s => {
    const delay = s.delay || 0, strategies = pack.strategies.map(p => ({ ...p,
      strategyWeight: (p.strategyWeight ?? 1) * ((p.family || p.name) === s.family ? s.weightMultiplier ?? 1 : 1) }));
    const options = { ...base, feeBps: base.feeBps * (s.feeMultiplier || 1), sellTaxBps: base.sellTaxBps * (s.feeMultiplier || 1),
      slippageBps: base.slippageBps * (s.slippageMultiplier || 1), holdDays: s.holdDays ?? base.holdDays,
      feeSchedules: base.feeSchedules?.map(f => ({ ...f, feeBps: f.feeBps * (s.feeMultiplier || 1),
        minFee: f.minFee * (s.feeMultiplier || 1), sellTaxBps: f.sellTaxBps * (s.feeMultiplier || 1), transferBps: (f.transferBps || 0) * (s.feeMultiplier || 1) })) ?? null,
      stopLossPct: s.stopLossPct ?? base.stopLossPct, maxParticipationPct: s.maxParticipationPct ?? base.maxParticipationPct,
      minPriorTurnover: s.minPriorTurnover ?? base.minPriorTurnover,
      selectCandidates: (_, day) => {
        const observed = day - delay; if (observed < 27) return [];
        const now = Date.UTC(2020, 0, 1) + day * 86400000;
        return history.stocks.filter(stock => universeObservation(base.universeHistory, String(stock.symbol || stock.code), stock.bars[observed].date).eligible)
          .map(stock => historicalStock(stock, observed, history.source, now)).filter(stock => validateFeed(stock, { now, maxAgeMs: 86400000 }).usable)
          .map(stock => ({ symbol: stock.symbol, result: evaluateCandidate({ stock, strategies }) }))
          .filter(x => x.result.pass && x.result.finalScore >= (s.minScore ?? 0))
          .sort((a, b) => b.result.finalScore - a.result.finalScore || a.symbol.localeCompare(b.symbol)).map(x => x.symbol);
      } };
    const result = ledgerBacktest(options);
    return { ...ledgerSummary(s.id, result), perturbation: s, modelFingerprint: hash(strategies) };
  });
  const eligible = variants.filter(v => v.filled > 0), numbers = eligible.map(v => v.metrics.returnPct);
  return report({ status: eligible.length ? 'research-only' : 'not-evaluated', variants,
    reason: eligible.length ? null : '全部扰动均无通过原门禁的模拟成交，不能宣称稳健',
    robustness: { evaluatedVariants: variants.length, variantsWithFills: eligible.length, minimumReturnPct: numbers.length ? Math.min(...numbers) : null,
      maximumReturnPct: numbers.length ? Math.max(...numbers) : null, medianReturnPct: numbers.length ? numbers.slice().sort((a, b) => a - b)[Math.floor(numbers.length / 2)] : null,
      nonNegativeFraction: numbers.length ? numbers.filter(x => x >= 0).length / numbers.length : null,
      worstDrawdownPct: eligible.length ? Math.max(...eligible.map(v => v.metrics.maxDrawdownPct)) : null },
    inspectedConfigurations: variants.length, selection: 'all-predeclared-variants-no-winner-selection',
    engine: 'existing-ledger-and-native-evaluateCandidate', limitations: ['范围描述不等于稳健性证明，不选最优参数或修改生产权重',
      '敏感度检查本身暴露结果，必须作为候选试验计入研究披露', '延迟改变决策观察日，成交仍走次日开盘和既有全部门禁'] });
}

function overfittingStudy({ trialReports = [], signalDays = [], packFingerprint, trialReturns, independentTrials, completeTrialHistory = false, asOf = Date.now() } = {}) {
  if (!stamp(asOf)) throw Error('过拟合研究截止时间无效');
  let budget;
  try { budget = assessGlobalTrialBudget(trialReports, signalDays, packFingerprint); }
  catch (e) { budget = unavailable(e.message); }
  const missing = unavailable('需要全部历史尝试的同期非重叠收益矩阵、有效独立试验数及已消费试验披露');
  if (!trialReturns) return report({ status: 'not-evaluated', budget, dsr: missing, pbo: missing, bootstrap: missing });
  const { matrix, dates, intervals, outcomeKnownAt, trialFingerprints, selectedColumn = 0, blocks = 8 } = trialReturns;
  const cutoff = new Date(asOf + 28800000).toISOString().slice(0, 10);
  if (!Array.isArray(matrix) || !Array.isArray(dates) || matrix.length !== dates.length || !Array.isArray(intervals) || intervals.length !== matrix.length ||
      !Array.isArray(outcomeKnownAt) || outcomeKnownAt.length !== matrix.length || outcomeKnownAt.some((t, i) => !stamp(t) || t > asOf || t < Date.parse(dates[i] + 'T15:10:00+08:00')) ||
      dates.some((d, i) => !date(d) || d > cutoff || i > 0 && d <= dates[i - 1]) || intervals.some((r, i) => !date(r?.entryDate) || !date(r?.exitDate) || r.entryDate >= r.exitDate || r.exitDate !== dates[i] || i > 0 && r.entryDate <= intervals[i - 1].exitDate) ||
      !Number.isInteger(selectedColumn) || selectedColumn < 0 || !matrix.length || selectedColumn >= matrix[0]?.length) return report({ status: 'not-evaluated', budget, dsr: missing, pbo: missing, bootstrap: missing });
  const inspected = trialReports.filter(r => ['shadow-updated', 'shadow-retained', 'paused-market-shock'].includes(r.status)).map(r => r.fingerprint);
  if (!Array.isArray(trialFingerprints) || trialFingerprints.length !== matrix[0].length || trialFingerprints.length !== inspected.length ||
      new Set(trialFingerprints).size !== trialFingerprints.length || trialFingerprints.some(f => !/^[a-f0-9]{64}$/.test(f || '') || !inspected.includes(f)))
    return report({ status: 'not-evaluated', budget, dsr: missing, pbo: missing, bootstrap: missing, reason: '共同收益列必须逐个对应所有已消费试验，不能遗漏失败候选或混入未披露变体' });
  const pbo = probabilityOfBacktestOverfitting({ matrix, blocks, completeTrialHistory, independentObservations: true });
  const sharpes = matrix[0].map((_, c) => sharpe(matrix.map(r => r[c])));
  if (sharpes.some(x => x === null) || !Number.isInteger(independentTrials) || budget.status === 'not-evaluated' || !completeTrialHistory || matrix[0].length < (budget.allTimeTrialCount || 0))
    return report({ status: 'not-evaluated', budget, dsr: missing, pbo: unavailable('全局试验记录或完整候选披露无法核对'), bootstrap: missing });
  const values = matrix.map(r => r[selectedColumn]);
  return report({ status: 'research-only', budget, dsr: deflatedSharpe({ returns: values, trialSharpes: sharpes, independentTrials, completeTrialHistory, independentObservations: true }),
    pbo, bootstrap: blockBootstrap(values) });
}

function buildEvolutionStatistics({ archive = {}, events = [], history = null, asOf = Date.now(), trialReports = [], packFingerprint = null, trialInputs = null, options = {} } = {}) {
  if (!stamp(asOf)) throw Error('统计截至时点无效');
  const settings = { asOf, horizon: options.horizon ?? 5, ...costs(options) };
  const rows = options.rows || workspaceStatisticalRows(events, settings), common = commonCohorts(rows, settings);
  const paper = common.groups.map(g => ({ id: g.id, regime: g.regime, versions: g.versions, ...distribution(g.rows.map(r => r.netReturnPct)) }));
  const signalDays = researchSignalDays(events, { asOf });
  return report({ status: 'research-only', asOf, competition: strategyCompetition(rows, settings), fusion: fusionStudy(rows, settings),
    expectation: { ...flags, settlements: tradeExpectation(archive.scope === 'demo' ? [] : archive.rows || archive.trades || [], { asOf }),
      paperSignals: report({ status: paper.length ? 'descriptive-only' : 'not-evaluated', source: 'mature-common-candidate-labels', groups: paper,
        meaning: '候选纸面净成本收益，包含被拒绝机会；不与结算收益相加' }) },
    benchmarks: options.diagnostics?.benchmarks || unavailable('运行诊断以复用原账本比较同窗现金、指数代理、冻结等权和买入持有'),
    robustness: options.diagnostics?.robustness || unavailable('运行诊断以执行有界参数、权重、时延、成本及流动性扰动'),
    overfitting: overfittingStudy({ trialReports: trialInputs?.trialReports || trialReports, signalDays: trialInputs?.signalDays || signalDays,
      packFingerprint: trialInputs?.packFingerprint || packFingerprint, ...options.overfitting, asOf }),
    diagnostics: options.diagnostics || unavailable('尚未运行或持久化因果及指标路径诊断'),
    inputSummary: { source: 'workspace-first-server-receipt', events: events.length, rows: rows.length, commonCandidates: common.groups.reduce((n, g) => n + g.rows.length, 0),
      sourceExclusions: rows.sourceExclusions || null, historyAvailable: !!history, costModel: costs(options) } });
}
function diagnosticInputsFromEvents(events, history, { asOf = Date.now() } = {}) {
  if (!Array.isArray(events) || events.length > 50000 || !stamp(asOf)) throw Error('原生诊断档案输入无效');
  const snapshots = {}, pythonEvidence = {}, seen = new Set(), exclusions = { testEvents: 0, testNativeEvidence: 0 };
  if (!history?.stocks) return { snapshots, pythonEvidence, source: 'first-server-receipt-native-inputs', nativeEvidenceCount: 0, exclusions };
  const allowed = new Set(history.stocks.flatMap(s => s.bars.map(b => String(s.symbol || s.code) + '/' + b.date)));
  const runs = events.filter(e => e?.kind === 'analysis' && stamp(e.recordedAt) && e.recordedAt <= asOf && stamp(e.data?.asOf) && e.data.asOf <= e.recordedAt)
    .sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);
  for (const e of runs) {
    if (testObservation(e) || testObservation(e.data)) { exclusions.testEvents++; continue; }
    const d = e.data, key = d.symbol + '/' + d.tradeDate;
    if (!allowed.has(key) || seen.has(key) || (history.provider && d.provider !== history.provider) || d.priceBasis !== 'unadjusted') continue;
    seen.add(key);
    const input = d.nativeInputs || {}, context = { symbol: d.symbol, observedThrough: d.tradeDate, knownAt: e.recordedAt };
    const valid = x => {
      if (testObservation(x)) { exclusions.testNativeEvidence++; return false; }
      return x && x.symbol === d.symbol && x.date === d.tradeDate && stamp(x.knownAt) && x.knownAt <= Math.min(asOf, e.recordedAt, d.asOf);
    };
    if (valid(input.fourteen)) {
      for (const field of ['sector', 'auction', 'profitRatio']) if (input.fourteen[field] !== undefined) context[field] = structuredClone(input.fourteen[field]);
      for (const field of ['name', 'floatCap']) if (input.fourteen.stock?.[field] !== undefined) context[field] = input.fourteen.stock[field];
    }
    if (valid(input.gpt)) { context.gptSnapshot = structuredClone(input.gpt.scores); context.gptSnapshotObservedThrough = d.tradeDate; context.market = structuredClone(input.gpt.market || {}); }
    if (Object.keys(context).length > 3) snapshots[key] = context;
    if (valid(input.python)) pythonEvidence[key] = { ...structuredClone(input.python), knownAt: e.recordedAt };
  }
  return { snapshots, pythonEvidence, source: 'first-server-receipt-native-inputs', nativeEvidenceCount: Object.keys(snapshots).length + Object.keys(pythonEvidence).length, exclusions };
}
async function runEvolutionDiagnostics({ history, snapshots = {}, pythonEvidence = {}, announcements = [], labels = [], cutoff, asOf = Date.now(), options = {} } = {}) {
  if (!stamp(asOf)) throw Error('诊断截至时点无效');
  if (!history) return unavailable('缺少封存历史，未执行模型或生成替代行情');
  boundedHistory(history);
  if (history.asOf > new Date(asOf + 28800000).toISOString().slice(0, 10)) return unavailable('历史行情晚于诊断查询时点');
  const { nativeCausalDiagnostics, indicatorPathDiagnostics } = require('./research-causal-diagnostics');
  const causal = nativeCausalDiagnostics({ history, snapshots, pythonEvidence, announcements, labels, cutoff: cutoff || history.stocks[0].bars.at(-2)?.date });
  await new Promise(resolve => setImmediate(resolve));
  const indicators = history.stocks.map(s => ({ symbol: String(s.symbol || s.code), ...indicatorPathDiagnostics(s.bars, options.indicators) }));
  const benchmarks = benchmarkComparison(history, options.benchmarks);
  await new Promise(resolve => setImmediate(resolve));
  const robustness = sensitivityStudy(history, options.sensitivity);
  return report({ status: causal.status === 'fail' || indicators.some(x => x.status === 'fail') ? 'fail' : 'research-only', asOf,
    dataFingerprint: hash(history), causal, indicators, benchmarks, robustness, inspectedConfigurations: robustness.inspectedConfigurations || 0 });
}
module.exports = { buildEvolutionStatistics, runEvolutionDiagnostics, workspaceStatisticalRows, commonCohorts, strategyCompetition,
  fusionStudy, deflatedSharpe, probabilityOfBacktestOverfitting, blockBootstrap, tradeExpectation, benchmarkComparison, sensitivityStudy, overfittingStudy, readEvolutionTrialInputs, diagnosticInputsFromEvents, researchSignalDays };
