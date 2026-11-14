'use strict';
/** A read-only projection of the authoritative legacy paper account.
 * Historical fills are not retroactively represented as placed/cancelled orders.
 * This module never writes accounts or submits orders.
 */
const crypto = require('node:crypto');
const cents = n => Math.round(n * 100);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);
function projectPaperAccount(account, { accountId, initialCash, audit, replica = false } = {}) {
  if (!account || !Array.isArray(account.trades) || !account.positions || !finite(account.cash) || !finite(initialCash)) throw new Error('模拟盘权威账户数据无效');
  if (!['pool','pre'].includes(accountId)) throw new Error('模拟盘账户标识无效');
  const events = account.trades.map((t, index) => {
    const side = t.side === '买入' ? 'BUY' : t.side === '卖出' ? 'SELL' : null;
    if (!side || !/^\d{6}$/.test(String(t.code)) || !Number.isSafeInteger(t.shares) || t.shares <= 0 || !finite(t.price) || t.price <= 0 || !finite(t.amount) || t.amount < 0 || !finite(t.fee) || t.fee < 0 || !Number.isSafeInteger(t.t) || t.t <= 0) throw new Error(`模拟盘历史成交记录不完整（索引${index}）`);
    const evidence = { t: t.t, side, code: t.code, shares: t.shares, price: t.price, amount: t.amount, fee: t.fee, pnl: t.pnl ?? null };
    return { eventId: `legacy-${hash({accountId, index, evidence})}`, type: 'FILL_RECORDED', source: 'legacy-paper', orderId: null, ...evidence };
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
    events, eventCount: events.length,
    warning: '历史自动成交仅有成交流水，无法反推出委托、部分成交、撤单或冻结资金；独立订单账本尚未成为主服务权威账本。'
  };
}
module.exports = { projectPaperAccount };
