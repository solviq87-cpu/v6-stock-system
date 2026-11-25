'use strict';
/**
 * Read-only intelligence-centre research. This module has no collectors, store
 * writes, order methods, or production-weight setters. All times are original
 * evidence times; creating this report never makes an old fact known earlier.
 */
const crypto = require('node:crypto');
const defaults = require('../../config/intelligence-center.json');
const installedCatalog = require('../../public/nova/shortline/catalog.json');
const {resolveUpstream, sourceLineage} = require('./data-source-lineage');
const {fuseMultiSourcePrices} = require('./multi-source-price-consensus');
const {evaluateThreeToFour,evaluateTemplateLibrary} = require('./intelligence-templates');
const {spearman, assessFactorRedundancy} = require('./factor-redundancy');
const {assessFactorReliability} = require('./factor-learning-reliability');
const numeric = require('../../public/nova/shortline/numeric-factors');
const MAX_BARS = 20000, MAX_CHECKS = 5000, MAX_FACTORS = 128;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = n => finite(n) ? +n.toFixed(8) : null;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dayOk = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
const chinaDay = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const marketZones = {CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', US: 'America/New_York', JP: 'Asia/Tokyo', KR: 'Asia/Seoul'};
function marketDay(at, market) {
  if (!Number.isSafeInteger(at) || at <= 0 || at >= 8e15 || !marketZones[market]) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: marketZones[market], year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(at), field = key => parts.find(part => part.type === key)?.value;
  return field('year') + '-' + field('month') + '-' + field('day');
}
const real = row => row && row.sampleSet !== 'test' && row.scope !== 'demo' &&
  ![true, 1, 'true', '1', '是'].includes(row.testSample) && ![true, 1, 'true', '1', '是'].includes(row.isTest) &&
  row.synthetic !== true && row.mock !== true && row.quality !== '教学样本' && !/^合成教学样本/.test(row.name || '') &&
  !/(?:^|[-_: /])(fixture|simulated|synthetic|mock|demo)(?:$|[-_: /])/i.test(String(row.source || ''));
function instant(value) {
  if (Number.isSafeInteger(value) && value > 0 && value < 8e15) return value;
  if (typeof value !== 'string') return null;
  // Existing shortline wall-clock strings are Beijing times. A bare day is
  // not an observation or receipt timestamp and must remain unknown.
  const s = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value) ?
    value.replace(' ', 'T') + (value.length === 16 ? ':00' : '') + '+08:00' : value;
  if (!/T\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s); return Number.isSafeInteger(t) && t > 0 && t < 8e15 ? t : null;
}
function canonicalAdjustment(value) {
  return value === 'unadjusted' || value === 'none' ? 'none' : ['qfq', 'hfq'].includes(value) ? value : null;
}
function checkedConfig(config = defaults) {
  if (!config || config.schemaVersion !== 1 || typeof config.enabled !== 'boolean' ||
      config.adjustment?.display !== 'qfq' || config.adjustment?.backtest !== 'hfq' || config.adjustment?.liveExecution !== 'none')
    throw Error('中心配置必须明确 display=qfq、backtest=hfq、liveExecution=none');
  const expected = {realtime: .35, completeness: .25, consistency: .2, continuity: .1, anomaly: .1};
  if (Object.keys(config.quality?.weights || {}).length !== 5 ||
      Object.entries(expected).some(([key, weight]) => config.quality.weights[key] !== weight) || config.quality.unknownValue !== null)
    throw Error('中心 Q 权重或未知值约定无效');
  const c = config.consistency || {}, f = config.factors || {}, w = config.walkforward || {};
  for (const [name, n, min, max] of [
    ['priceToleranceBps', c.priceToleranceBps, 0, 100], ['volumeTolerancePct', c.volumeTolerancePct, 0, 100],
    ['amountTolerancePct', c.amountTolerancePct, 0, 100], ['previousCloseToleranceBps', c.previousCloseToleranceBps, 0, 100],
    ['maxTimestampGapMs', c.maxTimestampGapMs, 0, 15000], ['maxAgeMs', config.quality.maxAgeMs, 1000, 30000],
    ['minCrossSection', f.minCrossSection, 5, 500], ['minIcDays', f.minIcDays, 15, 400],
    ['redundancyAbsCorrelation', f.redundancyAbsCorrelation, .92, 1], ['maxCandidateWeightChange', f.maxCandidateWeightChange, 0, .08],
    ['trainDays', w.trainDays, 15, 400], ['validationDays', w.validationDays, 5, 100], ['testDays', w.testDays, 5, 100],
    ['stepDays', w.stepDays, 1, 100], ['purgeTradingDays', w.purgeTradingDays, 1, 20], ['maxFolds', w.maxFolds, 1, 12]
  ]) if (!finite(n) || n < min || n > max) throw Error('中心配置阈值无效: ' + name);
  for (const key of ['trainDays', 'validationDays', 'testDays', 'stepDays', 'purgeTradingDays', 'maxFolds'])
    if (!Number.isSafeInteger(w[key])) throw Error('walk-forward 交易日窗口须为整数');
  if (!Number.isSafeInteger(f.minCrossSection) || !Number.isSafeInteger(f.minIcDays) ||
      f.orthogonalization !== 'training-only-modified-gram-schmidt' ||
      JSON.stringify(config.quality.requiredFields) !== JSON.stringify(['open', 'high', 'low', 'close', 'volume', 'amount']))
    throw Error('中心横截面、正交方法或完整性字段配置无效');
  if (c.minIndependentSources !== 2 || c.conflictPolicy !== 'exclude-from-center-research' ||
      w.marketDateAlignment !== 'intersection' || config.feedback?.mode !== 'candidate-only' ||
      config.feedback.approvalRequired !== true || config.feedback.productionWeightsChanged !== false)
    throw Error('中心研究不得放宽一致性、日期交集或原审批规则');
  return config;
}

/** Unknown components are null, not zero and not a reweighted partial score. */
function qualityScore(values = {}, config = defaults) {
  checkedConfig(config);
  const labels = {realtime: '实时性', completeness: '完整性', consistency: '一致性', continuity: '连续性', anomaly: '异常检查'};
  let contribution = 0, knownWeight = 0;
  const components = Object.entries(config.quality.weights).map(([id, weight]) => {
    const entry = values[id], value = entry && typeof entry === 'object' ? entry.value : entry;
    if (value != null && (!finite(value) || value < 0 || value > 1)) throw Error('Q 分量必须在 0–1 之间或为 null: ' + id);
    const known = finite(value);
    if (known) { contribution += value * weight; knownWeight += weight; }
    return {id, label: labels[id], weight, value: known ? round(value) : null,
      status: known ? 'observed' : 'unknown', evidence: entry?.evidence || null};
  });
  const complete = components.every(x => x.value !== null);
  return {status: complete ? 'observed' : knownWeight ? 'partial-evidence' : 'missing-data',
    formula: 'Q = 0.35×实时性 + 0.25×完整性 + 0.20×一致性 + 0.10×连续性 + 0.10×异常检查',
    score: complete ? round(contribution * 100) : null, knownWeight: round(knownWeight),
    possibleRange: [round(contribution * 100), round((contribution + 1 - knownWeight) * 100)], components,
    note: '分量为可核验检查通过比例；未知不补 0，不重新归一权重。区间仅表示未知分量的数学范围。', canTrade: false};
}

function calendarView(value, now, market = 'CN') {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const dates = input.days || input.tradingDays, knownAt = instant(input.knownAt);
  const edges = input.nextEvidenceByDay;
  const edgesValid = edges == null || !Array.isArray(edges) && typeof edges === 'object' &&
    Object.entries(edges).every(([day, row]) => dayOk(day) && dates?.includes(day) && dayOk(row?.nextTradingDay) &&
      row.nextTradingDay > day && dates?.includes(row.nextTradingDay) && typeof row.source === 'string' && row.source &&
      instant(row.knownAt) !== null && instant(row.knownAt) <= now);
  const sessionMapValid = (map, clock) => map == null || !Array.isArray(map) && typeof map === 'object' &&
    Object.entries(map).every(([day, value]) => dayOk(day) && dates?.includes(day) && instant(value) !== null &&
      marketDay(instant(value), market) === day && (market !== 'CN' || instant(value) === Date.parse(day + 'T' + clock + '+08:00')));
  const sessionsValid = sessionMapValid(input.openAtByDay, '09:30:00') && sessionMapValid(input.closeAtByDay, '15:00:00') &&
    Object.keys(input.closeAtByDay || {}).every(day => input.openAtByDay?.[day] == null || instant(input.closeAtByDay[day]) > instant(input.openAtByDay[day]));
  const valid = Array.isArray(dates) && dates.length > 1 && dates.length <= 4096 &&
    dates.every((day, i) => dayOk(day) && (!i || day > dates[i - 1])) &&
    typeof input.source === 'string' && input.source.length > 0 && knownAt !== null && knownAt <= now && edgesValid && sessionsValid;
  return {status: valid ? 'observed' : 'missing-calendar-evidence', days: valid ? [...dates] : [],
    source: input.source || null, knownAt: valid ? input.knownAt : null, knownAtMs: valid ? knownAt : null,
    openAtByDay: valid && input.openAtByDay && typeof input.openAtByDay === 'object' ? {...input.openAtByDay} : {},
    closeAtByDay: valid && input.closeAtByDay && typeof input.closeAtByDay === 'object' ? {...input.closeAtByDay} : {},
    nextEvidenceByDay: valid && input.nextEvidenceByDay && typeof input.nextEvidenceByDay === 'object' ? {...input.nextEvidenceByDay} : null,
    note: valid ? '按原交易日历相邻交易日对齐，不推测节假日。' : '需要原 days、source、knownAt；观测日期或周一至周五不能代替交易日历。'};
}
function extractArchiveCalendar(archive, {now = Date.now()} = {}) {
  const pairs = new Map(), conflicts = new Set(), sources = new Set();
  const rows = [...(archive?.marketHistory || []), ...(archive?.market || []),
    ...(archive?.checks || []).map(row => row?.market).filter(row => row && typeof row === 'object')];
  for (const row of rows) {
    const at = instant(row.calendarKnownAt), recorded = instant(row.knownAt), day = row.date, next = row.nextTradingDay;
    if (archive?.scope === 'demo' || !real(row) || !dayOk(day) || !dayOk(next) || next <= day ||
        at === null || recorded === null || at > recorded || recorded > now ||
        typeof row.calendarSource !== 'string' || !row.calendarSource) continue;
    const previous = pairs.get(day);
    if (previous && previous.nextTradingDay !== next) { conflicts.add(day); continue; }
    sources.add(row.calendarSource);
    if (!previous || at < instant(previous.knownAt)) pairs.set(day, {nextTradingDay: next,
      source: row.calendarSource, knownAt: row.calendarKnownAt, recordKnownAt: row.knownAt});
  }
  for (const day of conflicts) pairs.delete(day);
  if (!pairs.size) return null;
  const dates = [...new Set([...pairs].flatMap(([day, row]) => [day, row.nextTradingDay]))].sort();
  const earliest = [...pairs.values()].sort((a, b) => instant(a.knownAt) - instant(b.knownAt))[0];
  return {days: dates, source: 'shortline-archived-next-trading-day-evidence', knownAt: earliest.knownAt,
    originalSources: [...sources], nextEvidenceByDay: Object.fromEntries(pairs), conflictingDays: [...conflicts],
    note: '只使用原档案相邻交易日声明；每条沿用自身 calendarKnownAt。未记录的边不会由日期排序补齐。'};
}
function marketOpen(calendar, market, day) {
  const recorded = instant(calendar?.openAtByDay?.[day]);
  if (market === 'CN' && dayOk(day)) return Date.parse(day + 'T09:30:00+08:00');
  return recorded !== null && marketDay(recorded, market) === day ? recorded : null;
}
function marketClose(calendar, market, day) {
  const recorded = instant(calendar?.closeAtByDay?.[day]);
  if (market === 'CN' && dayOk(day)) return Date.parse(day + 'T15:00:00+08:00');
  return recorded !== null && marketDay(recorded, market) === day ? recorded : null;
}
function intersectMarketDates(marketCalendars = {}, {now = Date.now()} = {}) {
  if (instant(now) === null) throw Error('研究日历查询时钟无效');
  const markets = Object.keys(marketCalendars).sort(), calendars = {};
  for (const market of markets) calendars[market] = calendarView(marketCalendars[market], now, market);
  const missing = markets.filter(market => !calendars[market].days.length);
  if (!markets.length || missing.length) return {status: 'missing-calendar-evidence', markets, days: [], missing, calendars};
  let days = calendars[markets[0]].days;
  for (const market of markets.slice(1)) { const set = new Set(calendars[market].days); days = days.filter(day => set.has(day)); }
  return {status: markets.length > 1 ? days.length ? 'aligned' : 'no-common-dates' : 'single-market',
    markets, days, calendars, missing: [], droppedDays: Object.fromEntries(markets.map(market => [market,
      calendars[market].days.filter(day => !days.includes(day))])), alignment: 'exact-date-intersection'};
}

