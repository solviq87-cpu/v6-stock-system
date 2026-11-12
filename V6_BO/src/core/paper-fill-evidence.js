'use strict';
// Evidence accompanies a paper fill; it never grants execution permission.
const crypto = require('node:crypto');
const {aShareCalendarDate} = require('./a-share-calendar');
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8e15;
const label = value => value === null || typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const modes = new Set(['simulated', 'imported', 'public-live-unverified', 'unknown']);

function validateFillEvidence(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('成交报价证据格式无效');
  const {fingerprint: saved, ...payload} = value;
  if (saved !== fingerprint(payload) || payload.schemaVersion !== 1 ||
      !['research-manual', 'automatic-paper'].includes(payload.executionKind) ||
      !modes.has(payload.mode) || !label(payload.source) || !label(payload.provider) ||
      !timestamp(payload.executionAt) || !timestamp(payload.quoteAt) ||
      payload.quoteAt > payload.executionAt || payload.executionAt - payload.quoteAt > 180000 ||
      (payload.receivedAt !== null && (!timestamp(payload.receivedAt) ||
        payload.receivedAt < payload.quoteAt || payload.receivedAt > payload.executionAt)) ||
      !/^\d{6}$/.test(payload.symbol || '') ||
      payload.tradeDate !== aShareCalendarDate(payload.executionAt) ||
      payload.tradeDate !== aShareCalendarDate(payload.quoteAt) ||
      !Number.isFinite(payload.price) || payload.price <= 0 ||
      !Number.isFinite(payload.quotePrice) || payload.quotePrice <= 0 ||
      payload.volumeUnit !== 'shares' || !Number.isFinite(payload.volume) || payload.volume <= 0 ||
      payload.suspended !== false || payload.tradable !== true ||
      !Number.isFinite(payload.upperLimit) || !Number.isFinite(payload.lowerLimit) ||
      payload.lowerLimit <= 0 || payload.upperLimit <= payload.lowerLimit ||
      payload.price <= payload.lowerLimit || payload.price >= payload.upperLimit ||
      payload.verifiedLive !== false || payload.canTrade !== false) throw Error('成交报价证据完整性或时点校验失败');
  if (payload.source === 'simulated' && payload.mode !== 'simulated' ||
      payload.source === 'imported' && payload.mode !== 'imported') throw Error('成交报价证据模式与来源不一致');
  for (const key of ['symbol', 'tradeDate', 'price', 'executionAt']) {
    if (expected[key] !== undefined && payload[key] !== expected[key]) throw Error('成交报价证据与成交记录不一致');
  }
  return value;
}

function createFillEvidence(quote, {executionAt, executionKind, symbol, tradeDate, price} = {}) {
  // timestamp is the existing validated quote clock. Do not borrow a later clock.
  const quoteAt = quote?.quoteAt ?? quote?.timestamp;
  if (quote?.quoteAt != null && quote.quoteAt !== quote.timestamp) throw Error('报价原始时点字段冲突');
  const source = quote?.source ?? null;
  const provider = quote?.quoteSource ?? quote?.provider ?? null;
  if (quote?.quoteSource != null && quote?.provider != null && quote.quoteSource !== quote.provider) throw Error('报价来源字段冲突');
  const mode = quote?.mode ?? (source === 'simulated' ? 'simulated' : source === 'imported' ? 'imported' : provider ? 'public-live-unverified' : 'unknown');
  const payload = {schemaVersion: 1, executionKind, executionAt, quoteAt,
    receivedAt: quote?.receivedAt ?? null, source, provider, mode,
    symbol, tradeDate, price, quotePrice: quote?.price, volumeUnit: quote?.volumeUnit, volume: quote?.volume,
    upperLimit: quote?.upperLimit, lowerLimit: quote?.lowerLimit,
    suspended: quote?.suspended, tradable: quote?.tradable,
    // This is persisted research evidence, never a reusable execution approval.
    verifiedLive: false, canTrade: false};
  const value = {...payload, fingerprint: fingerprint(payload)};
  validateFillEvidence(value);
  return value;
}

function fillEvidenceOf(event) {
  if (event?.fillEvidence == null) return null;
  return validateFillEvidence(event.fillEvidence, {
    symbol: event.symbol, tradeDate: event.tradeDate ?? event.date,
    price: event.price, executionAt: event.timestamp ?? event.executionAt});
}

function executionTimeOf(event) {
  const evidence = fillEvidenceOf(event);
  const at = evidence?.executionAt ?? event?.timestamp ?? event?.executionAt;
  const date = event?.tradeDate ?? event?.date;
  return timestamp(at) && (!date || aShareCalendarDate(at) === date) ? at : null;
}

module.exports = {createFillEvidence, validateFillEvidence, fillEvidenceOf, executionTimeOf};
