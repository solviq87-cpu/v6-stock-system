'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildIntelligenceResearch, qualityScore, auditCenterInputs, decisionCrosscheckGate,
  extractArchiveResearchInputs, extractArchiveCalendar, intersectMarketDates, alignFactorOutcomes,
  fitOrthogonalFactors, applyOrthogonalFactors, buildWalkForward, evaluateThreeToFour} = require('../src/core/intelligence-research');
const {fuseMultiSourcePrices} = require('../src/core/multi-source-price-consensus');
const defaults = require('../config/intelligence-center.json');
const catalog = require('../public/nova/shortline/catalog.json');
const time = value => Date.parse(value);
const at = (day, clock = '15:00:00') => time(day + 'T' + clock + '+08:00');
const day = '2026-11-25', now = at(day, '15:10:00');
const clone = object => JSON.parse(JSON.stringify(object));
function bar(date = day, code = '600001', source = 'eastmoney', extra = {}) {
  return {date, code, source, adjustment: 'hfq', observedAt: at(date), knownAt: at(date) + 1000,
    currency: 'CNY', volumeUnit: 'shares', amountUnit: 'CNY', open: 10, high: 10.1, low: 9.9, close: 10,
    volume: 100000, amount: 1000000, suspended: false, sampleSet: 'real', ...extra};
}
function pair(date = day, code = '600001', extra = {}) {
  return [bar(date, code, 'eastmoney', extra), bar(date, code, 'baostock', {...extra, close: (extra.close ?? 10) * 1.00001})];
}
function calendar(days, knownAt = at(days[0], '08:00:00')) { return {days, source: 'sse-calendar', knownAt}; }
function observation(date, code = '600001', extra = {}) {
  return {id: 'check-' + date + '-' + code, market: 'CN', code, day: date, signalAt: at(date, '15:05:00'),
    recordedAt: new Date(at(date, '15:05:00')).toISOString(), values: {'TL-01': 1}, evidence: {}, ...extra};
}
function quoteReport(prices, clock = at(day, '10:00:00')) {
  const ids = ['eastmoney', 'tencent', 'sina'];
  return fuseMultiSourcePrices({code: '600001', now: clock, tradingDates: [day], sources: prices.map((price, i) => ({
    id: ids[i], status: 'fresh-unverified', quote: {code: '600001', exchange: 'SH', currency: 'CNY',
      adjustment: 'unadjusted', status: 'normal', price, previousClose: 10, quoteAt: clock - 1000}
  }))});
}
function tradingDates(count) {
  // Explicit deterministic test calendar; production code never derives it.
  const dates = [];
  for (let i = 0; dates.length < count; i++) { const t = new Date(Date.UTC(2026, 9, 12 + i));
    if (![0, 6].includes(t.getUTCDay())) dates.push(t.toISOString().slice(0, 10)); }
  return dates;
}
function shortConfig() {
  const config = clone(defaults);
  Object.assign(config.walkforward, {trainDays: 15, validationDays: 5, testDays: 5, stepDays: 5, maxFolds: 2});
  return config;
}
function sampledHistory() {
  const days = tradingDates(28), samples = [];
  for (let i = 0; i < 27; i++) for (let j = 0; j < 5; j++) samples.push({
    id: 's-' + i + '-' + j, market: 'CN', code: String(600000 + j), day: days[i], targetDay: days[i + 1],
    signalAt: at(days[i], '15:05:00'), labelKnownAt: at(days[i + 1]) + 1000,
    values: {'TL-01': j * 10, 'ZJ-01': j * 20 + 3}, returnPct: j - 2,
    cycle: i % 2 ? '修复' : '分歧', regime: 'not-systemic-selloff'});
  const clock = at(days.at(-1), '15:10:00');
  return {days, samples, clock, alignment: intersectMarketDates({CN: calendar(days)}, {now: clock})};
}