function sourceIdentity(row) {
  try {
    const identity = resolveUpstream(row.source, row.upstreamGroup);
    return identity.known && !identity.ambiguous && identity.catalogGroup ? {...identity, market: sourceLineage(row.source)?.market} : null;
  } catch { return null; }
}
/** A fresh diagnostic can add a centre block, never grant execution rights. */
function decisionCrosscheckGate(report, {code, day, now = Date.now(), source = null, config = defaults} = {}) {
  checkedConfig(config);
  const unknown = reason => ({status: 'unknown', blocked: false, canAdmit: false, reason,
    checkedAt: report?.checkedAt || null, sourceEvidence: [], canTrade: false, changesOriginalGates: false});
  const checked = instant(report?.checkedAt);
  if (!report || report.schemaVersion !== 1 || report.mode !== 'multi-source-price-consensus-research' ||
      report.canTrade !== false || report.code !== code || !dayOk(day) || !Number.isSafeInteger(now) || now <= 0 || now >= 8e15 ||
      checked === null || checked > now || chinaDay(checked) !== day || chinaDay(now) !== day ||
      !Array.isArray(report.sourceStatuses) || report.sourceStatuses.length > 8)
    return unknown('missing-or-mismatched-original-diagnostic');
  const evidence = report.sourceStatuses.filter(row => {
    const identity = sourceIdentity({source: row.provider, upstreamGroup: row.upstreamGroup});
    return identity && identity.catalogGroup === row.upstreamGroup && row.publisherCandidate === true &&
      row.status === 'eligible-for-comparison' && finite(row.observedPrice) && row.observedPrice > 0 &&
      finite(row.observedPreviousClose) && row.observedPreviousClose > 0 &&
      Number.isSafeInteger(row.quoteAt) && row.quoteAt <= checked && row.quoteAt <= now &&
      now - row.quoteAt <= config.quality.maxAgeMs && chinaDay(row.quoteAt) === day;
  });
  if (evidence.length < 2) return unknown('insufficient-fresh-original-source-evidence');
  const groups = new Set(evidence.map(row => row.upstreamGroup));
  const validIds = new Set(evidence.map(row => row.provider));
  const conflicted = ['source-price-or-time-conflict', 'ambiguous-price-groups', 'duplicate-upstream-evidence'].includes(report.status);
  const partial = report.status === 'partial-source-agreement-unverified';
  const agreement = ['sources-agree-unverified', 'partial-source-agreement-unverified'].includes(report.status) &&
    Array.isArray(report.supportingProviders) && report.supportingProviders.length >= 2 &&
    report.supportingProviders.every(id => validIds.has(id)) && groups.size >= 2 &&
    evidence.some(row => row.provider === report.representativeProvider && row.observedPrice === report.referencePrice && row.inConsensus === true);
  const sourceExcluded = partial && source && report.disagreeingProviders?.includes(source);
  const contradict = (a, b) => gap(a.observedPrice, b.observedPrice, 10000) > config.consistency.priceToleranceBps ||
    gap(a.observedPreviousClose, b.observedPreviousClose, 10000) > config.consistency.previousCloseToleranceBps ||
    Math.abs(a.quoteAt - b.quoteAt) > config.consistency.maxTimestampGapMs;
  const hasConflict = evidence.some((row, i) => evidence.slice(i + 1).some(other => contradict(row, other)));
  if (conflicted && !hasConflict && groups.size === evidence.length) return unknown('diagnostic-status-contradicts-original-values');
  const supporting = evidence.filter(row => report.supportingProviders?.includes(row.provider));
  const supporterConflict = agreement && supporting.some((row, i) => supporting.slice(i + 1).some(other => contradict(row, other)));
  if (!conflicted && !agreement) return unknown('unresolved-original-diagnostic-status');
  return {status: conflicted || sourceExcluded || supporterConflict ? 'conflict' : 'observed-agreement', blocked: Boolean(conflicted || sourceExcluded || supporterConflict),
    canAdmit: !conflicted && !sourceExcluded && !supporterConflict && agreement,
    reason: supporterConflict ? 'center-tolerance-exceeded' : sourceExcluded ? 'candidate-source-outside-consensus' : report.status,
    checkedAt: report.checkedAt, sourceEvidence: evidence.map(row => ({source: row.provider, upstreamGroup: row.upstreamGroup,
      quoteAt: row.quoteAt, price: row.observedPrice, previousClose: row.observedPreviousClose, inConsensus: row.inConsensus === true})),
    excludedSources: Array.isArray(report.disagreeingProviders) ? [...report.disagreeingProviders] : [],
    canTrade: false, changesOriginalGates: false};
}
function recordView(row) {
  const originalAdjustment = row?.adjustment ?? row?.priceBasis ?? row?.priceAdjustment?.mode ?? null;
  return {code: String(row?.code || row?.symbol || ''), day: row?.day || row?.date, market: row?.market || 'CN',
    adjustment: canonicalAdjustment(originalAdjustment), originalAdjustment, source: row?.source || row?.provider || null,
    upstreamGroup: row?.upstreamGroup, knownAt: row?.knownAt ?? row?.retrievedAt ?? row?.receivedAt ?? null,
    observedAt: row?.observedAt ?? row?.sourceTimestamp ?? null, currency: row?.currency || null,
    volumeUnit: row?.volumeUnit || null, amountUnit: row?.amountUnit || null,
    open: row?.open, high: row?.high, low: row?.low, close: row?.close, volume: row?.volume, amount: row?.amount,
    suspended: row?.suspended, sampleSet: row?.sampleSet, evidenceId: row?.evidenceId || row?.id || null,
    observationKind: row?.observationKind, captureProtocol: row?.captureProtocol,
    periodEndAt: row?.periodEndAt, sourceDate: row?.sourceDate, rawHash: row?.rawHash, rawRowHash: row?.rawRowHash,
    firstKnownBasis: row?.firstKnownBasis, sourceTimestamp: row?.sourceTimestamp, canTrade: row?.canTrade,
    original: row};
}
function capturedHistoricalBar(row) {
  return row.observationKind === 'historical-daily-bar' && row.captureProtocol === 'center-hfq-history-v1' &&
    ['eastmoney-public-history', 'baostock'].includes(row.source) && row.adjustment === 'hfq' &&
    row.sourceDate === row.day && row.market === 'CN' && row.periodEndAt === Date.parse(row.day + 'T15:00:00+08:00') &&
    /^[a-f0-9]{64}$/.test(row.rawHash || '') && /^[a-f0-9]{64}$/.test(row.rawRowHash || '') &&
    row.firstKnownBasis === 'actual-provider-receipt' && row.sourceTimestamp === null && row.canTrade === false &&
    instant(row.observedAt) === instant(row.knownAt);
}
function shapeReason(row) {
  if (![row.open, row.high, row.low, row.close, row.volume, row.amount].every(finite)) return 'missing-ohlcv-amount';
  if (Math.min(row.open, row.high, row.low, row.close) <= 0 || row.high < Math.max(row.open, row.close, row.low) ||
      row.low > Math.min(row.open, row.close) || row.volume < 0 || !Number.isSafeInteger(row.volume) || row.amount < 0 ||
      (row.volume === 0) !== (row.amount === 0) || row.suspended === true && row.volume !== 0) return 'invalid-ohlcv-amount';
  return null;
}
const gap = (a, b, scale) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) * scale;
function compatible(a, b, config) {
  const c = config.consistency;
  const historicalA = capturedHistoricalBar(a), historicalB = capturedHistoricalBar(b);
  // Historical daily providers describe the same bar period. Their actual
  // receipts remain separate knowledge clocks; neither is a live quote clock.
  if (historicalA !== historicalB) return false;
  const comparisonTimeA = historicalA ? a.periodEndAt : instant(a.observedAt);
  const comparisonTimeB = historicalB ? b.periodEndAt : instant(b.observedAt);
  if (a.currency !== b.currency || a.volumeUnit !== b.volumeUnit || a.amountUnit !== b.amountUnit ||
      a.suspended !== b.suspended || Math.abs(comparisonTimeA - comparisonTimeB) > c.maxTimestampGapMs) return false;
  return ['open', 'high', 'low', 'close'].every(k => gap(a[k], b[k], 10000) <= c.priceToleranceBps) &&
    gap(a.volume, b.volume, 100) <= c.volumeTolerancePct && gap(a.amount, b.amount, 100) <= c.amountTolerancePct;
}
function reference(row) {
  const {original, upstreamGroup, ...out} = row;
  return {...out, knownAt: row.knownAt, observedAt: row.observedAt};
}

