'use strict';
/** Centre-only hfq evidence. Raw receipts are append-only research records;
 * neither a successful fetch nor an adapter grants the original trading gate.
 * Daily source dates are deliberately NOT converted to invented quote clocks. */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const {execFile, spawnSync} = require('node:child_process');
const {appendEvent, readEvents, privateRoot, digest} = require('./research-workspace-store');
const {sourceLineage} = require('./data-source-lineage');
const ENDPOINT = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const MODE = 'fayo-center-hfq-receipt-v1';
const MAX_BYTES = 1024 * 1024, MAX_BARS = 12000, MAX_DAYS = 366;
const SOURCES = ['eastmoney-public-history', 'baostock'];
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
const time = value => Number.isSafeInteger(value) && value > 0 && value < 8e15;
const dayOf = at => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const code = value => typeof value === 'string' && /^(?:60|68|00|30)\d{4}$/.test(value);
const secid = value => (value.startsWith('6') ? '1.' : '0.') + value;
const baoCode = value => (value.startsWith('6') ? 'sh.' : 'sz.') + value;
function requestScope({symbols, start, end}, now) {
  if (!time(now) || !Array.isArray(symbols) || symbols.length < 1 || symbols.length > 3 ||
      symbols.some(s => !code(s)) || new Set(symbols).size !== symbols.length || !date(start) || !date(end) ||
      start > end || end > dayOf(now) || (Date.parse(end) - Date.parse(start)) / 86400000 > MAX_DAYS)
    throw Error('中心历史范围须为1至3只互异沪深股票、非未来且至多366日');
  return {symbols: [...symbols].sort(), start, end};
}
function allowedSource(source) {
  const lineage = sourceLineage(source);
  if (!SOURCES.includes(source) || !lineage?.known || lineage.access !== 'guarded-research') return false;
  if (source === 'baostock') {
    try { return require('../../config/data-source-catalog.json').sources.some(row => row.id === source && row.access === 'enabled-private-research'); }
    catch { return false; }
  }
  return true;
}
function numeric(value, label, integer = false) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
      !Number.isFinite(Number(value)) || integer && !Number.isSafeInteger(Number(value)))
    throw Error('原始历史字段缺失或非法: ' + label);
  return Number(value);
}
function barFields(row) {
  const open = numeric(row.open, 'open'), high = numeric(row.high, 'high'), low = numeric(row.low, 'low'),
    close = numeric(row.close, 'close'), volume = numeric(row.volume, 'volume', true), amount = numeric(row.amount, 'amount');
  if (Math.min(open, high, low, close) <= 0 || high < Math.max(open, low, close) || low > Math.min(open, close) ||
      (volume === 0) !== (amount === 0) || volume > 1e13 || amount > 1e16)
    throw Error('后复权历史OHLC、原始股数或金额不一致');
  return {open, high, low, close, volume, amount};
}
function normalizeHistoryReceipt(receipt, {now = Date.now()} = {}) {
  if (receipt?.schemaVersion !== 1 || receipt.mode !== MODE || !SOURCES.includes(receipt.source) ||
      !time(receipt.startedAt) || !time(receipt.receivedAt) || receipt.startedAt > receipt.receivedAt ||
      receipt.receivedAt > now || receipt.receivedAt - receipt.startedAt > 60000 || !time(now) ||
      typeof receipt.rawText !== 'string' || Buffer.byteLength(receipt.rawText) < 2 || Buffer.byteLength(receipt.rawText) > MAX_BYTES ||
      receipt.rawHash !== sha(receipt.rawText) || receipt.canTrade !== false || receipt.timeMeaning !== 'collector-received-at')
    throw Error('中心历史原始回执、哈希或真实接收时点无效');
  const scope = requestScope(receipt.request || {}, receipt.receivedAt);
  let raw; try { raw = JSON.parse(receipt.rawText); } catch { throw Error('中心历史原始回执不是JSON'); }
  const bars = [], calendars = [], seen = new Set();
  const add = (symbol, row, rawIndex, suspended, adjustmentEvidence, receivedAt = receipt.receivedAt) => {
    if (!code(symbol) || !scope.symbols.includes(symbol) || !date(row.date) || row.date < scope.start || row.date > scope.end ||
        seen.has(symbol + '|' + row.date)) throw Error('中心历史代码、日期范围或逐日唯一性不一致');
    seen.add(symbol + '|' + row.date);
    const fields = barFields(row);
    if (suspended === true && fields.volume !== 0) throw Error('停牌日不得有成交量');
    bars.push({code: symbol, date: row.date, day: row.date, market: 'CN', source: receipt.source,
      upstreamGroup: receipt.source === 'baostock' ? 'baostock' : 'eastmoney', adjustment: 'hfq',
      priceAdjustment: {mode: 'hfq', provider: adjustmentEvidence}, ...fields,
      currency: 'CNY', volumeUnit: 'shares', amountUnit: 'CNY', amountBasis: 'actual-unadjusted-turnover',
      suspended, knownAt: receipt.receivedAt, receivedAt, observedAt: null, sourceTimestamp: null,
      sourceDatePrecision: 'day', evidenceId: receipt.rawHash + ':' + rawIndex,
      lineage: {rawHash: receipt.rawHash, rawIndex, source: receipt.source, requestStartedAt: receipt.startedAt,
        receivedAt, sourceDate: row.date, sourceTimestamp: null, sourceTimestampMeaning: 'not-provided-in-daily-response',
        adjustmentEvidence, volumeConversion: receipt.source === 'baostock' ? 'source-shares' : 'source-hands-times-100'},
      canTrade: false});
  };
  if (receipt.source === 'eastmoney-public-history') {
    if (scope.symbols.length !== 1 || receipt.request.endpoint !== ENDPOINT || receipt.request.klt !== '101' ||
        receipt.request.fqt !== '2' || receipt.request.secid !== secid(scope.symbols[0]) ||
        raw?.rc !== 0 || String(raw.data?.code) !== scope.symbols[0] || !Array.isArray(raw.data?.klines) ||
        raw.data.klines.length < 1 || raw.data.klines.length > 370)
      throw Error('东财回执必须对应明确日K、fqt=2及同一代码');
    let previous = '';
    raw.data.klines.forEach((line, i) => {
      if (typeof line !== 'string') throw Error('东财日K原始行格式无效');
      const [dateValue, open, close, high, low, hands, amount] = line.split(',');
      if (dateValue <= previous) throw Error('东财日K日期无序'); previous = dateValue;
      const shares = numeric(hands, 'volumeHands') * 100;
      add(scope.symbols[0], {date: dateValue, open, close, high, low, volume: String(shares), amount}, i,
        null, 'eastmoney-public-history-fqt-2');
    });
  } else {
    if (receipt.request.frequency !== 'd' || receipt.request.adjustflag !== '1' || raw?.schemaVersion !== 1 ||
        raw.mode !== 'baostock-center-hfq-export-v1' || raw.completed !== true || raw.canTrade !== false ||
        !Array.isArray(raw.stocks) || raw.stocks.length !== scope.symbols.length ||
        !time(raw.startedAt) || !time(raw.completedAt) || raw.startedAt < receipt.startedAt || raw.completedAt > receipt.receivedAt ||
        raw.startedAt > raw.completedAt || raw.start !== scope.start || raw.end !== scope.end)
      throw Error('BaoStock必须为原始后复权1、日线及完整有界采集回执');
    const stockSeen = new Set();
    for (const stock of raw.stocks) {
      const symbol = String(stock?.code || '').slice(3), at = stock.receivedAt;
      if (!scope.symbols.includes(symbol) || stock.code !== baoCode(symbol) || stockSeen.has(symbol) || stock.errorCode !== '0' ||
          stock.complete !== true || stock.adjustflag !== '1' || stock.frequency !== 'd' || !time(at) ||
          at < raw.startedAt || at > raw.completedAt || !Array.isArray(stock.rows) || stock.rows.length < 1 || stock.rows.length > 370)
        throw Error('BaoStock逐票来源、后复权或完整性回执无效');
      stockSeen.add(symbol); let previous = '';
      stock.rows.forEach((row, i) => {
        if (row?.code !== stock.code || row.adjustflag !== '1' || !['0', '1'].includes(row.tradestatus) || row.date <= previous)
          throw Error('BaoStock逐行代码、复权或交易状态无效');
        previous = row.date;
        add(symbol, row, symbol + ':' + i, row.tradestatus === '0', 'baostock-adjustflag-1', at);
      });
    }
    const c = raw.calendar;
    if (!c || c.source !== 'baostock:query_trade_dates' || c.errorCode !== '0' || c.complete !== true ||
        !time(c.receivedAt) || c.receivedAt < raw.startedAt || c.receivedAt > raw.completedAt ||
        !Array.isArray(c.rows) || c.rows.length < 1 || c.rows.length > 400 || c.startDate !== scope.start ||
        !date(c.endDate) || c.endDate !== new Date(Date.parse(scope.end) + 30 * 86400000).toISOString().slice(0, 10))
      throw Error('BaoStock交易日历原始查询回执不完整');
    const days = []; let previous = '';
    for (const [i, row] of c.rows.entries()) {
      if (!date(row.calendar_date) || row.calendar_date <= previous || !['0', '1'].includes(row.is_trading_day) ||
          row.calendar_date !== new Date(Date.parse(c.startDate) + i * 86400000).toISOString().slice(0, 10))
        throw Error('BaoStock交易日历日期或状态无效');
      previous = row.calendar_date; if (row.is_trading_day === '1') days.push(row.calendar_date);
    }
    if (previous !== c.endDate) throw Error('BaoStock交易日历查询中间或尾部缺日');
    if (days.length > 1) calendars.push({days, source: 'baostock:query_trade_dates', knownAt: receipt.receivedAt,
      sourceReceivedAt: c.receivedAt, evidenceId: receipt.rawHash + ':calendar'});
  }
  return {bars, calendars, missing: ['逐日源端原始时刻（供应商日K仅返回日期；抓取时刻不替代源端时刻）'],
    source: receipt.source, rawHash: receipt.rawHash, receivedAt: receipt.receivedAt};
}
function recordReceipt(root, receipt, {now = Date.now()} = {}) {
  const normalized = normalizeHistoryReceipt(receipt, {now});
  const event = appendEvent(root, 'diagnostic', {asOf: receipt.receivedAt, mode: MODE, receipt},
    {requestId: 'hfq-' + digest(receipt), now});
  return {receiptId: event.hash, reused: event.reused, rows: normalized.bars.length, source: receipt.source,
    receivedAt: receipt.receivedAt, missing: normalized.missing, canTrade: false};
}
function historyCalendar(calendars) {
  const pairs = new Map(), conflicts = new Set();
  const milliseconds = value => time(value) ? value : Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value || '') ?
    value.replace(' ', 'T') + (value.length === 16 ? ':00' : '') + '+08:00' : value);
  for (const c of calendars) {
    const edges = c.nextEvidenceByDay || Object.fromEntries(c.days.slice(0, -1).map((day, i) => [day,
      {nextTradingDay: c.days[i + 1], knownAt: c.knownAt, source: c.source, evidenceId: c.evidenceId}]));
    for (const [day, edge] of Object.entries(edges)) {
      const knownAt = milliseconds(edge.knownAt), nextTradingDay = edge.nextTradingDay, previous = pairs.get(day);
      if (!time(knownAt)) throw Error('历史日历缺少原始取得时点');
      if (previous && previous.nextTradingDay !== nextTradingDay) conflicts.add(day);
      else if (!previous || knownAt < previous.knownAt)
        pairs.set(day, {...edge, knownAt});
    }
    for (const day of c.conflictingDays || []) conflicts.add(day);
  }
  for (const day of conflicts) pairs.delete(day);
  if (!pairs.size) return null;
  return {days: [...new Set([...pairs].flatMap(([day, row]) => [day, row.nextTradingDay]))].sort(),
    source: [...new Set([...pairs.values()].map(row => row.source))].sort().join('+'), knownAt: Math.min(...[...pairs.values()].map(row => row.knownAt)),
    nextEvidenceByDay: Object.fromEntries(pairs), conflictingDays: [...conflicts]};
}
function readReceiptHistory(root, {now = Date.now(), day = dayOf(now), maxBars = MAX_BARS} = {}) {
  if (!time(now) || !date(day) || day > dayOf(now) || !Number.isSafeInteger(maxBars) || maxBars < 0 || maxBars > 20000)
    throw Error('中心历史读取时点或容量无效');
  const empty = reason => ({bars: [], calendar: null, summary: {status: reason, adjustment: 'hfq', receipts: 0, rows: 0,
    sources: [], lastReceivedAt: null, issues: [], missing: ['中心独立后复权原始回执'], canTrade: false}});
  if (!root) return empty('not-configured');
  const events = readEvents(root, {asOf: now}), receipts = events.filter(row => row.data?.mode === MODE);
  if (!receipts.length) {
    const out = empty('missing-receipts'); out.summary.attempts = attemptSummary(events, dayOf(now)); return out;
  }
  const rows = new Map(), conflicts = new Set(), calendars = [], sources = new Set(); let lastReceivedAt = null;
  for (const event of receipts) {
    const n = normalizeHistoryReceipt(event.data.receipt, {now});
    if (event.recordedAt < n.receivedAt) throw Error('中心历史入库早于实际取得时间');
    sources.add(n.source); lastReceivedAt = Math.max(lastReceivedAt || 0, n.receivedAt); calendars.push(...n.calendars);
    for (const row of n.bars.filter(row => row.day <= day)) {
      const key = row.source + '|' + row.code + '|' + row.day, previous = rows.get(key);
      // A later provider correction cannot overwrite the historical first-known
      // value. Quarantine the conflicting key until a version-aware audit exists.
      const valueKey = value => digest(Object.fromEntries(['open', 'high', 'low', 'close', 'volume', 'amount', 'suspended'].map(k => [k, value[k]])));
      if (previous && valueKey(previous) !== valueKey(row)) conflicts.add(key);
      else if (!previous || row.knownAt < previous.knownAt) rows.set(key, row);
    }
  }
  for (const key of conflicts) rows.delete(key);
  const ordered = [...rows.values()].sort((a, b) => b.day.localeCompare(a.day) || a.code.localeCompare(b.code) || a.source.localeCompare(b.source));
  const bars = ordered.slice(0, maxBars), issues = [...conflicts].map(key => ({key, reason: 'same-source-historical-revision-conflict'}));
  if (ordered.length > maxBars) issues.push({reason: 'bounded-history-window', excludedRows: ordered.length - maxBars});
  return {bars, calendar: historyCalendar(calendars), summary: {status: 'received-awaiting-original-time', adjustment: 'hfq',
    receipts: receipts.length, rows: bars.length, sources: [...sources].sort(), lastReceivedAt, missingOriginalTime: bars.length,
    quarantinedKeys: conflicts.size, issues: issues.slice(0, 20), attempts: attemptSummary(events, dayOf(now)),
    missing: ['逐日源端原始时刻', ...(sources.size < 2 ? ['第二个独立历史来源'] : [])],
    note: '真实后复权回执已保存；只含日期的源数据仍受原研究准入拦截。实际抓取时点不回填为历史已知时点。', canTrade: false}};
}
function attemptSummary(events, day) {
  return events.filter(row => row.data?.mode === 'fayo-center-history-attempt-result-v1' && row.data.day === day)
    .map(row => ({at: row.recordedAt, status: row.data.status, attempts: row.data.attempts})).slice(-3);
}
async function boundedText(response) {
  if (!response?.ok) throw Object.assign(Error('历史源未返回成功响应'), {historyCode: 'source-http-failed',
    httpStatus: Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : null});
  const chunks = []; let size = 0;
  if (response.body?.[Symbol.asyncIterator]) {
    for await (const value of response.body) { size += value.length; if (size > MAX_BYTES) throw Error('历史响应超过1MiB'); chunks.push(Buffer.from(value)); }
  } else { const raw = Buffer.from(await response.text()); if (raw.length > MAX_BYTES) throw Error('历史响应超过1MiB'); chunks.push(raw); }
  const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw Error('历史源响应不是完整UTF-8，拒绝改变原始字节后存档');
  return text;
}
async function collectEastmoney(symbol, scope, {fetchImpl, clock, timeoutMs}) {
  const startedAt = clock(), url = new URL(ENDPOINT);
  for (const [key, value] of Object.entries({secid: secid(symbol), fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57', klt: '101', fqt: '2', beg: scope.start.replaceAll('-', ''),
    end: scope.end.replaceAll('-', ''), lmt: '370'})) url.searchParams.set(key, value);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rawText = await boundedText(await fetchImpl(url.toString(), {method: 'GET', redirect: 'error',
      signal: controller.signal, headers: {Accept: 'application/json'}}));
    return {schemaVersion: 1, mode: MODE, source: 'eastmoney-public-history', startedAt, receivedAt: clock(),
      rawText, rawHash: sha(rawText), timeMeaning: 'collector-received-at', canTrade: false,
      request: {...scope, symbols: [symbol], endpoint: ENDPOINT, secid: secid(symbol), klt: '101', fqt: '2'}};
  } finally { clearTimeout(timer); }
}
function runBaoStock(scope, {timeoutMs = 30000} = {}) {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, '../../scripts/collect-center-hfq-baostock.py'), '--symbols', scope.symbols.join(','),
      '--start', scope.start, '--end', scope.end, '--allow-research-fetch'], {timeout: timeoutMs, maxBuffer: MAX_BYTES, encoding: 'utf8'},
    (error, stdout) => {
      if (error) { reject(Object.assign(Error('BaoStock后复权采集未完成'), {historyCode:
        error.code === 78 ? 'adapter-unavailable' : error.killed ? 'source-timeout' : 'source-collection-failed'})); return; }
      resolve(stdout.trim());
    });
  });
}
async function withCollectionLock(root, fn) {
  const dir = privateRoot(path.join(root, 'collector'), true), fd = fs.openSync(path.join(dir, 'collection.guard'),
    fs.constants.O_CREAT | fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    if (!fs.fstatSync(fd).isFile()) throw Error('中心采集锁无效');
    const lock = spawnSync('flock', ['-n', '3'], {stdio: ['ignore', 'pipe', 'pipe', fd]});
    if (lock.error || lock.status !== 0) return {status: 'collection-busy', attempts: [], missing: ['前次采集尚未完成'], canTrade: false};
    return await fn();
  } finally { fs.closeSync(fd); }
}
async function collectCenterHistory({root, symbols, start, end, allowNetwork = false, replica = false, timeoutMs = 10000} = {}, dependencies = {}) {
  const clock = dependencies.clock || Date.now, startedAt = clock(), scope = requestScope({symbols, start, end}, startedAt);
  const canWrite = () => { try { return !replica && (!dependencies.canWrite || dependencies.canWrite() === true); } catch { return false; } };
  const revoked = attempts => ({status: 'read-only-instance', attempts, missing: ['实例已转为只读，停止后续采集与持久化'], canTrade: false});
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) throw Error('历史源请求时限无效');
  if (!canWrite()) return revoked([]);
  if (!allowNetwork) return {status: 'network-not-enabled', attempts: [], missing: ['未启用既有获准研究来源采集'], canTrade: false};
  if (end === dayOf(startedAt) && startedAt < Date.parse(end + 'T16:00:00+08:00'))
    return {status: 'waiting-for-close', attempts: [], missing: ['北京时间16点后的完整收盘回执'], canTrade: false};
  privateRoot(root, true);
  return withCollectionLock(root, async () => {
    if (!canWrite()) return revoked([]);
    const current = readEvents(path.join(root, 'receipts'), {asOf: clock()}), attemptDay = dayOf(startedAt),
      started = current.filter(row => row.data?.mode === 'fayo-center-history-attempt-v1' && row.data.day === attemptDay),
      done = current.filter(row => row.data?.mode === 'fayo-center-history-attempt-result-v1' && row.data.day === attemptDay);
    if (done.some(row => row.data.status === 'collected' && digest(row.data.scope) === digest(scope)))
      return {status: 'already-collected-today', attempts: [], canTrade: false};
    if (started.length >= 3 || started.length && startedAt - started.at(-1).recordedAt < 120000)
      return {status: started.length >= 3 ? 'daily-attempt-limit' : 'retry-cooldown', attempts: [], canTrade: false};
    const id = crypto.randomUUID().replaceAll('-', ''), dir = path.join(root, 'receipts');
    appendEvent(dir, 'diagnostic', {mode: 'fayo-center-history-attempt-v1', day: attemptDay, scope, asOf: startedAt},
      {requestId: 'hfq-start-' + id, now: startedAt});
    const attempts = [];
    for (const source of SOURCES) {
      if (!canWrite()) return revoked(attempts);
      if (!allowedSource(source)) { attempts.push({source, status: 'source-access-blocked'}); continue; }
      if (source === 'eastmoney-public-history') for (const symbol of scope.symbols) {
        if (!canWrite()) return revoked(attempts);
        try {
          const receipt = await collectEastmoney(symbol, scope, {fetchImpl: dependencies.fetchImpl || globalThis.fetch, clock, timeoutMs});
          if (!canWrite()) return revoked(attempts);
          const saved = recordReceipt(dir, receipt, {now: clock()});
          attempts.push({source, code: symbol, status: 'received', rows: saved.rows, receivedAt: saved.receivedAt});
        } catch (error) { attempts.push({source, code: symbol,
          status: error.historyCode || (error.name === 'AbortError' ? 'source-timeout' : 'source-receipt-rejected'),
          ...(error.httpStatus ? {httpStatus: error.httpStatus} : {})}); }
      } else {
        try {
          const sourceStartedAt = clock(), rawText = await (dependencies.runBaoStock || runBaoStock)(scope, {timeoutMs: 30000});
          if (!canWrite()) return revoked(attempts);
          const receipt = {schemaVersion: 1, mode: MODE, source, startedAt: sourceStartedAt, receivedAt: clock(),
            rawText, rawHash: sha(rawText), timeMeaning: 'collector-received-at', canTrade: false,
            request: {...scope, frequency: 'd', adjustflag: '1'}};
          const saved = recordReceipt(dir, receipt, {now: clock()});
          attempts.push({source, status: 'received', rows: saved.rows, receivedAt: saved.receivedAt});
        } catch (error) { attempts.push({source, status: error.historyCode || 'source-receipt-rejected'}); }
      }
    }
    const status = attempts.every(row => row.status === 'received') ? 'collected' : attempts.some(row => row.status === 'received') ? 'partially-collected' : 'collection-blocked';
    const completedAt = clock();
    if (!canWrite()) return revoked(attempts);
    appendEvent(dir, 'diagnostic', {mode: 'fayo-center-history-attempt-result-v1', day: attemptDay, scope, status, attempts, asOf: completedAt},
      {requestId: 'hfq-done-' + id, now: completedAt});
    const history = readReceiptHistory(dir, {now: completedAt, day: end});
    return {status, attempts, missing: history.summary.missing, summary: history.summary, canTrade: false};
  });
}
/** Public root is a dedicated subtree; its receipts are an independent chain. */
function readCenterHistory(root, options) { return readReceiptHistory(root ? path.join(root, 'receipts') : null, options); }
function recordHistoryReceipt(root, receipt, options) { return recordReceipt(path.join(root, 'receipts'), receipt, options); }
function composeCenterHistory(archive, historyRoot, {now = Date.now(), day = dayOf(now)} = {}) {
  const {extractArchiveResearchInputs, extractArchiveCalendar} = require('./intelligence-research');
  const extracted = extractArchiveResearchInputs(archive, {now});
  let history;
  try { history = readCenterHistory(historyRoot, {now, day, maxBars: Math.min(MAX_BARS, Math.max(0, 20000 - extracted.bars.length))}); }
  catch {
    // A damaged optional supply must be visible and excluded. It cannot mutate
    // the original archive or make unrelated existing research unavailable.
    history = {bars: [], calendar: null, summary: {status: 'invalid-history-store', adjustment: 'hfq', receipts: 0, rows: 0,
      sources: [], lastReceivedAt: null, issues: [{reason: 'private-history-integrity-or-permission-failed'}],
      missing: ['中心历史回执完整性或权限核验失败，该库未纳入研究'], canTrade: false}};
  }
  const calendars = [extractArchiveCalendar(archive, {now}), history.calendar].filter(Boolean);
  return {bars: [...extracted.bars, ...history.bars], calendar: historyCalendar(calendars), summary: history.summary};
}

module.exports = {MODE, ENDPOINT, SOURCES, allowedSource, normalizeHistoryReceipt, recordHistoryReceipt,
  readCenterHistory, collectCenterHistory, composeCenterHistory};
