'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../analysis');
function fixture() {
  const rows = Array.from({length: 60}, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    open: 10, close: 10, high: 10.2, low: 9.8, volume: 10000, amount: 100000,
    turnover: 4, pct: i % 3 === 0 ? 6 : 1
  }));
  return [{code: '600000', name: 'fixture', rows}];
}

test('real sync and async backtest entry points expose event frequencies rather than calibrated probabilities', async () => {
  const universe = fixture();
  const result = A.backtest(universe, 10);
  assert.deepEqual(await A.backtestAsync(universe, 10), result);
  assert.equal(result.kind, 'historical-event-frequency');
  assert.equal(result.target, 'next-observed-bar-close-limit-up-or-close-gain-5pct');
  assert.equal(result.calibrationCertified, false);
  assert.equal(result.executionSimulated, false);
  assert.equal(result.historicalUniverseVerified, false);
  assert.equal(result.observedUniverseSize, 1);
  assert.equal(result.总样本, 9);
  assert.equal(result.交易日数, 9);
  assert.match(result.labelDefinition, /收盘/);
});

test('historical scores expose unavailable funds and cross-sectional ranks instead of fabricated 5 or 5500', () => {
  const result = A.backtest(fixture(), 10);
  for (const row of result.明细样本) {
    assert.ok(row.scoreBasis.missing.includes('主力净占比'));
    assert.ok(row.scoreBasis.missing.includes('换手排名'));
  }
  const d = fixture()[0].rows;
  const unknown = A.scoreStock({rows: d, mainPct: null, turnoverRank2d: null, total: null});
  const zero = A.scoreStock({rows: d, mainPct: 0, turnoverRank2d: null, total: null});
  assert.ok(unknown.basis.missing.includes('主力净占比'));
  assert.ok(!zero.basis.missing.includes('主力净占比'));
  assert.equal(unknown.detail['主力净占比'], '未知');
  assert.equal(zero.detail['主力净占比'], '0.0%');
  assert.equal(unknown.score, zero.score);
});

test('a current stock-level funds field cannot affect past event frequency scores', () => {
  const universe = fixture(), first = A.backtest(universe, 10);
  universe[0].mainPct = 100;
  assert.deepEqual(A.backtest(universe, 10), first);
  universe[0].rows.forEach(row => { row.mainPct = 100; row.fundsKnownAt = Date.parse('2030-01-01'); });
  assert.deepEqual(A.backtest(universe, 10), first);
});

test('unknown next-day close outcomes are not counted as failed events', () => {
  const universe = fixture();
  universe[0].rows.at(-1).pct = null;
  const result = A.backtest(universe, 10);
  assert.equal(result.总样本, 8);
  assert.equal(result.unknownOutcomeCount, 1);
  for (const bucket of Object.values(result.分数段命中率)) {
    assert.equal(bucket.frequencyPct === null, bucket.样本数 === 0);
    if (bucket.样本数) assert.equal(bucket.frequencyPct, +(bucket.事件数 / bucket.样本数 * 100).toFixed(1));
  }
});

test('observed trading dates are not multiplied by the number of stocks', () => {
  const universe = fixture();
  universe.push({...universe[0], code: '000001'});
  const result = A.backtest(universe, 10);
  assert.equal(result.总样本, 18);
  assert.equal(result.交易日数, 9);
});

test('the actual backtest screen renders the event definition and never claims 80 percent calibration', async () => {
  const source = fs.readFileSync(require.resolve('../public/assets/app.js'), 'utf8');
  const start = source.indexOf('async function runBacktest() {');
  const end = source.indexOf('function regimeLabel(', start);
  const elements = {btState: {textContent: ''}, btResult: {innerHTML: ''}};
  const result = A.backtest(fixture(), 10);
  let poll, cleared = false;
  const ctx = vm.createContext({document: {getElementById: id => elements[id]},
    fetch: async () => ({json: async () => result}),
    setInterval: fn => {poll = fn; return 1;}, clearInterval: () => {cleared = true;}});
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.runBacktest();
  await poll();
  assert.equal(cleared, true);
  assert.match(elements.btResult.innerHTML, /历史频率|历史事件频率/);
  assert.match(elements.btResult.innerHTML, /不是当日封板校准概率/);
  assert.doesNotMatch(elements.btResult.innerHTML, /80%|概率模型以该命中率校准/);
});

test('the initial statistics explanation and actual relay cards do not claim calibrated probabilities', () => {
  const source = fs.readFileSync(require.resolve('../public/assets/app.js'), 'utf8');
  const elements = {btResult: {innerHTML: ''}, yierList: {innerHTML: ''}, lianbanList: {innerHTML: ''},
    yeTime: {}, lbTime: {}, yeInfo: {}, lbInfo: {}};
  const ctx = vm.createContext({document: {getElementById: id => elements[id]},
    s: {yierList: [{code: '600000', name: 'fixture', fused: 45, prob: 60, probKind: 'ranking-score',
      eventTarget: 'ztNext', sealRatio: 1, turnover: 5, price: 10, why: 'fixture'}]}});
  const explanationStart = source.indexOf("const _btR = document.getElementById('btResult');");
  const explanationEnd = source.indexOf('} catch (e) {}', explanationStart);
  vm.runInContext(source.slice(explanationStart, explanationEnd), ctx);
  assert.match(elements.btResult.innerHTML, /历史频率|收盘事件频率/);
  assert.doesNotMatch(elements.btResult.innerHTML, /80%|就是概率模型的校准依据/);
  const relayStart = source.indexOf('const _roleTag = r =>');
  const relayEnd = source.indexOf('    // ══ 次日作战计划', relayStart);
  vm.runInContext('{\n' + source.slice(relayStart, relayEnd), ctx);
  assert.match(elements.yierList.innerHTML, /45\/100/);
  assert.match(elements.yierList.innerHTML, /次日封板研究排序值，未独立校准/);
  assert.doesNotMatch(elements.yeInfo.innerHTML, /实测校准|融合概率/);
});
