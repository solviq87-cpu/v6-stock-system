import {prepareResearchDataset, closeAt, openAt, knownAt, barOK} from './analysis.mjs';
import universeModule from './vendor/historical-universe.js';
import sessionModule from './vendor/historical-session.js';

const {universeObservation} = universeModule;
const {atLockedLimit, limitPct} = sessionModule;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => finite(value) ? Number(value.toFixed(6)) : null;
const mode = 'research-only';
const commonRisk = ['ATR20采用前20个真实波幅均值初始化，再按Wilder递推；入场冻结2ATR距离。',
  '按风险预算、单票仓位和现金三者较小值计算整百股；不加仓、不做空。',
  '止损在收盘确认后下个提供交易日开盘模拟，跳空、费用与受阻退出可使损失超过预算。'];
const commonLimits = ['仅有规则来源，未核验实盘业绩；默认参数不是最佳参数或收益承诺。',
  '以提供日期作为未认证交易日历；不含盘口排队、最低佣金和真实成交保证。'];
const turtleSources = [
  {title: 'Backtrader Donchian：通道排除当前日', url: 'https://www.backtrader.com/recipes/indicators/donchian/donchian/'},
  {title: 'Backtide Turtle Trading规则说明', url: 'https://tvdboom.github.io/backtide/v0.1/api/models/strategies/turtletrading/'}];
const rsiSources = [{title: 'TradingMarkets：RSI2进出场规则',
  url: 'https://tradingmarkets.com/recent/how_to_enter_and_exit_a_position_on_the_close-677551'},
  {title: 'QuantConnect Lean：Wilder RSI定义',
    url: 'https://github.com/QuantConnect/Lean/blob/master/Indicators/RelativeStrengthIndex.cs'}];
const rotationSources = [{title: 'Qlib TopkDropoutStrategy：持仓与新候选联合排序',
  url: 'https://github.com/microsoft/qlib/blob/main/qlib/contrib/strategy/signal_strategy.py'}];
function catalogEntry(entry, sources) {
  return {...entry, version: '20261108-research1', sources,
    riskRules: [...commonRisk], limitations: [...commonLimits, ...(entry.limitations || [])],
    evidence: {level: 'source_rules_only', liveVerified: false,
      evidenceNote: '来源支持规则定义，不证明本实现或A股适配存在经审计实盘收益。', sources}};
}
export const strategyCatalog = [
  catalogEntry({id: 'donchian20_atr', label: 'Donchian 20/10 趋势突破', style: '趋势跟随', minBars: 21,
    thesis: '跟随收盘突破此前20日最高价的趋势，以10日低点和冻结ATR止损控制退出。',
    entryRules: ['收盘价严格高于此前20日最高价；当日不计入通道。', '收盘产生观察信号，最早下一提供交易日开盘模拟入场。'],
    exitRules: ['收盘跌破此前10日最低价，或收盘不高于入场冻结止损；下一开盘模拟退出。'],
    limitations: ['A股只做多、收盘确认、下一开盘和不加仓均为本地适配，并非完整复刻海龟系统。']}, turtleSources),
  catalogEntry({id: 'rsi2_mean_reversion', label: 'RSI2 顺势短线回归', style: '均值回归', minBars: 200,
    thesis: '在收盘位于200日均线之上的长期趋势中，研究短期超卖后的恢复。',
    entryRules: ['收盘价>SMA200且Wilder RSI2<5；RSI无平均损失时记100。', '次日开盘模拟入场，区别于来源中的收盘执行。'],
    exitRules: ['收盘RSI2>70、触及冻结2ATR止损，或已持有5个提供交易日，下一开盘模拟退出。'],
    limitations: ['5日持有上限、ATR20止损、风险预算和次日开盘都是本地研究适配。']}, rsiSources),
  catalogEntry({id: 'momentum20_rotation', label: '20日动量 TopK 轮动', style: '持仓轮动', minBars: 21,
    thesis: '用正20日动量进行持仓与新候选联合排序，限制换手并保留真实持仓状态。',
    entryRules: ['仅选择当时合格且20日动量>0的股票；分数降序、代码升序确定并列顺序。',
      '每5个提供交易日复核一次，目标K=5；持仓与前列新候选联合排序。'],
    exitRules: ['每次复核最多淘汰1只已持有至少5个交易日且落出联合前K的持仓。',
      '冻结ATR止损独立于轮动周期，收盘确认后下一开盘退出；退出受阻继续持仓。'],
    limitations: ['20日动量分数、正动量门槛、5日复核、持有期和ATR止损是本地适配；不是Qlib训练模型或其公布业绩。']}, rotationSources),
];