test('Q uses the specified five weights; unknowns remain null and are not renormalized', () => {
  const q = qualityScore({realtime: 1, completeness: .8, consistency: .5, continuity: .6, anomaly: .7});
  assert.equal(q.score, 78); assert.equal(q.knownWeight, 1); assert.deepEqual(q.possibleRange, [78, 78]);
  const missing = qualityScore({realtime: 1, completeness: .8, consistency: null, continuity: .6, anomaly: .7});
  assert.equal(missing.score, null); assert.equal(missing.knownWeight, .8); assert.deepEqual(missing.possibleRange, [68, 88]);
  assert.equal(missing.components.find(row => row.id === 'consistency').value, null);
  assert.equal(qualityScore({}).score, null);
  assert.throws(() => qualityScore({realtime: NaN}), /0–1/);
  assert.throws(() => qualityScore({consistency: 1.1}), /0–1/);
});

test('configuration fixes adjustment boundaries and cannot relax feedback approval', () => {
  assert.deepEqual(defaults.adjustment, {display: 'qfq', backtest: 'hfq', liveExecution: 'none'});
  assert.deepEqual(defaults.weather.positionCaps, {green: 20, yellow: 10, red: 0, unknown: 0});
  const config = clone(defaults); config.adjustment.backtest = 'unadjusted';
  assert.throws(() => qualityScore({}, config), /backtest=hfq/);
  const bad = clone(defaults); bad.feedback.approvalRequired = false;
  assert.throws(() => qualityScore({}, bad), /原审批规则/);
});

test('same code/day/hfq sources enter the centre dataset with an original source price', () => {
  const records = pair(), before = JSON.stringify(records), result = auditCenterInputs(records, {now});
  assert.equal(result.status, 'admitted'); assert.equal(result.admittedGroups, 1);
  assert.ok(records.some(row => row.close === result.admitted[0].close));
  assert.equal(result.admitted[0].knownAt, records[0].knownAt);
  assert.equal(result.admitted[0].consensusKnownAt, records[0].knownAt);
  assert.equal(result.canTrade, false); assert.equal(result.changesOriginalGates, false);
  assert.equal(JSON.stringify(records), before);
});

test('outlier is excluded by a unique majority; two conflicting sources produce no averaged price', () => {
  const records = [...pair(), bar(day, '600001', 'tencent', {close: 11, high: 11.1})];
  const result = auditCenterInputs(records, {now});
  assert.equal(result.admittedGroups, 1); assert.equal(result.excludedRecords, 1);
  assert.equal(result.rejected[0].source, 'tencent'); assert.equal(result.rejected[0].reason, 'outside-unique-consensus');
  const conflict = auditCenterInputs([records[0], records[2]], {now});
  assert.equal(conflict.admitted.length, 0); assert.equal(conflict.comparisons[0].status, 'source-value-or-time-conflict');
});

test('same raw publisher cannot become two independent sources through wrapper aliases', () => {
  const result = auditCenterInputs([bar(), bar(day, '600001', 'efinance')], {now});
  assert.equal(result.admitted.length, 0);
  assert.equal(result.comparisons[0].status, 'duplicate-upstream-evidence');
  assert.equal(result.comparableGroups, 0);
});

test('legacy unadjusted/qfq, unknown clocks, wrong units, and future evidence cannot become hfq', () => {
  const records = [bar(day, '600001', 'eastmoney', {adjustment: 'unadjusted'}),
    bar(day, '600001', 'baostock', {adjustment: 'qfq'}), bar(day, '600002', 'eastmoney', {knownAt: null}),
    bar(day, '600003', 'eastmoney', {amountUnit: 'CNY-10000'}), bar(day, '600004', 'eastmoney', {observedAt: now + 1, knownAt: now + 2})];
  const before = JSON.stringify(records), report = auditCenterInputs(records, {now});
  assert.equal(report.admitted.length, 0);
  assert.deepEqual(report.rejected.map(row => row.reason), ['adjustment-mismatch', 'adjustment-mismatch', 'missing-original-time',
    'missing-or-incompatible-units', 'future-or-backdated-time']);
  assert.equal(JSON.stringify(records), before);
  assert.equal(auditCenterInputs(pair(day, '600001', {adjustment: 'qfq'}), {purpose: 'display', now}).admittedGroups, 1);
});

