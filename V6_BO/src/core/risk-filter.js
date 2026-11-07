'use strict';
/**
 * 统一风险/可交易性过滤。默认“保守拒绝”：明确命中任一硬风险即不通过。
 */
function normalizeCode(v){return String(v||'').trim();}
function filterCandidate(c={}, options={}) {
  const reasons=[];
  if (c.isST || c.isDelisting) reasons.push('ST/退市风险');
  if (c.suspended) reasons.push('停牌');
  if (c.limitUpLocked && !options.allowLimitUpLocked) reasons.push('涨停封死，无法按常规策略成交');
  if (Number(c.avgTurnover||0) < Number(options.minTurnover||0)) reasons.push('流动性不足');
  if (Number(c.riskScore||0) > Number(options.maxRiskScore??75)) reasons.push('综合风险过高');
  return {pass:reasons.length===0, code:normalizeCode(c.code), reasons};
}
module.exports={filterCandidate};
