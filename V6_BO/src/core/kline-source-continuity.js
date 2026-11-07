'use strict';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

function indexBars(bars, source) {
  if (!Array.isArray(bars)) throw new Error(`${source} K线必须是数组`);
  const indexed = new Map();
  for (const bar of bars) {
    if (!bar || !validDate(bar.date)) throw new Error(`${source} K线日期无效`);
    if (indexed.has(bar.date)) throw new Error(`${source} 存在重复交易日: ${bar.date}`);
    if (![bar.open, bar.high, bar.low, bar.close].every(finite) ||
        [bar.open, bar.high, bar.low, bar.close].some(price => price <= 0) ||
        bar.high < Math.max(bar.open, bar.close, bar.low) ||
        bar.low > Math.min(bar.open, bar.close)) {
      throw new Error(`${source} K线价格关系无效: ${bar.date}`);
    }
    if (!Number.isSafeInteger(bar.volume) || bar.volume < 0) throw new Error(`${source} K线成交量无效: ${bar.date}`);
    indexed.set(bar.date, bar);
  }
  return indexed;
}

/**
 * Audits continuity when a historical K-line feed changes provider.
 * expectedDates must come from the exchange trading calendar, never weekdays guessed locally.
 * It deliberately refuses silent provider mixing when price basis diverges.
 */
function auditKlineSourceContinuity({ primaryBars, fallbackBars, expectedDates, primaryName = 'primary', fallbackName = 'fallback', maxCloseDivergencePct = 1 } = {}) {
  if (!Array.isArray(expectedDates) || expectedDates.length === 0 || !expectedDates.every(validDate)) {
    throw new Error('必须提供有效的交易所预期交易日期');
  }
  for (let i = 1; i < expectedDates.length; i++) {
    if (expectedDates[i] <= expectedDates[i - 1]) throw new Error('预期交易日期必须严格递增且无重复');
  }
  if (!finite(maxCloseDivergencePct) || maxCloseDivergencePct < 0 || maxCloseDivergencePct > 20) {
    throw new Error('价格差异阈值无效');
  }
  const primary = indexBars(primaryBars || [], primaryName);
  const fallback = indexBars(fallbackBars || [], fallbackName);
  const rows = [];
  const gaps = [];
  const sourceSwitches = [];
  let lastSource = null;
  for (const date of expectedDates) {
    const p = primary.get(date);
    const f = fallback.get(date);
    if (!p && !f) { gaps.push(date); continue; }
    if (p && f) {
      const divergence = Math.abs(p.close - f.close) / Math.max(p.close, f.close) * 100;
      if (divergence > maxCloseDivergencePct) {
        throw new Error(`跨数据源收盘价差异超过阈值: ${date} (${divergence.toFixed(4)}%)`);
      }
    }
    const source = p ? primaryName : fallbackName;
    const bar = p || f;
    if (lastSource && lastSource !== source) sourceSwitches.push({ date, from: lastSource, to: source });
    rows.push({ ...bar, date, source, fallbackUsed: !p });
    lastSource = source;
  }
  const unexpectedDates = [...primary.keys(), ...fallback.keys()].filter(date => !expectedDates.includes(date)).sort();
  return {
    status: gaps.length ? 'incomplete' : 'continuous',
    complete: gaps.length === 0,
    expectedCount: expectedDates.length,
    acceptedCount: rows.length,
    gaps,
    unexpectedDates,
    sourceSwitches,
    bars: rows,
    verifiedLive: false,
    canTrade: false,
    warning: '连续性审计不证明行情源真实或已授权；交易放行仍需独立来源与实时性验证'
  };
}

module.exports = { auditKlineSourceContinuity, validCalendarDate: validDate };