test('missing or mismatched code/day/adjustment stays separated rather than cross-pollinated', () => {
  const result = auditCenterInputs([bar(), bar(day, '600002', 'baostock'), bar('2026-11-24', '600001', 'baostock')], {now});
  assert.equal(result.admittedGroups, 0); assert.equal(result.comparisons.length, 3);
  assert.ok(result.comparisons.every(row => row.status === 'missing-independent-source'));
  const invalid = auditCenterInputs([bar(day, '600001', 'eastmoney', {observedAt: at('2026-11-24')})], {now});
  assert.equal(invalid.rejected[0].reason, 'source-day-mismatch');
});

test('live diagnostic adds a conflict block only from fresh original quote clocks', () => {
  const clock = at(day, '10:00:00'), report = quoteReport([10, 11], clock);
  const gate = decisionCrosscheckGate(report, {code: '600001', day, now: clock});
  assert.equal(gate.status, 'conflict'); assert.equal(gate.blocked, true); assert.equal(gate.canTrade, false);
  const old = {...report, checkedAt: new Date(clock + 20000).toISOString()};
  const stale = decisionCrosscheckGate(old, {code: '600001', day, now: clock + 20000});
  assert.equal(stale.status, 'unknown'); assert.equal(stale.blocked, false); assert.equal(stale.canAdmit, false);
  assert.equal(decisionCrosscheckGate(report, {code: '600002', day, now: clock}).status, 'unknown');
});

test('partial agreement rejects the candidate outlier source and contradictory report status is not trusted', () => {
  const clock = at(day, '10:00:00'), report = quoteReport([10, 10.0001, 11], clock);
  assert.equal(report.status, 'partial-source-agreement-unverified');
  assert.equal(decisionCrosscheckGate(report, {code: '600001', day, now: clock, source: 'sina'}).blocked, true);
  assert.equal(decisionCrosscheckGate(report, {code: '600001', day, now: clock, source: 'eastmoney'}).canAdmit, true);
  const forged = {...quoteReport([10, 10.0001], clock), status: 'source-price-or-time-conflict'};
  assert.equal(decisionCrosscheckGate(forged, {code: '600001', day, now: clock}).status, 'unknown');
});

test('cross-market dates use an exact intersection with original calendar provenance', () => {
  const cn = calendar(['2026-11-20', '2026-11-23', '2026-11-24']);
  const hk = calendar(['2026-11-20', '2026-11-24', '2026-11-25']);
  const result = intersectMarketDates({CN: cn, HK: hk}, {now});
  assert.deepEqual(result.days, ['2026-11-20', '2026-11-24']);
  assert.deepEqual(result.droppedDays.CN, ['2026-11-23']);
  assert.equal(intersectMarketDates({CN: {days: cn.days}}, {now}).status, 'missing-calendar-evidence');
  assert.equal(intersectMarketDates({CN: {...cn, knownAt: now + 1}}, {now}).days.length, 0);
});

test('archive next-day evidence retains its own knowledge clock and cannot invent a missing edge', () => {
  const archive = {scope: 'live', market: [
    {date: '2026-11-20', nextTradingDay: '2026-11-23', calendarSource: 'sse-calendar', calendarKnownAt: at('2026-11-20', '08:00:00'), knownAt: at('2026-11-20')},
    {date: '2026-11-24', nextTradingDay: '2026-11-25', calendarSource: 'sse-calendar', calendarKnownAt: at('2026-11-24', '08:00:00'), knownAt: at('2026-11-24')}
  ]};
  const result = extractArchiveCalendar(archive, {now});
  assert.equal(result.nextEvidenceByDay['2026-11-20'].knownAt, archive.market[0].calendarKnownAt);
  assert.equal(result.nextEvidenceByDay['2026-11-23'], undefined);
  const gate = auditCenterInputs([...pair('2026-11-23'), ...pair('2026-11-24')], {now});
  const aligned = alignFactorOutcomes([observation('2026-11-23')], gate, {CN: result}, {now});
  assert.equal(aligned.samples.length, 0);
  assert.equal(aligned.rejected[0].reason, 'missing-aligned-trading-calendar');
  archive.market.push({...archive.market[0], nextTradingDay: '2026-11-24'});
  assert.equal(extractArchiveCalendar(archive, {now}).nextEvidenceByDay['2026-11-20'], undefined);
});

