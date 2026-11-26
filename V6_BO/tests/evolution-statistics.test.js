'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const S = require('../src/core/evolution-research-statistics');
const C = require('../src/core/research-causal-diagnostics');
const { SYSTEMS } = require('../src/core/independent-strategy-attribution');
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day = i => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
const at = (i, clock = '16:30:00') => Date.parse(day(i) + 'T' + clock + '+08:00');
function rows(n = 40) {
  return Array.from({ length: n }, (_, i) => SYSTEMS.map((system, j) => ({ system, symbol: '600000', signalDate: day(i),
    entryDate: day(i + 1), exitDate: day(i + 6), signalAt: at(i), recordedAt: at(i) + 1, outcomeKnownAt: at(i + 6),
    provider: 'tencent', priceBasis: 'unadjusted', version: 'native-test-v1', regime: 'range', horizon: 5,
    costFingerprint: digest('same-fees'), scopeFingerprint: digest('same-universe'), verdict: j === 0 || i % 2 ? 'pass' : 'fail',
    status: 'paper-estimate', priceReturnPct: i % 2 ? 4 : -2, netReturnPct: i % 2 ? 3.5 : -2.5, runId: `${i}/${j}` }))).flat();
}
function history(n = 84, count = 2) {
  const fields = [...new Set(require('../strategies/a-share-strategy-pack.json').strategies.flatMap(s => s.rules.map(r => r.field)))];
  return { source: 'simulated', priceBasis: 'unadjusted', asOf: day(n - 1), start: 60, topN: 2, initialCash: 100000,
    stocks: Array.from({ length: count }, (_, j) => ({ code: `60000${j}`, market: 'main', isST: false, suspended: false, tradable: true, limitPct: 10,
      bars: Array.from({ length: n }, (_, i) => {
        const close = 10 + i * .015 + (i % 2 ? .15 : -.15) + j;
        return { date: day(i), open: close - .02, high: close + .1, low: close - .1, close, volume: 1000000, amount: 1e8,
          isST: false, suspended: false, tradable: true, priceBasis: 'unadjusted',
          factors: { ...Object.fromEntries(fields.map(k => [k, k === 'riskScore' ? 0 : 90])), amount: 1e8, riskScore: 0 },
          factorsPublishedAt: day(i) + 'T14:59:00+08:00' };
      }) })) };
}
function nativeInputs(h) {
  const snapshots = {}, pythonEvidence = {};
  const fields = [...new Set(require('../strategies/a-share-strategy-pack.json').strategies.flatMap(s => s.rules.map(r => r.field)))];
  for (const stock of h.stocks) for (const [i, bar] of stock.bars.entries()) {
    const symbol = stock.code, key = symbol + '/' + bar.date;
    snapshots[key] = { symbol, observedThrough: bar.date, knownAt: at(i, '15:00:00'), name: '原生隔离测试', floatCap: 5e9, profitRatio: 40,
      sector: { pct: 3 }, auction: { pct: 1 }, mainInflow: 2e8, sectorInfo: { secZT: 8, streak: 3, leaderPct: 8 },
      // Isolated synthetic fixture: observed zero is explicit, not inferred
      // from OHLC. These rule inputs are not a provider or live signal claim.
      fourteenEvidence: { symbol, date: bar.date, source: 'isolated-native-contract-fixture', knownAt: at(i, '15:00:00'),
        stock: { limitUpCount: 0, breakCount: 0, amount: bar.amount, sealAmount: 0 },
        sector: { pct: 3, ztCount: 5 }, auction: { auctionAmount: 5e7, auctionPct: 4.5 },
        lhb: { whale: true, whaleNet: 1e7, why: 'isolated fixture' } },
      gptSnapshotObservedThrough: bar.date, gptSnapshot: Object.fromEntries(fields.map(k => [k, k === 'riskScore' ? 0 : i % 2 ? 90 : 30])),
      market: { breadthScore: 70, indexTrendScore: 70, marketVolumeScore: 70, riskScore: 0, volatilityScore: 20, sentimentScore: 70 } };
    pythonEvidence[key] = { symbol, date: bar.date, observedThrough: bar.date, knownAt: at(i, '15:00:00'),
      evaluatorVersion: 'python-native/isolated-test-v1', provenance: 'python-runtime:isolated-contract-fixture',
      rounds: [1, 2, 3].map(round => ({ round, verdict: i % 2 ? 'pass' : 'fail', observedThrough: bar.date, reason: '隔离测试执行回执' })) };
  }
  return { history: h, snapshots, pythonEvidence };
}

