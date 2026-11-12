'use strict';
/** A read-only projection of the authoritative legacy paper account.
 * Historical fills are not retroactively represented as placed/cancelled orders.
 * This module never writes accounts or submits orders.
 */
const crypto = require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {validateFillEvidence}=require('./paper-fill-evidence');
const cents = n => Math.round(n * 100);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);
function projectPaperAccount(account, { accountId, initialCash, audit, replica = false } = {}) {
  if (!account || !Array.isArray(account.trades) || !account.positions || !finite(account.cash) || !finite(initialCash)) throw new Error('模拟盘权威账户数据无效');
  if (!['pool','pre'].includes(accountId)) throw new Error('模拟盘账户标识无效');
  const events = account.trades.map((t, index) => {
    const side = t.side === '买入' ? 'BUY' : t.side === '卖出' ? 'SELL' : null;
    const hasTime=Number.isSafeInteger(t.t)&&t.t>0;
    const validDate=typeof t.tradeDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.tradeDate)&&Number.isFinite(Date.parse(t.tradeDate))&&new Date(t.tradeDate).toISOString().slice(0,10)===t.tradeDate;
    if (!side || !/^\d{6}$/.test(String(t.code)) || !Number.isSafeInteger(t.shares) || t.shares <= 0 || !finite(t.price) || t.price <= 0 || !finite(t.amount) || t.amount < 0 || !finite(t.fee) || t.fee < 0 ||
        (!hasTime&&!(t.t===null&&validDate&&t.timeQuality==='date-only')) ||
        (hasTime&&validDate&&aShareCalendarDate(t.t)!==t.tradeDate) ||
        (t.orderId!=null&&!(typeof t.orderId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(t.orderId)))) throw new Error(`模拟盘历史成交记录不完整（索引${index}）`);
    const tradeDate=validDate?t.tradeDate:hasTime?aShareCalendarDate(t.t):null;
    const evidence = { t: hasTime?t.t:null, side, code: t.code, shares: t.shares, price: t.price, amount: t.amount, fee: t.fee, pnl: t.pnl ?? null };
    const fillEvidence=t.fillEvidence==null?null:JSON.parse(JSON.stringify(validateFillEvidence(t.fillEvidence,{symbol:t.code,tradeDate,price:t.price,executionAt:t.t})));
    return { eventId: t.eventId || `legacy-${hash({accountId, evidence})}`, type: 'FILL_RECORDED', source: t.orderId?'paper-order-account':'legacy-paper', orderId: t.orderId||null, ...evidence,
      tradeDate,timeQuality:hasTime?'known':'date-only',mode:fillEvidence?.mode||'unknown',provider:fillEvidence?.provider||null,quoteAt:fillEvidence?.quoteAt??null,receivedAt:fillEvidence?.receivedAt??null,fillEvidence };
  });
  const positions = Object.values(account.positions).map(p => {
    if (!/^\d{6}$/.test(String(p.code)) || !Number.isSafeInteger(p.shares) || p.shares <= 0 || !finite(p.basis)) throw new Error('模拟盘持仓数据不完整');
    return { code: p.code, shares: p.shares, basis: p.basis };
  }).sort((a,b)=>a.code.localeCompare(b.code));
  const auditStatus = audit?.ok === true ? 'passed' : audit?.incomplete ? 'incomplete' : audit?.replica || replica ? 'replica' : 'unverified';
  return {
    schemaVersion: 1, mode: 'authoritative-paper-readonly-projection', accountId,
    paperOnly: true, brokerConnected: false, canSubmitOrders: false, canCancelOrders: false,
    authoritative: !replica, historicalOrdersAvailable: false,
    accounting: { initialCash, cash: account.cash, realizedPnl: finite(account.realized) ? account.realized : null,
      positions, tradeCount: account.trades.length, droppedTradeCount: account.tradesDropped || 0,
      auditStatus, audit: audit || null },
    events, eventCount: events.length, linkedFillCount:events.filter(e=>e.orderId!==null).length,
    warning: '新成交保留已知订单关联与报价证据；迁入前只有流水的历史不反推委托、撤单或冻结资金，缺失时刻保持未知。新订单与自动成交共用权威快照。'
  };
}
module.exports = { projectPaperAccount };