test('factor extraction preserves numeric evidence and does not turn missing rule conditions into zero', () => {
  const check = {id: 'check-1', code: '600001', date: day, asOf: day + ' 15:05', createdAt: new Date(at(day, '15:05:00')).toISOString(),
    market: {systemicSelloff: false}, method: '行情自动识别', factorObservations: {
      'TL-01': {symbol: '600001', factorCode: 'TL-01', tradeDate: day, knownAt: at(day, '15:02:00'), value: 0, unit: 'count', source: 'eastmoney'},
      'ZJ-01': {symbol: '600001', factorCode: 'ZJ-01', tradeDate: day, knownAt: now + 1, value: 123, unit: 'CNY', source: 'eastmoney'}
    }, recognition: {candidates: [
      {name: catalog[0].name, total: 6, matched: 5, failed: [catalog[0].factors[0]], missing: []},
      {name: catalog[1].name, total: 5, matched: 4, failed: [], missing: [catalog[1].factors[0]]}
    ]}};
  const result = extractArchiveResearchInputs({scope: 'live', checks: [check], catalog}, {now});
  assert.equal(result.observations[0].market, 'CN');
  assert.equal(result.observations[0].values['TL-01'], 0);
  assert.equal(result.observations[0].values['YZ-01'], 5 / 6 * 100);
  assert.equal(result.observations[0].values['YZ-02'], undefined);
  assert.equal(result.observations[0].values['ZJ-01'], undefined);
  assert.equal(result.observations[0].evidence['TL-01'].knownAt, check.factorObservations['TL-01'].knownAt);
  assert.equal(result.rejected[0].reason, 'invalid-or-future-factor-evidence');
});

test('t→t+1 uses exact next trading day and original signal/label knowledge times', () => {
  const dates = ['2026-11-20', '2026-11-23', '2026-11-24'];
  const gate = auditCenterInputs([...pair(dates[0]), ...pair(dates[1], '600001', {close: 10.05})], {now});
  const c = {CN: calendar(dates)};
  const result = alignFactorOutcomes([observation(dates[0])], gate, c, {now});
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0].targetDay, dates[1]);
  assert.ok(Math.abs(result.samples[0].returnPct - .5) < 1e-9);
  const late = alignFactorOutcomes([observation(dates[0], '600001', {signalAt: at(dates[1], '10:00:00')})], gate, c, {now});
  assert.equal(late.rejected[0].reason, 'check-first-known-after-next-open');
  const oldCalendar = alignFactorOutcomes([observation(dates[0])], gate, {CN: calendar(dates, at(dates[1], '08:00:00'))}, {now});
  assert.equal(oldCalendar.rejected[0].reason, 'calendar-known-after-signal');
});

test('missing next-day or retrospective corrected signal price never substitutes a later return label', () => {
  const dates = ['2026-11-20', '2026-11-23', '2026-11-24'];
  const missing = auditCenterInputs([...pair(dates[0]), ...pair(dates[2])], {now});
  assert.equal(alignFactorOutcomes([observation(dates[0])], missing, {CN: calendar(dates)}, {now}).rejected[0].reason, 'missing-admitted-hfq-price-pair');
  const corrected = auditCenterInputs([...pair(dates[0], '600001', {knownAt: at(dates[1])}), ...pair(dates[1])], {now});
  assert.equal(alignFactorOutcomes([observation(dates[0])], corrected, {CN: calendar(dates)}, {now}).rejected[0].reason, 'signal-price-first-known-after-signal');
});

test('misdated or shifted explicit session clocks cannot move the next-open cutoff beyond a known answer', () => {
  const dates = ['2026-11-20', '2026-11-23', '2026-11-24'];
  const gate = auditCenterInputs([...pair(dates[0]), ...pair(dates[1])], {now});
  for (const nextOpen of ['2030-01-01T09:30:00+08:00', dates[1] + 'T16:30:00+08:00']) {
    const malicious = {...calendar(dates), openAtByDay: {[dates[1]]: nextOpen}};
    const aligned = alignFactorOutcomes([observation(dates[0], '600001', {signalAt: at(dates[1], '16:00:00')})], gate, {CN: malicious}, {now});
    assert.equal(aligned.samples.length, 0);
    assert.equal(aligned.alignment.status, 'missing-calendar-evidence');
  }
  const badClose = {...calendar(dates), closeAtByDay: {[dates[1]]: '2030-01-01T15:00:00+08:00'}};
  assert.equal(intersectMarketDates({CN: badClose}, {now}).status, 'missing-calendar-evidence');
});

