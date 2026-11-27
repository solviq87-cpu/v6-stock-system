'use strict';

// Read-only market-context gate. It can delay interpreting factor drift as a
// degradation signal; it NEVER edits weights, hides drawdowns or authorizes trades.
const DOMESTIC = ['shanghai', 'shenzhen', 'chinext'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
// Epoch milliseconds must remain representable as four-digit China dates.
const clockOK = x => Number.isSafeInteger(x) && x > 0 && x <= 253402271999999;
const record = x => x !== null && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const INVALID = Symbol('invalid-own-evidence');
// Evidence comes from data fields, never inherited values or accessors.
const own = (o, k) => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return !d ? undefined : Object.hasOwn(d, 'value') ? d.value : INVALID;
};
const notSimulated = o => !Object.hasOwn(o, 'simulated') || own(o, 'simulated') === false;
const fields = (o, keys) => Object.fromEntries(keys.map(k => [k, own(o, k)]));
const chinaDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
  new Date(Date.parse(s + 'T00:00:00Z')).toISOString().slice(0, 10) === s;

function assessMarketShock(context, {asOf, maxAgeMs = 90 * 60000} = {}) {
  if (!clockOK(asOf) || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1 || maxAgeMs > 86400000) throw Error('市场联动评估时钟或时效门槛无效');
  const unknown = reason => ({schemaVersion: 1, mode: 'market-shock-learning-gate',
    status: 'unverified', regime: 'unknown', deferLearningUpdate: false,
    reason, evidenceStatus: 'unverified', weightsChanged: false,
    returnSamplesPreserved: true, riskMonitoringRequired: true,
    canTrade: false, forceMajeureVerified: false});
  if (!record(context) || !notSimulated(context)) return unknown('market-context-source-unverified');
  context = fields(context, ['schemaVersion', 'source', 'provider', 'tradeDate', 'observedAt', 'coverage', 'breadth', 'indices']);
  if (context.schemaVersion !== 1 || context.source !== 'imported' ||
      typeof context.provider !== 'string' || !context.provider.trim() || context.provider.length > 120)
    return unknown('market-context-source-unverified');
  if (!dateOK(context.tradeDate) || !clockOK(context.observedAt) ||
      context.observedAt > asOf ||
      chinaDay(asOf) !== context.tradeDate || chinaDay(context.observedAt) !== context.tradeDate ||
      asOf - context.observedAt > maxAgeMs)
    return unknown('market-context-time-invalid');
  if (!finite(context.coverage) || context.coverage < 0.8 || context.coverage > 1)
    return unknown('market-coverage-insufficient');
  const observed = (raw, metric) => {
    if (!record(raw) || !notSimulated(raw)) return null;
    const row = fields(raw, ['source', 'observedAt', metric]);
    // Compare the original row time with the decision clock, not only with
    // the aggregate receipt. Two individually valid lags must not add up.
    return row.source === context.provider && clockOK(row.observedAt) &&
      row.observedAt <= context.observedAt && asOf - row.observedAt <= maxAgeMs &&
      chinaDay(row.observedAt) === context.tradeDate ? row : null;
  };
  const breadth = observed(context.breadth, 'upPct');
  if (!breadth || !finite(breadth.upPct) || breadth.upPct < 0 || breadth.upPct > 100)
    return unknown('market-breadth-unverified');
  if (!record(context.indices)) return unknown('domestic-indices-missing');
  const changes = {}, seen = new Set();
  for (const id of DOMESTIC) {
    const raw = own(context.indices, id);
    if (raw === undefined || raw === null) continue;
    // An invalid supplied index cannot be selectively omitted to fake a shock.
    const row = observed(raw, 'changePct');
    if (!row || !finite(row.changePct) || row.changePct < -100 || row.changePct > 100)
      return unknown('domestic-index-evidence-invalid');
    if (seen.has(raw)) return unknown('domestic-index-evidence-duplicate');
    seen.add(raw);
    changes[id] = row.changePct;
  }
  const count = Object.keys(changes).length;
  if (count < 2) return unknown('domestic-indices-insufficient');
  const steepDeclines = Object.values(changes).filter(v => v <= -3).length;
  const shock = steepDeclines >= 2 && breadth.upPct <= 25;
  // Weak breadth + one confirmed decline + one missing index is not proof
  // that the fixed two-index shock rule was not met. Keep the regime unknown.
  if (!shock && breadth.upPct <= 25 && steepDeclines + DOMESTIC.length - count >= 2)
    return unknown('domestic-indices-shock-undetermined');
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