/** Additional centre-only gate: never edits ingest/lastPx or their evidence. */
function auditCenterInputs(records = [], {purpose = 'backtest', now = Date.now(), config = defaults, marketCalendars = {}} = {}) {
  checkedConfig(config);
  if (instant(now) === null || !Array.isArray(records) || records.length > MAX_BARS || !Object.hasOwn(config.adjustment, purpose))
    throw Error('中心行情输入数量或用途无效');
  const expected = config.adjustment[purpose], groups = new Map(), rejected = [], admitted = [];
  const calendars = Object.fromEntries(Object.entries(marketCalendars).map(([market, value]) => [market, calendarView(value, now, market)]));
  for (const original of records) {
    const row = recordView(original), known = instant(row.knownAt), observed = instant(row.observedAt);
    const identity = sourceIdentity(row);
    const sessionClose = purpose === 'liveExecution' ? null : marketClose(calendars[row.market], row.market, row.day);
    let reason = !real(original) ? 'non-real-sample' :
      !/^[A-Za-z0-9.:-]{1,48}$/.test(row.code) || !dayOk(row.day) || !/^[A-Z]{2,12}$/.test(row.market) ? 'invalid-identity-or-date' :
      row.adjustment !== expected ? 'adjustment-mismatch' :
      !identity ? 'unregistered-or-ambiguous-upstream' :
      identity.market && identity.market !== 'GLOBAL' && identity.market !== row.market ? 'source-market-mismatch' :
      known === null || observed === null ? 'missing-original-time' :
      known > now || observed > known ? 'future-or-backdated-time' :
      row.observationKind === 'historical-daily-bar' && !capturedHistoricalBar(row) ? 'invalid-historical-receipt-evidence' :
      chinaDay(observed) !== row.day && row.market === 'CN' && !capturedHistoricalBar(row) ? 'source-day-mismatch' :
      purpose !== 'liveExecution' && sessionClose === null ? 'missing-market-close-evidence' :
      purpose !== 'liveExecution' && (observed < sessionClose || known < sessionClose || now < sessionClose) ? 'incomplete-daily-close-evidence' :
      purpose === 'liveExecution' && (now - observed > config.quality.maxAgeMs || chinaDay(now) !== row.day) ? 'stale-live-evidence' :
      !/^[A-Z]{3}$/.test(row.currency || '') || row.volumeUnit !== 'shares' || row.amountUnit !== row.currency ? 'missing-or-incompatible-units' :
      shapeReason(row);
    if (reason) { rejected.push({code: row.code, day: row.day, source: row.source, originalAdjustment: row.originalAdjustment,
      knownAt: row.knownAt, observedAt: row.observedAt, reason}); continue; }
    row.publisher = identity.catalogGroup;
    const key = JSON.stringify([row.market, row.code, row.day, row.adjustment]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const comparisons = [];
  for (const [key, rows] of groups) {
    const [market, code, day, adjustment] = JSON.parse(key), publishers = rows.map(row => row.publisher);
    let status = rows.length < 2 ? 'missing-independent-source' : rows.length > 8 ? 'too-many-source-records' :
      new Set(publishers).size !== publishers.length ? 'duplicate-upstream-evidence' : null;
    let matched = [];
    if (!status) {
      const quorum = rows.length <= 3 ? 2 : Math.floor(rows.length / 2) + 1, coherent = [];
      for (let mask = 1; mask < 1 << rows.length; mask++) {
        const set = rows.filter((_, i) => mask & 1 << i);
        if (set.length < quorum || !set.every((row, i) => set.slice(i + 1).every(other => compatible(row, other, config)))) continue;
        coherent.push(set);
      }
      const largest = coherent.length ? Math.max(...coherent.map(set => set.length)) : 0;
      const winners = coherent.filter(set => set.length === largest);
      status = !largest ? 'source-value-or-time-conflict' : winners.length !== 1 ? 'ambiguous-source-groups' : 'admitted';
      if (status === 'admitted') matched = winners[0];
    }
    const support = new Set(matched.map(row => row.source));
    const comparison = {market, code, day, adjustment, status, independentSources: new Set(publishers).size,
      supportingSources: [...support], excludedSources: rows.filter(row => !support.has(row.source)).map(row => row.source),
      observations: rows.map(reference), canTrade: false};
    comparisons.push(comparison);
    if (matched.length) {
      const representative = [...matched].sort((a, b) => instant(b.knownAt) - instant(a.knownAt) || a.source.localeCompare(b.source))[0];
      admitted.push({...reference(representative), consensusKnownAt: Math.max(...matched.map(row => instant(row.knownAt))),
        supportingSources: [...support], evidence: matched.map(reference), canTrade: false});
    }
    for (const row of rows.filter(row => !support.has(row.source))) rejected.push({code, day, source: row.source,
      originalAdjustment: row.originalAdjustment, knownAt: row.knownAt, observedAt: row.observedAt,
      reason: matched.length ? 'outside-unique-consensus' : status});
  }
  return {status: admitted.length ? rejected.length ? 'partially-admitted' : 'admitted' : records.length ? 'blocked' : 'missing-data',
    purpose, expectedAdjustment: expected, inputRecords: records.length, admittedGroups: admitted.length,
    excludedRecords: rejected.length, comparableGroups: comparisons.filter(row => row.independentSources >= 2 && !['duplicate-upstream-evidence', 'too-many-source-records'].includes(row.status)).length,
    admitted, comparisons, rejected, note: '同 code/day/adjustment、原始时点与单位可比才核对；异常来源从中心研究集剔除；保留实际来源价格，不平均造价。',
    changesOriginalGates: false, canTrade: false};
}

function extractArchiveResearchInputs(archive, {now = Date.now()} = {}) {
  if (!archive || archive.scope === 'demo') return {bars: [], observations: [], rejected: [], catalog: installedCatalog, status: 'missing-real-archive'};
  const bars = (Array.isArray(archive.bars) ? archive.bars : []).filter(row => (row.role || 'stock') === 'stock' && dayOk(row.date));
  const catalog = (Array.isArray(archive.catalog) ? archive.catalog : installedCatalog).filter(row => Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 95);
  const observations = [], rejected = [], checks = Array.isArray(archive.checks) ? archive.checks : [];
  const ruleCoverage = {schema: numeric.PANEL, fullPanelChecks: 0, legacyPartialChecks: 0, invalidPanels: 0,
    rules: catalog.map(row => ({factorId: 'YZ-' + String(row.id).padStart(2,'0'), kind: row.kind, name: row.name,
      recordedChecks: 0, measuredChecks: 0, unknownChecks: 0, missingConditions: 0}))};
  if (bars.length > MAX_BARS || checks.length > MAX_CHECKS) throw Error('研究档案超过中心只读分析上限；请使用有明确范围的原档案切片');
  for (const check of checks) {
    const day = check.date, code = String(check.code || ''), recordedAt = instant(check.createdAt), asOf = instant(check.asOf);
    if (!real(check) || !dayOk(day) || !/^\d{6}$/.test(code) || !check.id || recordedAt === null || asOf === null ||
        recordedAt > now || asOf > recordedAt) { rejected.push({id: check.id || null, reason: 'invalid-or-unrecorded-check'}); continue; }
    const values = {}, evidence = {}, signalAt = Math.max(recordedAt, asOf);
    for (const [id, item] of Object.entries(check.factorObservations || {})) {
      if (id.startsWith('YZ-') && check.recognition?.ruleObservations) continue;
      const knownAt = instant(item?.knownAt);
      if (!/^[A-Z]{2,12}-\d{2,3}$/.test(id) || !item || !real(item) || item.symbol !== code || item.tradeDate !== day ||
          item.factorCode !== id || !finite(item.value) || typeof item.unit !== 'string' || !item.unit ||
          typeof item.source !== 'string' || !item.source || knownAt === null || knownAt > signalAt || chinaDay(knownAt) < day) {
        rejected.push({id: check.id, factorId: id, reason: 'invalid-or-future-factor-evidence'}); continue;
      }
      values[id] = item.value; evidence[id] = {...item, archiveCheckId: check.id, recordedAt: check.createdAt};
    }
    const panel = check.recognition?.ruleObservations;
    if (check.method === '行情自动识别' && panel) {
      const parsed = numeric.readRulePanel(panel, catalog, {code, day, at: signalAt, recordedAt: check.createdAt});
      if (archive.dictionaryVersion && panel.dictionaryVersion !== archive.dictionaryVersion)
        parsed.rejected.push({reason: 'rule-dictionary-version-mismatch'});
      if (parsed.rejected.length) {
        ruleCoverage.invalidPanels++;
        rejected.push(...parsed.rejected.map(row => ({id: check.id, ...row})));
      } else {
        ruleCoverage.fullPanelChecks++;
        for (const rule of panel.rules) {
          const summary = ruleCoverage.rules.find(row => row.factorId === rule.factorCode);
          summary.recordedChecks++; summary.missingConditions += [...rule.states].filter(value => value === '?').length;
          if (Object.hasOwn(parsed.values, rule.factorCode)) summary.measuredChecks++; else summary.unknownChecks++;
        }
        Object.assign(values, parsed.values);
        for (const [id, item] of Object.entries(parsed.evidence)) evidence[id] = {...item, archiveCheckId: check.id, recordedAt: check.createdAt};
      }
    }
    // Original 95 rules are observed only when an archived automatic check has
    // explicit complete condition statuses. Absence from matches means unknown.
    if (check.method === '行情自动识别' && !panel) {
      ruleCoverage.legacyPartialChecks++;
      for (const candidate of check.recognition?.candidates || []) {
      const definition = catalog.find(row => row.name === candidate.name), total = definition?.factors?.length;
      if (!total || candidate.total !== total || !Number.isSafeInteger(candidate.matched) || candidate.matched < 0 ||
          !Array.isArray(candidate.failed) || !Array.isArray(candidate.missing) || candidate.missing.length ||
          new Set(candidate.failed).size !== candidate.failed.length || candidate.failed.some(name => !definition.factors.includes(name)) ||
          candidate.matched + candidate.failed.length !== total) continue;
      const id = 'YZ-' + String(definition.id).padStart(2, '0');
      if (Object.hasOwn(values, id)) continue;
      values[id] = candidate.matched / total * 100;
      evidence[id] = {factorCode: id, symbol: code, tradeDate: day, value: values[id], unit: 'condition-match-percent',
        knownAt: check.createdAt, source: 'shortline-recorded-condition-status', archiveCheckId: check.id,
        matched: candidate.matched, failed: [...candidate.failed], total, sampleSet: 'real'};
      }
    }
    if (Object.keys(values).length) observations.push({id: check.id, market: typeof check.market === 'string' ? check.market : 'CN', code, day,
      signalAt, recordedAt: check.createdAt, asOf: check.asOf, values, evidence,
      regime: check.market?.systemicSelloff === true ? 'systemic-selloff' : check.market?.systemicSelloff === false ? 'not-systemic-selloff' : null,
      cycle: check.emotion?.stage || 'unknown'});
  }
  return {status: bars.length || observations.length ? 'observed' : 'missing-data', bars, observations, rejected, catalog, ruleCoverage};
}

function alignFactorOutcomes(observations, gate, marketCalendars, {now = Date.now()} = {}) {
  const alignment = intersectMarketDates(marketCalendars, {now}), common = new Set(alignment.days), samples = [], rejected = [];
  const prices = new Map(gate.admitted.map(row => [JSON.stringify([row.market, row.code, row.day]), row]));
  const seen = new Set();
  for (const observation of [...observations].sort((a, b) => a.signalAt - b.signalAt || a.id.localeCompare(b.id))) {
    const {market, code, day, signalAt} = observation, calendar = alignment.calendars[market], index = calendar?.days.indexOf(day) ?? -1;
    const nextEvidence = calendar?.nextEvidenceByDay?.[day];
    const targetDay = index >= 0 ? calendar.nextEvidenceByDay ? nextEvidence?.nextTradingDay : calendar.days[index + 1] : null;
    const current = prices.get(JSON.stringify([market, code, day])), target = prices.get(JSON.stringify([market, code, targetDay]));
    const open = targetDay ? marketOpen(calendar, market, targetDay) : null;
    const currentClose = marketClose(calendar, market, day), targetClose = targetDay ? marketClose(calendar, market, targetDay) : null;
    const key = JSON.stringify([market, code, day]);
    const reason = !common.has(day) || !targetDay ? 'missing-aligned-trading-calendar' :
      alignment.markets.length > 1 && !common.has(targetDay) ? 'cross-market-label-date-mismatch' :
      open === null ? 'missing-market-session-open' :
      (nextEvidence ? instant(nextEvidence.knownAt) : calendar.knownAtMs) > signalAt ? 'calendar-known-after-signal' : signalAt >= open ? 'check-first-known-after-next-open' :
      marketDay(signalAt, market) !== day ? 'check-first-known-outside-signal-day' :
      !current || !target ? 'missing-admitted-hfq-price-pair' : current.suspended === true || target.suspended === true ? 'suspended-label-window' :
      currentClose === null || targetClose === null ? 'missing-market-session-close' :
      instant(current.observedAt) < currentClose || current.consensusKnownAt < currentClose ||
        instant(target.observedAt) < targetClose || target.consensusKnownAt < targetClose || now < targetClose ? 'incomplete-daily-close-evidence' :
      current.consensusKnownAt > signalAt ? 'signal-price-first-known-after-signal' :
      signalAt >= target.consensusKnownAt ? 'signal-not-before-label-knowledge' :
      target.consensusKnownAt > now ? 'unmatured-label' : seen.has(key) ? 'duplicate-symbol-day-check' : null;
    if (reason) { rejected.push({id: observation.id, code, day, targetDay, reason}); continue; }
    seen.add(key);
    samples.push({...observation, targetDay, returnPct: (target.close / current.close - 1) * 100,
      labelKnownAt: target.consensusKnownAt, priceEvidence: {signal: reference(current), target: reference(target)},
      adjustment: 'hfq', canTrade: false});
  }
  return {status: samples.length ? 'aligned' : 'missing-aligned-samples', samples, rejected, alignment,
    label: 't 日冻结因子 → 同一市场下一交易日 t+1 收盘价格变化；这是研究标签，未扣费且不是模拟成交收益。'};
}

function factorMetrics(samples, ids, minRows) {
  const groups = new Map(), markets = [...new Set(samples.map(row => row.market))].sort();
  for (const row of samples) { const key = JSON.stringify([row.day, row.market]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  return Object.fromEntries(ids.map(id => {
    const definitions = [...new Set(samples.filter(row => finite(row.values[id])).map(row =>
      numeric.fingerprint(numeric.numericDefinition(id,row.evidence?.[id]))))];
    if (definitions.length > 1) return [id,{factorId:id,status:'mixed-factor-definition-versions',meanIC:null,days:0,daily:[],
      reliability:assessFactorReliability([]),byMarket:{},definitionVersions:definitions,minCrossSection:minRows,
      note:'同名因子的量化定义或阈值版本变化，不能混为同一个有效IC。'}];
    const byDay = new Map();
    for (const [key, rows] of groups) {
      const [day, market] = JSON.parse(key), usable = rows.filter(row => finite(row.values[id]) && finite(row.returnPct));
      const ic = usable.length >= minRows ? spearman(usable.map(row => row.values[id]), usable.map(row => row.returnPct)) : null;
      if (ic === null) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      const regimes = [...new Set(usable.map(row => row.regime))];
      byDay.get(day).push({day, market, ic, count: usable.length, regime: regimes.length === 1 ? regimes[0] : null});
    }
    const daily = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).filter(([, rows]) => rows.length === markets.length)
      .map(([day, rows]) => ({day, ic: mean(rows.map(row => row.ic)), samples: rows.reduce((sum, row) => sum + row.count, 0),
        regime: new Set(rows.map(row => row.regime)).size === 1 ? rows[0].regime : null, markets: rows}));
    const measured = daily.slice(-400), reliability = assessFactorReliability(measured);
    const byMarket = Object.fromEntries(markets.map(market => {
      const rows = measured.flatMap(row => row.markets.filter(item => item.market === market));
      return [market, {days: rows.length, meanIC: round(mean(rows.map(row => row.ic))), reliability: assessFactorReliability(rows)}];
    }));
    return [id, {factorId: id, status: measured.length ? 'observed' : 'insufficient-cross-section',
      meanIC: round(mean(measured.map(row => row.ic))), days: measured.length, daily: measured, reliability, byMarket,
      excludedEarlierDays: Math.max(0, daily.length - 400), minCrossSection: minRows, definitionVersions:definitions}];
  }));
}
function rankPercent(values) {
  const rows = values.map((value, index) => ({value, index})).sort((a, b) => a.value - b.value), ranks = [];
  for (let i = 0; i < rows.length;) { let j = i + 1; while (j < rows.length && rows[j].value === rows[i].value) j++;
    for (let k = i; k < j; k++) ranks[rows[k].index] = (i + j - 1) / 2 / Math.max(1, rows.length - 1) * 100; i = j; }
  return ranks;
}
function redundancyReport(train, ids, metrics, minRows, config) {
  const byDay = new Map(), pairs = [], markets = new Set(train.map(row => row.market));
  for (const row of train) { const key = JSON.stringify([row.day, row.market]); if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(row); }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j], dates = new Map();
    for (const [key, rows] of byDay) {
      const [day, market] = JSON.parse(key);
      const usable = rows.filter(row => finite(row.values[a]) && finite(row.values[b]));
      if (usable.length < minRows) continue;
      const ar = rankPercent(usable.map(row => row.values[a])), br = rankPercent(usable.map(row => row.values[b]));
      if (!dates.has(day)) dates.set(day, {day, rows: [], markets: new Set()});
      const record = dates.get(day); record.markets.add(market);
      record.rows.push(...usable.map((row, k) => ({values: {[a]: ar[k], [b]: br[k]}})));
    }
    const days = [...dates.values()].filter(row => row.markets.size === markets.size).sort((a, b) => a.day.localeCompare(b.day));
    const report = assessFactorRedundancy(days.slice(-400), [a, b], {[a]: metrics[a].reliability, [b]: metrics[b].reliability});
    // The shared report rounds display correlations. A tighter configured gate
    // must use the original rank statistic, not that rounded display number.
    const correlations = days.slice(-400).map(row => spearman(row.rows.map(item => item.values[a]), row.rows.map(item => item.values[b])))
      .filter(finite).sort((lhs, rhs) => lhs - rhs);
    const middle = Math.floor(correlations.length / 2), median = correlations.length ? correlations.length % 2 ? correlations[middle] :
      (correlations[middle - 1] + correlations[middle]) / 2 : null;
    pairs.push(...report.pairs.map(pair => ({...pair, configuredRankCorrelationCutoff: config.factors.redundancyAbsCorrelation,
      requiredDays: Math.max(pair.requiredDays, config.factors.minIcDays),
      eligibleForSuppression: pair.eligibleForSuppression && median !== null && median >= config.factors.redundancyAbsCorrelation &&
        pair.comparableDays >= config.factors.minIcDays})));
  }
  // Suppress only against an actually retained factor. Pairwise suppression
  // alone could remove C through an already-removed B even when A/C differ.
  const ordered = [...ids].sort((a, b) => (metrics[b].reliability.meanIC ?? -1) - (metrics[a].reliability.meanIC ?? -1) || a.localeCompare(b));
  const retained = [], suppressed = [];
  for (const id of ordered) {
    const duplicateOf = retained.find(kept => pairs.some(pair => pair.eligibleForSuppression &&
      (pair.factorA === id && pair.factorB === kept || pair.factorB === id && pair.factorA === kept)));
    if (duplicateOf) suppressed.push({factorId: id, duplicateOf, maxShadowAdjustment: -.02}); else retained.push(id);
  }
  return {status: pairs.length ? 'evaluated-training-only' : 'insufficient-factor-pairs', pairs,
    retainedFactorIds: retained, suppressedFactors: suppressed, canTrade: false, productionWeightsChanged: false};
}

/** Fit centering, scaling and projections using TRAIN data only. */
function fitOrthogonalFactors(train, ids, {minRows = 5} = {}) {
  const parameters = [], basis = [], suppressed = [], definitions = {};
  const stableIds = ids.filter(id => {
    const found = train.filter(row => finite(row.values[id])).map(row => numeric.numericDefinition(id,row.evidence?.[id]));
    if (new Set(found.map(numeric.stable)).size > 1) { suppressed.push({factorId:id,reason:'definition-change-in-training'}); return false; }
    if (found.length) definitions[id] = found[0]; return true;
  });
  const complete = train.filter(row => stableIds.every(id => finite(row.values[id])));
  if (!ids.length || complete.length < minRows) return {status: 'insufficient-complete-training-rows', parameters, suppressed,
    completeTrainingRows: complete.length, trainingRows: train.length, trainedThrough: null, trainingFingerprint: hash([])};
  for (const id of stableIds) {
    const xs = complete.map(row => row.values[id]), center = mean(xs), scale = Math.sqrt(mean(xs.map(value => (value - center) ** 2)));
    if (!finite(center) || !finite(scale)) { suppressed.push({factorId: id, reason: 'unstable-training-moments'}); continue; }
    if (scale <= 1e-12) { suppressed.push({factorId: id, reason: 'constant-training-factor'}); continue; }
    let residual = xs.map(value => (value - center) / scale); const projections = [];
    for (const prior of basis) {
      const coefficient = residual.reduce((sum, value, i) => sum + value * prior.values[i], 0) /
        prior.values.reduce((sum, value) => sum + value * value, 0);
      residual = residual.map((value, i) => value - coefficient * prior.values[i]);
      projections.push({factorId: prior.id, coefficient});
    }
    const residualScale = Math.sqrt(mean(residual.map(value => value * value)));
    if (!finite(residualScale) || projections.some(row => !finite(row.coefficient))) { suppressed.push({factorId: id, reason: 'unstable-training-projections'}); continue; }
    if (residualScale <= 1e-8) { suppressed.push({factorId: id, reason: 'linearly-redundant-in-training'}); continue; }
    parameters.push({factorId: id, center, scale, projections, residualScale});
    basis.push({id, values: residual.map(value => value / residualScale)});
  }
  return {status: parameters.length ? 'frozen-training-fit' : 'no-varying-training-factors', parameters, suppressed, definitions,
    completeTrainingRows: complete.length, trainingRows: train.length,
    trainedThrough: [...new Set(complete.map(row => row.day))].sort().at(-1),
    trainingFingerprint: hash({ids, rows: complete.map(row => ({id: row.id, market: row.market, code: row.code, day: row.day,
      values: row.values, returnPct: row.returnPct, labelKnownAt: row.labelKnownAt}))}),
    note: '缺失值不补 0；训练均值、尺度和投影系数冻结后应用于验证和测试。', productionWeightsChanged: false};
}
function applyOrthogonalFactors(rows, model) {
  return rows.map(row => {
    const values = {};
    for (const parameter of model.parameters) {
      const id = parameter.factorId;
      if (!finite(row.values[id]) || model.definitions && numeric.stable(model.definitions[id]) !== numeric.stable(numeric.numericDefinition(id,row.evidence?.[id])) ||
          parameter.projections.some(p => !finite(values[p.factorId]))) continue;
      let value = (row.values[id] - parameter.center) / parameter.scale;
      for (const projection of parameter.projections) value -= projection.coefficient * values[projection.factorId];
      const residual = value / parameter.residualScale;
      if (finite(residual)) values[id] = residual;
    }
    return {...row, values};
  });
}

function buildWalkForward(samples, alignment, {config = defaults, now = Date.now()} = {}) {
  checkedConfig(config);
  const ids = [...new Set(samples.flatMap(row => Object.keys(row.values)))].sort();
  if (ids.length > MAX_FACTORS) throw Error('实际因子数量超过中心研究上限');
  const s = config.walkforward, total = s.trainDays + s.validationDays + s.testDays + s.purgeTradingDays * 2;
  const first = samples.map(row => row.day).sort()[0], last = samples.map(row => row.day).sort().at(-1);
  const days = alignment.days.filter(day => day >= first && day <= last && day <= chinaDay(now)), folds = [];
  const startIndices = [];
  for (let start = 0; start + total <= days.length; start += s.stepDays) startIndices.push(start);
  for (const start of startIndices.slice(-s.maxFolds)) {
    const windowDays = days.slice(start, start + total);
    if (alignment.markets.some(market => {
      const calendar = alignment.calendars[market];
      return calendar.nextEvidenceByDay && windowDays.slice(0, -1).some((day, i) =>
        calendar.nextEvidenceByDay[day]?.nextTradingDay !== windowDays[i + 1]);
    })) continue;
    const trainDays = days.slice(start, start + s.trainDays), validationStart = start + s.trainDays + s.purgeTradingDays;
    const validationDays = days.slice(validationStart, validationStart + s.validationDays);
    const testStart = validationStart + s.validationDays + s.purgeTradingDays, testDays = days.slice(testStart, testStart + s.testDays);
    const phaseDays = {train: trainDays, validation: validationDays, test: testDays};
    const opens = targetDay => alignment.markets.map(market => marketOpen(alignment.calendars[market], market, targetDay));
    const trainingOpens = opens(validationDays[0]), validationOpens = opens(testDays[0]);
    if (trainingOpens.some(at => at === null) || validationOpens.some(at => at === null)) continue;
    const trainCutoff = Math.min(...trainingOpens), validationCutoff = Math.min(...validationOpens);
    const phases = Object.fromEntries(Object.entries(phaseDays).map(([phase, dates]) => {
      const set = new Set(dates), cutoff = phase === 'train' ? trainCutoff : phase === 'validation' ? validationCutoff : now;
      return [phase, samples.filter(row => set.has(row.day) && row.labelKnownAt < cutoff &&
        (phase === 'train' ? row.targetDay < validationDays[0] : phase === 'validation' ? row.targetDay < testDays[0] : true))];
    }));
    const trainingIds = [...new Set(phases.train.flatMap(row => Object.keys(row.values)))].sort();
    const raw = Object.fromEntries(Object.entries(phases).map(([phase, rows]) => [phase, factorMetrics(rows, trainingIds, config.factors.minCrossSection)]));
    const ordered = [...trainingIds].sort((a, b) => (raw.train[b]?.meanIC ?? -2) - (raw.train[a]?.meanIC ?? -2) || a.localeCompare(b));
    const model = fitOrthogonalFactors(phases.train, ordered, {minRows: config.factors.minCrossSection});
    const orthogonalIds = model.parameters.map(row => row.factorId);
    const orthogonal = Object.fromEntries(Object.entries(phases).map(([phase, rows]) => [phase,
      factorMetrics(applyOrthogonalFactors(rows, model), orthogonalIds, config.factors.minCrossSection)]));
    const strata = Object.fromEntries(Object.entries(phases).map(([phase, rows]) => [phase,
      Object.fromEntries([...new Set(rows.map(row => row.cycle || 'unknown'))].map(cycle => [cycle,
        {samples: rows.filter(row => (row.cycle || 'unknown') === cycle).length,
          factors: factorMetrics(rows.filter(row => (row.cycle || 'unknown') === cycle), trainingIds, config.factors.minCrossSection)}]))]));
    folds.push({id: 'wf-' + trainDays[0] + '-' + testDays.at(-1),
      status: trainingIds.some(id => raw.train[id].days >= config.factors.minIcDays && raw.validation[id].days >= 5 && raw.test[id].days >= 5) ? 'evaluated' : 'insufficient-phase-samples',
      factorIds: trainingIds,
      ranges: Object.fromEntries(Object.entries(phaseDays).map(([phase, dates]) => [phase, {start: dates[0], end: dates.at(-1), tradingDays: dates.length, samples: phases[phase].length}])),
      purgeTradingDays: s.purgeTradingDays, raw, orthogonal, orthogonalization: model,
      redundancy: redundancyReport(phases.train, trainingIds, raw.train, config.factors.minCrossSection, config), strata,
      maxTrainingLabelKnownAt: phases.train.length ? Math.max(...phases.train.map(row => row.labelKnownAt)) : null,
      calendarEvidenceFingerprint: hash(alignment.calendars),
      inputEvidenceFingerprint: hash(Object.fromEntries(Object.entries(phases).map(([phase, rows]) => [phase,
        rows.map(row => ({id: row.id, market: row.market, code: row.code, day: row.day, signalAt: row.signalAt,
          values: row.values, labelKnownAt: row.labelKnownAt, priceEvidence: row.priceEvidence, evidence: row.evidence}))]))),
      trainLabelCutoff: new Date(trainCutoff).toISOString(), validationLabelCutoff: new Date(validationCutoff).toISOString(),
      productionWeightsChanged: false, canTrade: false});
  }
  return {status: folds.length ? folds.some(fold => fold.status === 'evaluated') ? 'evaluated' : 'insufficient-phase-samples' : 'insufficient-trading-days',
    method: 'rolling-train-validation-test', requiredTradingDays: total, availableTradingDays: days.length,
    factorIds: ids, folds, omittedEarlierFolds: Math.max(0, startIndices.length - s.maxFolds),
    adjustment: config.adjustment.backtest, canTrade: false, productionWeightsChanged: false,
    note: '训练、验证、测试按交易日分层，边界清除 t→t+1 重叠标签；正交化与权重建议只拟合训练集；收益是未扣费标签 IC，既有账本回测及批准门禁仍生效。'};
}

function numericScoringState(version) {
  return {weights: version.weights, threshold: version.threshold, strategyThresholds: version.strategyThresholds,
    minSupport: version.minSupport, numericModel: version.numericModel || null};
}
function validApprovedNumeric(version, dictionaryVersion) {
  return Boolean(version?.numericModel && numeric.validModel(version.numericModel) &&
    (!dictionaryVersion || version.numericModel.dictionaryVersion === dictionaryVersion) &&
    numeric.stable(version.weights) === numeric.stable(version.numericModel.weights) &&
    version.scoringFingerprint === numeric.fingerprint(numericScoringState(version)));
}
function observationVector(row) {
  return {values: row.values, definitions: Object.fromEntries(Object.keys(row.values).map(id => [id,numeric.numericDefinition(id,row.evidence?.[id])]))};
}
function buildApprovedScoring(archive, observations, {day, now, calendars}) {
  const approved = [...(archive?.versions || [])].filter(row => real(row) && row.sampleScope !== 'demo' &&
    instant(row.approvedAt) !== null && instant(row.approvedAt) <= now).sort((a,b) => instant(b.approvedAt)-instant(a.approvedAt))[0];
  const valid = validApprovedNumeric(approved, archive?.dictionaryVersion), rows = [];
  const report = {status: !approved?.numericModel ? 'missing-approved-numeric-model' : valid ? 'missing-current-observations' : 'invalid-approved-numeric-model',
    factorSchema: numeric.MODEL, day, asOf: now, modelVersion: approved?.numericModel ? approved.number : null,
    approvedAt: approved?.numericModel ? approved.approvedAt : null, modelFingerprint: valid ? approved.numericModel.fingerprint : null,
    trainCutoff: valid ? approved.numericModel.trainCutoff : null,
    trainingSignalStart: valid ? approved.numericModel.trainingSignalStart : null,
    trainingSignalEnd: valid ? approved.numericModel.trainingSignalEnd : null,
    trainingLabelKnownAtMax: valid ? approved.numericModel.trainingLabelKnownAtMax : null,
    rows, canTrade: false, changesOriginalGates: false,
    note: '仅使用人工批准且完整指纹匹配的数值模型；本次评分时刻与原观察时刻分开。缺定义或缺观测不补分。'};
  if (!valid) return report;
  const latest = new Map();
  for (const row of observations) if (row.day === day && row.signalAt <= now && (!latest.has(row.code) || latest.get(row.code).signalAt < row.signalAt)) latest.set(row.code,row);
  for (const row of latest.values()) {
    const scored = numeric.numericScore(approved.numericModel,observationVector(row));
    const calendar=calendarView(calendars?.[row.market],now,row.market),index=calendar.days.indexOf(row.day);
    const edge=calendar.nextEvidenceByDay?.[row.day],targetDay=index<0?null:calendar.nextEvidenceByDay?edge?.nextTradingDay||null:calendar.days[index+1]||null;
    const calendarKnownAt=instant(edge?edge.knownAt:calendar.knownAt),targetOpenAt=targetDay?marketOpen(calendar,row.market,targetDay):null;
    const missing=[...scored.missing,
      (!targetDay||targetDay!==calendar.days[index+1])&&'缺少原日历的相邻下一交易日',
      (calendarKnownAt===null||calendarKnownAt>row.signalAt)&&'下一交易日日历在原观察后才取得',
      (marketDay(row.signalAt,row.market)!==row.day||targetOpenAt===null||row.signalAt>=targetOpenAt)&&'观察时点不属于原信号日或已越过目标开盘',
      instant(approved.approvedAt)>row.signalAt&&'数值模型在原信号后才批准',
      (!finite(approved.numericModel.trainingLabelKnownAtMax)||approved.numericModel.trainingLabelKnownAtMax>=instant(approved.approvedAt))&&'缺少批准前已成熟的训练标签时点',
      (instant(approved.numericModel.trainCutoff)===null||instant(approved.numericModel.trainCutoff)>instant(approved.approvedAt))&&'模型训练截止晚于批准时点'].filter(Boolean);
    rows.push({code: row.code, day, signalDay:row.day,targetDay,targetOpenAt,calendarKnownAt,calendarSource:edge?.source||calendar.source,
      eligibleForNextSession:!missing.length&&finite(scored.score),score: finite(scored.score) ? round(scored.score) : null,
      threshold: approved.threshold ?? null, passesResearchThreshold: finite(scored.score) && finite(approved.threshold) ? scored.score > approved.threshold : null,
      modelVersion: approved.number, modelFingerprint: approved.numericModel.fingerprint,
      sourceCheckId: row.originCheckId || row.id, observationAt: row.signalAt, scoredAt: now, missing,
      factorCount: approved.numericModel.parameters.length, canTrade: false});
  }
  if (rows.some(row => row.eligibleForNextSession)) report.status = 'ready';
  else if (rows.length) report.status = 'missing-compatible-factor-observations';
  return report;
}

function feedbackReport(archive, walkforward, gate, now, config, quality, day, samples = []) {
  const plans = new Map((archive?.plans || []).filter(row => real(row) && row.id).map(row => [row.id, row]));
  const trades = [], excluded = [];
  for (const trade of archive?.trades || []) {
    const plan = plans.get(trade.planId), created = instant(trade.createdAt),
      entry = instant(trade.entryTimestamp ?? trade.entryTime), exit = instant(trade.exitTimestamp ?? trade.exitTime), frozen = instant(plan?.frozenAt);
    const reason = !real(trade) || archive?.scope === 'demo' ? 'non-real-sample' : !plan || frozen === null || entry === null || frozen > entry || plan.code !== trade.code ? 'missing-prior-frozen-plan' :
      created === null || exit === null || exit <= entry || exit > created || created > now || !finite(trade.pnl) ? 'unmatured-or-unrecorded-trade' : null;
    if (reason) { excluded.push({id: trade.id || null, reason}); continue; }
    trades.push(trade);
  }
  const approved = [...(archive?.versions || [])].filter(row => real(row) && row.sampleScope !== 'demo' && instant(row.approvedAt) !== null &&
    instant(row.approvedAt) <= now && row.weights && typeof row.weights === 'object').sort((a, b) => instant(b.approvedAt) - instant(a.approvedAt))[0];
  const latest = walkforward.folds.filter(row => row.status === 'evaluated').at(-1), candidates = [];
  const numericBaseline = validApprovedNumeric(approved,archive?.dictionaryVersion);
  let metrics = approved?.numericModel && !numericBaseline ? null : latest?.raw;
  if (latest && numericBaseline) {
    // A coefficient belongs to its approved basis. Re-fitting another basis and
    // retaining the same code would silently change the meaning of that weight.
    const ids = approved.numericModel.parameters.map(row => row.factorId);
    metrics = Object.fromEntries(['train','validation','test'].map(phase => {
      const range = latest.ranges[phase], cutoff = phase === 'train' ? instant(latest.trainLabelCutoff) : phase === 'validation' ? instant(latest.validationLabelCutoff) : now;
      const eligible = samples.filter(row => row.day >= range.start && row.day <= range.end && row.labelKnownAt < cutoff &&
        (phase === 'train' ? row.targetDay < latest.ranges.validation.start : phase === 'validation' ? row.targetDay < latest.ranges.test.start : true));
      const transformed = eligible.map(row => ({...row,values:numeric.projectNumeric(row.values,approved.numericModel,observationVector(row).definitions)}));
      return [phase,factorMetrics(transformed,ids,config.factors.minCrossSection)];
    }));
  }
  if (latest && metrics) for (const [id, metric] of Object.entries(metrics.train)) {
    const reliability = metric.reliability, validation = metrics.validation[id], test = metrics.test[id];
    if (!reliability.reliable || !finite(reliability.suggestedWeightMultiplier) || reliability.suggestedWeightMultiplier === 0) continue;
    if (Object.values(metric.byMarket || {}).some(row => !row.reliability.reliable || Math.sign(row.meanIC) !== Math.sign(metric.meanIC))) continue;
    const duplicate = !numericBaseline && latest.redundancy.suppressedFactors.some(row => row.factorId === id);
    const delta = Math.max(-config.factors.maxCandidateWeightChange, Math.min(config.factors.maxCandidateWeightChange,
      duplicate ? Math.min(-.02, reliability.suggestedWeightMultiplier) : reliability.suggestedWeightMultiplier));
    const old = finite(approved?.weights[id]) && (!id.startsWith('YZ-') || numericBaseline) ? approved.weights[id] : null;
    candidates.push({factorId: id, status: 'pending-validation', multiplier: round(1 + delta),
      baselineVersion: approved?.number || null, baselineWeight: old, candidateWeight: old === null ? null : round(old * (1 + delta)),
      baselineStatus: old === null ? id.startsWith('YZ-') && approved && !numericBaseline ? 'incompatible-legacy-presence-weight' : 'missing-approved-factor-weight' : 'observed-approved-weight',
      factorSchema: numericBaseline ? numeric.MODEL : 'legacy-presence-weights', metricBasis: numericBaseline ? 'approved-frozen-orthogonal-basis' : 'raw-factor-ic',
      sourceFold: latest.id, trainingFingerprint: latest.orthogonalization.trainingFingerprint,
      evidence: {trainingIC: metric.meanIC, validationIC: validation?.meanIC ?? null, testIC: test?.meanIC ?? null,
        matureRelatedTrades: trades.filter(row => (row.factors || []).includes(id)).length},
      redundancySuppressed: duplicate, approvalRequired: true, productionWeightsChanged: false,
      nextGate: '服务端复算同一提案并经过原五项验证，再由 learn:decision 人工批准；读取本报告不写入档案'});
  }
  const reasons = new Map();
  for (const row of gate.rejected) {
    if (!['source-value-or-time-conflict', 'outside-unique-consensus', 'invalid-ohlcv-amount', 'future-or-backdated-time'].includes(row.reason)) continue;
    if (!reasons.has(row.reason)) reasons.set(row.reason, []);
    reasons.get(row.reason).push(row);
  }
  const qualityCandidates = [...reasons].map(([reason, evidence]) => ({status: 'source-evidence-recorded', type: 'quality-evidence-review',
    reason, affectedRecords: evidence.length, evidence: evidence.slice(0, 12), evidenceFingerprint: hash(evidence),
    proposedScore: quality.score, scoreStatus: quality.status, scoreRole: 'current-evidence-derived-Q', proposedComponents: quality.components.map(row => ({id: row.id,
      value: row.value, weight: row.weight, evidence: row.evidence})), qualityEvidenceFingerprint: hash(quality.components),
    appliedToCenterQuality: true, changesOriginalGates: false, approvalRequired: false, productionWeightsChanged: false,
    note: '附本次原始审计复算的 Q 及各分量：可比较冲突进入一致性，OHLCV 异常进入异常分量，时点违规继续隔离。未知仍为空，不按策略输赢改分或改变固定权重。'}));
  const baseline = approved ? {number: approved.number, approvedAt: approved.approvedAt, weights: approved.weights,
    threshold: approved.threshold, strategyThresholds: approved.strategyThresholds, minSupport: approved.minSupport,
    ...(approved.numericModel ? {numericModel:approved.numericModel,scoringFingerprint:approved.scoringFingerprint} : {})} : null;
  const compatible = candidates.filter(row => finite(row.baselineWeight) && finite(row.candidateWeight) && row.candidateWeight !== row.baselineWeight);
  const proposal = latest && compatible.length && baseline ? {schemaVersion: 1, day,
    dictionaryVersion: archive?.dictionaryVersion || null, catalogFingerprint: hash(installedCatalog),
    archiveRevision: Number.isSafeInteger(archive?.revision) ? archive.revision : null,
    baselineVersion: baseline.number, baselineFingerprint: hash(baseline), baselineApprovedAt: baseline.approvedAt,
    sourceFold: latest.id, ranges: latest.ranges, trainingFingerprint: latest.orthogonalization.trainingFingerprint,
    maxTrainingLabelKnownAt: latest.maxTrainingLabelKnownAt, inputEvidenceFingerprint: latest.inputEvidenceFingerprint,
    calendarEvidenceFingerprint: latest.calendarEvidenceFingerprint,
    matureTradeEvidenceFingerprint: hash(trades.map(row => ({trade: row, frozenPlan: plans.get(row.planId)}))),
    changes: compatible.map(row => ({factorId: row.factorId, baselineWeight: row.baselineWeight,
      candidateWeight: row.candidateWeight, multiplier: row.multiplier})), matureTradeIds: trades.map(row => row.id).sort()} : null;
  if (proposal && numericBaseline) {
    const weights={...approved.weights};for(const change of proposal.changes)weights[change.factorId]=change.candidateWeight;
    proposal.factorSchema=numeric.MODEL;
    proposal.numericModel=numeric.sealModel({...approved.numericModel,weights,
      adjustment:{parentModelFingerprint:approved.numericModel.fingerprint,sourceFold:latest.id,
        trainingFingerprint:latest.inputEvidenceFingerprint,method:'bounded-train-ic-on-approved-basis'}});
  }
  const proposalFingerprint = proposal ? hash(proposal) : null;
  const missing = [!approved && '缺少原已审批权重基线', !latest && '缺少有效后复权 walk-forward 窗口',
    !compatible.length && '缺少与原获批因子同名且有实际调整的提案', !archive?.dictionaryVersion && '缺少因子词典版本',
    trades.length < 36 && '需至少 36 条有事前冻结计划的成熟成交',
    approved?.numericModel && !numericBaseline && '获批数值模型、词典或评分指纹不一致'].filter(Boolean);
  const strata = {standard: 0, blackSwan: 0, extreme: 0};
  for (const row of trades) { const key = row.blackSwan === true || row.quality === '黑天鹅' ? 'blackSwan' :
    row.extreme === true || row.repeatable === false || row.quality === '不可复制极端行情' ? 'extreme' : 'standard'; strata[key]++; }
  return {status: candidates.length || qualityCandidates.length ? 'candidates-pending-validation' : trades.length ? 'observed-no-new-candidate' : 'missing-mature-review-evidence',
    matureTrades: trades.length, excludedTrades: excluded, strata, candidates, qualityCandidates,
    proposal, proposalFingerprint, archiveRevision: Number.isSafeInteger(archive?.revision) ? archive.revision : null,
    qualityFeedback: {mode: 'verified-source-evidence', score: quality.score, status: quality.status,
      components: quality.components, evidenceFingerprint: hash(quality.components), affectedRecords: qualityCandidates.reduce((n, row) => n + row.affectedRecords, 0),
      fixedWeights: {...config.quality.weights}, appliedToCenterQuality: true, strategyProfitChangesQuality: false, changesOriginalGates: false},
    archivedCandidates: (archive?.candidates || []).filter(row => real(row) && row.sampleScope !== 'demo' && instant(row.createdAt) !== null && instant(row.createdAt) <= now)
      .slice(-20).map(row => ({id: row.id, createdAt: row.createdAt, status: row.status, baseVersion: row.baseVersion, counts: row.counts})),
    validationBridge: {endpoint: '/api/decision-center/feedback', generateAction: 'learn:candidate', importAction: 'learn:center-feedback', automaticAction: 'learn:auto-candidate',
      approvalAction: 'learn:decision', approveDecision: 'approve', requiresCurrentRevision: true, requiresEditorRole: true,
      proposalImportSupported: true, ready: Boolean(proposal) && !missing.length, missing,
      readReportWrites: false, originalAutomaticLoopChanged: false,
      numericModelInitialization: {action:'learn:candidate',approvalAction:'learn:decision',
        status:numericBaseline?'approved-numeric-baseline':'requires-real-settlement-training-and-five-gates',
        note:'首份数值基线由原候选生成入口使用事前观察与真实净结算训练、五项验证、人工批准；旧boolean权重不映射为YZ数值权重。'},
      note: '只接受日期、档案版本和提案指纹；服务端从同一档案与历史证据复算全部权重，沿用原五项验证、留出期隔离和人工审批。数值调权固定在同一获批正交基底；缺少同定义获批权重、成熟成交或独立窗口时阻断。'},
    approvalRequired: true, productionWeightsChanged: false, canTrade: false};
}

function templateGroups(catalog, observations) {
  const definitions = [
    {id: 'first-board', name: '首板', ruleIds: [8, 12, 18], match: 'related-existing-rules',
      missing: ['需原始首板身份、题材与竞价/封单证据同时齐备；模板本身不生成候选票']},
    {id: 'one-to-two', name: '一进二', ruleIds: [45, 6, 47], match: 'related-existing-rules',
      missing: ['一进二结果仍读取既有同日策略池；95库放量二板规则不替代既有一进二门禁']},
    {id: 'weak-to-strong-reversal', name: '弱转强反包', ruleIds: [2, 10, 29, 47], match: 'related-existing-rules',
      missing: ['需断板前后原始日 K、回流量价及板块同步证据，未知条件不视为通过']},
    {id: 'three-to-four', name: '三进四', ruleIds: [6, 42], match: 'implemented-evidence-evaluator',
      missing: ['新增三进四分水岭独立定义，待原始证据齐备及独立样本外验证']},
    {id: 'leader', name: '龙头', ruleIds: [1, 17, 26, 27, 50], match: 'related-existing-rules',
      missing: ['需同日龙头身份、主线、助攻、位置与封单等原始证据']},
    {id: 'emotion-timing', name: '情绪择时', ruleIds: [18, 39, 67, 71, 77, 78, 87, 95], match: 'related-existing-rules',
      missing: ['需同日市场宽度/涨跌停/封板率及历史情绪；不以价格涨幅单独替代情绪状态']}
  ];
  return definitions.map(group => {
    const rules = group.ruleIds.map(id => catalog.find(row => row.id === id)).filter(Boolean).map(row => ({
      code: 'YZ-' + String(row.id).padStart(2, '0'), name: row.name, kind: row.kind, conditions: [...row.factors]}));
    const ids = new Set(rules.map(row => row.code));
    return {...group, status: rules.length === group.ruleIds.length ? group.match : 'missing-catalog-rules', rules,
      missingRuleIds: group.ruleIds.filter(id => !catalog.some(row => row.id === id)),
      observedChecks: observations.filter(row => Object.keys(row.values).some(id => ids.has(id))).length,
      validationStatus: 'requires-original-validation', canTrade: false};
  });
}

function buildIntelligenceResearch({day, now = Date.now(), archive = null, bars = null, quotes = [], frozenObservations = [], historyCoverage = null,
  calendar = null, marketCalendars = {}, config = defaults} = {}) {
  checkedConfig(config);
  if (!Number.isSafeInteger(now) || now <= 0 || now >= 8e15 || !dayOk(day) || day > chinaDay(now) || !Array.isArray(quotes) || quotes.length > 200)
    throw Error('中心研究日期、时钟或逐股报价证据无效');
  const extracted = extractArchiveResearchInputs(archive, {now}), records = bars === null ? extracted.bars : bars;
  // Only the independent intake's actual same-day freeze can establish a new
  // signal after a later price receipt. The old check is never backdated/edited.
  if (!Array.isArray(frozenObservations) || frozenObservations.length > MAX_CHECKS) throw Error('中心冻结因子记录超限');
  for (const row of frozenObservations) {
    if (row?.captureProtocol !== 'center-hfq-history-v1' || !real(row) || row.market !== 'CN' ||
        !/^\d{6}$/.test(row.code || '') || !dayOk(row.day) || !row.id || !row.originCheckId ||
        !Number.isSafeInteger(row.signalAt) || row.signalAt > now || chinaDay(row.signalAt) !== row.day ||
        instant(row.recordedAt) !== row.signalAt || !row.values || Object.values(row.values).some(value=>!finite(value)) ||
        !row.evidence || Object.entries(row.values).some(([id])=>instant(row.evidence[id]?.knownAt) === null ||
          instant(row.evidence[id].knownAt) > row.signalAt)) throw Error('中心冻结因子缺少原始同日证据');
  }
  const observations = [...extracted.observations, ...frozenObservations];
  const calendars = {...marketCalendars}; if (!calendars.CN) {
    const cn = calendar || extractArchiveCalendar(archive, {now}); if (cn) calendars.CN = cn;
  }
  const backtest = auditCenterInputs(records, {purpose: 'backtest', now, config, marketCalendars: calendars});
  const display = auditCenterInputs(records, {purpose: 'display', now, config, marketCalendars: calendars});
  const aligned = alignFactorOutcomes(observations, backtest, calendars, {now});
  const walkforward = buildWalkForward(aligned.samples, aligned.alignment, {config, now});
  const threeToFour = evaluateThreeToFour(archive, {day, now, calendar: calendars.CN, config});
  const quoteDiagnostics = [];
  for (const item of quotes) {
    if (item?.mode === 'multi-source-price-consensus-research') {
      const gate = decisionCrosscheckGate(item, {code: item.code, day, now, config});
      quoteDiagnostics.push({...item, centerGate: gate}); continue;
    }
    try { const report = fuseMultiSourcePrices({code: item.code, now, sources: item.sources,
      priceToleranceBps: config.consistency.priceToleranceBps, previousCloseToleranceBps: config.consistency.previousCloseToleranceBps,
      timeGapMs: config.consistency.maxTimestampGapMs, maxAgeMs: config.quality.maxAgeMs,
      ...(aligned.alignment.calendars.CN?.days.length ? {tradingDates: aligned.alignment.calendars.CN.days} : {})});
      quoteDiagnostics.push({...report, centerGate: decisionCrosscheckGate(report, {code: item.code, day, now, config})}); }
    catch (error) { quoteDiagnostics.push({code: item?.code || null, status: 'invalid-original-quote-evidence', reason: error.message, referencePrice: null, canTrade: false}); }
  }
  const views = records.filter(real).map(recordView), fields = ['open', 'high', 'low', 'close', 'volume', 'amount'];
  const timed = views.filter(row => instant(row.knownAt) !== null && instant(row.observedAt) !== null && instant(row.observedAt) <= instant(row.knownAt) && instant(row.knownAt) <= now);
  const completeRows = views.filter(row => fields.every(key => finite(row[key]))), comparisonRows = backtest.comparisons.filter(row => row.independentSources >= 2 && !['duplicate-upstream-evidence', 'too-many-source-records'].includes(row.status));
  const currentQuoteChecks = quoteDiagnostics.filter(row => row.centerGate && row.centerGate.status !== 'unknown');
  // Rejected intake records never enter the research-price set, but cannot
  // disappear from its data-quality denominator. Count each latest code/day
  // comparison once and avoid counting its admitted copy a second time.
  const intakeQuality=historyCoverage?.intakeQuality;
  const otherComparisons=intakeQuality?comparisonRows.filter(row=>!row.observations.some(value=>value.captureProtocol==='center-hfq-history-v1')):comparisonRows;
  const historicalCompared=otherComparisons.length+(intakeQuality?.comparableGroups||0),
    historicalConsistent=otherComparisons.filter(row=>row.status==='admitted').length+(intakeQuality?.consistentGroups||0);
  const originalQuotes = quoteDiagnostics.flatMap(report => (Array.isArray(report.sourceStatuses) ? report.sourceStatuses : []).filter(row => {
    const checkedAt = instant(report.checkedAt), originalAt = instant(row.quoteAt);
    return checkedAt !== null && checkedAt <= now && Number.isSafeInteger(row.quoteAt) && originalAt !== null && originalAt <= checkedAt &&
      finite(row.observedPrice) && row.observedPrice > 0 && sourceIdentity({source: row.provider, upstreamGroup: row.upstreamGroup});
  }));
  const continuity = [];
  const scopes = new Map();
  for (const row of views) {
    if (!dayOk(row.day)) continue;
    const key = JSON.stringify([row.market, row.code, row.source, row.originalAdjustment]);
    if (!scopes.has(key)) scopes.set(key, []); scopes.get(key).push(row.day);
  }
  for (const [key, observed] of scopes) {
    const [market] = JSON.parse(key), days = aligned.alignment.calendars[market]?.days || [];
    const sorted = [...new Set(observed)].sort(), expected = days.filter(date => date >= sorted[0] && date <= sorted.at(-1));
    if (expected.length > 1) continuity.push({expected: expected.length, present: expected.filter(date => sorted.includes(date)).length});
  }
  const quality = qualityScore({
    realtime: {value: originalQuotes.length ? originalQuotes.filter(row => chinaDay(row.quoteAt) === day && now - row.quoteAt <= config.quality.maxAgeMs).length / originalQuotes.length : null,
      evidence: {basis: 'original-live-quoteAt-age-at-report-time', checked: originalQuotes.length, maxAgeMs: config.quality.maxAgeMs,
        note: '历史日 K 的快速接收不能冒充当前实时报价；无原始逐股时点时保持未知。'}},
    completeness: {value: views.length ? views.reduce((sum, row) => sum + fields.filter(key => finite(row[key])).length, 0) / (views.length * fields.length) : null,
      evidence: {records: views.length, requiredFields: fields}},
    consistency: {value: historicalCompared + currentQuoteChecks.length ?
      (historicalConsistent + currentQuoteChecks.filter(row => row.centerGate.status === 'observed-agreement').length) /
        (historicalCompared + currentQuoteChecks.length) : null,
      evidence: {purpose: 'backtest-and-current-quote-checks', comparableGroups: historicalCompared, currentQuoteChecks: currentQuoteChecks.length,
        intake: intakeQuality||null,
        missingOrExcludedGroups: backtest.comparisons.length - comparisonRows.length}},
    continuity: {value: continuity.length ? continuity.reduce((sum, row) => sum + row.present, 0) / continuity.reduce((sum, row) => sum + row.expected, 0) : null,
      evidence: {series: continuity.length, basis: 'explicit-calendar-between-observed-endpoints'}},
    anomaly: {value: completeRows.length ? completeRows.filter(row => !shapeReason(row)).length / completeRows.length : null,
      evidence: {checked: completeRows.length, unknown: views.length - completeRows.length, checks: ['OHLC ordering', 'nonnegative shares/CNY', 'zero volume/amount parity', 'explicit halt-volume contradiction']}}
  }, config);
  const summarizeGate = gate => ({status: gate.status, expectedAdjustment: gate.expectedAdjustment, inputRecords: gate.inputRecords,
    admittedGroups: gate.admittedGroups, excludedRecords: gate.excludedRecords, comparableGroups: gate.comparableGroups,
    reasons: Object.fromEntries([...new Set(gate.rejected.map(row => row.reason))].map(reason => [reason, gate.rejected.filter(row => row.reason === reason).length])),
    examples: gate.rejected.slice(0, 12), note: gate.note, changesOriginalGates: false});
  quality.gates = {display: summarizeGate(display), backtest: summarizeGate(backtest)};
  quality.historyTimeliness = {checked: timed.length, unknown: views.length - timed.length,
    timelyFraction: timed.length ? timed.filter(row => instant(row.knownAt) - instant(row.observedAt) <= config.quality.maxAgeMs).length / timed.length : null,
    basis: 'original-observedAt-to-original-knownAt-lag', contributesToCurrentRealtimeScore: false};
  quality.liveQuotes = quoteDiagnostics;
  quality.sources = [...new Set(views.map(row => row.source))].map(source => ({source,
    records: views.filter(row => row.source === source).length, adjustments: [...new Set(views.filter(row => row.source === source).map(row => row.originalAdjustment))]}));
  const factorIds = [...new Set(observations.flatMap(row => Object.keys(row.values)))].sort();
  const factors = {status: aligned.samples.length ? 'observed' : 'missing-aligned-samples',
    dictionaryVersion: archive?.dictionaryVersion || null, catalogRules: extracted.catalog.length,
    measuredFactors: factorIds.length, factorIds, observationCount: observations.length, alignedSamples: aligned.samples.length,
    ruleCoverage: extracted.ruleCoverage || null,
    sampleUniverse:{scope:'bounded-observed-research-subset',codes:historyCoverage?.codes||null,
      omittedCodes:historyCoverage?.omittedCodes||0,omittedEarlierObservations:historyCoverage?.omittedEarlierObservations||0,
      fullMarketCertification:false},
    label: aligned.label, rejectionReasons: Object.fromEntries([...new Set(aligned.rejected.map(row => row.reason))].map(reason => [reason, aligned.rejected.filter(row => row.reason === reason).length])),
    rejectedChecks: extracted.rejected.slice(0, 20), descriptive: factorMetrics(aligned.samples, factorIds, config.factors.minCrossSection),
    orthogonalization: walkforward.folds.at(-1)?.orthogonalization || {status: 'missing-training-window', parameters: [], suppressed: []},
    redundancy: walkforward.folds.at(-1)?.redundancy || {status: 'missing-training-window', pairs: [], suppressedFactors: []},
    note: '新校验完整保存95条规则的逐条件观察；仅来源、时点与全部条件可核对时形成数值，明确失败可以为0，未知不填0。旧top8档案单列为部分观察，不补历史。IC 限于本次有界研究样本子集，不代表全市场或全部95项有效；全样本 IC 仅描述，不能用于拟合或批准。', canTrade: false};
  factors.approvedScoring = buildApprovedScoring(archive, observations, {day,now,calendars});
  const feedback = feedbackReport(archive, walkforward, backtest, now, config, quality, day, aligned.samples);
  if (historyCoverage?.rejectedRecords > 0) feedback.qualityCandidates.push({status:'source-evidence-recorded',type:'history-intake-quality-review',
    reason:'独立历史采集存在未通过多源准入的记录',affectedRecords:historyCoverage.rejectedRecords,
    evidence:historyCoverage.rejectionExamples || [],evidenceIsBoundedSample:true,proposedScore:quality.score,
    proposedComponents:quality.components,qualityEvidenceFingerprint:hash(quality.components),
    appliedToCenterQuality:true,changesOriginalGates:false,approvalRequired:false,productionWeightsChanged:false});
  if(feedback.qualityCandidates.length)feedback.status='candidates-pending-validation';
  feedback.qualityFeedback.affectedRecords=feedback.qualityCandidates.reduce((count,row)=>count+row.affectedRecords,0);
  const executionValidation = require('./intelligence-execution-validation').buildExecutionValidation(archive,walkforward,{now});
  const templates = {status: extracted.catalog.length ? 'observed-catalog' : 'missing-catalog',
    commandEngine: config.templates.engine, supportedQueries: ['近5日主力净流入前5的芯片股', '精选评分前3', '共振分前3'],
    scope: '当前已接收候选池，非全市场排名；只支持已有字段与可追溯历史。',
    groups: templateGroups(extracted.catalog, extracted.observations),
    threeToFour,
    catalog: extracted.catalog.map(row => { const code = 'YZ-' + String(row.id).padStart(2, '0'); return {code, name: row.name,
      kind: row.kind, conditions: row.factors?.length || 0, observedChecks: extracted.observations.filter(item => Object.hasOwn(item.values, code)).length}; }),
    canTrade: false};
  Object.assign(templates.groups.find(group => group.id === 'three-to-four'), {definition: threeToFour.definition,
    observationCount: threeToFour.observations.length, evidenceStatus: threeToFour.status,
    missing: threeToFour.missing.length ? threeToFour.missing : ['等待独立样本外验证'], validationStatus: 'not-oos-validated'});
  for (const evaluated of evaluateTemplateLibrary(archive,{day,now,calendar:calendars.CN,catalog:extracted.catalog})) {
    const group=templates.groups.find(row=>row.id===evaluated.definition.id);
    Object.assign(group,{status:'implemented-evidence-evaluator',definition:evaluated.definition,evidenceStatus:evaluated.status,
      evaluations:evaluated.evaluations,observations:evaluated.observations,observationCount:evaluated.observations.length,
      missing:evaluated.missing,validationStatus:evaluated.validationStatus,affectsResonance:false});
  }
  const governance = require('./fayo-research-governance').buildGovernance({archive:archive?{...archive,catalog:extracted.catalog}:null,samples:aligned.samples,walkforward,quality,execution:executionValidation,feedback,now});
  const report = {authority: 'fayo-intelligence-research', schemaVersion: 1, ruleVersion: config.ruleVersion, day,
    generatedAt: new Date(now).toISOString(), status: config.enabled ? extracted.status : 'disabled',
    adjustment: {...config.adjustment}, quality, factors, walkforward, executionValidation, feedback, templates, governance,
    crossMarket: aligned.alignment, historyIntake: historyCoverage,
    coverage: {archivePresent: Boolean(archive), rawBars: records.length, recordedChecks: archive?.checks?.length || 0,
      realFactorObservations: observations.length, admittedHfqGroups: backtest.admittedGroups,
      alignedFactorSamples: aligned.samples.length, missing: [!records.length && '原始行情', !backtest.admittedGroups && '同口径 hfq 多源证据',
        !aligned.alignment.days.length && '原交易日历与 knownAt', !extracted.observations.length && '冻结因子观测', !walkforward.folds.length && 'walk-forward 所需交易日'].filter(Boolean)},
    originalGatesChanged: false, productionWeightsChanged: false, canTrade: false, canNotify: false};
  return {...report, fingerprint: hash(report)};
}

module.exports = {buildIntelligenceResearch, qualityScore, auditCenterInputs, decisionCrosscheckGate, extractArchiveResearchInputs,
  extractArchiveCalendar, intersectMarketDates, alignFactorOutcomes, fitOrthogonalFactors, applyOrthogonalFactors, buildWalkForward, evaluateThreeToFour};