test('intraday target bars cannot mature a next-day close label, even with apparently complete OHLCV', () => {
  const dates = ['2026-11-20', '2026-11-23', '2026-11-24'], intraday = at(dates[1], '10:00:00');
  const records = [...pair(dates[0]), ...pair(dates[1], '600001', {observedAt: at(dates[1], '09:59:00'), knownAt: at(dates[1], '09:59:01')})];
  const gate = auditCenterInputs(records, {now: intraday});
  assert.equal(gate.admittedGroups, 1);
  assert.equal(gate.rejected.filter(row => row.reason === 'incomplete-daily-close-evidence').length, 2);
  assert.equal(alignFactorOutcomes([observation(dates[0])], gate, {CN: calendar(dates)}, {now: intraday}).samples.length, 0);
  // The causal join independently guards finality even if a caller presents an
  // old gate object rather than recomputing the gate at the new report clock.
  const previouslyFinal = auditCenterInputs([...pair(dates[0]), ...pair(dates[1])], {now});
  const result = alignFactorOutcomes([observation(dates[0])], previouslyFinal, {CN: calendar(dates)}, {now: intraday});
  assert.equal(result.samples.length, 0); assert.equal(result.rejected[0].reason, 'incomplete-daily-close-evidence');
});

test('orthogonalization fits training only, removes exact redundancy, and leaves missing values unresolved', () => {
  const train = Array.from({length: 6}, (_, j) => ({id: String(j), day: '2026-11-20', values: {A: j, B: j * 2 + 10, C: j % 2}, returnPct: j}));
  const model = fitOrthogonalFactors(train, ['A', 'B', 'C']);
  assert.equal(model.status, 'frozen-training-fit'); assert.equal(model.suppressed[0].factorId, 'B');
  const before = JSON.stringify(model);
  const transformed = applyOrthogonalFactors([{values: {A: 100, B: 210, C: 1000}}, {values: {A: 2}}], model);
  assert.ok(Number.isFinite(transformed[0].values.C)); assert.equal(transformed[1].values.C, undefined);
  assert.equal(JSON.stringify(model), before);
  const fitRows = applyOrthogonalFactors(train, model), dot = fitRows.reduce((sum, row) => sum + row.values.A * row.values.C, 0);
  assert.ok(Math.abs(dot) < 1e-10);
});

test('walk-forward purges boundary labels and freezes train parameters before both holdouts', () => {
  const {samples, clock, alignment} = sampledHistory(), config = shortConfig();
  const report = buildWalkForward(samples, alignment, {config, now: clock});
  assert.equal(report.status, 'evaluated'); assert.equal(report.folds.length, 1);
  const fold = report.folds[0];
  assert.equal(fold.raw.train['TL-01'].meanIC, 1); assert.equal(fold.raw.validation['TL-01'].meanIC, 1);
  assert.equal(fold.raw.test['TL-01'].meanIC, 1); assert.equal(fold.raw.train['TL-01'].days, 15);
  assert.ok(fold.redundancy.suppressedFactors.length >= 1);
  assert.ok(fold.ranges.train.end < fold.ranges.validation.start && fold.ranges.validation.end < fold.ranges.test.start);
  const changed = clone(samples);
  for (const row of changed) if (row.day >= fold.ranges.validation.start) {
    row.values['TL-01'] *= 1000; row.values['ZJ-01'] *= -1000; row.values['FUTURE-01'] = 99999; row.returnPct *= -10;
  }
  const other = buildWalkForward(changed, alignment, {config, now: clock}).folds[0];
  assert.deepEqual(other.orthogonalization, fold.orthogonalization);
  assert.equal(other.factorIds.includes('FUTURE-01'), false);
  assert.deepEqual(other.raw.train, fold.raw.train);
  assert.equal(other.raw.test['TL-01'].meanIC, -1);
});

