'use strict';

/** Deterministic offline paper-order lifecycle ledger. No broker connectivity. */
const roundCent = value => Math.round((value + Number.EPSILON) * 100);
const money = cents => cents / 100;
const safePositiveInt = value => Number.isSafeInteger(value) && value > 0;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const ORDER_STATES = Object.freeze({ NEW: 'NEW', PARTIALLY_FILLED: 'PARTIALLY_FILLED', FILLED: 'FILLED', CANCELLED: 'CANCELLED' });

function createPaperOrderLedger({ initialCash, feeBps = 8, sellTaxBps = 5, lotSize = 100 } = {}) {
  if (typeof initialCash !== 'number' || !Number.isFinite(initialCash) || initialCash < 0) throw new TypeError('initialCash 必须是非负有限数值');
  if (typeof feeBps !== 'number' || !Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) throw new TypeError('feeBps 无效');
  if (typeof sellTaxBps !== 'number' || !Number.isFinite(sellTaxBps) || sellTaxBps < 0 || sellTaxBps > 1000) throw new TypeError('sellTaxBps 无效');
  if (!safePositiveInt(lotSize)) throw new TypeError('lotSize 必须是正整数');

  let cashCents = roundCent(initialCash);
  let reservedCashCents = 0;
  let realizedCents = 0;
  let sequence = 0;
  let currentTradingDay = null;
  const orders = new Map();
  const positions = new Map();
  const events = [];
  const fills = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const emit = (type, order, extra = {}) => events.push({ sequence: ++sequence, type, orderId: order.id, ...extra });
  const snapshot = () => ({
    cash: money(cashCents), reservedCash: money(reservedCashCents), availableCash: money(cashCents - reservedCashCents),
    realizedPnl: money(realizedCents),
    positions: Object.fromEntries([...positions.entries()].map(([code, p]) => [code, { shares: p.shares, sellableShares: p.sellableShares, basis: money(p.basisCents) }])),
    orders: [...orders.values()].map(o => clone(o)), fills: clone(fills), events: clone(events)
  });

  function submit({ id, side, code, quantity, limitPrice, tradingDay }) {
    if (typeof id !== 'string' || !id.trim() || orders.has(id)) throw new Error('订单ID缺失或重复');
    if (!['BUY', 'SELL'].includes(side)) throw new Error('订单方向无效');
    if (typeof code !== 'string' || !code.trim()) throw new Error('股票代码无效');
    if (!safePositiveInt(quantity) || quantity % lotSize !== 0) throw new Error('委托数量必须为正整数且符合整手规则');
    if (typeof limitPrice !== 'number' || !Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error('委托价格无效');
    if (!validDay(tradingDay) || (currentTradingDay && tradingDay !== currentTradingDay)) throw new Error('交易日期无效或与当前交易日不一致');
    if (!currentTradingDay) currentTradingDay = tradingDay;
    const priceCents = roundCent(limitPrice);
    if (priceCents <= 0) throw new Error('委托价格精度无效');
    const reserve = side === 'BUY' ? Math.ceil(priceCents * quantity * (1 + feeBps / 10000)) : 0;
    if (side === 'BUY' && reserve > cashCents - reservedCashCents) throw new Error('可用资金不足');
    if (side === 'SELL') {
      const p = positions.get(code);
      if (!p || p.sellableShares < quantity) throw new Error('可卖持仓不足或不满足T+1');
      p.sellableShares -= quantity;
    }
    reservedCashCents += reserve;
    const order = { id, side, code, quantity, filledQuantity: 0, remainingQuantity: quantity, limitPrice: priceCents / 100, tradingDay, status: ORDER_STATES.NEW, reservedCashCents: reserve, averageFillPrice: null };
    orders.set(id, order);
    emit('ORDER_SUBMITTED', order, { quantity, reservedCash: money(reserve) });
    return clone(order);
  }

  function fill(orderId, { quantity, price, tradingDay }) {
    const order = orders.get(orderId);
    if (!order || ![ORDER_STATES.NEW, ORDER_STATES.PARTIALLY_FILLED].includes(order.status)) throw new Error('订单不存在或已终态');
    if (!safePositiveInt(quantity) || quantity > order.remainingQuantity || quantity % lotSize !== 0) throw new Error('成交数量无效');
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || roundCent(price) > roundCent(order.limitPrice) && order.side === 'BUY' || roundCent(price) < roundCent(order.limitPrice) && order.side === 'SELL') throw new Error('成交价格超出限价约束');
    if (!validDay(tradingDay) || tradingDay < order.tradingDay || tradingDay !== currentTradingDay) throw new Error('成交日期无效');
    const grossCents = roundCent(price) * quantity;
    const feeCents = Math.round(grossCents * feeBps / 10000) + (order.side === 'SELL' ? Math.round(grossCents * sellTaxBps / 10000) : 0);
    if (order.side === 'BUY') {
      const debit = grossCents + feeCents;
      if (debit > order.reservedCashCents) throw new Error('成交金额超过订单冻结资金');
      cashCents -= debit;
      reservedCashCents -= debit;
      order.reservedCashCents -= debit;
      const p = positions.get(order.code) || { shares: 0, sellableShares: 0, basisCents: 0, lots: [] };
      p.shares += quantity;
      p.basisCents += debit;
      p.lots.push({ shares: quantity, basisCents: debit });
      positions.set(order.code, p);
    } else {
      const p = positions.get(order.code);
      if (!p || p.shares < quantity) throw new Error('成交时持仓不足或违反T+1');
      let remainingToSell = quantity, releasedBasis = 0;
      while (remainingToSell > 0 && p.lots.length) {
        const lot = p.lots[0];
        const take = Math.min(remainingToSell, lot.shares);
        const part = take === lot.shares ? lot.basisCents : Math.round(lot.basisCents * take / lot.shares);
        releasedBasis += part;
        lot.shares -= take;
        lot.basisCents -= part;
        remainingToSell -= take;
        if (lot.shares === 0) p.lots.shift();
      }
      if (remainingToSell > 0) throw new Error('持仓批次不足，拒绝成交');
      const proceeds = grossCents - feeCents;
      cashCents += proceeds;
      realizedCents += proceeds - releasedBasis;
      p.shares -= quantity;
      p.basisCents -= releasedBasis;
      if (p.shares === 0) positions.delete(order.code);
    }
    const previousFilledValue = order.averageFillPrice === null ? 0 : roundCent(order.averageFillPrice) * order.filledQuantity;
    order.filledQuantity += quantity;
    order.remainingQuantity -= quantity;
    order.averageFillPrice = (previousFilledValue + roundCent(price) * quantity) / order.filledQuantity / 100;
    order.status = order.remainingQuantity === 0 ? ORDER_STATES.FILLED : ORDER_STATES.PARTIALLY_FILLED;
    fills.push({ t: Date.parse(`${tradingDay}T00:00:00Z`), tradeId: `${order.id}:${order.filledQuantity}`, side: order.side, code: order.code, shares: quantity, amount: money(grossCents), fee: money(feeCents) });
    emit('ORDER_FILL', order, { quantity, price: roundCent(price) / 100, gross: money(grossCents), fee: money(feeCents), tradingDay });
    if (order.status === ORDER_STATES.FILLED) {
      if (order.side === 'BUY' && order.reservedCashCents > 0) {
        const releasedCents = order.reservedCashCents;
        reservedCashCents -= releasedCents;
        order.reservedCashCents = 0;
        emit('ORDER_RESERVATION_RELEASED', order, { releasedCash: money(releasedCents), tradingDay });
      }
      emit('ORDER_SETTLED', order, { tradingDay });
    }
    return clone(order);
  }

  function cancel(orderId, { tradingDay } = {}) {
    const order = orders.get(orderId);
    if (!order || ![ORDER_STATES.NEW, ORDER_STATES.PARTIALLY_FILLED].includes(order.status)) throw new Error('订单不存在或已终态');
    if (!validDay(tradingDay) || tradingDay < order.tradingDay || tradingDay !== currentTradingDay) throw new Error('撤单日期无效');
    if (order.side === 'BUY') {
      reservedCashCents -= order.reservedCashCents;
      order.reservedCashCents = 0;
    } else {
      const p = positions.get(order.code);
      if (p) p.sellableShares += order.remainingQuantity;
    }
    const releasedQuantity = order.remainingQuantity;
    order.remainingQuantity = 0;
    order.status = ORDER_STATES.CANCELLED;
    emit('ORDER_CANCELLED', order, { releasedQuantity, releasedCash: money(order.side === 'BUY' ? 0 : 0), tradingDay });
    return clone(order);
  }

  function advanceTradingDay(nextDay) {
    if (!validDay(nextDay) || !currentTradingDay || nextDay <= currentTradingDay) throw new Error('交易日期必须严格递增');
    currentTradingDay = nextDay;
    for (const [code, p] of positions) {
      const reservedForOpenSells = [...orders.values()].filter(o => o.code === code && o.side === 'SELL' && [ORDER_STATES.NEW, ORDER_STATES.PARTIALLY_FILLED].includes(o.status)).reduce((n, o) => n + o.remainingQuantity, 0);
      p.sellableShares = Math.max(0, p.shares - reservedForOpenSells);
    }
    events.push({ sequence: ++sequence, type: 'TRADING_DAY_ADVANCED', tradingDay: nextDay });
  }

  function audit() {
    const errors = [];
    let expectedReserved = 0;
    for (const o of orders.values()) {
      if (o.status === ORDER_STATES.NEW || o.status === ORDER_STATES.PARTIALLY_FILLED) {
        if (o.side === 'BUY') expectedReserved += o.reservedCashCents;
      } else if (o.reservedCashCents !== 0) errors.push(`终态订单${o.id}仍冻结资金`);
      const quantityInvariant = o.status === ORDER_STATES.CANCELLED
        ? o.remainingQuantity === 0 && o.filledQuantity <= o.quantity
        : o.filledQuantity + o.remainingQuantity === o.quantity;
      if (!quantityInvariant) errors.push(`订单${o.id}数量不守恒`);
    }
    if (expectedReserved !== reservedCashCents) errors.push('订单冻结资金合计不一致');
    if (cashCents < 0 || reservedCashCents < 0 || reservedCashCents > cashCents) errors.push('账户现金或冻结资金异常');
    for (const [code, p] of positions) {
      const reservedSellShares = [...orders.values()].filter(o => o.code === code && o.side === 'SELL' && [ORDER_STATES.NEW, ORDER_STATES.PARTIALLY_FILLED].includes(o.status)).reduce((n, o) => n + o.remainingQuantity, 0);
      if (!safePositiveInt(p.shares) || !Number.isSafeInteger(p.sellableShares) || p.sellableShares < 0 || p.sellableShares + reservedSellShares > p.shares || p.basisCents < 0 || p.lots.reduce((n, lot) => n + lot.shares, 0) !== p.shares || p.lots.reduce((n, lot) => n + lot.basisCents, 0) !== p.basisCents) errors.push(`持仓${code}状态异常`);
    }
    return { ok: errors.length === 0, errors, snapshot: snapshot() };
  }

  return Object.freeze({ submit, fill, cancel, advanceTradingDay, snapshot, audit });
}

module.exports = { createPaperOrderLedger, ORDER_STATES };
