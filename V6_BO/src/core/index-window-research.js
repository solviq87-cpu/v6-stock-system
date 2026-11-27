'use strict';

// Exploratory same-minute comparison on the session feed's reconciled prices.
// Keep at most 21 observed days; optionally recover ended days from the original research journal.
const MINUTE = 60000;
const PRIOR_DAYS = 20;
const WINDOWS = [1, 5, 15];
const INDEX_CODES = new Set(['1.000001', '0.399001', '0.399006', '1.000688']);
const SOURCES = new Set(['tencent-index', 'sina-index']);
// Match the upstream session feed's clock domain before constructing a Date.
const validTime = at => Number.isSafeInteger(at) && at > 0 && at <= 8e15;
function validObservation(row, asOf) {
  return row && !['sourceConflict','conflict','simulated','synthetic','fixture','mock','imported','testSample'].some(k=>row[k]===true) &&
    row.quoteStatus!=='conflict'&&row.evidenceStatus!=='conflict'&&
    ![row.quoteMode,row.mode].some(v=>typeof v==='string'&&/simulat|synthetic|fixture|mock|imported|test-sample/i.test(v))&&
    (row.vendorQuoteAt==null||row.vendorQuoteAt===row.quoteAt)&&
    SOURCES.has(row.quoteSource) && Number.isFinite(row.price) && row.price > 0 &&
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

// Track one current research revision per index/window. An episode joins only
// adjacent qualified minutes from the same source and direction. This is not
// a trading signal, an alert lifecycle, or proof of the cause of a move.
function continuityRevision(event, previous, slot, abnormal) {
  const adjacent = previous?.status === 'abnormal' && previous.slot === slot - 1 &&
    previous.day === event.day && previous.source === event.source;
  if (!abnormal && !adjacent) return null;
  const direction = abnormal ? (event.returnPct > 0 ? 'up' : 'down') : previous.direction;
  const reversed = abnormal && adjacent && direction !== previous.direction;
  const continuing = adjacent && !reversed;
  let phase = 'started';
  if (!abnormal) phase = 'below-historical-range';
  else if (reversed) phase = 'reversed';
  else if (continuing) {
    const change = Math.abs(event.returnPct) - Math.abs(previous.returnPct);
    phase = Math.abs(change) <= 1e-10 ? 'steady' : change > 0 ? 'strengthening' : 'weakening';
  }
  return {
    episodeId: continuing ? previous.episodeId : event.id,
    previousEpisodeId: reversed ? previous.episodeId : null,
    revision: continuing ? previous.revision + 1 : 1,
    firstDetectedAt: continuing ? previous.firstDetectedAt : event.detectedAt,
    previousQuoteAt: adjacent ? previous.quoteAt : null,
    previousReturnPct: adjacent ? previous.returnPct : null,
    phase, status: abnormal ? 'abnormal' : 'ended', direction, slot,
    day:event.day, code:event.code, source:event.source, windowMinutes:event.windowMinutes,
    baseAt:event.baseAt, basePrice:event.basePrice, quoteAt:event.quoteAt, price:event.price,
    receivedAt:event.receivedAt, detectedAt:event.detectedAt, validUntil:event.validUntil,
    returnPct:event.returnPct, historicalMaxAbsPct:event.historicalMaxAbsPct,
    referenceDays:event.referenceDays, method:'adjacent-qualified-index-window-v1',
    attribution:'unknown', canTrade:false, canNotify:false
  };
}

function createIndexWindowResearch({ investigate, reviewInvestigation, historyRoot, clock=Date.now, canPersist, onHistoryError } = {}) {
  const days = new Map();
  let lastClock = 0;
  let active = [];
  const continuity = new Map(),dayHashes=new Map();
  const history=historyRoot?require('./index-window-history').createIndexDayHistory({root:historyRoot,clock,canPersist,onError:onHistoryError}):null;
  if(history){
    const restored=history.load();lastClock=restored.loadedAt;
    for(const data of restored.days){
      const codes=new Map();dayHashes.set(data.day,data.journalHash);
      for(const p of data.points){if(!codes.has(p.code))codes.set(p.code,new Map());codes.get(p.code).set(p.minute,p.observation?{...p.observation,historyHash:data.journalHash}:null);}
      days.set(data.day,codes);
    }
  }
  function sealEndedDays(asOf,day){
    if(!history)return;
    const minute=(Math.floor(asOf/MINUTE)+480)%1440;
    for(const [date,codes] of days){
      if(date>day||date===day&&minute<900||dayHashes.has(date))continue;
      if([...codes.values()].some(samples=>samples.size)){const hash=history.seal(date,()=>{
        const points=[];for(const [code,samples] of codes)for(const [minute,observation] of samples)points.push({code,minute,observation});return points;
      },asOf);if(typeof hash==='string'){dayHashes.set(date,hash);for(const samples of codes.values())for(const o of samples.values())if(o)o.historyHash=hash;}}
    }
  }
  function clearContinuity(code) {
    for (const width of WINDOWS) continuity.delete(code + '/' + width);
  }
  function observe(feed, session, asOf) {
    if (!validTime(asOf) || asOf < lastClock) {
      days.clear();dayHashes.clear();
      history?.invalidate();
      active = [];
      continuity.clear();
      lastClock = 0;
      return;
    }
    lastClock = asOf;
    const day = new Date(asOf + 28800000).toISOString().slice(0, 10).replaceAll('-', '');
    const slot = sessionMinute(asOf);
    sealEndedDays(asOf,day);
    if (!session?.trading || session.day !== day || feed?.day !== day || slot === null) {
      active = [];
      continuity.clear();
      return;
    }
    if (!days.has(day)) {
      days.set(day, new Map());
      if (days.size > PRIOR_DAYS + 1) days.delete(days.keys().next().value);
    }
    const current = days.get(day);
    const prior = [...days.entries()].slice(0, -1);
    const latest = uniqueIndices(feed.indices);
    for (const [key, previous] of continuity) {
      const row = latest.get(previous.code);
      if (previous.day !== day || slot - previous.slot > 1 ||
          !validObservation(row, asOf) || row.quoteSource !== previous.source ||
          row.quoteAt < previous.quoteAt || row.quoteAt === previous.quoteAt && row.price !== previous.price) {
        continuity.delete(key);
      }
    }
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
        clearContinuity(code);
        continue;
      }
      // Sample the first reconciled observation from seconds 0..9 of a
      // minute. The actual timestamps and span are retained on each clue.
      if (points.has(slot) || !validObservation(row, asOf) || asOf - row.quoteAt > 15000 ||
          Math.floor(row.quoteAt / MINUTE) !== Math.floor(asOf / MINUTE) || row.quoteAt % MINUTE >= 10000) continue;
      points.set(slot, {price:row.price, quoteAt:row.quoteAt, receivedAt:row.receivedAt, quoteSource:row.quoteSource});
      for (const width of WINDOWS) {
        const sample = windowChange(points, slot, width);
        const key = code + '/' + width;
        if (!sample || !Number.isFinite(sample.returnPct)) {
          continuity.delete(key);
          continue;
        }
        const comparable = [];
        for (const [date, data] of prior) {
          const reference = data.has(code) && windowChange(data.get(code), slot, width);
          if (reference && reference.last.quoteSource === row.quoteSource && Number.isFinite(reference.returnPct)) {
            comparable.push({date, baseAt:reference.first.quoteAt, basePrice:reference.first.price,
              quoteAt:reference.last.quoteAt, price:reference.last.price, returnPct:reference.returnPct,
              ...(reference.first.historyHash&&reference.first.historyHash===reference.last.historyHash?{archiveHash:reference.last.historyHash}:{})});
          }
        }
        if (comparable.length < PRIOR_DAYS) {
          continuity.delete(key);
          continue;
        }
        const historicalMaxAbsPct = Math.max(...comparable.map(p => Math.abs(p.returnPct)));
        const abnormal = Math.abs(sample.returnPct) > historicalMaxAbsPct;
        const event = {
          id: [day, code, slot, width, row.quoteSource].join('/'), day, code, source:row.quoteSource,
          windowMinutes:width, baseAt:sample.first.quoteAt, basePrice:sample.first.price,
          quoteAt:row.quoteAt, price:row.price, receivedAt:row.receivedAt, detectedAt:asOf,
          returnPct:sample.returnPct, historicalMaxAbsPct, referenceDays:comparable.length,
          validUntil: (Math.floor(row.quoteAt / MINUTE) + 1) * MINUTE,
          method:'same-minute-absolute-range-v1', references:comparable, status:'market-only', attribution:'unknown', canTrade:false, canNotify:false
        };
        const revision = continuityRevision(event, continuity.get(key), slot, abnormal);
        if (revision) continuity.set(key, revision);
        else continuity.delete(key);
        if (!abnormal) continue;
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
  function visibleEvent(event) {
    const copy = structuredClone(event);
    if (typeof reviewInvestigation !== 'function' || !copy.investigation?.evidenceHashes?.length) return copy;
    const priorCount = copy.investigation.evidenceHashes.length;
    try {
      copy.investigation = structuredClone(reviewInvestigation(structuredClone(copy)) ?? {status:'unavailable'});
    } catch {
      copy.investigation = {status:'unavailable'};
    }
    copy.investigation.initialEvidenceCount = priorCount;
    return copy;
  }
  return {observe, view(asOf) {
    return {mode:'experimental-same-minute-range', priorDaysRequired:PRIOR_DAYS,
      priorDaysObserved:validTime(asOf)&&asOf>=lastClock?Math.min(PRIOR_DAYS,[...days.keys()].filter(day=>day<new Date(asOf+28800000).toISOString().slice(0,10).replaceAll('-','')).length):0,
      ...(history?{history:history.status()}:{}),
      events:validTime(asOf) && asOf >= lastClock
        ? active.filter(e => e.detectedAt <= asOf && asOf < e.validUntil).map(visibleEvent) : [],
      continuity:validTime(asOf) && asOf >= lastClock
        ? structuredClone([...continuity.values()].filter(e => e.detectedAt <= asOf && asOf < e.validUntil)) : [], canTrade:false};
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
