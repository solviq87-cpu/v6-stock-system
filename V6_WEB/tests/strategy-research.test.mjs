import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyCatalog, analyzeStrategyPlans, runStrategyResearch} from '../src/strategy-research.mjs';
import {closeAt} from '../src/analysis.mjs';

function dates(count) {
  const result = [];
  for (let day = 0; result.length < count; day++) {
    const date = new Date(Date.UTC(2025, 0, 2 + day));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}
function bar(date, close, open = close) {
  return {date, open, close, high: Math.max(open, close) + .2, low: Math.min(open, close) - .2,
    volume: 1000000, amount: close * 1000000};
}
function stock(count, price, symbol = '600001') {
  return {symbol, name: '研究样本' + symbol, market: 'main', limitPct: 10,
    bars: dates(count).map((date, day) => bar(date, price(day)))};
}
function dataset(stocks) {
  return {source: 'imported', asOf: closeAt(stocks[0].bars.at(-1).date), stocks};
}
function breakout(count = 32) {
  return dataset([stock(count, day => day < 20 ? 10 : day < 24 ? 11 : day === 24 ? 9.7 : 9.8)]);
}
function rsiInput(count = 226, rebound = true) {
  const s = stock(count, day => day <= 219 ? 10 + day * .02 :
    day === 220 ? 14.23 : day === 221 ? 14.08 : day === 222 ? 13.93 :
      rebound ? (day === 223 ? 14.5 : 14.45) : 13.93 - (day - 222) * .01);
  s.bars[222] = bar(s.bars[222].date, s.bars[222].close, 14.08);
  if (rebound) s.bars[223] = bar(s.bars[223].date, 14.5, 14);
  return dataset([s]);
}
function rotation(count = 46) {
  return dataset(Array.from({length: 6}, (_, j) => stock(count,
    day => j < 5 ? 10 + day * (.01 + .002 * j) : 10 + Math.max(0, day - 30) * .2,
    String(600001 + j))));
}
function members(input) {
  return input.stocks.map(s => ({symbol: s.symbol, from: s.bars[0].date, through: s.bars.at(-1).date,
    knownAt: s.bars[0].date + 'T08:00:00+08:00', eligible: true, source: 'test-only'}));
}
const donchian = {strategyId: 'donchian20_atr'};
const rsi = {strategyId: 'rsi2_mean_reversion'};
const momentum = {strategyId: 'momentum20_rotation'};
const approx = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon,
  `${actual} differs from ${expected}`);

test('three complete catalogs distinguish rule sources from unaudited live evidence', () => {
  assert.equal(strategyCatalog.length, 3);
  for (const s of strategyCatalog) {
    assert.ok(s.entryRules.length && s.exitRules.length && s.riskRules.length && s.sources.length);
    assert.equal(s.evidence.liveVerified, false);
    assert.equal(s.evidence.level, 'source_rules_only');
    assert.ok(s.sources.every(source => source.url.startsWith('https://')));
  }
});

test('Donchian excludes the signal high and seeds ATR from exactly twenty true ranges', () => {
  const input = breakout(21), original = structuredClone(input);
  const row = analyzeStrategyPlans(input, donchian).strategies[0].candidates[0];
  assert.equal(row.status, 'candidate');
  approx(row.indicators.priorHigh20, 10.2);
  approx(row.atr, .44);
  approx(row.stopReference, 10.12);
  assert.deepEqual(input, original);
  const result = runStrategyResearch(input, donchian);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.orders.length, 0);
});

test('Donchian lifecycle enters the next open, exits after a close signal, charges all costs', () => {
  const input = breakout(), ds = input.stocks[0].bars;
  const report = runStrategyResearch(input, donchian);
  assert.equal(report.status, 'completed');
  assert.equal(report.trades.length, 1);
  assert.equal(report.trades[0].buyDate, ds[21].date);
  assert.equal(report.trades[0].sellDate, ds[25].date);
  assert.match(report.trades[0].reason, /止损/);
  assert.ok(report.metrics.fees > 0 && report.metrics.returnPct < 0);
  assert.ok(report.trades.every(t => t.buyDate < t.sellDate));
  assert.equal(report.autoTrade, false);
  assert.equal(report.liveVerified, false);
  assert.equal(report.protocol.config.feeBps, 8);
});