test('phase label availability is enforced and thin cross-sections cannot report a successful validation', () => {
  const {samples, clock, alignment} = sampledHistory(), config = shortConfig();
  const thin = samples.filter(row => row.code === '600000');
  assert.equal(buildWalkForward(thin, alignment, {config, now: clock}).status, 'insufficient-phase-samples');
  const original = buildWalkForward(samples, alignment, {config, now: clock}).folds[0];
  const changed = clone(samples); changed[0].labelKnownAt = time(original.trainLabelCutoff) + 1;
  const next = buildWalkForward(changed, alignment, {config, now: clock}).folds[0];
  assert.equal(next.ranges.train.samples, original.ranges.train.samples - 1);
});

test('a stricter configured redundancy cutoff can only tighten the original research suppression gate', () => {
  const {days, clock, alignment} = sampledHistory(), samples = [];
  for (let i = 0; i < 27; i++) for (let j = 0; j < 6; j++) samples.push({
    ...observation(days[i], String(600000 + j)), id: i + '-' + j, targetDay: days[i + 1], labelKnownAt: at(days[i + 1]) + 1000,
    values: {A: j, B: [0, 1, 2, 3, 5, 4][j]}, returnPct: j, regime: 'not-systemic-selloff', cycle: '修复'});
  const baseline = buildWalkForward(samples, alignment, {config: shortConfig(), now: clock}).folds[0];
  assert.equal(baseline.redundancy.suppressedFactors.length, 1);
  const config = shortConfig(); config.factors.redundancyAbsCorrelation = 1;
  const tightened = buildWalkForward(samples, alignment, {config, now: clock}).folds[0];
  assert.equal(tightened.redundancy.suppressedFactors.length, 0);
  assert.equal(tightened.redundancy.pairs[0].configuredRankCorrelationCutoff, 1);
  assert.equal(tightened.redundancy.pairs[0].eligibleForSuppression, false);
});

test('empty archive reports missing evidence and six explicit existing-rule groups without fabricated candidates', () => {
  const report = buildIntelligenceResearch({day, now});
  assert.equal(report.quality.score, null); assert.equal(report.factors.alignedSamples, 0);
  assert.equal(report.factors.measuredFactors, 0); assert.equal(report.factors.catalogRules, 95);
  assert.equal(report.walkforward.folds.length, 0); assert.equal(report.feedback.candidates.length, 0);
  assert.deepEqual(report.templates.groups.map(group => group.name), ['首板', '一进二', '弱转强反包', '三进四', '龙头', '情绪择时']);
  const missing = report.templates.groups.find(group => group.id === 'three-to-four');
  assert.equal(missing.status, 'implemented-evidence-evaluator'); assert.equal(missing.definition.id, 'CENTER-3TO4-v1');
  assert.equal(missing.validationStatus, 'not-oos-validated'); assert.equal(missing.definition.conditions.length, 7);
  assert.equal(report.canTrade, false); assert.equal(report.productionWeightsChanged, false); assert.equal(report.originalGatesChanged, false);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
});

test('existing consensus reports are consumed read-only and never refetched or written into quotes', () => {
  const clock = at(day, '10:00:00'), quote = quoteReport([10, 11], clock), before = JSON.stringify(quote);
  const report = buildIntelligenceResearch({day, now: clock, quotes: [quote]});
  assert.equal(report.quality.liveQuotes[0].centerGate.blocked, true);
  assert.equal(report.quality.score, null); assert.equal(report.quality.liveQuotes[0].referencePrice, null);
  assert.equal(report.quality.components.find(row => row.id === 'consistency').value, 0);
  assert.equal(report.quality.components.find(row => row.id === 'realtime').value, 1);
  assert.equal(JSON.stringify(quote), before);
});

