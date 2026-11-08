'use strict';

// Read-only market-context gate. It can delay interpreting factor drift as a
// degradation signal; it NEVER edits weights, hides drawdowns or authorizes trades.
const DOMESTIC = ['shanghai', 'shenzhen', 'chinext'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const chinaDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
  new Date(Date.parse(s + 'T00:00:00Z')).toISOString().slice(0, 10) === s;

function assessMarketShock(context, {asOf, maxAgeMs = 90 * 60000} = {}) {
  if (!finite(asOf) || asOf <= 0 || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1 || maxAgeMs > 86400000) throw Error('市场联动评估时钟或时效门槛无效');
  const unknown = reason => ({schemaVersion: 1, mode: 'market-shock-learning-gate',
    status: 'unverified', regime: 'unknown', deferLearningUpdate: false,
    reason, evidenceStatus: 'unverified', weightsChanged: false,
    returnSamplesPreserved: true, riskMonitoringRequired: true,
    canTrade: false, forceMajeureVerified: false});
  if (!context || typeof context !== 'object' || Array.isArray(context) ||
      context.schemaVersion !== 1 || context.source !== 'imported' || context.simulated === true ||
      typeof context.provider !== 'string' || !context.provider.trim() || context.provider.length > 120)
    return unknown('market-context-source-unverified');
  if (!dateOK(context.tradeDate) || !finite(context.observedAt) ||
      context.observedAt <= 0 || context.observedAt > asOf ||
      chinaDay(asOf) !== context.tradeDate || chinaDay(context.observedAt) !== context.tradeDate ||
      asOf - context.observedAt > maxAgeMs)
    return unknown('market-context-time-invalid');
  if (!finite(context.coverage) || context.coverage < 0.8 || context.coverage > 1)
    return unknown('market-coverage-insufficient');
  const observed = row => row && typeof row === 'object' && !Array.isArray(row) &&
    row.source === context.provider && row.simulated !== true &&
    finite(row.observedAt) && row.observedAt > 0 &&
    row.observedAt <= context.observedAt &&
    context.observedAt - row.observedAt <= maxAgeMs &&
    chinaDay(row.observedAt) === context.tradeDate;
  const breadth = context.breadth;
  if (!observed(breadth) || !finite(breadth.upPct) || breadth.upPct < 0 || breadth.upPct > 100)
    return unknown('market-breadth-unverified');
  if (!context.indices || typeof context.indices !== 'object' || Array.isArray(context.indices))
    return unknown('domestic-indices-missing');
  const changes = {};
  for (const id of DOMESTIC) {
    const row = context.indices[id];
    if (row === undefined || row === null) continue;
    // An invalid supplied index cannot be selectively omitted to fake a shock.
    if (!observed(row) || !finite(row.changePct) || row.changePct < -100 || row.changePct > 100)
      return unknown('domestic-index-evidence-invalid');
    changes[id] = row.changePct;
  }
  if (Object.keys(changes).length < 2)
    return unknown('domestic-indices-insufficient');
  const steepDeclines = Object.values(changes).filter(v => v <= -3).length;
  const shock = steepDeclines >= 2 && breadth.upPct <= 25;
  return {schemaVersion: 1, mode: 'market-shock-learning-gate',
    status: 'observed-unverified', regime: shock ? 'systemic-selloff' : 'not-systemic-selloff',
    deferLearningUpdate: shock, reason: shock ? 'multi-index-selloff-with-weak-breadth' : 'shock-rule-not-met',
    evidenceStatus: 'imported-unverified', tradeDate: context.tradeDate,
    observedAt: context.observedAt, provider: context.provider,
    observedDomesticIndices: changes, steepDeclines, marketBreadthUpPct: breadth.upPct,
    coverage: context.coverage, thresholds: {indexDropPct: -3, minDecliningIndices: 2,
      maxBreadthUpPct: 25, minCoverage: 0.8},
    weightsChanged: false, returnSamplesPreserved: true, riskMonitoringRequired: true,
    canTrade: false, forceMajeureVerified: false};
}
module.exports = {assessMarketShock};
