'use strict';

// Exploratory same-minute comparison on the session feed's reconciled prices.
// Keep at most 21 observed days. A cold start has no historical reference.
const MINUTE = 60000;
const PRIOR_DAYS = 20;
const WINDOWS = [1, 5, 15];
const INDEX_CODES = new Set(['1.000001', '0.399001', '0.399006', '1.000688']);
const SOURCES = new Set(['tencent-index', 'sina-index']);
// Match the upstream session feed's clock domain before constructing a Date.
const validTime = at => Number.isSafeInteger(at) && at > 0 && at <= 8e15;
function validObservation(row, asOf) {
  return row && SOURCES.has(row.quoteSource) && Number.isFinite(row.price) && row.price > 0 &&
    validTime(row.quoteAt) && validTime(row.receivedAt) && row.quoteAt <= row.receivedAt && row.receivedAt <= asOf;
}
function uniqueIndices(rows) {
  const latest = new Map();
  if (!Array.isArray(rows)) return latest;
  for (const row of rows) {
    if (!INDEX_CODES.has(row?.code)) continue;
    latest.set(row.code, latest.has(row.code) ? null : row);
  }
  return latest;
}

function sessionMinute(at) {
  const minute = (Math.floor(at / MINUTE) + 480) % 1440;
  if (minute >= 570 && minute < 690 || minute >= 780 && minute < 897) return minute;
  return null;
}

function windowChange(points, endMinute, width) {
  const first = points.get(endMinute - width);
  const last = points.get(endMinute);
  if (!first || !last || first.quoteSource !== last.quoteSource) return null;
  for (let minute = endMinute - width + 1; minute < endMinute; minute++) {
    if (points.get(minute)?.quoteSource !== first.quoteSource) return null;
  }
  return {first, last, returnPct: (last.price / first.price - 1) * 100};
}

function createIndexWindowResearch({ investigate } = {}) {
  const days = new Map();
  let lastClock = 0;
  let active = [];
  function observe(feed, session, asOf) {
    if (!validTime(asOf) || asOf < lastClock) {
      days.clear();
      active = [];
      lastClock = 0;
      return;
    }
    lastClock = asOf;
    const day = new Date(asOf + 28800000).toISOString().slice(0, 10).replaceAll('-', '');
    const slot = sessionMinute(asOf);
    if (!session?.trading || session.day !== day || feed?.day !== day || slot === null) {
      active = [];
      return;
    }
    if (!days.has(day)) {
      days.set(day, new Map());
      if (days.size > PRIOR_DAYS + 1) days.delete(days.keys().next().value);
    }
    const current = days.get(day);
    const prior = [...days.entries()].slice(0, -1);
    const latest = uniqueIndices(feed.indices);
    active = active.filter(e => e.day === day && e.validUntil > asOf && latest.get(e.code)?.quoteSource === e.source);
    for (const code of INDEX_CODES) {
      if (!current.has(code)) current.set(code, new Map());
      const points = current.get(code);
      const row = latest.get(code);
      // A suppressed/conflicting quote or source switch disqualifies the
      // current minute. Do not retain a now-disputed detection.
      const saved = points.get(slot);
      if (saved && (!validObservation(row, asOf) || row.quoteSource !== saved.quoteSource ||
          row.quoteAt < saved.quoteAt || row.quoteAt === saved.quoteAt && row.price !== saved.price)) {
        points.set(slot, null);
        active = active.filter(e => e.code !== code);
        continue;
      }
      // Sample the first reconciled observation from seconds 0..9 of a
      // minute. The actual timestamps and span are retained on each clue.
      if (points.has(slot) || !validObservation(row, asOf) || asOf - row.quoteAt > 15000 ||
          Math.floor(row.quoteAt / MINUTE) !== Math.floor(asOf / MINUTE) || row.quoteAt % MINUTE >= 10000) continue;
      points.set(slot, {price:row.price, quoteAt:row.quoteAt, receivedAt:row.receivedAt, quoteSource:row.quoteSource});
      for (const width of WINDOWS) {
        const sample = windowChange(points, slot, width);
        if (!sample || !Number.isFinite(sample.returnPct)) continue;
        const comparable = [];
        for (const [date, data] of prior) {
          const reference = data.has(code) && windowChange(data.get(code), slot, width);
          if (reference && reference.last.quoteSource === row.quoteSource && Number.isFinite(reference.returnPct)) {
            comparable.push({date, baseAt:reference.first.quoteAt, basePrice:reference.first.price,
              quoteAt:reference.last.quoteAt, price:reference.last.price, returnPct:reference.returnPct});
          }
        }
        if (comparable.length < PRIOR_DAYS) continue;
        const historicalMaxAbsPct = Math.max(...comparable.map(p => Math.abs(p.returnPct)));
        if (Math.abs(sample.returnPct) <= historicalMaxAbsPct) continue;
        const event = {
          id: [day, code, slot, width, row.quoteSource].join('/'), day, code, source:row.quoteSource,
          windowMinutes:width, baseAt:sample.first.quoteAt, basePrice:sample.first.price,
          quoteAt:row.quoteAt, price:row.price, receivedAt:row.receivedAt, detectedAt:asOf,
          returnPct:sample.returnPct, historicalMaxAbsPct, referenceDays:comparable.length,
          validUntil: (Math.floor(row.quoteAt / MINUTE) + 1) * MINUTE,
          method:'same-minute-absolute-range-v1', references:comparable, status:'market-only', attribution:'unknown', canTrade:false, canNotify:false
        };
        // Optional cache research must not abort the market observation loop.
        // Give the investigator a detached copy, never the stored event.
        try {
          event.investigation = structuredClone(investigate?.(structuredClone(event)) ?? {status:'unavailable'});
        } catch {
          event.investigation = {status:'unavailable'};
        }
        active.push(event);
      }
    }
  }
  return {observe, view(asOf) {
    return {mode:'experimental-same-minute-range', priorDaysRequired:PRIOR_DAYS,
      priorDaysObserved:Math.max(0, days.size - 1),
      events:validTime(asOf) && asOf >= lastClock
        ? structuredClone(active.filter(e => e.detectedAt <= asOf && asOf < e.validUntil)) : [], canTrade:false};
  }};
}

// Only count original receipts already in the bounded application news cache.
// Co-occurrence does not identify a buyer or establish a cause.
function investigateKnownNews(event, news) {
  if (!news || news.evidenceIntake?.status === 'unknown') return {status:'unavailable'};
  const refs = new Set();
  let inspected = 0;
  for (const rows of [news.goodAll, news.badAll, news.neutralAll]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, 50)) {
      inspected++;
      const proof = row?.newsEvidence;
      if (!/^[a-f0-9]{64}$/.test(proof?.eventHash || '') ||
          ![row.publishedAt, row.receivedAt, proof.recordedAt].every(Number.isSafeInteger) ||
          row.publishedAt < event.baseAt || row.publishedAt > event.quoteAt ||
          row.publishedAt > row.receivedAt || row.receivedAt > event.detectedAt ||
          proof.recordedAt < row.publishedAt || proof.recordedAt > event.detectedAt) continue;
      refs.add(proof.eventHash);
    }
  }
  return {status:inspected ? 'cached-window-checked' : 'unavailable', inspected, evidenceHashes:[...refs]};
}
module.exports = {createIndexWindowResearch, investigateKnownNews};
