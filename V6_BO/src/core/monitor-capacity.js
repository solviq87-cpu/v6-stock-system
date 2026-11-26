'use strict';
const { quoteUseEligibility } = require('./quote-observation-view');
const { createHash } = require('node:crypto');
const HELD_SCOPE='original-monitor-held-symbols-v1';
// Keep individual quote times inside the issuing process; the normal monitor
// status and runtime journal expose counts, never the extra symbol list.
const receipts=new WeakMap();
const heldPopulationHash=codes=>createHash('sha256').update(JSON.stringify([...new Set(codes)].sort())).digest('hex');
const MONITOR_CAPACITY = 220;
function heldCodes(accounts) {
  return [...new Set(Object.values(accounts || {}).flatMap(account =>
    Object.keys(account?.positions || {}).filter(code => /^\d{6}$/.test(code))))];
}
function monitorPlan(accounts, candidates, sectors, offset = 0, watch = []) {
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
  const strategyCodes = [...requested];
  // An optional watch may fill spare places once the existing strategy and
  // holding plan has been allocated. Its quotes are for observation only.
  for (const code of watch) if (requested.size < MONITOR_CAPACITY) requested.add(code);
  return { codes: [...requested], strategyCodes, held, nextOffset,
    watchRequested: watch.filter(code => requested.has(code)).length, watchTotal: watch.length,
    marketCodes: strategyCodes.filter(code => optional.has(code)),
    optional: [...optional].filter(code => !heldSet.has(code)) };
}
function monitorCoverage(plan, rows, now, status = 'observed', accounts = null) {
  const requested = new Set(plan.codes), held = new Set(accounts === null ? plan.held : heldCodes(accounts));
  const plannedHeld = new Set(plan.held);
  const heldChanged = held.size !== plannedHeld.size || [...held].some(code => !plannedHeld.has(code));
  const observed = new Map(), fresh = new Map(), conflicts=new Set();
  for (const row of rows || []) {
    if (!requested.has(row?.code) || !held.has(row.code)) continue;
    const use = quoteUseEligibility(row, now);
    const conflict=row.sourceConflict===true||row.conflict===true||row.evidenceStatus==='conflict'||row.quoteStatus==='conflict'||
      (row.source!=null&&row.quoteSource!=null&&row.source!==row.quoteSource)||
      (row.tradeDate!=null&&row.tradeDate!==use.tradeDate);
    const identity=JSON.stringify([row.price,use.quoteAt,use.receivedAt,use.quoteSource,use.mode,use.canTrade,conflict]);
    const prior=observed.get(row.code);
    if(conflict||prior&&prior.identity!==identity)conflicts.add(row.code);
    if(!prior)observed.set(row.code,{identity,use});
  }
  for(const [code,{use}] of observed)if(!conflicts.has(code)&&use.canTrade)fresh.set(code,use.quoteAgeMs);
  const heldRequested = plan.codes.filter(code => held.has(code)).length;
  const receipt={ basis: 'tick-return-snapshot', status, checkedAt: now, capacity: MONITOR_CAPACITY,
    requested: plan.codes.length, heldTotal: held.size, heldRequested,
    plannedHeldTotal: plannedHeld.size, heldChanged,
    heldDeferred: held.size - heldRequested, heldFresh: fresh.size, heldConflicting:conflicts.size,
    heldUncovered: held.size - fresh.size,
    heldCoveragePct: held.size ? +(fresh.size / held.size * 100).toFixed(2) : null,
    maxHeldQuoteAgeMs: fresh.size ? Math.max(...fresh.values()) : null,
    optionalTotal: plan.optional.length, optionalRequested: plan.optional.filter(code => requested.has(code)).length,
    optionalDeferred: plan.optional.filter(code => !requested.has(code)).length,
    capacityExceeded: held.size > MONITOR_CAPACITY,
    complete: status === 'observed' && !heldChanged && fresh.size === held.size };
  if(Number.isSafeInteger(now)&&now>0&&!heldChanged&&['observed','fetch-failed'].includes(status)){
    receipts.set(receipt,{status,checkedAt:now,populationHash:heldPopulationHash(held),expectedSymbols:held.size,
      requestedSymbols:heldRequested,conflictingSymbols:conflicts.size,quoteTimes:[...fresh.values()].map(age=>now-age)});
  }
  return receipt;
}
// A newly sampled minute must use an original in-process monitor receipt for
// the exact current holding population, not a reconstructed or stale result.
function monitorEvidenceForRuntime(receipt,accounts,now){
  const data=receipt&&receipts.get(receipt);
  if(!data||!Number.isSafeInteger(now)||now<data.checkedAt||now-data.checkedAt>15000||
      Math.floor((now+28800000)/86400000)!==Math.floor((data.checkedAt+28800000)/86400000))return null;
  const codes=heldCodes(accounts);
  if(data.expectedSymbols!==codes.length||data.populationHash!==heldPopulationHash(codes))return null;
  const freshSymbols=data.status==='observed'?data.quoteTimes.filter(at=>at<=now&&now-at<=15000).length:0;
  return {scope:HELD_SCOPE,status:data.status,checkedAt:data.checkedAt,observedAt:now,populationHash:data.populationHash,
    expectedSymbols:data.expectedSymbols,requestedSymbols:data.requestedSymbols,freshSymbols,conflictingSymbols:data.conflictingSymbols,verifiedExternal:false};
}
module.exports = { MONITOR_CAPACITY, heldCodes, monitorPlan, monitorCoverage, monitorEvidenceForRuntime, HELD_SCOPE, heldPopulationHash };
