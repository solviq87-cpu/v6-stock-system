'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {modelExperiment} = require('../src/strategy/model-experiment');
const {validateModelFilters, evaluateModelFilters} = require('../src/strategy/model-selection-conditions');
const {ledgerBacktest} = require('../src/strategy/research-v2-position-ledger-backtest');

function fixture() {
  const dates = [];
  for (let i = 0; dates.length < 102; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i));
    if (date.getUTCDay() % 6 !== 0) dates.push(date.toISOString().slice(0, 10));
  }
  const stocks = Array.from({length: 5}, (_, j) => ({
    symbol: String(600000 + j), market: 'main',
    bars: dates.map((date, day) => {
      const open = 10 + j + day * .01 + .2 * Math.sin(day / (3 + j));
      const close = open + .05 * Math.cos(day + j);
      return {date, open, close, low: Math.min(open, close) - .01,
        high: Math.max(open, close) + .01, volume: 100000 + day * 5, amount: 10000000};
    }),
  }));
  const universeHistory = stocks.map(stock => ({symbol: stock.symbol, from: dates[0],
    through: dates.at(-1), knownAt: '2024-12-01T00:00:00Z', eligible: true, source: 'test-only'}));
  return {stocks, splitDay: 88, source: 'simulated', models: ['ridge'], universeHistory};
}

test('未来才入池的股票不影响历史模型；缺失历史资格不输出最新候选', () => {
  const cfg = fixture();
  cfg.universeHistory.pop();
  const before = modelExperiment(cfg);
  // Prices of a non-member are valid but radically different. They must not
  // change the fitted weights used for any eligible stock.
  cfg.stocks.at(-1).bars = cfg.stocks.at(-1).bars.map((bar, i) => {
    const price = 100 + i * 3;
    return {...bar, open: price, close: price, high: price + 1, low: price - 1};
  });
  cfg.universeHistory.push({symbol: cfg.stocks.at(-1).symbol, from: '2026-01-01',
    through: '2026-12-31', knownAt: '2026-01-01T00:00:00Z', eligible: true, source: 'future'});
  const after = modelExperiment(cfg);
  assert.deepEqual(after.latest, before.latest);
  assert.deepEqual(after.summaries, before.summaries);
  assert.equal(after.trainingRows, 104);
  assert.equal(after.latest.length, 4);
  assert.equal(after.sampleAudit.training.rejected.NO_POINT_IN_TIME_MEMBERSHIP, 26);
  assert.equal(after.protocol.universeMode, 'provided-unverified');
});

test('训练标签的开盘资格必须在开盘已知，不能借用当天稍晚披露', () => {
  const cfg = fixture(), dates = cfg.stocks[0].bars.map(bar => bar.date);
  const first = cfg.universeHistory.shift();
  cfg.universeHistory.push({...first, through: dates[60]},
    {...first, from: dates[61], knownAt: dates[61] + 'T10:00:00+08:00'});
  const result = modelExperiment(cfg);
  assert.equal(result.trainingRows, 129);
  assert.equal(result.sampleAudit.training.rejected.NO_ENTRY_POINT_IN_TIME_MEMBERSHIP, 1);
  assert.equal(result.latest.length, 5);
  assert.ok(result.lastTrainingLabelDate < result.firstEvaluationDate);
});

test('研究条件使用信号当时的成交额，缺失值拒绝而不是补量估价', () => {
  const cfg = fixture();
  cfg.stocks[0].bars.forEach(bar => { bar.amount = 100; });
  cfg.stocks[1].bars.forEach(bar => { delete bar.amount; });
  const result = modelExperiment({...cfg, modelFilters: {minAverageTurnover20: 5000000}});
  assert.deepEqual(result.latest.map(row => row.symbol), ['600002', '600003', '600004']);
  assert.equal(result.trainingRows, 78);
  assert.equal(result.sampleAudit.training.rejected.TURNOVER20_TOO_LOW, 26);
  assert.equal(result.sampleAudit.training.rejected.TURNOVER20_UNKNOWN, 26);
  const prior = modelExperiment({...cfg, minPriorTurnover: 5000000});
  assert.deepEqual(prior.latest, result.latest);
  assert.equal(prior.sampleAudit.training.rejected.PRIOR_TURNOVER_TOO_LOW_OR_UNKNOWN, 52);
});

