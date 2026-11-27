'use strict';

const {readResearchCalendar} = require('../core/research-calendar-source');
const {assessDailyTurnoverBar} = require('../core/daily-turnover-sanity');
const {readTurnoverSession} = require('./shortline-minute-archive');

const lookback = 20;
const windows = [
  {start: '09:30', end: '09:35'},
  {start: '13:00', end: '13:05'},
  {start: '14:55', end: '15:00'}
];
const nativeSources = {'1m': 'V6/eastmoney', '5m': 'V6/sina'};

function measureSession(root, selection) {
  let session;
  try {
    session = readTurnoverSession(root, selection);
  } catch {
    return {status: 'unreadable-session'};
  }
  if (session.status !== 'available') return session;
  const {period, code} = selection;
  const {rawHash, knownAt} = session.rows[0];
  const source = nativeSources[period];
  const secid = (code.startsWith('6') ? '1.' : '0.') + code;
  // Native providers return one full session per receipt. Different pulls,
  // units or bar periods cannot be stitched into a synthetic complete day.
  if (!/^[a-f0-9]{64}$/.test(rawHash || '') || session.rows.some(row =>
    row.source !== source || row.secid !== secid || row.rawHash !== rawHash ||
    row.knownAt !== knownAt || row.priceBasis !== 'unadjusted' || row.volumeUnit !== 'shares' ||
    (row.amountUnit != null && row.amountUnit !== 'CNY') ||
    !['in-range', 'no-trades'].includes(assessDailyTurnoverBar(row).status))) {
    return {status: 'incompatible-receipt-or-amount'};
  }
  const amounts = [];
  for (const {start, end} of windows) {
    const bars = session.rows.filter(row => {
      const time = row.date.slice(11);
      return time > start && time <= end;
    });
    const amount = bars.reduce((sum, row) => sum + row.amount, 0);
    if (bars.length !== (period === '1m' ? 5 : 1) || !Number.isFinite(amount)) {
      return {status: 'incomplete-window'};
    }
    amounts.push(amount);
  }
  return {status: 'available', source, rawHash, knownAt, capturedAt: session.capturedAt, amounts};
}

function compareWindowTurnover(root, {day, code, observedAtMs}, calendarFile) {
  const report = {version: 1, purpose: 'post-close-stock-research', code, day, asOf: observedAtMs,
    unit: 'CNY', requiredDays: lookback, status: 'unknown', windows: [], history: []};
  const calendar = readResearchCalendar({symbol: code, asOf: observedAtMs, calendarFile});
  report.calendarSha256 = calendar.metadata?.sha256 || null;
  const index = calendar.tradeDates.indexOf(day);
  if (calendar.status !== 'available' || index < 0) {
    report.reason = 'calendar-unavailable-or-session-closed';
    return report;
  }

  report.currentAttempts = {};
  let current;
  for (const period of Object.keys(nativeSources)) {
    const session = measureSession(root, {day, code, period, observedAtMs});
    report.currentAttempts[period] = session.status;
    if (session.status === 'available') {
      current = session;
      report.period = period;
      break;
    }
    // An explicit dispute or integrity error must remain visible.
    if (['disputed-session', 'unreadable-session'].includes(session.status)) break;
  }
  if (!current) {
    report.reason = 'current-session-unavailable';
    return report;
  }
  report.current = current;
  for (const date of calendar.tradeDates.slice(Math.max(0, index - lookback), index)) {
    report.history.push({day: date, ...measureSession(root, {day: date, code, period: report.period, observedAtMs})});
  }
  const samples = report.history.filter(session => session.status === 'available');
  report.observedDays = samples.length;
  report.windows = windows.map(({start, end}, i) => {
    const result = {start, end, amount: current.amounts[i], median: null, multiple: null};
    if (samples.length !== lookback) return {...result, reason: 'insufficient-history'};
    const sorted = samples.map(session => session.amounts[i]).sort((a, b) => a - b);
    const lower = sorted[lookback / 2 - 1];
    result.median = lower + (sorted[lookback / 2] - lower) / 2;
    if (result.median === 0) return {...result, reason: 'zero-median'};
    const multiple = result.amount / result.median;
    if (!Number.isFinite(multiple)) return {...result, reason: 'unrepresentable-ratio'};
    return {...result, multiple};
  });
  const count = report.windows.filter(window => window.multiple !== null).length;
  report.status = count === windows.length ? 'available' : count ? 'partial' : 'unknown';
  return report;
}

module.exports = {compareWindowTurnover};
