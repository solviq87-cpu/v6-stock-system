'use strict';

// CLS exposes its current up_pool, including labelled ST stocks. Its event time
// dates the pool membership/reason; it does not authenticate a quote timestamp.
const { requestResearchBytes, createResearchRequest, restrictionFields } = require('./research-curl-bytes');
const CLS_LIMIT_POOL_URL = 'https://x-quote.cls.cn/quote/index/up_down_analysis?app=CailianpressWeb&os=web&sv=8.4.6&type=up_pool&way=last_px&rever=1';
const MAX_ITEMS = 10000, MAX_BYTES = 2 * 1024 * 1024;
const FLAGS = Object.freeze({ researchOnly: true, canTrade: false, canNotify: false, canTrain: false, verifiedLive: false });
const fail = code => { throw Object.assign(new Error(code), { code }); };
const number = value => typeof value === 'number' && Number.isFinite(value) ? value :
  typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' ? value.trim() : '';
function date(value) {
  const raw = typeof value === 'string' ? value : '';
  const day = /^\d{8}$/.test(raw) ? raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) &&
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day ? day : null;
}
function receivedTime(value) {
  // Reception strings require an explicit zone and real civil date.
  if (typeof value === 'string' &&
      (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
       !date(value.slice(0,10)))) return null;
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isSafeInteger(time) && time > 0 && time < 8e15 ? time : null;
}
const chinaDay = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
function base(requestedDate, receivedAt) {
  return { ...FLAGS, source: 'cls', sourceUrl: CLS_LIMIT_POOL_URL, scope: 'provider-up-pool-including-st',
    status: 'invalid', items: [], tradeDate: null, sourceTradeDate: null, requestedDate, receivedAt,
    totalCount: null, fetchedCount: 0, uniqueCount: 0, complete: false, historicalDateSelectionSupported: false,
    quoteAt: null, quoteMode: 'dated-limit-up-pool', sourceTimeSemantics: 'provider-event-time-not-quote-time',
    coverage: 'provider-up-pool-only-not-all-a-shares', errors: [] };
}
function eventTime(value, receivedAt) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value) || !date(value.slice(0, 10)))
    fail('cls-event-time-invalid');
  const time = Date.parse(value.replace(' ', 'T') + '+08:00');
  if (!Number.isSafeInteger(time) || time > receivedAt) fail('cls-event-time-future');
  return time;
}
function normalizeClsLimitPool(json, { requestedDate, receivedAt } = {}) {
  const target = date(requestedDate), received = receivedTime(receivedAt), out = base(target, received);
  try {
    if (!target) fail('cls-requested-date-invalid');
    if (received === null) fail('cls-received-time-invalid');
    if (target > chinaDay(received)) fail('cls-requested-date-future');
    if (!json || json.code !== 200 || !Array.isArray(json.data)) fail('cls-provider-response-invalid');
    if (!json.data.length) fail('cls-empty-pool-date-unverified');
    if (json.data.length > MAX_ITEMS) fail('cls-pool-too-large');
    out.fetchedCount = json.data.length;
    const seen = new Set(), items = []; let total = null, sourceDate = null;
    for (const row of json.data) {
      if (!row || typeof row !== 'object' || typeof row.secu_code !== 'string' || !/^(sh|sz|bj)\d{6}$/.test(row.secu_code) || !text(row.secu_name)) fail('cls-item-identity-invalid');
      const code = row.secu_code.slice(2);
      if (seen.has(code)) fail('cls-duplicate-code');
      seen.add(code); out.uniqueCount = seen.size;
      if (!Number.isSafeInteger(row.num_stocks) || row.num_stocks < 1 || row.num_stocks > MAX_ITEMS || total !== null && total !== row.num_stocks)
        fail('cls-total-invalid');
      total = row.num_stocks; out.totalCount = total;
      const sourceEventAt = eventTime(row.time, received), tradeDate = row.time.slice(0, 10);
      if (sourceDate !== null && sourceDate !== tradeDate) fail('cls-mixed-trade-dates');
      sourceDate = tradeDate;
      if (row.plate != null && !Array.isArray(row.plate)) fail('cls-plate-invalid');
      const plateSeen=new Set();
      const plates = Array.from(row.plate || [],(plate,index) => {
        const code=text(plate?.secu_code),name=text(plate?.secu_name);
        if(!Object.hasOwn(row.plate,index)||!plate||!code||!name||plateSeen.has(code))fail('cls-plate-invalid');
        plateSeen.add(code);
        return {code,name};
      });
      const price = number(row.last_px), change = number(row.change), count = row.limit_up_days;
      const matched = tradeDate === target, reason = text(row.up_reason);
      items.push({ ...FLAGS, code, name: text(row.secu_name), exchange: row.secu_code.slice(0, 2), source: 'cls', src: 'cls',
        price: price !== null && price > 0 ? price : null, pct: null,
        nativeChange: change !== null && Math.abs(change) <= 1000000 ? change : null, changeUnit: 'unverified',
        limitUpCount: Number.isSafeInteger(count) && count > 0 ? count : null,
        sector: plates[0]?.name || '', plates, sectorTags: plates.map(plate => ({ ...plate, source: 'cls', type: 'provider-sector' })),
        sectorStatus: plates.length ? 'provider-reported' : 'unknown', reason, reasonSource: 'cls', reasonTradeDate: tradeDate,
        reasonDateStatus: matched ? 'matched' : 'date-mismatch', reasonStatus: reason ? 'provider-reported' : 'unknown',
        isST: row.is_st === 1 ? true : row.is_st === 0 ? false : null,
        requestedDate: target, tradeDate, sourceTradeDate: tradeDate, sourceDateStatus: matched ? 'matched' : 'date-mismatch',
        receivedAt: received, sourceEventAt, rawEventTime: row.time, quoteAt: null, quoteMode: 'dated-limit-up-pool',
        sourceTimeSemantics: 'provider-event-time-not-quote-time',
        metadata: { sourceUrl: CLS_LIMIT_POOL_URL, eventTimeField: 'time', rawEventTime: row.time, eventTimeZone: 'Asia/Shanghai',
          priceTimestampProvided: false, changeUnit: 'unverified', reasonField: 'up_reason', sectorField: 'plate' } });
    }
    if (total !== items.length) fail('cls-incomplete-pool');
    out.items = items; out.tradeDate = sourceDate; out.sourceTradeDate = sourceDate; out.complete = true;
    out.status = sourceDate === target ? 'available' : 'date-mismatch';
    out.sourceDateStatus = sourceDate === target ? 'matched' : 'date-mismatch';
    out.dateEvidence = 'all-provider-item-event-dates';
    out.reasonCount = items.filter(item => item.reason).length;
    out.sectorCount = items.filter(item => item.sectorTags.length).length;
    return out;
  } catch (error) {
    // Reject the entire pool: a valid prefix cannot establish complete coverage.
    out.errors.push({ code: error.code || 'cls-normalization-failed' }); return out;
  }
}
async function requestClsLimitPool(target, options) {
  if (target !== CLS_LIMIT_POOL_URL) fail('cls-endpoint-not-allowed');
  return requestResearchBytes(target, options);
}
async function fetchClsLimitPool(options = {}, dependencies = {}) {
  const { now = Date.now, requestJson = requestClsLimitPool, requestGovernor } = dependencies;
  const clock = typeof now === 'function' ? now : () => now;
  const sample = () => { try { return receivedTime(clock()); } catch { return null; } };
  const startedAt = sample(), requestedDate = date(options.date) || (options.date === undefined && startedAt !== null ? chinaDay(startedAt) : null);
  let out = base(requestedDate, startedAt);
  if (!requestedDate || startedAt === null) { out.errors.push({ code: !requestedDate ? 'cls-requested-date-invalid' : 'cls-received-time-invalid' }); return out; }
  if (requestedDate > chinaDay(startedAt)) { out.errors.push({ code: 'cls-requested-date-future' }); return out; }
  try {
    const request = createResearchRequest(requestJson, requestClsLimitPool, requestGovernor);
    const response = await request(CLS_LIMIT_POOL_URL, { maxBytes: MAX_BYTES, timeoutMs: 12000, processTimeoutMs: 13000,
      ...(options.signal ? { signal: options.signal } : {}) });
    const receivedAt = sample();
    if (receivedAt === null || receivedAt < startedAt) fail('cls-received-time-invalid');
    const raw = Buffer.isBuffer(response?.raw) ? response.raw : typeof response?.raw === 'string' ? Buffer.from(response.raw, 'utf8') : null;
    if (!raw || !raw.length) fail('cls-response-bytes-required');
    if (raw.length > MAX_BYTES) fail('response-too-large');
    let json; try { json = JSON.parse(raw.toString('utf8')); } catch { fail('cls-json-invalid'); }
    out = normalizeClsLimitPool(json, { requestedDate, receivedAt });
    out.requestCount = 1; return out;
  } catch (error) {
    const restriction = restrictionFields(error);
    out.status = error.code === 'MARKET_RESTRICTED' ? 'restricted' : 'unavailable';
    out.requestCount = 1; out.errors.push({ code: typeof error.code === 'string' ? error.code : 'cls-request-failed', ...restriction });
    if (error.code === 'MARKET_RESTRICTED') { out.httpStatus = restriction.status; out.resumeAt = restriction.resumeAt; }
    return out;
  }
}

module.exports = { CLS_LIMIT_POOL_URL, normalizeClsLimitPool, fetchClsLimitPool, fetchClsLimitUpPool: fetchClsLimitPool };