test('four systems use identical mature denominators and cash for actual rejections', () => {
  const input = rows(), before = JSON.stringify(input), result = S.strategyCompetition(input, { asOf: at(80) });
  assert.equal(result.commonSamples, 40); assert.equal(result.groups.length, 1);
  const systems = result.groups[0].systems;
  assert.ok(systems.every(x => x.commonSamples === 40 && x.commonDateCount === 40));
  assert.equal(systems[0].meanNetReturnPct, .5); assert.equal(systems[1].meanNetReturnPct, 1.75);
  assert.equal(systems[1].selectedOutcome.mean, 3.5); assert.equal(systems[1].rank, 1); assert.equal(systems[0].rank, 4);
  assert.equal(JSON.stringify(input), before); assert.equal(result.canTrade, false);
});
for (const defect of ['unknown', 'future', 'cost', 'regime', 'window', 'duplicate', 'version', 'late-signal', 'unfillable']) test('common cohort excludes ' + defect + ' without turning it into failure', () => {
  const input = rows(1), target = input[3];
  if (defect === 'unknown') target.verdict = 'unknown';
  if (defect === 'future') target.outcomeKnownAt = at(100);
  if (defect === 'cost') target.costFingerprint = digest('other');
  if (defect === 'regime') target.regime = 'other';
  if (defect === 'window') target.exitDate = day(7);
  if (defect === 'late-signal') target.recordedAt = at(1, '10:00:00');
  if (defect === 'unfillable') target.status = 'unverified-execution';
  if (defect === 'duplicate') input.push({ ...target, netReturnPct: 50 });
  if (defect === 'version') input.push({ ...target, version: 'v2' });
  const result = S.strategyCompetition(input, { asOf: at(80) });
  assert.equal(result.commonSamples, 0); assert.equal(result.status, 'not-evaluated');
  assert.ok(Object.keys(result.exclusions).length);
});
test('different model versions are separate cohorts and identical duplicates are idempotent', () => {
  const input = rows(); for (const row of input.slice(80)) row.version = 'v2';
  assert.equal(S.strategyCompetition([...input, input[0]], { asOf: at(80) }).commonSamples, 40);
  assert.equal(S.strategyCompetition(input, { asOf: at(80) }).groups.length, 2);
});
test('real workspace scorecards supply mature counterfactual exposures while preserving native verdicts and first receipts', () => {
  const D = require('../src/core/research-workspace-decision');
  const { fixture, native, event, at: t } = require('./helpers/research-workspace-fixtures');
  const signal = D.buildWorkspaceDecision(fixture(), native()), later = D.buildWorkspaceDecision(fixture({ index: 140 }), native(140));
  // Exercise the ordinary source contract here. Explicit teaching markers are
  // covered separately below and must never enter this admissible population.
  for (const d of [signal, later]) {
    d.name = '原生合同观察'; d.nativeInputs.gpt.source = 'provider:observed-factors';
    d.nativeInputs.python.provenance = 'python-runtime:provider-native-bridge';
  }
  for (const s of signal.systems) s.verdict = s.id === 'python' ? 'fail' : 'pass';
  const first = event(signal), next = event(later, 2), revised = structuredClone(first);
  revised.hash = 'revision'; revised.recordedAt++; revised.sequence = 3; revised.data.systems.find(s => s.id === 'python').verdict = 'pass';
  const source = [first, next, revised], frozen = JSON.stringify(source);
  const projected = S.workspaceStatisticalRows(source, { asOf: t(140) });
  const common = S.strategyCompetition(projected, { asOf: t(140), horizon: 5 });
  assert.equal(common.commonSamples, 1); assert.equal(common.groups[0].systems.find(s => s.system === 'python').passed, 0);
  assert.equal(S.strategyCompetition(S.workspaceStatisticalRows(source, { asOf: t(70) }), { asOf: t(70) }).commonSamples, 0);
  assert.equal(JSON.stringify(source), frozen);
  const h = { provider: 'tencent', stocks: [{ code: signal.symbol, bars: signal.bars }] };
  const nativeInputs = S.diagnosticInputsFromEvents(source, h, { asOf: t(140) });
  assert.ok(nativeInputs.snapshots[signal.symbol + '/' + signal.tradeDate].gptSnapshot);
  assert.ok(nativeInputs.pythonEvidence[signal.symbol + '/' + signal.tradeDate]);
  assert.equal(nativeInputs.pythonEvidence[signal.symbol + '/' + signal.tradeDate].knownAt, first.recordedAt);
});
test('test/demo/synthetic observation ancestors and child evidence never enter ordinary returns or native first-receipt slots', () => {
  const D = require('../src/core/research-workspace-decision');
  const { fixture, native, event, at: t } = require('./helpers/research-workspace-fixtures');
  const first = D.buildWorkspaceDecision(fixture(), native()), last = D.buildWorkspaceDecision(fixture({ index: 140 }), native(140));
  for (const d of [first, last]) {
    d.name = '原生合同观察'; d.nativeInputs.gpt.source = 'provider:observed-factors';
    d.nativeInputs.python.provenance = 'python-runtime:provider-native-bridge';
    for (const s of d.systems) s.verdict = 'pass';
  }
  const source = [event(first), event(last, 2)], h = { provider: 'tencent', stocks: [{ code: first.symbol, bars: first.bars }] };
  for (const [ancestor, marker] of [['event', { scope: 'demo' }], ['data', { sampleSet: 'test' }], ['data', { simulated: true }],
    ['event', { synthetic: true }], ['data', { source: 'fixture' }], ['data', { source: 'mock-provider' }]]) {
    const poisoned = structuredClone(source);
    for (const e of poisoned) Object.assign(ancestor === 'event' ? e : e.data, marker);
    const result = S.buildEvolutionStatistics({ events: poisoned, archive: { scope: 'main' }, asOf: t(140) });
    assert.equal(result.competition.commonSamples, 0); assert.equal(result.fusion.groups.length, 0);
    assert.equal(result.expectation.paperSignals.groups.length, 0); assert.equal(result.inputSummary.sourceExclusions.testEvents, 2);
    const nativeProjection = S.diagnosticInputsFromEvents(poisoned, h, { asOf: t(140) });
    assert.equal(nativeProjection.nativeEvidenceCount, 0); assert.equal(nativeProjection.exclusions.testEvents, 2);
  }
  const poisonedFirst = structuredClone(source[0]); poisonedFirst.sampleSet = 'test'; poisonedFirst.recordedAt--;
  const mixed = S.diagnosticInputsFromEvents([poisonedFirst, ...source], h, { asOf: t(140) });
  assert.equal(mixed.pythonEvidence[first.symbol + '/' + first.tradeDate].knownAt, source[0].recordedAt);
  const child = structuredClone(source); child[1].data.bars[71].sampleSet = 'test';
  const projected = S.workspaceStatisticalRows(child, { asOf: t(140) });
  assert.equal(projected.sourceExclusions.testBars, 1); assert.equal(S.strategyCompetition(projected, { asOf: t(140) }).commonSamples, 0);
  const nativeChild = structuredClone(source); nativeChild[0].data.nativeInputs.gpt.source = 'synthetic-factors';
  assert.equal(S.strategyCompetition(S.workspaceStatisticalRows(nativeChild, { asOf: t(140) }), { asOf: t(140) }).commonSamples, 0);
  assert.equal(S.diagnosticInputsFromEvents(nativeChild, h, { asOf: t(140) }).snapshots[first.symbol + '/' + first.tradeDate], undefined);
});
test('trial-budget signal days exclude demo ancestry, holiday recalculations, late first receipts and test price evidence', () => {
  const D = require('../src/core/research-workspace-decision');
  const { fixture, native, event, at: t, dates } = require('./helpers/research-workspace-fixtures');
  const make = index => { const d = D.buildWorkspaceDecision(fixture({ index }), native(index)); d.name = '原生合同观察'; return event(d, index); };
  const good = make(70), later = make(140), demo = make(141); demo.data.sampleSet = 'test';
  const holiday = make(71); holiday.data.asOf = t(72); holiday.recordedAt = t(72);
  const late = make(73); late.recordedAt = t(74);
  const testPrice = make(75); testPrice.data.bars.at(-1).scope = 'demo';
  const synthetic = make(76); synthetic.simulated = true;
  assert.deepEqual(S.researchSignalDays([later, demo, good, good, holiday, late, testPrice, synthetic], { asOf: t(150) }), [dates[70], dates[140]]);
  assert.deepEqual(S.researchSignalDays([good, later], { asOf: t(70) }), [dates[70]]);
});
test('fusion retains all eight predefined variants and uses common denominators with undefined constant correlation', () => {
  const result = S.fusionStudy(rows(), { asOf: at(80) }), group = result.groups[0];
  assert.equal(group.variants.length, 8); assert.equal(group.pairs.length, 6);
  assert.ok(group.pairs.filter(p => p.a === 'fourteen').every(p => p.signalCorrelation === null));
  assert.ok(group.variants.every(v => v.commonSamples === 40));
  assert.equal(result.productionWeightsChanged, false); assert.equal(result.promotion, 'never');
});
test('strategy risk and equal-weight fusion use common costs and a date-only nonoverlapping paper path', () => {
  const net = [10, -20, 5, -5, 20, -10, 1, 2], input = rows(net.length);
  for (let i = 0; i < net.length; i++) for (const r of input.slice(i * 4, (i + 1) * 4)) Object.assign(r, {
    signalDate: day(i * 7), entryDate: day(i * 7 + 1), exitDate: day(i * 7 + 6),
    signalAt: at(i * 7), recordedAt: at(i * 7) + 1, outcomeKnownAt: at(i * 7 + 6),
    verdict: r.system === SYSTEMS[0] ? 'pass' : 'fail', netReturnPct: net[i], priceReturnPct: net[i] + .5
  });
  const options = { asOf: at(100) }, competition = S.strategyCompetition(input, options).groups[0];
  const full = competition.systems[0].pathStatistics;
  const expected = net.reduce((equity, value) => equity * (1 + value / 100), 1);
  assert.ok(Math.abs(full.totalReturnPct - 100 * (expected - 1)) < 1e-12);
  assert.ok(Math.abs(full.maxDrawdownPct - 20.2) < 1e-10);
  assert.equal(full.nonOverlappingPeriods, 8); assert.equal(full.excludedOverlappingPeriods, 0);
  assert.equal(full.accountEquity, false); assert.equal(full.independentObservations, false);
  assert.equal(full.meanCostDragPct, .5); assert.equal(full.stability.firstHalfMeanPct, -2.5);
  assert.equal(full.stability.secondHalfMeanPct, 3.25);
  const fusion = S.fusionStudy(input, options).groups[0], equal = fusion.equalWeight;
  assert.equal(fusion.variants.length, 8); assert.equal(fusion.predefinedFusionConfigurations, 9);
  assert.equal(fusion.singleStrategies.length, 4); assert.equal(equal.meanExposurePct, 25);
  assert.equal(equal.meanCostDragPct, .125);
  assert.deepEqual(equal.series.map(p => p.value), net.map(value => value / 4));
  assert.deepEqual(fusion.singleStrategies[0].pathStatistics, full);
  assert.ok(fusion.singleStrategies.slice(1).every(s => s.meanExposurePct === 0 && s.pathStatistics.maxDrawdownPct === 0));
  assert.deepEqual(S.fusionStudy(input.slice().reverse(), options).groups[0], fusion);
});
test('overlapping labels are never compounded as reusable capital and short paths retain unknown stability', () => {
  const competition = S.strategyCompetition(rows(), { asOf: at(80) }).groups[0], risk = competition.systems[0].pathStatistics;
  assert.equal(risk.nonOverlappingPeriods, 7); assert.equal(risk.excludedOverlappingPeriods, 33);
  assert.ok(Math.abs(risk.totalReturnPct - ((1 - .025) ** 7 - 1) * 100) < 1e-10);
  const short = S.strategyCompetition(rows(3), { asOf: at(80) }).groups[0].systems[0].pathStatistics;
  assert.equal(short.nonOverlappingPeriods, 1); assert.equal(short.periodVolatilityPct, null);
  assert.equal(short.stability.status, 'not-evaluated'); assert.equal(short.stability.halfMeanDifferencePct, null);
  const invalid = rows(1); invalid.forEach(r => { r.netReturnPct = -101; r.priceReturnPct = -99; });
  const unavailable = S.strategyCompetition(invalid, { asOf: at(80) }).groups[0].systems[0].pathStatistics;
  assert.equal(unavailable.status, 'not-evaluated'); assert.equal(unavailable.maxDrawdownPct, null);
});
test('DSR matches an independent Python statistics.NormalDist oracle and deflates increasing trial search', () => {
  const returns = Array.from({ length: 20 }, () => [-.02, .01, .03, -.01, .04, .005]).flat();
  const options = { returns, trialSharpes: [-.1, 0, .1, .2, .3], completeTrialHistory: true, independentObservations: true };
  const result = S.deflatedSharpe({ ...options, independentTrials: 5 });
  // Independently evaluated using Python stdlib mean/variance/NormalDist, Eq. (2)-(3).
  assert.ok(Math.abs(result.expectedMaximumSharpe - .18856566835299465) < 2e-7);
  assert.ok(Math.abs(result.probability - .9968507645680189) < 2e-7);
  assert.ok(Math.abs(result.skewness - .11739916666765678) < 1e-12);
  assert.ok(Math.abs(result.kurtosis - 1.7043557164196836) < 1e-12);
  assert.ok(result.probability < S.deflatedSharpe({ ...options, independentTrials: 1 }).probability);
  assert.equal(S.deflatedSharpe({ ...options, independentTrials: 5, completeTrialHistory: false }).status, 'not-evaluated');
  assert.equal(S.deflatedSharpe({ ...options, returns: Array(120).fill(1), independentTrials: 5 }).status, 'not-evaluated');
  assert.throws(() => S.deflatedSharpe({ ...options, returns: [NaN], independentTrials: 5 }), /DSR/);
});
test('PBO CSCV has exact stable-winner oracle, reversal failure and column-order invariant ties', () => {
  const matrix = Array.from({ length: 32 }, (_, i) => [.02 + i % 4 * .001, .005 + i % 4 * .001, -.01 + i % 4 * .001]);
  const options = { matrix, blocks: 4, completeTrialHistory: true, independentObservations: true };
  const stable = S.probabilityOfBacktestOverfitting(options);
  assert.equal(stable.probability, 0); assert.equal(stable.totalSplits, 6); assert.equal(stable.splits[0].winners[0].relativeRank, .75);
  const reversal = matrix.map((r, i) => i < 16 ? [r[0], r[2]] : [r[2], r[0]]);
  const fail = S.probabilityOfBacktestOverfitting({ ...options, matrix: reversal });
  assert.equal(fail.probability, 1);
  assert.equal(S.probabilityOfBacktestOverfitting({ ...options, matrix: reversal.map(r => r.slice().reverse()) }).probability, fail.probability);
  assert.equal(S.probabilityOfBacktestOverfitting({ ...options, matrix: Array(32).fill([0, 1]) }).status, 'not-evaluated');
  assert.equal(S.probabilityOfBacktestOverfitting({ ...options, independentObservations: false }).status, 'not-evaluated');
  assert.throws(() => S.probabilityOfBacktestOverfitting({ ...options, matrix: [[1, 2], [3]] }), /矩阵/);
});
test('circular block bootstrap is deterministic, block-sensitive and transparent about insufficient data', () => {
  const values = Array.from({ length: 80 }, (_, i) => Math.floor(i / 10) % 2 ? 3 : -2);
  const options = { seed: 71, blockLength: 5, replications: 300 };
  assert.deepEqual(S.blockBootstrap(values, options), S.blockBootstrap(values, options));
  assert.notDeepEqual(S.blockBootstrap(values, options).interval, S.blockBootstrap(values, { ...options, blockLength: 1 }).interval);
  assert.equal(S.blockBootstrap(values.slice(0, 20), options).status, 'not-evaluated');
  assert.throws(() => S.blockBootstrap(values, { seed: -1 }), /bootstrap/);
});
test('DSR/PBO integration requires every sealed trial, a mature common matrix and nonoverlapping intervals', () => {
  const packFingerprint = digest(require('../strategies/extended-factor-pack.json'));
  const trialReports = Array.from({ length: 3 }, (_, i) => ({ mode: 'v6-factor-shadow-evolution-v1', status: 'shadow-retained',
    packFingerprint, fingerprint: digest('trial-' + i), lastObservationDay: day(i * 6 + 5), trialAudit: { schemaVersion: 1, status: 'consumed',
      firstHoldoutDay: day(i * 6), lastHoldoutDay: day(i * 6 + 5), holdoutDays: 6, candidateFingerprint: digest('candidate-' + i) } }));
  const dates = Array.from({ length: 32 }, (_, i) => day(21 + 2 * i));
  const trialReturns = { matrix: dates.map((_, i) => [.02 + i % 4 * .001, .005 + i % 4 * .001, -.01 + i % 4 * .001]), dates,
    intervals: dates.map((exitDate, i) => ({ entryDate: day(20 + 2 * i), exitDate })),
    outcomeKnownAt: dates.map((_, i) => at(21 + 2 * i)), trialFingerprints: trialReports.map(r => r.fingerprint), blocks: 4 };
  const input = { trialReports, signalDays: Array.from({ length: 100 }, (_, i) => day(i)), packFingerprint, trialReturns,
    independentTrials: 3, completeTrialHistory: true, asOf: at(100) };
  const result = S.overfittingStudy(input);
  assert.equal(result.budget.allTimeTrialCount, 3); assert.equal(result.budget.usedTrials, 2);
  assert.equal(result.dsr.status, 'evaluated'); assert.equal(result.pbo.probability, 0);
  assert.equal(result.bootstrap.status, 'evaluated');
  assert.equal(S.overfittingStudy({ ...input, trialReturns: { ...trialReturns, trialFingerprints: trialReturns.trialFingerprints.slice(1) } }).status, 'not-evaluated');
  assert.equal(S.overfittingStudy({ ...input, trialReturns: { ...trialReturns, outcomeKnownAt: trialReturns.outcomeKnownAt.map(() => at(101)) } }).status, 'not-evaluated');
  assert.equal(S.overfittingStudy({ ...input, trialReturns: { ...trialReturns, intervals: trialReturns.intervals.map(r => ({ ...r, entryDate: day(20) })) } }).status, 'not-evaluated');
});
test('benchmarks use the actual ledger, frozen universe, same window and costs without inventing blocked fills', () => {
  const h = history(), stamp = at(59), before = JSON.stringify(h), cfg = { frozenUniverse: { symbols: ['600000', '600001'], knownAt: stamp, source: 'frozen-fixture' },
    buyHold: { symbol: '600000', knownAt: stamp, source: 'predeclared-fixture' } };
  const result = S.benchmarkComparison(h, cfg), equal = result.entries.find(e => e.id === 'frozen-equal-weight');
  assert.equal(result.entries[0].metrics.returnPct, 0); assert.equal(equal.closedTrades, 2);
  const direct = require('../src/strategy/research-v2-position-ledger-backtest').ledgerBacktest({ ...h, stocks: h.stocks,
    feeBps: 8, slippageBps: 10, sellTaxBps: 5 });
  assert.deepEqual(result.nativeStrategy.metrics, direct.metrics);
  assert.equal(result.nativeStrategy.equity.length, equal.equity.length);
  assert.equal(result.comparisons[0].netReturnDifferencePct, direct.metrics.returnPct);
  assert.equal(result.comparisons[1].drawdownDifferencePct, direct.metrics.maxDrawdownPct - equal.metrics.maxDrawdownPct);
  assert.equal(result.comparisons[3].netReturnDifferencePct, null);
  assert.equal(equal.equity.length, result.entries[0].equity.length); assert.equal(result.entries.find(e => e.id === 'index-proxy').status, 'not-evaluated');
  const locked = structuredClone(h); locked.stocks[0].bars[61].open = locked.stocks[0].bars[61].high = Math.round(locked.stocks[0].bars[60].close * 110) / 100;
  const blocked = S.benchmarkComparison(locked, cfg).entries.find(e => e.id === 'buy-and-hold');
  assert.equal(blocked.filled, 0); assert.equal(blocked.blocked, 1);
  const stranded = structuredClone(h); stranded.stocks[0].bars.at(-1).suspended = true;
  const pending = S.benchmarkComparison(stranded, cfg).entries.find(e => e.id === 'buy-and-hold');
  assert.equal(pending.closedTrades, 0); assert.equal(pending.openPositions.length, 1); assert.ok(pending.blocked > 0);
  assert.equal(S.benchmarkComparison(h, { ...cfg, frozenUniverse: { ...cfg.frozenUniverse, knownAt: at(70) } }).entries[1].status, 'not-evaluated');
  assert.equal(JSON.stringify(h), before);
});
test('native sensitivity reruns parameters, costs, delays, liquidity, thresholds and model weights without selecting a winner', () => {
  const h = history(70, 1), before = JSON.stringify(h), result = S.sensitivityStudy(h);
  assert.equal(result.variants.length, 15); assert.equal(result.inspectedConfigurations, 15); assert.ok(result.variants.some(v => v.filled));
  const base = result.variants.find(v => v.id === 'baseline'), fees = result.variants.find(v => v.id === 'fees-2x');
  assert.ok(fees.metrics.returnPct <= base.metrics.returnPct);
  assert.notEqual(result.variants.find(v => v.id === 'weights-minus-20pct').modelFingerprint, base.modelFingerprint);
  assert.equal(result.selection, 'all-predeclared-variants-no-winner-selection'); assert.equal(JSON.stringify(h), before);
  const noFills = structuredClone(h); noFills.stocks[0].suspended = true; noFills.stocks[0].bars.forEach(b => { b.suspended = true; });
  assert.equal(S.sensitivityStudy(noFills, { scenarios: [{ id: 'baseline' }] }).status, 'not-evaluated');
  assert.throws(() => S.sensitivityStudy(h, { scenarios: [{ id: 'x', delay: -1 }] }), /扰动/);
});
test('equal-weight covers the frozen five-name universe even when strategy topN is three', () => {
  const h = history(70, 5); h.topN = 3;
  const result = S.benchmarkComparison(h, { frozenUniverse: { symbols: h.stocks.map(s => s.code), knownAt: at(59), source: 'frozen-five' } }).entries[1];
  assert.equal(result.targetWeightPct, 20); assert.equal(result.closedTrades, 5);
  assert.equal(result.orders.filter(o => o.side === 'buy' && o.status === 'filled').length, 5);
});
test('non-synthetic benchmarks and perturbations cannot fabricate executable prices from missing open-status metadata', () => {
  const h = history(70, 1); h.source = 'imported';
  const result = S.benchmarkComparison(h, { buyHold: { symbol: '600000', knownAt: at(59), source: 'frozen' } });
  assert.equal(result.entries[0].metrics.returnPct, 0); assert.equal(result.entries[2].status, 'not-evaluated');
  assert.equal(result.nativeStrategy.status, 'not-evaluated');
  assert.ok(result.comparisons.every(x => x.netReturnDifferencePct === null && x.drawdownDifferencePct === null));
  assert.equal(S.sensitivityStudy(h).status, 'not-evaluated');
});
test('EMA/MACD batch, incremental and serialized restart are independent paths; cold history actually changes the answer', () => {
  const h = history(280, 1), bars = h.stocks[0].bars;
  bars.forEach((b, i) => { const v = i < 180 ? 100 : 10 + Math.sin(i) * .1; b.open = b.close = v; b.high = v + 1; b.low = v - 1; });
  const result = C.indicatorPathDiagnostics(bars, { lengths: [26, 60, 120, 250], absTolerance: 1e-8, relativeTolerance: 1e-8, restartAt: 173 });
  assert.equal(result.status, 'pass'); assert.equal(result.paths.length, 2); assert.equal(result.checkpoint.count, 173);
  assert.equal(result.cold[0].status, 'fail'); assert.equal(result.paths[0].status, 'pass');
  assert.throws(() => C.restoreIndicatorState({ schemaVersion: 1, count: 4, lastDate: day(4), ema12: NaN, ema26: 10, dea: 0 }), /检查点/);
  assert.equal(C.indicatorPathDiagnostics(bars.slice(0, 20)).status, 'not-evaluated');
});
test('actual native four-strategy pipeline preserves factors, scores and cross-stock ranking under all future attacks', () => {
  const input = nativeInputs(history()), before = JSON.stringify(input), cutoff = day(80);
  const baseline = C.nativePointInTime(input, cutoff), result = C.nativeCausalDiagnostics({ ...input, cutoff });
  assert.equal(result.checks.length, 4); assert.ok(result.checks.every(x => x.status === 'pass'));
  assert.ok(result.systems.every(x => x.evaluated > 0)); assert.equal(result.status, 'pass');
  assert.ok(baseline.ranks.some(x => x.system === 'gpt' && x.ranked.length === 2));
  const late = structuredClone(input); for (const s of Object.values(late.snapshots)) s.knownAt = at(100);
  assert.equal(C.nativePointInTime(late, cutoff).coverage.gpt.evaluated, 0);
  const changed = structuredClone(input); changed.snapshots['600000/' + cutoff].gptSnapshot = Object.fromEntries(Object.keys(changed.snapshots['600000/' + cutoff].gptSnapshot).map(k => [k, 100]));
  const target = list => list.find(d => d.symbol === '600000' && d.date === cutoff);
  assert.notDeepEqual(target(C.nativePointInTime(changed, cutoff).details), target(baseline.details));
  assert.equal(JSON.stringify(input), before);
});
test('missing Python runtime receipts retain not-evaluated instead of claiming four strategy proof', () => {
  const input = nativeInputs(history(70, 1)); delete input.pythonEvidence;
  const result = C.nativeCausalDiagnostics({ ...input, cutoff: day(65) });
  assert.equal(result.status, 'not-evaluated'); assert.equal(result.systems.find(s => s.system === 'python').status, 'not-evaluated');
});
test('daily causal cutoff accepts same-evening receipts but does not backdate next-day prices', () => {
  const input = nativeInputs(history(70, 1));
  input.history.stocks[0].bars.forEach((b, i) => { b.knownAt = at(i); });
  const result = C.nativeCausalDiagnostics({ ...input, cutoff: day(65) });
  assert.equal(result.status, 'pass'); assert.equal(result.decisionTimePolicy, 'closed-session-day-end-before-next-open');
  input.history.stocks[0].bars[60].knownAt = at(61);
  assert.equal(C.nativeCausalDiagnostics({ ...input, cutoff: day(65) }).status, 'not-evaluated');
});
test('paper expectancy reconciles original actual importer receipts, costs and idempotent settlement identities', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-stat-settlement-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-11-04T10:00:00+08:00');
  const service = require('../src/core/paper-application-service').createPaperApplicationService({ file: path.join(dir, 'pool.json'), clock: () => now, calendar: { isOpen: () => true } });
  service.initialize(100000);
  for (const [id, side, price, time] of [['buy', 'buy', 10, '2026-11-04'], ['sell', 'sell', 11, '2026-11-05']]) {
    now = Date.parse(time + 'T10:00:00+08:00');
    service.submit({ orderId: id, symbol: '600000', side, quantity: 100, limitPrice: price, tradeDate: time });
    service.fill(id, id + '-fill', { symbol: '600000', timestamp: now, source: 'simulated', tradeDate: time, suspended: false, tradable: true, price, volume: 1000000, volumeUnit: 'shares', upperLimit: 20, lowerLimit: 5 });
  }
  const archive = { trades: [], plans: [], explanations: [] }; now += 1000;
  require('../src/research/shortline-paper-import').importSettledPaperTrades(archive, { accountDir: dir, now });
  assert.equal(archive.trades.length, 1);
  const row = archive.trades[0], result = S.tradeExpectation([row, structuredClone(row), { pnl: 500 }], { asOf: now });
  assert.equal(result.n, 1); assert.equal(result.excluded['duplicate-settlement'], 1); assert.ok(result.mean < 10);
  assert.ok(Math.abs(result.mean - row.paperSettlement.realizedCents / row.paperSettlement.costBasisCents * 100) < 1e-10);
  assert.equal(S.tradeExpectation([row], { asOf: now - 1 }).n, 0);
  const tampered = structuredClone(row); tampered.paperSettlement.realizedCents++; tampered.sourceFingerprint = digest(tampered.paperSettlement);
  assert.equal(S.tradeExpectation([tampered], { asOf: now }).n, 0); assert.equal(result.source, 'verified-simulation-settlements');
  assert.equal(S.tradeExpectation([row, tampered], { asOf: now }).n, 0);
  assert.deepEqual(S.tradeExpectation([row, tampered], { asOf: now }), S.tradeExpectation([tampered, row], { asOf: now }));
  const later = { ...structuredClone(tampered), createdAt: new Date(now + 1000).toISOString() };
  const historical = S.tradeExpectation([row, later], { asOf: now });
  assert.equal(historical.n, 1); assert.equal(historical.mean, result.mean);
  assert.equal(S.tradeExpectation([row, later], { asOf: now + 1000 }).n, 0);
  for (const marker of [{ sampleSet: 'demo' }, { sampleSet: 'test' }, { synthetic: true }, { replicable: false },
    { quality: '演示样本' }, { quality: '黑天鹅' }, { extremeMarket: true }]) {
    const isolated = S.tradeExpectation([row, { ...tampered, ...marker }], { asOf: now });
    assert.equal(isolated.n, 1); assert.equal(isolated.mean, result.mean);
  }
});
test('manual expectancy consumes the real canonical-hash journal importer and remains distinct from broker certification', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-stat-manual-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const M = require('../src/core/manual-decision-loop'), W = require('../src/core/research-workspace-store');
  const workspaceRoot = path.join(root, 'workspace'), manualRoot = path.join(root, 'manual');
  const cn = s => Date.parse(s + '+08:00');
  const analysis = { symbol: '600001', name: '人工导入测试', tradeDate: '2026-08-14', asOf: cn('2026-08-14T15:00:00'),
    systems: [{ id: 'test', label: '隔离测试', verdict: 'pass' }], regime: 'up' };
  const run = W.appendEvent(workspaceRoot, 'analysis', analysis, { requestId: 'manual_test_source', now: analysis.asOf });
  let n = 0, now = cn('2026-08-17T08:00:00');
  const op = (action, fields) => M.execute(manualRoot, { action, requestId: 'manual_stat_' + (++n), expectedRevision: M.view(manualRoot).revision, ...fields }, { workspaceRoot, now });
  const planId = op('freeze', { runId: run.hash, shares: 100, limitPrice: '10.00' }).recordId;
  const buys = { reference: 'buy-stat', quantity: 100, price: '10.0000', fee: '5.00', side: 'buy', executedAt: '2026-08-17T10:00:00+08:00' };
  const sells = { reference: 'sell-stat', quantity: 100, price: '11.0000', fee: '6.00', side: 'sell', executedAt: '2026-08-18T11:00:00+08:00' };
  now = cn('2026-08-17T10:01:00'); op('fill', { planId, fill: buys });
  now = cn('2026-08-18T11:01:00'); op('fill', { planId, fill: sells });
  op('reconcile', { planId, statement: { sourceLabel: '本人测试交割单', rows: [buys, sells] } });
  const archive = { trades: [], explanations: [], candidates: [], versions: [] };
  require('../src/research/shortline-manual-import').importManualDecisionLoop(archive, { root: manualRoot, now });
  assert.equal(archive.trades.length, 1);
  const result = S.tradeExpectation(archive.trades, { asOf: now });
  assert.equal(result.n, 1); assert.equal(result.source, 'reconciled-manual-import'); assert.equal(result.brokerVerified, false);
  assert.equal(result.realizedAmount, 89); assert.equal(result.costBasisAmount, 1005);
  assert.ok(Math.abs(result.mean - 89 / 1005 * 100) < 1e-10);
  assert.notEqual(archive.trades[0].sourceFingerprint, digest(archive.trades[0].manualDecision));
  const future = structuredClone(archive.trades[0]);
  future.manualDecision.reconciledAt = now + 1000; future.createdAt = new Date(now + 1000).toISOString();
  future.sourceFingerprint = W.digest(future.manualDecision);
  assert.equal(S.tradeExpectation([...archive.trades, future], { asOf: now }).n, 1);
  assert.equal(S.tradeExpectation([...archive.trades, future], { asOf: now + 1000 }).n, 0);
  // Isolated numerical receipt fixture, never written to a production account.
  const paperSettlement = { accountId: 'pool', symbol: '600001', exitEventId: 'isolated-paper-exit', exitOrderId: 'isolated-paper-sell',
    exitTimestamp: cn('2026-08-18T10:00:00'), tradeDate: '2026-08-18', exitQuantity: 100, exitPrice: 9,
    exitGrossCents: 90000, exitFeeCents: 500, costBasisCents: 100500, realizedCents: -11000,
    entryFills: [{ eventId: 'isolated-paper-buy', orderId: 'isolated-paper-entry', quantity: 100, price: 10,
      grossCents: 100000, costCents: 100500, time: cn('2026-08-17T10:00:00') }] };
  const paperRow = { source: 'V6 模拟成交', sourceFingerprint: digest(paperSettlement), paperSettlement, createdAt: new Date(now).toISOString(),
    code: '600001', shares: 100, pnl: -11000 / 100500 * 100, pnlAmount: -110, costBasis: 1005 };
  const mixed = S.tradeExpectation([...archive.trades, paperRow], { asOf: now });
  assert.equal(mixed.n, 2); assert.equal(mixed.aggregationStatus, 'separate-sources');
  assert.equal(mixed.mean, null); assert.equal(mixed.realizedAmount, null); assert.equal(mixed.lossCount, null);
  assert.equal(mixed.groups.find(g => g.source === 'verified-simulation-settlements').lossCount, 1);
  assert.equal(mixed.groups.find(g => g.source === 'reconciled-manual-import').realizedAmount, 89);
});
test('async diagnostic orchestration runs actual native/indicator/ledger paths with bounded options', async () => {
  const input = nativeInputs(history(70, 1));
  const result = await S.runEvolutionDiagnostics({ ...input, asOf: at(100), options: { sensitivity: { scenarios: [{ id: 'baseline' }] } } });
  assert.equal(result.causal.status, 'pass'); assert.equal(result.indicators[0].status, 'pass');
  assert.equal(result.benchmarks.entries[0].metrics.returnPct, 0); assert.equal(result.robustness.variants.length, 1);
  assert.equal(result.inspectedConfigurations, 1); assert.equal(result.canTrade, false);
  assert.equal((await S.runEvolutionDiagnostics({ ...input, asOf: at(30) })).status, 'not-evaluated');
});
test('ordinary report is cheap and independent of invalid or oversized heavy-history inputs', () => {
  const result = S.buildEvolutionStatistics({ archive: { trades: [{ pnl: 100 }] }, history: { malformed: true }, asOf: at(100), options: { rows: rows() } });
  assert.equal(result.competition.commonSamples, 40); assert.equal(result.benchmarks.status, 'not-evaluated');
  assert.equal(result.expectation.settlements.n, 0); assert.equal(result.overfitting.dsr.status, 'not-evaluated');
  assert.equal(result.canTrade, false);
});
test('existing global immutable trial archives include rejected candidates and detect byte changes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-stat-trials-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payload = { schemaVersion: 1, mode: 'v6-factor-shadow-evolution-v1', status: 'shadow-retained', trainingEnd: day(20), lastObservationDay: day(45),
    packFingerprint: digest(require('../strategies/extended-factor-pack.json')), canTrade: false, productionWeightsChanged: false,
    trialAudit: { schemaVersion: 1, status: 'consumed', firstHoldoutDay: day(40), lastHoldoutDay: day(45), holdoutDays: 6, candidateFingerprint: 'a'.repeat(64) } };
  const fingerprint = digest(payload), file = path.join(dir, `shadow-${payload.trainingEnd}-${fingerprint.slice(0, 12)}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...payload, fingerprint }));
  const result = S.readEvolutionTrialInputs({ modelDir: dir, signalDays: Array.from({ length: 60 }, (_, i) => day(i)), asOf: at(80) });
  assert.equal(result.budget.usedTrials, 1); assert.equal(result.trialReports.length, 1);
  const broken = { ...payload, status: 'shadow-updated', fingerprint }; fs.writeFileSync(file, JSON.stringify(broken));
  assert.throws(() => S.readEvolutionTrialInputs({ modelDir: dir, signalDays: Array.from({ length: 60 }, (_, i) => day(i)), asOf: at(80) }), /完整性/);
  assert.equal(S.readEvolutionTrialInputs().status, 'not-evaluated');
});