const defaults = {initialCash: 100000, feeBps: 8, slippageBps: 10, sellTaxBps: 5,
  riskPct: 1, maxPositionPct: 10, maxPositions: 5};
const unsupportedKeys = ['corporateAction', 'corporateActions', 'settlements', 'split', 'splits', 'splitFactor', 'shareMultiplier', 'dividend'];
function rejectCorporateActions(input, stocks) {
  const present = row => unsupportedKeys.some(key => row?.[key] != null &&
    !(Array.isArray(row[key]) && row[key].length === 0));
  if (present(input) || stocks.some(stock => present(stock) || stock.bars.some(present)))
    throw Error('策略研究暂不支持公司行动、拆并股或权益结算；请提供无此类事件的可核验区间');
}
function prepare(input) {
  const data = prepareResearchDataset(input);
  rejectCorporateActions(input, data.stocks);
  return {...data, stocks: [...data.stocks].sort((a, b) => a.symbol.localeCompare(b.symbol))};
}
function strategyById(id) {
  const strategy = strategyCatalog.find(item => item.id === id);
  if (!strategy) throw Error('不支持的研究策略');
  return strategy;
}

function timestampCeiling(row) {
  let ceiling = 0;
  for (const key of ['timestamp', 'observedAt', 'publishedAt']) if (row?.[key] !== undefined) {
    const stamp = typeof row[key] === 'string' ? Date.parse(row[key]) : row[key];
    if (!finite(stamp) || stamp <= 0) return Infinity;
    ceiling = Math.max(ceiling, stamp);
  }
  return ceiling;
}

