'use strict';

// Read-only cross-sectional diagnostics. These states never alter strategy weights.
const crypto = require('node:crypto');
const pack = require('../../strategies/extended-factor-pack.json');
const { assessMarketShock } = require('./market-shock-learning-gate');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const STATUSES = ['valid', 'missing', 'invalid-value', 'missing-evidence', 'simulated', 'source-mismatch', 'invalid-time', 'future', 'stale'];

function clock(now) {
  if (!finite(now) || now <= 0) throw Error('诊断时钟无效');
}
function feedContract(feed) {
  if (!feed || !['imported', 'fixture', 'simulated'].includes(feed.source) || !text(feed.provider) || !text(feed.datasetId)) throw Error('因子来源协议无效');
  return { source: feed.source, provider: feed.provider, datasetId: feed.datasetId };
}
function policyContract(p) {
  if (!p || !Number.isSafeInteger(p.maxAgeMs) || p.maxAgeMs < 1 || p.maxAgeMs > 86400000 * 366 ||
      !Number.isSafeInteger(p.minValidSamples) || p.minValidSamples < 1 || p.minValidSamples > 500 ||
      !finite(p.minValidFraction) || p.minValidFraction <= 0 || p.minValidFraction > 1 ||
      !finite(p.maxMeanShift) || p.maxMeanShift <= 0 || p.maxMeanShift > 100) throw Error('冻结诊断门槛无效');
  return { maxAgeMs: p.maxAgeMs, minValidSamples: p.minValidSamples, minValidFraction: p.minValidFraction, maxMeanShift: p.maxMeanShift };
}
function definitions(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > pack.factors.length || new Set(ids).size !== ids.length) throw Error('因子ID无效或重复');
  return ids.map(id => {
    const factor = pack.factors.find(f => f.id === id);
    if (!factor) throw Error('未知V6因子ID');
    return { id: factor.id, field: factor.field, group: factor.group, label: factor.label };
  });
}
function normalizeSnapshot(input, factors, feed, now) {
  if (!input || input.schemaVersion !== 1 || hash(feedContract(input.feed)) !== hash(feed) ||
      !finite(input.asOf) || input.asOf <= 0 || input.asOf > now ||
      !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 500) throw Error('因子快照来源/时点/样本无效');
  const symbols = new Set();
  const rows = input.rows.map(row => {
    if (!row || typeof row.symbol !== 'string' || !/^\d{6}$/.test(row.symbol) || symbols.has(row.symbol)) throw Error('证券代码无效或重复');
    symbols.add(row.symbol);
    const values = {}, evidence = {};
    for (const f of factors) {
      // Keep only the declared fields; no account data or vendor payload is exported.
      const v = row[f.field];
      values[f.field] = v === undefined || v === null ? null : finite(v) ? v : 'invalid';
      const e = row.factorEvidence?.[f.field];
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        evidence[f.field] = {
          source: text(e.source) ? e.source : null,
          timestamp: finite(e.timestamp) ? e.timestamp : null,
          simulated: e.simulated === true || e.mode === 'simulation'
        };
      }
    }
    return { symbol: row.symbol, ...values, factorEvidence: evidence };
  });
  return { schemaVersion: 1, feed, asOf: input.asOf, rows };
}
function summarize(snapshot, factors, policy) {
  return factors.map(f => {
    const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
    const samples = [], validValues = [];
    for (const row of snapshot.rows) {
      const v = row[f.field], e = row.factorEvidence[f.field];
      let status;
      if (v === null) status = 'missing';
      else if (!finite(v) || v < 0 || v > 100) status = 'invalid-value';
      else if (!e) status = 'missing-evidence';
      else if (e.simulated) status = 'simulated';
      else if (e.source !== snapshot.feed.provider) status = 'source-mismatch';
      else if (!finite(e.timestamp) || e.timestamp <= 0) status = 'invalid-time';
      else if (e.timestamp > snapshot.asOf) status = 'future';
      else if (snapshot.asOf - e.timestamp > policy.maxAgeMs) status = 'stale';
      else status = 'valid';
      counts[status]++;
      samples.push({ symbol: row.symbol, status });
      if (status === 'valid') validValues.push(v);
    }
    return {
      factorId: f.id, sampleCount: snapshot.rows.length, validCount: counts.valid,
      validFraction: counts.valid / snapshot.rows.length, counts,
      meanScore: validValues.length ? validValues.reduce((a, b) => a + b, 0) / validValues.length : null,
      samples
    };
  });
}
function enough(s, p) { return s.validCount >= p.minValidSamples && s.validFraction >= p.minValidFraction; }
function freezeHealthBaseline(input, { now = Date.now() } = {}) {
  clock(now);
  if (!input || input.schemaVersion !== 1) throw Error('因子基线协议无效');
  const feed = feedContract(input.feed), factors = definitions(input.factorIds), policy = policyContract(input.policy);
  const baseline = normalizeSnapshot(input.baseline, factors, feed, now);
  const summaries = summarize(baseline, factors, policy);
  if (summaries.some(s => !enough(s, policy))) throw Error('基线有效样本或覆盖率不足');
  const payload = {
    schemaVersion: 1, mode: 'frozen-factor-health-baseline', feed,
    packVersion: pack.version, packFingerprint: hash(pack), factors, policy, baseline, summaries,
    frozenAt: now, canTrade: false, prospectiveCertified: false
  };
  return { ...payload, fingerprint: hash(payload) };
}
function verifyBaseline(frozen, now) {
  const { fingerprint, ...payload } = frozen || {};
  if (fingerprint !== hash(payload) || payload.mode !== 'frozen-factor-health-baseline' ||
      !finite(payload.frozenAt) || payload.frozenAt > now || payload.canTrade !== false || payload.prospectiveCertified !== false) throw Error('因子基线指纹或时点无效');
  const again = freezeHealthBaseline({ schemaVersion: 1, feed: payload.feed, factorIds: payload.factors?.map(f => f.id), policy: payload.policy, baseline: payload.baseline }, { now: payload.frozenAt });
  if (hash(again) !== hash(frozen)) throw Error('因子基线结构或版本变化');
  return payload;
}
function evaluateFactorHealth(frozen, input, { now = Date.now(), marketContext } = {}) {
  clock(now);
  const baseline = verifyBaseline(frozen, now);
  const current = normalizeSnapshot(input, baseline.factors, baseline.feed, now);
  if (current.asOf <= baseline.frozenAt) throw Error('诊断快照必须晚于冻结时点');
  const summaries = summarize(current, baseline.factors, baseline.policy);
  const factors = summaries.map((s, i) => {
    const b = baseline.summaries[i], sufficient = enough(s, baseline.policy);
    const meanShift = sufficient ? s.meanScore - b.meanScore : null;
    const reasons = [];
    if (s.validCount < baseline.policy.minValidSamples) reasons.push('insufficient-samples');
    if (s.validFraction < baseline.policy.minValidFraction) reasons.push('low-coverage');
    if (sufficient && Math.abs(meanShift) > baseline.policy.maxMeanShift) reasons.push('mean-shift');
    return { ...s, baselineMeanScore: b.meanScore, meanShift,
      status: !sufficient ? 'insufficient-data' : reasons.length ? 'watch' : 'within-thresholds', reasons };
  });
  const report = {
    schemaVersion: 1, mode: 'factor-health-diagnostic', asOf: current.asOf, generatedAt: now,
    baselineFingerprint: frozen.fingerprint, snapshotFingerprint: hash(current), feed: baseline.feed,
    packVersion: baseline.packVersion, packFingerprint: baseline.packFingerprint, policy: baseline.policy, factors,
    canTrade: false, verifiedLive: false, prospectiveCertified: false, weightsChanged: false,
    warning: '仅分数分布与输入质量诊断；不是收益衰减、IC、因果、晋级或交易认证。股票池变动也会造成均值变化。'
  };
  // Market context is optional and cannot edit frozen baselines, factor watch statuses or weights.
  if (marketContext !== undefined) report.learningGate = assessMarketShock(marketContext, { asOf: current.asOf });
  return report;
}
module.exports = { freezeHealthBaseline, evaluateFactorHealth };