test('real provenance-shaped archive can produce research IC and bounded candidates without changing approved weights', () => {
  const {days, clock} = sampledHistory(), config = shortConfig(), archive = {scope: 'live', catalog,
    dictionaryVersion: 'original-archive-version', bars: [], checks: [], plans: [], trades: [], market: [],
    versions: [{number: 1, approvedAt: new Date(at(days[0], '08:00:00')).toISOString(), weights: {'TL-01': 2, 'ZJ-01': 1}}]};
  for (let i = 0; i < days.length; i++) for (let j = 0; j < 5; j++) {
    const code = String(600000 + j), close = (10 + j) * (1 + (j - 2) / 1000) ** i;
    const original = {open: close, high: close * 1.01, low: close * .99, close, amount: close * 100000};
    archive.bars.push(...pair(days[i], code, original));
    if (i === days.length - 1) continue;
    const observedAt = at(days[i], '15:02:00');
    archive.checks.push({id: 'c-' + i + '-' + j, code, date: days[i], asOf: days[i] + ' 15:05',
      createdAt: new Date(at(days[i], '15:05:00')).toISOString(), market: {systemicSelloff: false}, emotion: {stage: '修复'},
      factorObservations: Object.fromEntries([['TL-01', j * 10], ['ZJ-01', j * 20 + 3]].map(([factorCode, value]) => [factorCode,
        {factorCode, symbol: code, tradeDate: days[i], knownAt: observedAt, source: 'eastmoney', value, unit: 'score', sampleSet: 'real'}]))});
  }
  const before = JSON.stringify(archive);
  const report = buildIntelligenceResearch({day: days.at(-1), now: clock, archive, calendar: calendar(days), config});
  assert.equal(report.factors.alignedSamples, 135); assert.equal(report.walkforward.status, 'evaluated');
  assert.equal(report.factors.descriptive['TL-01'].meanIC, 1);
  assert.ok(report.feedback.candidates.length > 0);
  for (const candidate of report.feedback.candidates) {
    assert.equal(candidate.status, 'pending-validation'); assert.equal(candidate.approvalRequired, true);
    assert.ok(Math.abs(candidate.multiplier - 1) <= .08000001);
    assert.ok(Math.abs(candidate.candidateWeight / candidate.baselineWeight - 1) <= .08000001);
  }
  assert.equal(report.productionWeightsChanged, false); assert.equal(report.feedback.productionWeightsChanged, false);
  assert.equal(report.quality.components.find(row => row.id === 'realtime').value, null);
  assert.equal(report.feedback.validationBridge.generateAction, 'learn:candidate');
  assert.equal(report.feedback.validationBridge.approvalAction, 'learn:decision');
  assert.equal(report.feedback.validationBridge.proposalImportSupported, true);
  assert.equal(report.feedback.validationBridge.ready, false);
  assert.ok(report.feedback.validationBridge.missing.some(reason => reason.includes('36')));
  assert.match(report.feedback.proposalFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(archive), before);
});

function threeToFourHistory() {
  const dates = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', day];
  const originalCalendar = calendar(dates, at('2026-11-17', '08:00:00'));
  const refs = [{name: '半导体', provider: 'cls', kind: 'theme'}];
  const archive = {scope: 'live', bars: [], market: []};
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i], current = date === day, close = current ? 11 : i === 4 ? 10 : 9;
    archive.bars.push(bar(date, '600001', 'V6/sina', {adjustment: 'unadjusted', role: 'stock', period: '日K',
      close, open: current ? 10.5 : close, high: close, low: current ? 10.4 : close, volume: current ? 150000 : 100000,
      amount: current ? 1650000 : close * 100000, turnover: 8}));
    const market = {date, source: 'V6 原始行情和收盘证据', knownAt: at(date) + 3000,
      nextTradingDay: dates[i + 1] || '2026-11-26', calendarSource: 'sse-calendar', calendarKnownAt: originalCalendar.knownAt};
    if (i >= 4) {
      market.structurePools = [{date, previousDay: dates[i - 1], knownAt: at(date) + 2000, provider: 'eastmoney',
        source: '东方财富收盘封板池', scope: '东方财富涨停专题统计池', complete: true, totalCount: 3,
        sealed: [{code: '600001', name: '证据测试标的', level: current ? 4 : 3, close, upLimit: close,
          amountCny: current ? 1650000 : 1000000, refs},
        {code: '600002', name: '助攻一', level: 1, close: 8, upLimit: 8, refs},
        {code: '600003', name: '助攻二', level: 2, close: 7, upLimit: 7, refs}]}];
      market.themes = [{name: '半导体', refs, members: [{code: '600001', level: current ? 4 : 3,
        sealedFundsCny: 99000, amountCny: current ? 1650000 : 1000000}]}];
    }
    archive.market.push(market);
  }
  return {archive, originalCalendar};
}