// State is derived once, in chronological order. Neither channel includes its
// signal bar; Wilder recurrences never read a later observation.
function seriesFor(stock, end) {
  const bars = stock.bars.slice(0, end + 1), values = [];
  let trSum = 0, atr = null, gain = 0, loss = 0, sum200 = 0;
  let numeric = true, complete = true, observedThrough = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    numeric = numeric && barOK(bar);
    complete = complete && bar.complete !== false;
    observedThrough = Math.max(observedThrough, timestampCeiling(bar));
    sum200 += bar.close;
    if (i >= 200) sum200 -= bars[i - 200].close;
    if (i > 0 && numeric) {
      const previous = bars[i - 1].close, delta = bar.close - previous;
      const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous));
      if (i <= 20) trSum += tr;
      if (i === 20) atr = trSum / 20;
      else if (i > 20) atr = (19 * atr + tr) / 20;
      if (i <= 2) { gain += Math.max(delta, 0) / 2; loss += Math.max(-delta, 0) / 2; }
      else { gain = (gain + Math.max(delta, 0)) / 2; loss = (loss + Math.max(-delta, 0)) / 2; }
    }
    values.push({numeric, complete, observedThrough, close: bar.close,
      atr20: numeric ? atr : null,
      rsi2: numeric && i >= 2 ? (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)) : null,
      sma200: numeric && i >= 199 ? sum200 / 200 : null,
      priorHigh20: numeric && i >= 20 ? Math.max(...bars.slice(i - 20, i).map(b => b.high)) : null,
      priorLow10: numeric && i >= 10 ? Math.min(...bars.slice(i - 10, i).map(b => b.low)) : null,
      momentum20: numeric && i >= 20 ? bar.close / bars[i - 20].close - 1 : null});
  }
  return {stock, bars, values};
}
function stateAt(stock, bar) {
  return {isST: bar.isST ?? stock.isST, suspended: bar.suspended ?? stock.suspended,
    tradable: bar.tradable ?? stock.tradable, isDelisting: bar.isDelisting ?? stock.isDelisting,
    limitPct: bar.limitPct ?? stock.limitPct,
    noPriceLimit: bar.noPriceLimit ?? stock.noPriceLimit, ipoNoLimit: bar.ipoNoLimit ?? stock.ipoNoLimit};
}
function riskReason(stock, bar, {sell = false} = {}) {
  const state = stateAt(stock, bar);
  if (['isST', 'suspended', 'tradable', 'isDelisting'].some(key => state[key] !== undefined && typeof state[key] !== 'boolean'))
    return '交易状态字段无效';
  if (!sell && (state.isST || state.isDelisting)) return 'ST或退市风险，禁止新增研究仓位';
  if (state.suspended || state.tradable === false || bar.volume === 0) return '停牌、零成交量或明确不可交易';
  if (state.noPriceLimit || state.ipoNoLimit || limitPct({...stock, ...state}) === null)
    return '涨跌停制度未知或当前制度不受支持';
  return null;
}
function signalObservation(data, series, day, strategy) {
  const {stock, bars, values} = series, bar = bars[day], ind = values[day];
  const base = {symbol: stock.symbol, name: stock.name, date: bar?.date || null,
    referencePrice: finite(bar?.close) ? bar.close : null,
    stopReference: ind?.atr20 > 0 ? round(bar.close - 2 * ind.atr20) : null,
    atr: ind?.atr20 ?? null, indicators: ind ? {priorHigh20: ind.priorHigh20, priorLow10: ind.priorLow10,
      sma200: ind.sma200, rsi2: ind.rsi2, momentum20: ind.momentum20} : {}};
  if (!bar || day + 1 < strategy.minBars || !ind.numeric || !ind.complete || !finite(ind.atr20))
    return {...base, status: 'insufficient_data', reasons: ['缺少完整且有效的策略预热历史']};
  const risks = [];
  if (!knownAt(stock.feed, data.asOf) || ind.observedThrough > closeAt(bar.date)) risks.push('来源或历史观测在信号收盘时不可用');
  const risk = riskReason(stock, bar); if (risk) risks.push(risk);
  if (!universeObservation(data.universeHistory, stock.symbol, bar.date).eligible) risks.push('信号收盘时不具备历史股票池资格');
  if (!(ind.atr20 > 0) || !(base.stopReference > 0)) risks.push('ATR风险距离为零或参考止损非正值');
  if (risks.length) return {...base, status: 'risk_blocked', reasons: risks};
  let matched = false, reasons = [];
  if (strategy.id === 'donchian20_atr') {
    matched = bar.close > ind.priorHigh20;
    reasons = [matched ? '收盘突破此前20日最高价，下一开盘仍需复核' : '收盘尚未突破此前20日最高价'];
  } else if (strategy.id === 'rsi2_mean_reversion') {
    matched = bar.close > ind.sma200 && ind.rsi2 < 5;
    if (!(bar.close > ind.sma200)) reasons.push('收盘未在SMA200之上');
    if (!(ind.rsi2 < 5)) reasons.push('Wilder RSI2尚未低于5');
    if (matched) reasons.push('长期均线向上区间出现短期超卖；下一开盘复核');
  } else {
    matched = ind.momentum20 > 0;
    reasons = [matched ? '20日动量为正，候选资格不等于已进入组合前K' : '20日动量非正，不新增研究仓位'];
  }
  return {...base, status: matched ? 'candidate' : 'not_matched', reasons};
}
function reportWarnings(data) {
  const warnings = ['所有策略只有规则来源，实盘证据未经核验；本页只产生研究观察及模拟结果。'];
  if (!data.universeHistory) warnings.push('未提供历史股票池，沿用输入样本范围，存在幸存者偏差风险。');
  if (data.stocks.some(stock => stock.feed?.timestamp === undefined)) warnings.push('部分来源未提供观测时间，按未认证历史导入数据处理。');
  if (data.stocks.some(stock => ['isST', 'suspended', 'tradable', 'isDelisting'].some(key => stock[key] !== undefined)))
    warnings.push('股票级交易状态按用户的全历史静态声明使用；动态状态必须由逐日日线覆盖，这不是已核验的点时状态。');
  return warnings;
}
function visibleEnd(stock, asOf) {
  let day = stock.bars.length - 1;
  while (day >= 0 && (closeAt(stock.bars[day].date) > asOf || stock.bars[day].complete === false)) day--;
  return day;
}
export function analyzeStrategyPlans(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('策略观察配置无效');
  const data = prepare(input);
  const selected = options.strategyId === undefined ? strategyCatalog : [strategyById(options.strategyId)];
  const prepared = data.stocks.map(stock => seriesFor(stock, visibleEnd(stock, data.asOf)));
  return {asOf: data.asOf, mode, autoTrade: false, liveVerified: false,
    strategies: selected.map(strategy => ({...strategy,
      candidates: prepared.map(series => signalObservation(data, series, series.bars.length - 1, strategy))})),
    warnings: reportWarnings(data)};
}

