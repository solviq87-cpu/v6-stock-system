'use strict';
const {aShareCalendarDate} = require('./a-share-calendar');
const {normalizeDay} = require('./limit-reason-evidence');

// Walk backwards from the authoritative realized balance. This also works when
// the opening balance predates the retained fills or several sells share a date.
function paperRealizedSeries(account, now = Date.now()) {
  if (!Number.isFinite(account?.realized)) return [];
  const byDay = new Map(), today = aShareCalendarDate(now);
  for (const t of account.trades || []) {
    if (!['买入','卖出'].includes(t.side)) continue;
    if(t.t!=null && (!Number.isSafeInteger(t.t) || t.t <= 0 || t.t > now))return [];
    const day=t.t==null?normalizeDay(t.tradeDate):aShareCalendarDate(t.t);
    if(!day||day>today||t.tradeDate&&normalizeDay(t.tradeDate)!==day)return [];
    if(t.side==='卖出'&&!Number.isFinite(t.pnl))return [];
    byDay.set(day,(byDay.get(day)||0)+(t.side==='卖出'?Math.round(t.pnl*100):0));
  }
  let cents = Math.round(account.realized*100);
  return [...byDay.keys()].sort().reverse().slice(0,250).map(day=>{
    const value=cents/100;cents-=byDay.get(day);return {day,value};
  }).reverse();
}
module.exports={paperRealizedSeries};
