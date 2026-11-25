'use strict';

// Read-only projection of already collected daily funds. The request must never
// turn an absent history, an unknown amount or reception time into market data.
const LIMIT = 200;
const finite = value => typeof value === 'number' && Number.isFinite(value);
function dayOf(value) {
  if (typeof value !== 'string') return null;
  const day = value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const at = Date.parse(day + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day ? day : null;
}
function boundedText(value, max = 120) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function observedAt(value, now) {
  return Number.isSafeInteger(value) && value > 0 && value <= now ? value : null;
}
function expectedWindow(day, days, isTradingDay) {
  if (typeof isTradingDay !== 'function') return [];
  const result = [];
  let cursor = day;
  for (let n = 0; n < 70 && result.length < days; n++) {
    let open;
    try { open = isTradingDay(cursor); } catch { return []; }
    if (typeof open !== 'boolean' || (n === 0 && !open)) return [];
    if (open) result.unshift(cursor);
    cursor = new Date(Date.parse(cursor + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  }
  return result.length === days ? result : [];
}

function commandSelectionContext(state, {day: rawDay, days = 5, now = Date.now(), isTradingDay} = {}) {
  const day = dayOf(rawDay);
  if (!day || !Number.isSafeInteger(now) || now <= 0 || !Number.isInteger(days) || days < 1 || days > 10)
    return {ok: false, status: 'invalid-request', error: '交易日无效，资金窗口须为 1–10 个交易日。'};
  if (day > new Date(now + 28800000).toISOString().slice(0, 10))
    return {ok: false, status: 'future-day', error: '不能读取未来交易日的选股依据。'};
  const expectedDays = expectedWindow(day, days, isTradingDay);
  const original = Array.isArray(state?.candidatePool) ? state.candidatePool : [];
  const allCodes = [...new Set(original.map(row => row?.code).filter(code => /^\d{6}$/.test(code || '')))];
  const codes = allCodes.slice(0, LIMIT), flowHistory = Object.create(null);
  let complete = 0, rejectedRecords = 0;
  for (const code of codes) {
    const history = state?.fundDays instanceof Map ? state.fundDays.get(code) : null;
    const projected = [];
    for (const row of Array.isArray(history) ? history : []) {
      const date = dayOf(row?.date), knownAt = observedAt(row?.retrievedAt, now);
      const conflict = row?.tradeDate != null && row.tradeDate !== '' && dayOf(row.tradeDate) !== date;
      // The provider supplies a daily date even when its intraday timestamp is
      // unknown. Keep the two separate; never borrow the stock's price time.
      if (!date || date > day || conflict || !knownAt || knownAt < Date.parse(date + 'T00:00:00+08:00') ||
          ['synthetic', 'fixture', 'mock', 'simulated'].some(key => row?.[key] === true)) {
        rejectedRecords++; continue;
      }
      const source = boundedText(row.source || row.upstream), method = boundedText(row.fundsMethod);
      const unit = boundedText(row.fundsUnit || row.unit, 12);
      const sourceTimestamp = row.sourceTimestamp == null ? null : observedAt(row.sourceTimestamp, knownAt);
      if (!source || /synthetic|fixture|mock|demo/i.test(source) || method !== 'vendor-order-size-estimate' || unit !== 'CNY' ||
          (row.sourceTimestamp != null && (!sourceTimestamp || new Date(sourceTimestamp + 28800000).toISOString().slice(0, 10) !== date))) { rejectedRecords++; continue; }
      projected.push({date, main: finite(row.main) ? row.main : null, source, fundsMethod: method, unit,
        retrievedAt: knownAt, knownAt, sourceTimestamp, canTrade: false});
    }
    // Do not deduplicate contradictory same-day records: the consumer rejects
    // ambiguous windows instead of choosing whichever amount happens to sort first.
    projected.sort((a, b) => a.date.localeCompare(b.date));
    flowHistory[code] = projected.filter(row => !expectedDays.length || row.date >= expectedDays[0]).slice(-24);
    if (expectedDays.length && expectedDays.every(date => {
      const matches = projected.filter(row => row.date === date);
      return matches.length === 1 && finite(matches[0].main);
    }) && new Set(projected.filter(row => expectedDays.includes(row.date)).map(row => row.source)).size === 1) complete++;
  }
  return {ok: true, status: expectedDays.length ? 'observed' : 'missing-calendar', day, days, expectedDays, flowHistory,
    coverage: {scope: 'existing-candidate-pool', total: allCodes.length, returned: codes.length, complete,
      missing: codes.length - complete, truncated: codes.length < allCodes.length, rejectedRecords},
    note: expectedDays.length ? '仅投影已采集候选的逐日资金回执；不触发采集。' : '缺少覆盖此窗口的交易日历，无法核对连续交易日。',
    canTrade: false};
}

module.exports = {commandSelectionContext};