test('原V6对照也应用相同筛选条件；报告保存有效费用和风险配置', () => {
  const cfg = fixture();
  for (const stock of cfg.stocks) for (const bar of stock.bars) {
    bar.factors = {trendScore: 80, relativeStrengthScore: 80, maAlignmentScore: 80,
      momentumScore: 80, closeStrengthScore: 80, turnoverQualityScore: 80,
      breakoutScore: 80, volumeScore: 80, positionScore: 80, fundFlowScore: 80,
      liquidityScore: 80, oversoldScore: 80, reversalScore: 80, riskScore: 10};
    bar.amount = stock.symbol === '600000' ? 100 : 10000000;
  }
  const modelFilters = {minAverageTurnover20: 5000000};
  const options = {...cfg, modelFilters, topN: 1, feeBps: 0, maxParticipationPct: 1};
  // Participation requires explicit volume units, the same for every model.
  for (const stock of cfg.stocks) stock.volumeUnit = 'shares';
  const actual = modelExperiment(options);
  const expected = ledgerBacktest({...options, stocks: cfg.stocks.slice(1),
    start: cfg.splitDay, end: cfg.stocks[0].bars.length - 1});
  assert.ok(expected.metrics.closedTrades > 0);
  assert.deepEqual(actual.summaries.v6Original, expected.metrics);
  assert.equal(actual.protocol.backtest.feeBps, 0);
  assert.equal(actual.protocol.backtest.slippageBps, 10);
  assert.equal(actual.protocol.backtest.maxParticipationPct, 1);
  assert.equal(actual.protocol.backtest.topN, 1);
  const expensive = modelExperiment({...options, feeBps: 100});
  assert.notDeepEqual(expensive.protocol, actual.protocol);
  assert.equal(expensive.protocol.datasetSha256, actual.protocol.datasetSha256);
  assert.notEqual(expensive.summaries.ridge.returnPct, actual.summaries.ridge.returnPct);
});

test('波动率、量比和成交额边界可配置；未来成交额不影响过去条件', () => {
  const cfg = fixture(), bars = cfg.stocks[0].bars;
  const features = {volatility20: .02, volumeRatio20: 1.5};
  const filters = {minAverageTurnover20: 10000000, maxVolatility20: .02,
    minVolumeRatio20: 1.5, maxVolumeRatio20: 1.5};
  assert.equal(evaluateModelFilters(bars, 70, features, filters).pass, true);
  bars[71].amount = 0;
  assert.equal(evaluateModelFilters(bars, 70, features, filters).pass, true);
  assert.deepEqual(evaluateModelFilters(bars, 70, {volatility20: .03, volumeRatio20: 2}, filters).reasons,
    ['VOLATILITY20_TOO_HIGH', 'VOLUME_RATIO20_TOO_HIGH']);
  assert.deepEqual(evaluateModelFilters(bars, 70, {volatility20: .03, volumeRatio20: 1}, filters).reasons,
    ['VOLATILITY20_TOO_HIGH', 'VOLUME_RATIO20_TOO_LOW']);
});

test('筛选协议和模型名拒绝拼写错误、非法阈值和重复项', () => {
  for (const filters of [null, [], {minAverageTurnover20: NaN}, {maxVolatility20: -.1},
    {minimumTurnover: 1}, {minVolumeRatio20: 2, maxVolumeRatio20: 1}]) {
    assert.throws(() => validateModelFilters(filters));
  }
  for (const models of [null, [], 'ridge', ['ridge', 'ridge'], ['unknown']]) {
    assert.throws(() => modelExperiment({...fixture(), models}), /模型/);
  }
  const cfg = fixture();
  cfg.universeHistory.push({...cfg.universeHistory[0]});
  assert.throws(() => modelExperiment(cfg), /重叠/);
});

test('五类模型通过同一研究入口、筛选条件和成本账本完成比较', t => {
  const available = spawnSync(process.env.V6_MODEL_PYTHON || 'python3', ['-c',
    'import importlib.util; print(all(importlib.util.find_spec(name) is not None for name in ["lightgbm", "xgboost"]))'],
  {encoding: 'utf8', timeout: 10000});
  assert.equal(available.status, 0, available.error?.message || available.stderr);
  if (available.stdout.trim() === 'False') return t.skip('需要 requirements-models-optional.txt');
  const models = ['ridge', 'extraTrees', 'histBoost', 'lightgbm', 'xgboost'];
  const cfg = {...fixture(), models, modelFilters: {minAverageTurnover20: 5000000,
    maxVolatility20: .04, minVolumeRatio20: .5, maxVolumeRatio20: 3}};
  const result = modelExperiment(cfg);
  assert.deepEqual(result.protocol.models, models);
  assert.deepEqual(result.protocol.modelFilters, cfg.modelFilters);
  assert.match(result.protocol.datasetSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.modelVersions.lightgbm, '4.6.0');
  assert.equal(result.modelVersions.xgboost, '3.1.3');
  for (const name of [...models, 'v6Original', 'momentum', 'lowVol']) {
    assert.ok(Number.isFinite(result.summaries[name].returnPct));
  }
  for (const name of models) assert.ok(Number.isFinite(result.latest[0].scores[name]));
  assert.equal(result.verifiedLive, false);
  assert.equal(result.autoTrade, false);
});
