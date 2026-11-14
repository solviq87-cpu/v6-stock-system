'use strict';
const {normalizeMarketLinkageEvidence} = require('./market-sector-stock-linkage');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const time = x => Number.isSafeInteger(x) && x > 0;
const dateOK = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
const close = date => Date.parse(date + 'T15:00:00+08:00');
const unknown = reason => ({status:'unknown',sessions:5,return:null,relativeReturn:null,frontSessions:null,role:'unknown',reason});
const compound = values => {
 let product = 1;
 for (const value of values) { product *= 1 + value; if (!finite(product)) return null; }
 return finite(product - 1) ? product - 1 : null;
};
const round = value => finite(value) ? Number(value.toFixed(10)) : null;
const membersKey = members => JSON.stringify([...members].sort());

// This is a read-only comparison of existing daily snapshots, never a new archive.
function enrichMarketLinkageHistory(view, events, {selectedEvent, asOf} = {}) {
 const result = JSON.parse(JSON.stringify(view));
 const boards = Array.isArray(result.boards) ? result.boards : [];
 const clear = reason => {
  for (const board of boards) {
   board.trend = unknown(reason);
   for (const member of board.members || []) member.trend = unknown(reason);
   if (board.stock) board.stock.trend = unknown(reason);
  }
  return result;
 };
 const selected = selectedEvent?.data;
 if (!selected || selectedEvent.kind !== 'analysis' || !time(asOf) || !time(selected.asOf) || selected.asOf > asOf || !time(selectedEvent.recordedAt) || selectedEvent.recordedAt > asOf || !Number.isSafeInteger(selectedEvent.sequence)) return clear('selected-snapshot-unavailable');
 const dates = selected.tradeDates;
 if (!Array.isArray(dates) || !dates.every(dateOK) || dates.some((d,i) => i && d <= dates[i-1])) return clear('five-consecutive-sessions-unavailable');
 const throughSelected = dates.filter(d => d <= selected.tradeDate);
 if (throughSelected.length < 6 || throughSelected.at(-1) !== selected.tradeDate) return clear('five-consecutive-sessions-unavailable');
 const days = throughSelected.slice(-6), snapshots = [];
 for (let i = 1; i < days.length; i++) {
  const target = days[i];
  // The selected event is the authoritative final revision. Other dates use
  // the latest admissible revision before the selected snapshot's clock.
  let event;
  if (target === selected.tradeDate) event = selectedEvent;
  else {
   const eligible = (Array.isArray(events) ? events : []).filter(e => e?.kind === 'analysis' && e.data?.symbol === selected.symbol && e.data?.tradeDate === target && time(e.recordedAt) && e.recordedAt <= selected.asOf && e.recordedAt <= selectedEvent.recordedAt && time(e.data.asOf) && e.data.asOf <= selected.asOf && Number.isSafeInteger(e.sequence) && e.sequence <= selectedEvent.sequence);
   eligible.sort((a,b) => b.sequence-a.sequence || b.recordedAt-a.recordedAt);
   event = eligible[0];
  }
  const d = event?.data;
  if (!d || d.symbol !== selected.symbol || d.provider !== selected.provider || d.priceBasis !== selected.priceBasis || !time(d.asOf) || d.asOf > selected.asOf) return clear('daily-snapshot-missing-or-incompatible');
  let evidence;
  try { evidence = normalizeMarketLinkageEvidence(d.context?.marketLinkageEvidence, {asOf:d.asOf,tradeDate:target,provider:d.provider,symbol:d.symbol}); } catch { return clear('daily-snapshot-invalid'); }
  if (!evidence || evidence.window.start !== close(days[i-1]) || evidence.window.end !== close(target) || evidence.methodology.noCorporateActions !== true || !evidence.benchmark.methodologyVersion || !finite(evidence.benchmark.return)) return clear('daily-window-or-method-unavailable');
  snapshots.push(evidence);
 }
 const first = snapshots[0];
 if (snapshots.some(e => e.returnBasis !== first.returnBasis || e.benchmark.provider !== first.benchmark.provider || e.benchmark.code !== first.benchmark.code || e.benchmark.methodologyVersion !== first.benchmark.methodologyVersion || e.classification.provider !== first.classification.provider || e.classification.version !== first.classification.version)) return clear('daily-method-changed');
 for (const board of boards) {
  const daily = snapshots.map(e => ({e, board:e.boards.find(b => b.code === board.code && b.category === board.category)}));
  if (daily.some(x => !x.board || !finite(x.board.return)) || daily.some(x => membersKey(x.board.members) !== membersKey(daily[0].board.members)) || membersKey((board.members || []).map(m => m.symbol)) !== membersKey(daily[0].board.members)) {
   board.trend=unknown('board-membership-or-return-changed');
   for (const m of board.members || []) m.trend=unknown('board-membership-or-return-changed');
   if (board.stock) board.stock.trend=unknown('board-membership-or-return-changed');
   continue;
  }
  const samples = daily.map(({e,board:b}) => {
   const bySymbol = new Map(e.stocks.map(s => [s.symbol,s]));
   const rows = b.members.map(symbol => bySymbol.get(symbol)).filter(s => s && finite(s.return));
   return {board:b,rows,bySymbol,eligible:rows.length >= 5 && rows.length / b.members.length >= .8};
  });
  const boardReturn = compound(daily.map(x => x.board.return)), benchmarkReturn = compound(daily.map(x => x.e.benchmark.return));
  board.trend = boardReturn === null || benchmarkReturn === null ? unknown('compound-overflow') : {status:'observed-unverified',sessions:5,return:round(boardReturn),relativeReturn:round(boardReturn-benchmarkReturn),frontSessions:null,role:'mixed',reason:'board-return-relative-to-benchmark'};
  for (const member of board.members || []) {
   const rows = samples.map(s => s.bySymbol.get(member.symbol));
   if (samples.some(s => !s.eligible) || rows.some(s => !s || !finite(s.return))) {member.trend=unknown('member-coverage-or-return-unavailable');continue;}
   const stockReturn=compound(rows.map(s=>s.return));
   if (stockReturn === null || boardReturn === null || !finite(stockReturn-boardReturn)) {member.trend=unknown('compound-overflow');continue;}
   let front=0, back=0;
   samples.forEach((s,i) => {const rank=1+s.rows.filter(x=>x.return>rows[i].return).length;if(rank<=Math.ceil(s.rows.length*.2))front++;if(rank>s.rows.length*.8)back++;});
   const relative=stockReturn-boardReturn;
   member.trend={status:'observed-unverified',sessions:5,return:round(stockReturn),relativeReturn:round(relative),frontSessions:front,role:relative>0&&front>=3?'persistent-front-candidate':relative<0&&back>=3?'relative-weak-observation':'mixed',reason:'five-frozen-daily-snapshots'};
  }
  if (board.stock) board.stock.trend = board.members?.find(m=>m.symbol===board.stock.symbol)?.trend || unknown('stock-not-in-board');
 }
 if(boards.some(b=>b.trend?.status==='observed-unverified'))result.unknownReasons=[...(result.unknownReasons||[]).filter(x=>x!=='history-not-verified'),'history-source-not-authenticated'];
 return result;
}
module.exports = {enrichMarketLinkageHistory};
