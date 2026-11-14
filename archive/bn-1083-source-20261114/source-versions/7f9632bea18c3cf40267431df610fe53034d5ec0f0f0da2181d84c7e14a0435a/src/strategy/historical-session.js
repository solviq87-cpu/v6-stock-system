'use strict';

const boardLimits = {main:10, chinext:20, star:20, bse:30};
function limitPct(stock) {
  if (Number.isFinite(stock.limitPct) && stock.limitPct > 0 && stock.limitPct <= 100) return stock.limitPct;
  if (stock.isST) return 5;
  return Object.hasOwn(boardLimits, stock.market) ? boardLimits[stock.market] : null;
}

// A later intraday unlock is unavailable to a simulated opening order.
function atLockedLimit(bar, prior, stock, side) {
  if (!(Number.isFinite(bar?.open) && bar.open > 0)) return {blocked:true, reason:'开盘价无效'};
  let boundary = side === 'buy' ? bar.upperLimit : bar.lowerLimit;
  if (boundary === undefined) {
    const limit = limitPct(stock);
    if (!limit || !Number.isFinite(prior?.close) || prior.close <= 0) return {blocked:true, reason:'缺少涨跌停制度或前收盘价'};
    const pct = side === 'buy' ? limit : -limit;
    boundary = Math.round(prior.close * (100 + pct) + 1e-9) / 100;
  }
  if (!Number.isFinite(boundary) || boundary <= 0) return {blocked:true, reason:'涨跌停价格无效'};
  const blocked = side === 'buy' ? bar.open >= boundary : bar.open <= boundary;
  return {blocked, reason:blocked ? '开盘触及涨跌停，无法确认排队成交' : null};
}

function historicalStock(stock, day, source, timestamp) {
  const bars = stock.bars.slice(0, day + 1);
  const bar = bars[day];
  const prev = bars[day - 1];
  // Only dated, as-of-close factors are eligible. Latest stock-level scores never travel back in time.
  return {...bar.factors, symbol:stock.symbol || stock.code, market:stock.market,
    isST:bar.isST ?? stock.isST, suspended:bar.suspended ?? stock.suspended,
    tradable:bar.tradable ?? stock.tradable, limitPct:stock.limitPct,
    close:bar.close, pctChange:(bar.close / prev.close - 1) * 100, bars, feed:{source,timestamp}};
}

function assertAligned(stocks, stop, tradingDates) {
  if (tradingDates !== null && (!Array.isArray(tradingDates) || tradingDates.length <= stop)) throw Error('交易日历覆盖不足');

  for (let day = 0; day <= stop; day++) {
    const date = stocks[0].bars[day]?.date;
    if (tradingDates !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date ||
        tradingDates[day] !== date)) throw Error('行情日期与指定交易日历不符');
    for (const stock of stocks) {
      const bar = stock.bars[day];
      if (!bar || bar.date !== date || (day && (date === undefined) !== (stock.bars[day-1].date === undefined)) ||
          (day && date !== undefined && date <= stock.bars[day-1].date)) {
        throw Error('历史交易日缺失或未对齐，请按共同交易日提供停牌占位');
      }
    }
  }
}
module.exports = {limitPct, atLockedLimit, historicalStock, assertAligned};