test('Donchian ten-day channel exit is distinct from its frozen ATR stop', () => {
  const input = breakout(34), bars = input.stocks[0].bars;
  // Large historical ranges widen ATR while all historical low points remain
  // above the later close. This triggers the channel, without touching stop.
  for (let i = 0; i < 20; i++) bars[i] = {...bars[i], high: 11, low: 9};
  bars[20] = bar(bars[20].date, 12);
  for (let i = 21; i < 31; i++) bars[i] = bar(bars[i].date, 12);
  bars[31] = bar(bars[31].date, 11.5);
  bars[32] = bar(bars[32].date, 11.6);
  bars[33] = bar(bars[33].date, 11.6);
  const report = runStrategyResearch(input, {...donchian, slippageBps: 0, feeBps: 0, sellTaxBps: 0});
  assert.equal(report.trades.length, 1);
  assert.match(report.trades[0].reason, /10日最低价/);
  assert.equal(report.trades[0].sellDate, bars[32].date);
});

test('risk budget, lots, cash and the entry ATR are respected without intraday stop guesses', () => {
  const input = breakout(24), bars = input.stocks[0].bars;
  // Intraday low crosses the stop; close does not. A daily-close strategy must
  // not invent an intraday exit or update its initial risk distance.
  bars[22] = {...bars[22], high: 15, low: 8};
  const report = runStrategyResearch(input, {...donchian, riskPct: .1, feeBps: 0, slippageBps: 0});
  const buy = report.orders.find(o => o.side === 'buy' && o.status === 'filled');
  assert.equal(buy.quantity, 100);
  approx(buy.atr, .44);
  approx(buy.stopReference, 10.12);
  assert.ok(buy.quantity * (buy.price - buy.stopReference) <= 100 + 1e-6);
  assert.equal(report.trades.length, 0);
  assert.equal(report.openPositions.length, 1);
  approx(report.openPositions[0].stopReference, buy.stopReference);
  assert.ok(report.metrics.finalEquity >= 0);
  const poor = runStrategyResearch(input, {...donchian, initialCash: 500});
  assert.equal(poor.orders.filter(o => o.status === 'filled').length, 0);
  assert.ok(poor.orders.some(o => /不足一手/.test(o.reason)));
});

test('gap, two-way slippage, commission and sell tax reconcile to cash', () => {
  const report = runStrategyResearch(breakout(), {...donchian, initialCash: 2000,
    riskPct: 100, maxPositionPct: 100, maxPositions: 1, feeBps: 100, slippageBps: 100, sellTaxBps: 50});
  assert.equal(report.trades[0].quantity, 100);
  approx(report.trades[0].entry, 11.11);
  approx(report.trades[0].exit, 9.702);
  approx(report.metrics.fees, 25.663);
  approx(report.metrics.finalEquity, 1833.537);
  approx(report.trades[0].netPnl, -166.463);
});

test('stopped holdings retry locked and halted exits while unrealized losses remain marked', () => {
  const input = breakout(), bars = input.stocks[0].bars;
  bars[25] = bar(bars[25].date, 9.2, 8.73); // Prior close9.7 gives lower limit8.73.
  bars[26] = {...bar(bars[26].date, 9.1), suspended: true};
  bars[27] = bar(bars[27].date, 9.2);
  const report = runStrategyResearch(input, {...donchian, feeBps: 0, slippageBps: 0, sellTaxBps: 0});
  assert.equal(report.trades[0].sellDate, bars[27].date);
  assert.ok(report.orders.some(o => o.date === bars[25].date && o.side === 'sell' && o.status === 'blocked'));
  assert.ok(report.orders.some(o => o.date === bars[26].date && o.side === 'sell' && o.status === 'blocked'));
  approx(report.equity.find(e => e.date === bars[25].date).value, 100000 - 900 * 11 + 900 * 9.2);
  assert.ok(report.metrics.maxDrawdownPct > 0);
});