test('three-to-four has a complete independent definition and emits only evidence-backed unvalidated observations', () => {
  const {archive, originalCalendar} = threeToFourHistory(), before = JSON.stringify(archive);
  const result = evaluateThreeToFour(archive, {day, now, calendar: originalCalendar});
  assert.equal(result.status, 'observed-unvalidated'); assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].conditions.length, 7);
  assert.ok(result.observations[0].conditions.every(row => row.status === 'passed'));
  assert.equal(result.observations[0].priorDay, '2026-11-24');
  assert.equal(result.definition.changesOriginal95Rules, false); assert.equal(result.affectsResonance, false);
  assert.equal(result.canTrade, false); assert.equal(result.validationStatus, 'not-oos-validated');
  assert.equal(JSON.stringify(archive), before);
  const report = buildIntelligenceResearch({day, now, archive});
  assert.equal(report.templates.threeToFour.observations.length, 1);
  assert.equal(report.factors.alignedSamples, 0); assert.equal(report.quality.gates.backtest.admittedGroups, 0);
});

test('three-to-four does not fill missing seal, turnover or calendar evidence', () => {
  const {archive, originalCalendar} = threeToFourHistory();
  delete archive.market.at(-1).themes[0].members[0].sealedFundsCny;
  delete archive.bars.at(-1).turnover;
  const result = evaluateThreeToFour(archive, {day, now, calendar: originalCalendar});
  assert.equal(result.observations.length, 0); assert.equal(result.status, 'missing-evidence');
  assert.equal(result.evaluations[0].conditions.find(row => row.id === 'seal-ratio').value, null);
  assert.equal(result.evaluations[0].conditions.find(row => row.id === 'turnover').value, null);
  const noCalendar = evaluateThreeToFour(threeToFourHistory().archive, {day, now});
  assert.equal(noCalendar.observations.length, 0);
  assert.equal(noCalendar.evaluations[0].conditions.find(row => row.id === 'next-trading-day').status, 'unknown');
});

test('three-to-four blocks late prior pools, mixed-day backfill and disagreeing raw close prices', () => {
  const first = threeToFourHistory();
  first.archive.market.at(-2).knownAt = at(day, '10:00:00');
  first.archive.market.at(-2).structurePools[0].knownAt = at(day, '10:00:00');
  assert.equal(evaluateThreeToFour(first.archive, {day, now, calendar: first.originalCalendar}).observations.length, 0);
  const second = threeToFourHistory(); second.archive.bars[0].knownAt = at(day, '10:00:00');
  const backfilled = evaluateThreeToFour(second.archive, {day, now, calendar: second.originalCalendar});
  assert.equal(backfilled.observations.length, 0);
  assert.equal(backfilled.evaluations[0].conditions.find(row => row.id === 'volume-price').status, 'unknown');
  const third = threeToFourHistory(); third.archive.bars.at(-1).close = 10.9;
  const conflict = evaluateThreeToFour(third.archive, {day, now, calendar: third.originalCalendar});
  assert.equal(conflict.observations.length, 0);
  assert.equal(conflict.evaluations[0].conditions.find(row => row.id === 'volume-price').status, 'failed');
});

test('three-to-four observed failed conditions stay distinct from unknown and do not claim historical validation', () => {
  const {archive, originalCalendar} = threeToFourHistory(); archive.bars.at(-1).turnover = 25;
  const result = evaluateThreeToFour(archive, {day, now, calendar: originalCalendar});
  assert.equal(result.observations.length, 0); assert.equal(result.status, 'no-matching-observation');
  assert.equal(result.evaluations[0].conditions.find(row => row.id === 'turnover').status, 'failed');
  assert.equal(result.evaluations[0].validationStatus, 'not-oos-validated');
  assert.equal(Object.hasOwn(result, 'winRate'), false);
});
