'use strict';

// This is a disposable projection of an already-authorized research read. It
// never substitutes for the private archive or for the original risk engine.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REASONS = Object.freeze({
  DATA_QUALITY_GAP: '当前研究来源质量存在缺项，需要核对原回执',
  INSUFFICIENT_MATCHED_SAMPLES: '缺少同范围、同定义且已成熟的独立窗口',
  FACTOR_DISTRIBUTION_SHIFT: '同定义因子分布发生变化，需要复核适用环境',
  FACTOR_IC_DETERIORATION: '独立窗口因子关联下降，需要核对样本和环境',
  COST_PRESSURE: '原结算样本未通过所列假设成本压力'
});
const timestamp = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const FLAGS = Object.freeze({researchOnly: true, verifiedDecay: false, canTrade: false,
  canNotify: false, canApprove: false, productionWeightsChanged: false, writesAccount: false});
function missing(status = 'missing-research', asOf = null) {
  return {schemaVersion: 1, mode: 'fayo-research-governance-projection', status, asOf,
    sourceFingerprint: null, day: null, reasons: [], ...FLAGS};
}

function project(report, now) {
  const g = report?.governance;
  if (!timestamp(now) || report?.authority !== 'fayo-intelligence-research' ||
      report.schemaVersion !== 1 || !digest(report.fingerprint) ||
      report.canTrade !== false || report.canNotify !== false || report.productionWeightsChanged !== false ||
      !g || g.mode !== 'fayo-research-governance-readonly' || g.schemaVersion !== 1 ||
      !timestamp(g.asOf) || g.asOf > now || Date.parse(report.generatedAt) !== g.asOf ||
      g.canTrade !== false || g.canNotify !== false || g.canApprove !== false ||
      g.productionWeightsChanged !== false || g.writesAccount !== false || g.decay?.verifiedDecay !== false ||
      !/^\d{4}-\d{2}-\d{2}$/.test(report.day || '') || !Array.isArray(g.decay.reasons)) return null;
  // Only known reason codes cross into the risk view; notes, plan identities,
  // local paths, model coefficients and private source payloads stay out.
  const reasons = [...new Set(g.decay.reasons.map(row => row?.code))]
    .filter(code => Object.hasOwn(REASONS, code)).map(code => ({code, meaning: REASONS[code]}));
  return {schemaVersion: 1, mode: 'fayo-research-governance-projection',
    status: reasons.some(row => row.code !== 'INSUFFICIENT_MATCHED_SAMPLES') ? 'review-observed-unverified' : 'unknown',
    asOf: g.asOf, day: report.day, sourceFingerprint: report.fingerprint, reasons, ...FLAGS};
}

function createResearchGovernanceCache() {
  let latest = null;
  return {
    remember(report, {now = Date.now()} = {}) {
      const value = project(report, now);
      if (!value) { latest = null; return false; }
      // Concurrent older reads cannot replace a newer snapshot.
      if (!latest || value.asOf >= latest.asOf) latest = value;
      return true;
    },
    read({now = Date.now()} = {}) {
      if (!timestamp(now)) return missing('invalid-clock');
      if (!latest) return missing();
      if (latest.asOf > now) return missing('future-research');
      const value = structuredClone(latest);
      if (now - value.asOf > MAX_AGE_MS) value.status = 'stale-research';
      return value;
    }
  };
}

function strategyDecayFromProjection(value, {now = Date.now()} = {}) {
  const base = {status: 'unknown', estimate: null, verifiedDecay: false,
    reason: '没有足够的独立成熟样本及经校验的衰减检验，不能推断策略有效或失效',
    evidenceAsOf: null, sourceFingerprint: null, observations: []};
  if (!timestamp(now) || value?.schemaVersion !== 1 || value.mode !== 'fayo-research-governance-projection' ||
      !timestamp(value.asOf) || value.asOf > now || !digest(value.sourceFingerprint) ||
      Object.entries(FLAGS).some(([key, expected]) => value[key] !== expected) ||
      !['unknown', 'review-observed-unverified', 'stale-research'].includes(value.status) || !Array.isArray(value.reasons)) return base;
  const observations = value.reasons.filter(row => Object.hasOwn(REASONS, row?.code))
    .map(row => ({code: row.code, meaning: REASONS[row.code]}));
  const stale = now - value.asOf > MAX_AGE_MS || value.status === 'stale-research';
  return {...base, status: stale ? 'stale-research' : value.status,
    evidenceAsOf: value.asOf, sourceFingerprint: value.sourceFingerprint, observations,
    reason: stale ? '已读研究证据超过24小时，需重新读取研究中心；历史线索不代表当前风险' :
      observations.length ? observations.map(row => row.meaning).join('；') + '。这些是研究复核线索，未认证策略衰减。' : base.reason};
}

module.exports = {...createResearchGovernanceCache(), createResearchGovernanceCache,
  strategyDecayFromProjection, MAX_AGE_MS};