test('a close stop on entry day exits no earlier than the next provided open (T+1)', () => {
  const input = breakout(), bars = input.stocks[0].bars;
  bars[21] = bar(bars[21].date, 9.9, 11);
  bars[22] = bar(bars[22].date, 9.8);
  const report = runStrategyResearch(input, donchian);
  assert.equal(report.trades[0].buyDate, bars[21].date);
  assert.equal(report.trades[0].sellDate, bars[22].date);
});

test('Wilder RSI2 matches the recurrence oracle and uses100 for flat/no-loss sequences', () => {
  const s = stock(203, day => day < 200 ? 10 : day === 200 ? 11 : day === 201 ? 10 : 11);
  const row = analyzeStrategyPlans(dataset([s]), rsi).strategies[0].candidates[0];
  approx(row.indicators.rsi2, 100 - 100 / 3.5);
  const flat = analyzeStrategyPlans(dataset([stock(201, () => 10)]), rsi).strategies[0].candidates[0];
  assert.equal(flat.indicators.rsi2, 100);
  assert.equal(flat.status, 'not_matched');
});

test('RSI2 lifecycle uses long-term trend, oversold entry and overbought exit', () => {
  const input = rsiInput(), bars = input.stocks[0].bars;
  const report = runStrategyResearch(input, rsi);
  assert.equal(report.trades.length, 1);
  assert.equal(report.trades[0].buyDate, bars[222].date);
  assert.equal(report.trades[0].sellDate, bars[224].date);
  assert.match(report.trades[0].reason, /RSI2高于70/);
  const downtrend = dataset([stock(220, day => 30 - day * .05)]);
  assert.equal(runStrategyResearch(downtrend, rsi).orders.filter(o => o.status === 'filled').length, 0);
});

test('RSI2 time exit is a local five-session risk adaptation', () => {
  const input = rsiInput(228, false), bars = input.stocks[0].bars;
  const report = runStrategyResearch(input, rsi);
  assert.equal(report.trades[0].buyDate, bars[222].date);
  assert.equal(report.trades[0].sellDate, bars[227].date);
  assert.match(report.trades[0].reason, /5个提供交易日/);
});

test('point-in-time signal and entry-open membership are both required', () => {
  const input = breakout(), bars = input.stocks[0].bars;
  const [all] = members(input);
  input.universeHistory = [{...all, through: bars[20].date},
    {...all, from: bars[21].date, knownAt: bars[21].date + 'T09:31:00+08:00'}];
  const report = runStrategyResearch(input, donchian);
  assert.ok(report.orders.some(o => o.date === bars[21].date && /开盘时不具备/.test(o.reason)));
  assert.equal(report.orders.filter(o => o.status === 'filled').length, 0);
  input.universeHistory = [{...all, eligible: false}];
  assert.equal(analyzeStrategyPlans(input, donchian).strategies[0].candidates[0].status, 'risk_blocked');
});

test('unobservable signal history, unsupported boards and opening price locks block entry', () => {
  const delayed = breakout();
  delayed.stocks[0].bars[20].publishedAt = delayed.stocks[0].bars[21].date + 'T09:00:00+08:00';
  assert.equal(runStrategyResearch(delayed, donchian).orders.filter(o => o.status === 'filled').length, 0);
  const unknown = breakout(); delete unknown.stocks[0].market; delete unknown.stocks[0].limitPct;
  assert.equal(runStrategyResearch(unknown, donchian).orders.filter(o => o.status === 'filled').length, 0);
  const locked = breakout(); locked.stocks[0].bars[21] = bar(locked.stocks[0].bars[21].date, 11.8, 12.1);
  const report = runStrategyResearch(locked, donchian);
  assert.ok(report.orders.some(o => o.status === 'blocked' && /涨跌停/.test(o.reason)));
  const future = breakout(); future.stocks[0].feed = {timestamp: future.asOf + 1};
  assert.equal(runStrategyResearch(future, donchian).orders.filter(o => o.status === 'filled').length, 0);
});

