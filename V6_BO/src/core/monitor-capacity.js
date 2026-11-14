'use strict';
const { quoteUseEligibility } = require('./quote-observation-view');
const MONITOR_CAPACITY = 220;
function heldCodes(accounts) {
  return [...new Set(Object.values(accounts || {}).flatMap(account =>
    Object.keys(account?.positions || {}).filter(code => /^\d{6}$/.test(code))))];
}
function monitorPlan(accounts, candidates, sectors, offset = 0) {
  const held = heldCodes(accounts);
  // Normal-sized portfolios retain their existing request order. Oversized
  // portfolios rotate a stable order, without increasing the provider budget.
  let ordered = held;
  let nextOffset = 0;
  if (held.length > MONITOR_CAPACITY) {
    const sorted = [...held].sort();
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset % sorted.length : 0;
    ordered = [...sorted.slice(start), ...sorted.slice(0, start)];
    nextOffset = (start + MONITOR_CAPACITY) % sorted.length;
  }
  const requested = new Set(ordered.slice(0, MONITOR_CAPACITY));
  const optional = new Set([
    ...(candidates || []).slice(0, 100).map(row => row?.code),
    ...(sectors || []).slice(0, 20).map(row => row?.leaderCode)
  ].filter(code => typeof code === 'string' && /^\d{6}$/.test(code)));
  const heldSet = new Set(held);
  for (const code of optional) if (requested.size < MONITOR_CAPACITY) requested.add(code);
  return { codes: [...requested], held, nextOffset,
    optional: [...optional].filter(code => !heldSet.has(code)) };
}
function monitorCoverage(plan, rows, now, status = 'observed', accounts = null) {
  const requested = new Set(plan.codes), held = new Set(accounts === null ? plan.held : heldCodes(accounts));
  const plannedHeld = new Set(plan.held);
  const heldChanged = held.size !== plannedHeld.size || [...held].some(code => !plannedHeld.has(code));
  const fresh = new Map();
  for (const row of rows || []) {
    if (!requested.has(row?.code) || !held.has(row.code)) continue;
    const use = quoteUseEligibility(row, now);
    if (use.canTrade) fresh.set(row.code, use.quoteAgeMs);
  }
  const heldRequested = plan.codes.filter(code => held.has(code)).length;
  return { basis: 'tick-return-snapshot', status, checkedAt: now, capacity: MONITOR_CAPACITY,
    requested: plan.codes.length, heldTotal: held.size, heldRequested,
    plannedHeldTotal: plannedHeld.size, heldChanged,
    heldDeferred: held.size - heldRequested, heldFresh: fresh.size,
    heldUncovered: held.size - fresh.size,
    heldCoveragePct: held.size ? +(fresh.size / held.size * 100).toFixed(2) : null,
    maxHeldQuoteAgeMs: fresh.size ? Math.max(...fresh.values()) : null,
    optionalTotal: plan.optional.length, optionalRequested: plan.optional.filter(code => requested.has(code)).length,
    optionalDeferred: plan.optional.filter(code => !requested.has(code)).length,
    capacityExceeded: held.size > MONITOR_CAPACITY,
    complete: status === 'observed' && !heldChanged && fresh.size === held.size };
}
module.exports = { MONITOR_CAPACITY, heldCodes, monitorPlan, monitorCoverage };
