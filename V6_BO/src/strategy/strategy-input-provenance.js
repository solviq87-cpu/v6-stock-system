'use strict';

/**
 * Read-only diagnostic for default-derived strategy inputs.
 * Does not alter normalization, scoring, order placement, or account state.
 * Absence of a direct raw score is not proof that a derived score is invalid;
 * it is a provenance gap requiring review before real-time use.
 */
const DIRECT = Object.freeze({
  trendScore: ['trendScore', '趋势评分'],
  relativeStrengthScore: ['relativeStrength', 'relativeStrengthScore', '相对强度'],
  capitalScore: ['capitalScore', '资金评分', 'moneyFlowScore'],
  positionScore: ['positionScore', '位置评分'],
  riskScore: ['riskScore', '风险评分'],
  volumeScore: ['volumeScore', '量能评分'],
  momentumScore: ['momentumScore', '动量评分'],
  closeStrengthScore: ['closeStrengthScore', '收盘强度'],
  turnoverQualityScore: ['turnoverQualityScore', '换手质量'],
  breakoutScore: ['breakoutScore', '突破评分'],
  maAlignmentScore: ['maAlignmentScore', '均线评分'],
  fundFlowScore: ['fundFlowScore', '资金强度'],
  liquidityScore: ['liquidityScore', '流动性评分'],
  oversoldScore: ['oversoldScore', '超跌评分'],
  reversalScore: ['reversalScore', '反转评分']
});
const isObserved = value => value !== null && value !== undefined &&
  typeof value !== 'boolean' && !(typeof value === 'string' && value.trim() === '') &&
  Number.isFinite(Number(value));
function auditStrategyInputProvenance(raw = {}) {
  const stock = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fields = {};
  for (const [field, aliases] of Object.entries(DIRECT)) {
    const key = aliases.find(k => Object.prototype.hasOwnProperty.call(stock, k) && isObserved(stock[k]));
    fields[field] = key ? { status: 'raw_observed', sourceField: key } :
      { status: 'default_or_derived', sourceField: null };
  }
  const missing = Object.entries(fields).filter(([,v]) => v.status !== 'raw_observed').map(([k]) => k);
  return { fields, rawObserved: Object.keys(fields).length - missing.length,
    total: Object.keys(fields).length, missingDirectEvidence: missing,
    note: '只读原始字段来源诊断；派生字段需要独立数据血缘证明，不能将默认值当作已观测数据' };
}
module.exports = { auditStrategyInputProvenance };