test('incomplete or not-yet-closed tails do not affect prices, orders or strategy plans', () => {
  const input = breakout(22), bars = input.stocks[0].bars;
  bars.at(-1).complete = false;
  const incomplete = runStrategyResearch(input, donchian);
  assert.equal(incomplete.evaluatedThrough, bars[20].date);
  assert.equal(incomplete.orders.length, 0);
  const plan = analyzeStrategyPlans(input, donchian).strategies[0].candidates[0];
  assert.equal(plan.date, bars[20].date);
  delete bars.at(-1).complete;
  input.asOf = Date.parse(bars[21].date + 'T09:00:00+08:00');
  assert.deepEqual(runStrategyResearch(input, donchian).equity, incomplete.equity);
});

test('later price and observation changes cannot rewrite earlier equity or fills', () => {
  const input = breakout(40), before = runStrategyResearch(input, donchian), cutoff = input.stocks[0].bars[28].date;
  const changed = structuredClone(input);
  for (let i = 30; i < 40; i++) changed.stocks[0].bars[i] = bar(changed.stocks[0].bars[i].date, 40 + i);
  const after = runStrategyResearch(changed, donchian);
  assert.deepEqual(after.equity.filter(e => e.date <= cutoff), before.equity.filter(e => e.date <= cutoff));
  assert.deepEqual(after.orders.filter(e => e.date <= cutoff), before.orders.filter(e => e.date <= cutoff));
  assert.deepEqual(after.trades.filter(e => e.sellDate <= cutoff), before.trades.filter(e => e.sellDate <= cutoff));
});

test('TopK rotation maintains held state, drops at most one and does not equal-weight daily', () => {
  const input = rotation(), bars = input.stocks[0].bars;
  const report = runStrategyResearch(input, momentum);
  const first = report.orders.filter(o => o.side === 'buy' && o.status === 'filled' && o.date === bars[21].date);
  assert.equal(first.length, 5);
  assert.equal(report.trades[0].symbol, '600001');
  assert.equal(report.trades[0].sellDate, bars[36].date);
  assert.match(report.trades[0].reason, /轮动复核/);
  assert.ok(report.orders.some(o => o.symbol === '600006' && o.side === 'buy' && o.status === 'filled' && o.date === bars[36].date));
  for (const symbol of ['600002', '600003', '600004', '600005'])
    assert.equal(report.orders.filter(o => o.symbol === symbol && o.side === 'buy' && o.status === 'filled').length, 1);
  const reversed = {...input, stocks: [...input.stocks].reverse()};
  assert.deepEqual(runStrategyResearch(reversed, momentum), report);
});

test('blocked rotation sell does not manufacture cash or a vacant slot', () => {
  const input = rotation(), a = input.stocks[0], date = a.bars[36].date;
  a.bars[36] = bar(date, 10.3, 9.32);
  a.bars[37] = bar(a.bars[37].date, 10.3);
  const report = runStrategyResearch(input, momentum);
  assert.ok(report.orders.some(o => o.date === date && o.symbol === a.symbol && o.side === 'sell' && o.status === 'blocked'));
  assert.ok(report.orders.some(o => o.date === date && o.symbol === '600006' && o.side === 'buy' && o.status === 'blocked'));
  assert.ok(!report.orders.some(o => o.date === date && o.symbol === '600006' && o.side === 'buy' && o.status === 'filled'));
  assert.equal(report.trades[0].sellDate, a.bars[37].date);
  assert.ok(report.openPositions.length <= 5);
});