function simulationConfig(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'strategyId' && !Object.hasOwn(defaults, key))) throw Error('策略模拟配置无效或含未知字段');
  const config = {...defaults, ...options};
  strategyById(config.strategyId);
  if (!finite(config.initialCash) || config.initialCash <= 0 || config.initialCash > 1e12 ||
      !['feeBps', 'slippageBps', 'sellTaxBps'].every(key => finite(config[key]) && config[key] >= 0 && config[key] < 10000) ||
      config.feeBps + config.sellTaxBps >= 10000 ||
      !['riskPct', 'maxPositionPct'].every(key => finite(config[key]) && config[key] > 0 && config[key] <= 100) ||
      !Number.isSafeInteger(config.maxPositions) || config.maxPositions < 1 || config.maxPositions > 100)
    throw Error('资金、费用、风险预算或仓位参数无效');
  return config;
}
function executionGate(data, series, day, side) {
  const {stock, bars} = series, bar = bars[day], prior = bars[day - 1];
  if (!bar || !prior || !barOK(bar) || bar.complete === false ||
      !knownAt(stock.feed, data.asOf) || !knownAt(bar, openAt(bar.date)))
    return {reason: '开盘时没有可用的来源观测或完整日线证据'};
  const reason = riskReason(stock, bar, {sell: side === 'sell'});
  if (reason) return {reason};
  if (side === 'buy' && !universeObservation(data.universeHistory, stock.symbol, bar.date, {at: 'open'}).eligible)
    return {reason: '开盘时不具备历史股票池资格'};
  const lock = atLockedLimit(bar, prior, {...stock, ...stateAt(stock, bar)}, side);
  return lock.blocked ? {reason: lock.reason} : {lock};
}
const byRank = (a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol);

