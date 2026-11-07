'use strict';
/** Deterministic offline paper-order lifecycle reducer. No broker/network/account writes. */
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TERMINAL = new Set(['filled', 'canceled', 'rejected']);
const ALLOWED = {
  pending: new Set(['partial', 'filled', 'canceled', 'rejected']),
  partial: new Set(['partial', 'filled', 'canceled']),
  filled: new Set(), canceled: new Set(), rejected: new Set()
};

function reducePaperOrderEvents(order, events) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw new Error('订单对象无效');
  const quantity = Number(order.quantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || (quantity % 100 !== 0 && !(order.side==='sell'&&order.liquidateOddLot===true))) throw new Error('订单数量必须为正整数手');
  if (!Array.isArray(events)) throw new Error('订单事件必须为数组');
  const state = {
    orderId: String(order.orderId || ''), symbol: String(order.symbol || ''), side: order.side,
    quantity, status: 'pending', filledQuantity: 0, remainingQuantity: quantity,
    averageFillPrice: 0, fills: [], events: [], lastSequence: 0
  };
  if (!state.orderId || !/^\d{6}$/.test(state.symbol) || !['buy', 'sell'].includes(state.side)) throw new Error('订单标识、股票代码或方向无效');
  const seen = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('订单事件格式无效');
    const id = String(event.eventId || '');
    const sequence = Number(event.sequence);
    if (!id) throw new Error('订单事件缺少 eventId');
    if (seen.has(id)) continue; // idempotent replay
    if (!Number.isSafeInteger(sequence) || sequence <= state.lastSequence) throw new Error('订单事件序号必须严格递增');
    if (TERMINAL.has(state.status)) throw new Error('终态订单不能继续变更');
    const type = event.type;
    if (type === 'fill') {
      const qty = Number(event.quantity), price = Number(event.price);
      if (!Number.isSafeInteger(qty) || qty <= 0 || (qty % 100 !== 0 && !(order.side==='sell'&&order.liquidateOddLot===true))) throw new Error('成交数量必须为正整数手');
      if (!Number.isFinite(price) || price <= 0) throw new Error('成交价格无效');
      if (qty > state.remainingQuantity) throw new Error('成交数量超过剩余委托数量');
      const oldValue = state.averageFillPrice * state.filledQuantity;
      state.filledQuantity += qty;
      state.remainingQuantity -= qty;
      state.averageFillPrice = Math.round(((oldValue + qty * price) / state.filledQuantity + Number.EPSILON) * 10000) / 10000;
      state.fills.push({ eventId: id, sequence, quantity: qty, price, date: event.date || null });
      state.status = state.remainingQuantity === 0 ? 'filled' : 'partial';
    } else if (type === 'cancel') {
      if (state.status === 'pending' || state.status === 'partial') state.status = 'canceled';
      else throw new Error('当前订单不能撤销');
    } else if (type === 'reject') {
      if (state.filledQuantity > 0) throw new Error('已有部分成交的订单不能整体拒单');
      state.status = 'rejected';
      state.rejectReason = String(event.reason || '未提供拒单原因').slice(0, 240);
    } else {
      throw new Error(`未知订单事件类型：${String(type)}`);
    }
    state.lastSequence = sequence;
    state.events.push({ eventId: id, sequence, type, statusAfter: state.status });
    seen.add(id);
  }
  state.terminal = TERMINAL.has(state.status);
  state.paperOnly = true;
  state.brokerConnected = false;
  state.accountMutated = false;
  state.fingerprint = hash(state);
  return state;
}

module.exports = { reducePaperOrderEvents };
