'use strict';
// Events are committed in the SAME atomic paper.json snapshot as the account.
// This is not a separate balance/position ledger and cannot be independently updated.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function tradeIdentity(account, trade) {
  return hash({account,t:trade.t,side:trade.side,code:trade.code,shares:trade.shares,price:trade.price,amount:trade.amount,fee:trade.fee,basis:trade.basis});
}
function buildTradeEvents(previous, next, existing = []) {
  if (!Array.isArray(existing)) throw Error('权威事件日志格式错误');
  const known = new Set(existing.map(e => e.id));
  const result = existing.slice();
  for (const key of ['pool','pre']) {
    const oldTrades = previous[key]?.trades || [];
    const newTrades = next[key]?.trades || [];
    if (!Array.isArray(oldTrades) || !Array.isArray(newTrades)) throw Error('成交记录格式错误');
    const oldCounts = new Map();
    for (const t of oldTrades) { const id=tradeIdentity(key,t); oldCounts.set(id,(oldCounts.get(id)||0)+1); }
    for (const t of [...newTrades].reverse()) {
      const id=tradeIdentity(key,t);
      const count=oldCounts.get(id)||0;
      if (count) {oldCounts.set(id,count-1);continue;}
      if (known.has(id)) continue;
      result.push({id,account:key,type:'TRADE_FILLED',trade:{...t}});
      known.add(id);
    }
  }
  return result;
}
function validateEvents(events) {
  if (!Array.isArray(events)) throw Error('权威事件日志不是数组');
  const seen=new Set();
  for (const event of events) {
    if (!event || !['pool','pre'].includes(event.account) || event.type!=='TRADE_FILLED' || event.id!==tradeIdentity(event.account,event.trade) || seen.has(event.id)) throw Error('权威事件日志损坏或重复');
    seen.add(event.id);
  }
  return true;
}
module.exports={tradeIdentity,buildTradeEvents,validateEvents};