export function runStrategyResearch(input, options = {}) {
  const cfg = simulationConfig(options), strategy = strategyById(cfg.strategyId), data = prepare(input);
  if (data.stocks.length > 100) throw Error('策略模拟最多支持100只股票');
  const dates = data.stocks[0].bars.map(bar => bar.date);
  if (data.stocks.some(stock => stock.bars.length !== dates.length || stock.bars.some((bar, i) => bar.date !== dates[i])))
    throw Error('策略模拟要求共同且逐日对齐的日历；缺失交易日请提供停牌占位日线');
  // A common finished prefix avoids valuing one stock with an unfinished day
  // while every other holding is already marked at that day's final close.
  const end = Math.min(...data.stocks.map(stock => visibleEnd(stock, data.asOf)));
  const series = data.stocks.map(stock => seriesFor(stock, end));
  if (series.some(item => item.values.some(value => !value.numeric || !value.complete)))
    throw Error('共同历史区间含无效或未完成日线，请先修复历史数据');
  const byCode = new Map(series.map(item => [item.stock.symbol, item]));
  const positions = new Map(), warnings = new Set(reportWarnings(data));
  const equity = [], trades = [], orders = [];
  let cash = cfg.initialCash, fees = 0, peak = cash, maxDrawdown = 0, pendingBuys = [], previousEquity = cash;
  const cost = cfg.feeBps / 10000, tax = cfg.sellTaxBps / 10000, slip = cfg.slippageBps / 10000;
  const blocked = (date, symbol, side, reason) => orders.push({date, symbol, side, status: 'blocked', reason});
  for (let day = 0; day <= end; day++) {
    const date = dates[day], priorEquity = previousEquity;
    // Only a previous close may request an exit. Blocked exits keep both their
    // risk reason and their unrealized exposure, and retry at later opens.
    for (const [symbol, position] of [...positions]) if (position.exitReason) {
      if (day <= position.buyDay) { blocked(date, symbol, 'sell', 'T+1禁止买入当日卖出'); continue; }
      const item = byCode.get(symbol), gate = executionGate(data, item, day, 'sell');
      if (gate.reason) { blocked(date, symbol, 'sell', gate.reason); continue; }
      const price = Math.max(gate.lock.boundary, item.bars[day].open * (1 - slip));
      const gross = position.quantity * price, fee = gross * (cost + tax);
      cash += gross - fee; fees += fee;
      trades.push({symbol, buyDate: position.buyDate, sellDate: date, quantity: position.quantity,
        entry: round(position.entry), exit: round(price), netPnl: round(gross - fee - position.basis), reason: position.exitReason});
      orders.push({date, symbol, side: 'sell', status: 'filled', quantity: position.quantity,
        price: round(price), fees: round(fee), reason: position.exitReason});
      positions.delete(symbol);
    }
    for (const request of pendingBuys) {
      const {symbol, atr} = request;
      if (positions.has(symbol)) { blocked(date, symbol, 'buy', '已持仓，不重复开仓'); continue; }
      if (positions.size >= Math.min(cfg.maxPositions, strategy.id === 'momentum20_rotation' ? 5 : 100)) {
        blocked(date, symbol, 'buy', '实际持仓槽位未释放'); continue;
      }
      const item = byCode.get(symbol), gate = executionGate(data, item, day, 'buy');
      if (gate.reason) { blocked(date, symbol, 'buy', gate.reason); continue; }
      const price = Math.min(gate.lock.boundary, item.bars[day].open * (1 + slip));
      const distance = 2 * atr, stop = price - distance;
      const quantity = Math.floor(Math.min(priorEquity * cfg.riskPct / 100 / distance,
        priorEquity * cfg.maxPositionPct / 100 / price, cash / (price * (1 + cost))) / 100) * 100;
      if (!(stop > 0) || !Number.isSafeInteger(quantity) || quantity < 100) {
        blocked(date, symbol, 'buy', '风险预算、仓位或含费用现金不足一手，或止损无效'); continue;
      }
      const gross = quantity * price, fee = gross * cost;
      cash -= gross + fee; fees += fee;
      positions.set(symbol, {symbol, quantity, entry: price, basis: gross + fee, buyDate: date, buyDay: day,
        stopReference: stop, atr, lastMark: price, exitReason: null});
      orders.push({date, signalDate: request.signalDate, symbol, side: 'buy', status: 'filled', quantity,
        price: round(price), fees: round(fee), stopReference: round(stop), atr: round(atr), reason: '前一完整日线收盘信号'});
    }
    pendingBuys = [];
    const observations = new Map();
    for (const item of series) {
      const bar = item.bars[day], symbol = item.stock.symbol;
      const available = knownAt(item.stock.feed, data.asOf) && item.values[day].observedThrough <= closeAt(date);
      const position = positions.get(symbol);
      if (position) {
        if (available) position.lastMark = bar.close;
        else warnings.add(symbol + '存在收盘时尚不可用的观测；沿用上一有效估值并暂停新信号。');
      }
      const observation = signalObservation(data, item, day, strategy);
      observations.set(symbol, observation);
      if (!position || position.exitReason || !available) continue;
      if (bar.close <= position.stopReference) position.exitReason = '收盘触及冻结2ATR止损';
      else if (strategy.id === 'donchian20_atr' && bar.close < item.values[day].priorLow10)
        position.exitReason = '收盘跌破此前10日最低价';
      else if (strategy.id === 'rsi2_mean_reversion' && item.values[day].rsi2 > 70)
        position.exitReason = '收盘Wilder RSI2高于70';
      else if (strategy.id === 'rsi2_mean_reversion' && day - position.buyDay + 1 >= 5)
        position.exitReason = '达到5个提供交易日持有上限';
    }
    const value = cash + [...positions.values()].reduce((sum, position) => sum + position.quantity * position.lastMark, 0);
    if (!finite(value) || !finite(cash) || cash < -1e-6) throw Error('模拟净值或现金超出有效数值范围');
    peak = Math.max(peak, value); maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100);
    equity.push({date, value: round(value)});
    previousEquity = value;
    if (day === end) break;
    const candidates = [...observations.values()].filter(row => row.status === 'candidate' && !positions.has(row.symbol));
    if (strategy.id === 'momentum20_rotation') {
      if (day < 20 || (day - 20) % 5 !== 0) continue;
      const k = Math.min(5, cfg.maxPositions);
      const heldVisible = [...positions.keys()].every(symbol => {
        const item = byCode.get(symbol), ind = item.values[day];
        return ind.numeric && ind.complete && finite(ind.momentum20) &&
          knownAt(item.stock.feed, data.asOf) && ind.observedThrough <= closeAt(date);
      });
      if (!heldVisible) {
        warnings.add('轮动复核缺少可见的完整持仓动量，保留持仓且暂停本次轮动新增；既有退出重试不受影响。');
        continue;
      }
      const ranked = candidates.map(row => ({...row, score: row.indicators.momentum20})).sort(byRank);
      const topNew = ranked.slice(0, Math.max(0, k - positions.size) + 1);
      const held = [...positions.values()].map(position => {
        return {symbol: position.symbol, score: byCode.get(position.symbol).values[day].momentum20};
      });
      const union = [...held, ...topNew].sort(byRank);
      // Choose the bottom D=1 first, then apply the holding-period gate. A
      // blocked/too-young worst holding does not authorize selling a substitute.
      const worst = union.length > k ? union.at(-1) : null;
      const dropout = worst && positions.has(worst.symbol) &&
        day - positions.get(worst.symbol).buyDay + 1 >= 5 && !positions.get(worst.symbol).exitReason ? worst : null;
      if (dropout) positions.get(dropout.symbol).exitReason = '轮动复核：落出联合前K且已达到最短持有期';
      const exits = [...positions.values()].filter(position => position.exitReason).length;
      pendingBuys = ranked.slice(0, Math.max(0, k - positions.size + exits));
    } else pendingBuys = candidates.slice(0, Math.max(0, cfg.maxPositions - positions.size));
    pendingBuys = pendingBuys.map(row => ({symbol: row.symbol, atr: row.atr, signalDate: row.date}));
  }
  const evaluatedThrough = end >= 0 ? dates[end] : null;
  const sufficient = end + 1 > strategy.minBars;
  if (!sufficient) warnings.add('完整共同历史不足以在策略预热后执行下一开盘，尚不能评价策略表现。');
  if (end < dates.length - 1) warnings.add('尾部未完成或研究时点之前尚未收盘的日线未参与模拟。');
  if (positions.size) warnings.add('期末持仓按最后可用收盘价估值，未强制平仓；浮动损益仍计入净值。');
  const finalEquity = equity.at(-1)?.value ?? cfg.initialCash;
  return {strategyId: strategy.id, strategyVersion: strategy.version, status: sufficient ? 'completed' : 'insufficient_data',
    asOf: data.asOf, evaluatedThrough, sourceLabel: data.simulated ? '模拟历史数据（未核验）' : '导入历史数据（未核验）',
    mode, autoTrade: false, liveVerified: false, evidence: {...strategy.evidence}, config: {...cfg},
    protocol: {strategyId: strategy.id, strategyVersion: strategy.version, config: {...cfg},
      firstDate: dates[0], evaluatedThrough, signalTime: 'provided-session-close-15:10-China', executionTime: 'next-provided-session-open',
      universeMode: data.universeHistory ? 'provided-unverified' : 'legacy-unverified'},
    metrics: {finalEquity: round(finalEquity), returnPct: round((finalEquity / cfg.initialCash - 1) * 100),
      maxDrawdownPct: round(maxDrawdown), closedTrades: trades.length,
      winRatePct: trades.length ? round(trades.filter(trade => trade.netPnl > 0).length / trades.length * 100) : null, fees: round(fees)},
    equity, trades, orders,
    openPositions: [...positions.values()].map(position => ({symbol: position.symbol, quantity: position.quantity,
      buyDate: position.buyDate, entry: round(position.entry), stopReference: round(position.stopReference),
      lastMark: round(position.lastMark), exitPending: !!position.exitReason, exitReason: position.exitReason})),
    assumptions: ['日线收盘确认，最早下一提供交易日开盘模拟；T+1禁止当日卖出；不猜测日内成交顺序。',
      '按整百股、实际剩余现金和实际空槽位买入；多候选按代码排序，轮动按动量及代码排序。',
      '佣金为成交额比例，无最低佣金；双向滑点和卖出税单独计入；不保证开盘成交。',
      '风险预算仅为2ATR价格距离，费用、跳空和涨跌停会使最终损失超过预算。',
      'ATR20从第1至20个真实波幅初始化后Wilder递推；RSI2无平均损失（含全平）时记100。',
      '轮动K最多5、D最多1、最短持有5个提供交易日、每5日复核；受阻退出不释放持仓或现金。',
      '执行日零成交量仅作事后不可成交排除，不进入前一收盘的选股或排序；正成交量也不证明开盘可成交。',
      '股票级ST、停牌、可交易和退市状态是全区间静态声明；逐日明确状态优先，不把最新状态冒充历史认证。',
      '来源及逐日观测如显式声明晚于当次开盘或收盘，将阻止相应模拟，不用报告时点替代当时可见性。'],
    warnings: [...warnings]};
}
