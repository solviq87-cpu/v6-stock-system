'use strict';
/** Read-only reconciliation between durable order journals and the paper cash/position ledger. */
const crypto = require('node:crypto');
const { reducePaperOrderEvents } = require('./paper-order-state-machine');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function reconcilePaperLedger(orderRecords, account) {
  if (!Array.isArray(orderRecords)) throw new Error('订单记录必须为数组');
  if (!account || account.schemaVersion !== 1 || !Array.isArray(account.events) || !account.positions || !Number.isFinite(account.cash)) {
    throw new Error('模拟盘账户账本结构无效');
  }
  const accountFingerprint = hash({ cash: account.cash, positions: account.positions, events: account.events });
  if (account.fingerprint !== accountFingerprint) throw new Error('模拟盘账户指纹校验失败');

  const orderFills = new Map();
  const orderIssues = [];
  for (const record of orderRecords) {
    if (!record || record.schemaVersion !== 1 || !record.order || !Array.isArray(record.events)) throw new Error('订单日志结构无效');
    const journalHash = hash(record.events);
    if (record.journalHash !== journalHash) throw new Error(`订单日志指纹校验失败：${record.order.orderId || 'unknown'}`);
    const state = reducePaperOrderEvents(record.order, record.events);
    if (!record.state || record.state.fingerprint !== state.fingerprint) throw new Error(`订单状态与事件日志不一致：${record.order.orderId}`);
    for (const fill of state.fills) {
      if (orderFills.has(fill.eventId)) orderIssues.push({ type: 'duplicate-order-fill-event', eventId: fill.eventId });
      else orderFills.set(fill.eventId, {
        eventId: fill.eventId, orderId: state.orderId, symbol: state.symbol,
        side: state.side, quantity: fill.quantity, price: fill.price,
        date: fill.date || null
      });
    }
  }

  const ledgerFills = new Map();
  for (const event of account.events) {
    if (!event || !event.eventId) throw new Error('账户流水缺少事件ID');
    if (ledgerFills.has(event.eventId)) orderIssues.push({ type: 'duplicate-ledger-event', eventId: event.eventId });
    else ledgerFills.set(event.eventId, event);
  }

  const missingLedger = [];
  const mismatched = [];
  for (const [id, fill] of orderFills) {
    const ledgerEvent = ledgerFills.get(id);
    if (!ledgerEvent) { missingLedger.push(fill); continue; }
    const same = ledgerEvent.orderId === fill.orderId && ledgerEvent.symbol === fill.symbol &&
      ledgerEvent.side === fill.side && Number(ledgerEvent.quantity) === fill.quantity &&
      Number(ledgerEvent.price) === fill.price;
    if (!same) mismatched.push({ eventId: id, orderFill: fill, ledgerEvent });
  }
  const orphanLedger = [...ledgerFills.values()].filter(x => !orderFills.has(x.eventId));
  const ok = !orderIssues.length && !missingLedger.length && !mismatched.length && !orphanLedger.length;
  const report = {
    schemaVersion: 1, mode: 'read-only-paper-ledger-reconciliation',
    ok, readOnly: true, accountMutated: false, brokerConnected: false,
    orderCount: orderRecords.length, orderFillCount: orderFills.size, ledgerEventCount: ledgerFills.size,
    missingLedger, orphanLedger, mismatched, issues: orderIssues,
    accountFingerprint,
    checkedAt: new Date().toISOString()
  };
  report.reportFingerprint = hash({ ...report, checkedAt: null });
  return report;
}
module.exports = { reconcilePaperLedger };