test('rotation preserves actual negative held ranks and skips a review with unavailable held ranks', () => {
  const input = rotation();
  for (const [j, finish] of [[0, 9.8], [1, 10]]) {
    const bars = input.stocks[j].bars, start = bars[30].close;
    for (let day = 31; day <= 35; day++) bars[day] = bar(bars[day].date, start + (finish - start) * (day - 30) / 5);
    bars[36] = bar(bars[36].date, finish);
  }
  const report = runStrategyResearch(input, momentum);
  assert.equal(report.trades.find(t => /轮动复核/.test(t.reason)).symbol, '600001');
  const delayed = rotation(), review = delayed.stocks[0].bars[35].date;
  delayed.stocks[0].bars[35].publishedAt = delayed.stocks[0].bars[36].date + 'T16:00:00+08:00';
  const held = runStrategyResearch(delayed, momentum);
  assert.ok(!held.orders.some(o => o.date === delayed.stocks[0].bars[36].date && o.status === 'filled'));
  assert.ok(held.warnings.some(w => /轮动复核缺少/.test(w)));
  assert.equal(held.equity.filter(e => e.date < review).length, 35);
});

test('no positive momentum never creates rotation buys', () => {
  const input = dataset([stock(50, () => 10), stock(50, day => 15 - day * .02, '600002')]);
  const report = runStrategyResearch(input, momentum);
  assert.equal(report.orders.length, 0);
  assert.equal(report.openPositions.length, 0);
});

test('mixed calendars, unsupported wealth adjustments and invalid configuration fail clearly', () => {
  const mixed = rotation(); mixed.stocks[1].bars.splice(10, 1);
  assert.throws(() => runStrategyResearch(mixed, momentum), /日历/);
  const action = breakout(); action.stocks[0].bars[22].corporateAction = {shareMultiplier: 2};
  assert.throws(() => runStrategyResearch(action, donchian), /公司行动/);
  assert.throws(() => analyzeStrategyPlans({...breakout(), settlements: [{cash: 1}]}), /公司行动/);
  for (const options of [{...donchian, riskPct: 0}, {...donchian, feeBps: -1},
    {...donchian, maxPositions: 1.5}, {...donchian, initialCash: Infinity}, {strategyId: 'unknown'}])
    assert.throws(() => runStrategyResearch(breakout(), options));
});

test('positive execution-day volume does not change the opening decision; zero rejects the realized fill', () => {
  const input = breakout(), original = runStrategyResearch(input, donchian);
  input.stocks[0].bars[21].volume *= 2;
  const positive = runStrategyResearch(input, donchian);
  assert.deepEqual(positive.orders, original.orders);
  assert.deepEqual(positive.metrics, original.metrics);
  input.stocks[0].bars[21].volume = 0;
  const zero = runStrategyResearch(input, donchian);
  assert.ok(zero.orders.some(o => o.date === input.stocks[0].bars[21].date && o.status === 'blocked' && /零成交量/.test(o.reason)));
  assert.ok(!zero.orders.some(o => o.side === 'buy' && o.status === 'filled'));
  assert.ok(zero.assumptions.some(a => /事后不可成交排除/.test(a)));
});

test('static stock status is disclosed, and explicit dated false status overrides a global true', () => {
  const input = breakout(), original = runStrategyResearch(input, donchian);
  input.stocks[0].isST = true;
  const excluded = runStrategyResearch(input, donchian);
  assert.equal(excluded.orders.filter(o => o.status === 'filled').length, 0);
  assert.ok(excluded.warnings.some(w => /全历史静态声明/.test(w)));
  for (const b of input.stocks[0].bars) b.isST = false;
  const dated = runStrategyResearch(input, donchian);
  assert.deepEqual(dated.orders, original.orders);
  assert.deepEqual(dated.metrics, original.metrics);
});
