'use strict';
const {createHash} = require('node:crypto');
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
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function rankValues(rows) {
 const ranks=new Map();
 [...rows].sort((a,b)=>b.return-a.return).forEach((s,i)=>{if(!ranks.has(s.return))ranks.set(s.return,i+1);});
 return ranks;
}
const mean = rows => rows.length ? round(rows.reduce((sum,s)=>sum+s.return,0)/rows.length) : null;
// The prior day's front group is defined before observing today's returns.
// Require the identical observed cohort, rather than choosing survivors today.
function frontMigration(samples,dates,archiveClocks) {
 const prior=samples.at(-2), current=samples.at(-1), priorClock=archiveClocks.at(-2);
 const currentOpen=Date.parse(dates.at(-1)+'T09:30:00+08:00');
 if(!priorClock||priorClock.recordedAt>currentOpen||priorClock.asOf>currentOpen||priorClock.recordedAt<priorClock.asOf||!prior.eligible||!current.eligible||prior.rows.length!==current.rows.length||
    prior.rows.some(s=>!finite(current.bySymbol.get(s.symbol)?.return)))return null;
 const priorFront=prior.rows.filter(s=>prior.ranks.get(s.return)<=Math.ceil(prior.rows.length*.2));
 const currentFront=new Set(current.rows.filter(s=>current.ranks.get(s.return)<=Math.ceil(current.rows.length*.2)).map(s=>s.symbol));
 const priorIds=new Set(priorFront.map(s=>s.symbol));
 const retained=priorFront.filter(s=>currentFront.has(s.symbol)).length;
 return {priorDate:dates.at(-2),currentDate:dates.at(-1),priorRecordedAt:priorClock.recordedAt,priorAsOf:priorClock.asOf,priorCohortHash:digest([...prior.rows.map(s=>s.symbol)].sort()),
  priorFrontCount:priorFront.length,currentFrontCount:currentFront.size,retainedFront:retained,enteredFront:currentFront.size-retained,leftFront:priorFront.length-retained,
  priorFrontCurrentMeanReturn:mean(current.rows.filter(s=>priorIds.has(s.symbol))),otherCurrentMeanReturn:mean(current.rows.filter(s=>!priorIds.has(s.symbol))),canTrade:false};
}
// Fixed one-session lead/lag diagnostic on the prior day's observed cohort.
// A same-session comparison is a control, never a forecast. Four pairs are
// insufficient for inference; absent or late evidence is counted, not replaced.
function leadLagDiagnostic(daily,samples,dates,clocks){
 const pairs=[];
 for(let i=1;i<daily.length;i++){
  const a=samples[i-1],b=samples[i],clock=clocks[i-1],target=clocks[i],open=Date.parse(dates[i]+'T09:30:00+08:00');
  const row={signalDate:dates[i-1],targetDate:dates[i],signalRecordedAt:clock.recordedAt,targetRecordedAt:target.recordedAt,
   status:'unknown',reason:null,priorBreadth:null,concurrentBreadth:null,targetIndexDirection:null,lagMatch:null,concurrentMatch:null,cohortHash:null};
  if(clock.recordedAt<clock.asOf||clock.recordedAt>open||clock.asOf<close(dates[i-1])||target.recordedAt<target.asOf){row.reason='clock-not-point-in-time';pairs.push(row);continue;}
  if(!a.eligible||!b.eligible||a.rows.length!==b.rows.length||a.rows.some(s=>!finite(b.bySymbol.get(s.symbol)?.return))){row.reason='same-cohort-unavailable';pairs.push(row);continue;}
  const breadth=rows=>Math.sign(rows.reduce((n,s)=>n+Math.sign(s.return),0));
  const prior=breadth(a.rows),same=breadth(b.rows),direction=Math.sign(daily[i].e.benchmark.return);
  Object.assign(row,{status:'observed-unverified',priorBreadth:prior,concurrentBreadth:same,targetIndexDirection:direction,cohortHash:digest(a.rows.map(s=>s.symbol).sort())});
  if(prior&&same&&direction){row.lagMatch=prior===direction;row.concurrentMatch=same===direction;}
  else row.reason='neutral-direction-abstention';
  pairs.push(row);
 }
 const evaluated=pairs.filter(p=>p.lagMatch!==null&&p.concurrentMatch!==null);
 return {method:'fixed-one-session-breadth-vs-index-v1',lagSessions:1,status:'descriptive-insufficient-sample',pairs,
  attempted:pairs.length,pairedEvaluated:evaluated.length,unknown:pairs.filter(p=>p.status==='unknown').length,
  abstained:pairs.filter(p=>p.status!=='unknown'&&p.lagMatch===null).length,
  lagMatches:evaluated.length?evaluated.filter(p=>p.lagMatch).length:null,
  concurrentMatches:evaluated.length?evaluated.filter(p=>p.concurrentMatch).length:null,
  outOfSampleVerified:false,leadingConfirmed:false,canTrade:false,canNotify:false};
}
// Report the first transition only WITHIN the supplied five consecutive
// archived sessions. The pre-open receipt gate prevents late revisions from
// retroactively becoming a discovery or confirmation. No event or value claim.
function earlyBoardObservation(samples,values,dates,clocks){
 const base={mode:'five-frozen-session-early-observation-v1',status:'unknown',firstObservedAt:null,firstDate:null,confirmedAt:null,confirmedDate:null,confirmationDelayMs:null,invalidatedAt:null,scope:'five-session-window-only',actualCatalystVerified:false,forwardValueVerified:false,canTrade:false,canNotify:false};
 if(samples.some(s=>!s.eligible||s.rows.length!==samples[0].rows.length||samples[0].rows.some(r=>!finite(s.bySymbol.get(r.symbol)?.return))))return base;
 if(clocks.some((c,i)=>!time(c.asOf)||!time(c.recordedAt)||c.asOf<close(dates[i])||c.recordedAt<c.asOf||i&&c.recordedAt<=clocks[i-1].recordedAt||i+1<dates.length&&c.recordedAt>=Date.parse(dates[i+1]+'T09:30:00+08:00')||i===dates.length-1&&new Date(c.recordedAt+28800000).toISOString().slice(0,10)!==dates[i]))return base;
 const qualifies=values.map((r,i)=>r.boardReturn>0&&r.boardReturn>r.benchmarkReturn&&samples[i].rows.filter(x=>x.return>0).length>samples[i].rows.length/2);
 if(qualifies[0])return {...base,status:'left-censored-existing-strength'};
 const index=qualifies.indexOf(true);if(index<0)return {...base,status:'no-qualified-observation'};
 const confirmed=index+1<dates.length&&qualifies[index+1],failure=qualifies.findIndex((q,i)=>i>index&&!q);
 return {...base,status:failure>=0?'invalidated-observation':confirmed?'confirmed-within-window':'first-observation-only',firstObservedAt:clocks[index].recordedAt,firstDate:dates[index],confirmedAt:confirmed?clocks[index+1].recordedAt:null,confirmedDate:confirmed?dates[index+1]:null,confirmationDelayMs:confirmed?clocks[index+1].recordedAt-clocks[index].recordedAt:null,invalidatedAt:failure>=0?clocks[failure].recordedAt:null};
}
// Five-day retrospective structure uses a common observed cohort at this cutoff.
// It is not a reconstruction of a signal known before the final session.
function boardStructure(daily,samples,dates,boardReturn,benchmarkReturn,archiveClocks){
 const roster=daily[0].board.members,common=[...roster].sort().filter(symbol=>samples.every(s=>finite(s.bySymbol.get(symbol)?.return)));
 const coverage=roster.length?common.length/roster.length:null;
 const base={status:'unknown',role:'unknown',method:'five-session-common-cohort-v1',cohortBasis:'retrospective-common-coverage',
  memberCount:roster.length,commonObserved:common.length,coverage:round(coverage),cohortHash:digest(common),
  broadUpSessions:null,broadDownSessions:null,outperformSessions:null,underperformSessions:null,daily:[],migration:null,leadLag:null,earlyObservation:null,canTrade:false,canNotify:false};
 if(common.length<5||coverage<.8||!finite(boardReturn)||!finite(benchmarkReturn))return base;
 const values=daily.map(({e,board},i)=>{
  const rows=common.map(symbol=>samples[i].bySymbol.get(symbol));
  const up=rows.filter(s=>s.return>0).length,down=rows.filter(s=>s.return<0).length;
  return {date:dates[i],up,down,flat:rows.length-up-down,upShare:round(up/rows.length),downShare:round(down/rows.length),boardReturn:board.return,benchmarkReturn:e.benchmark.return};
 });
 const broadUpSessions=values.filter(v=>v.up>common.length/2).length,broadDownSessions=values.filter(v=>v.down>common.length/2).length;
 const outperformSessions=values.filter(v=>v.boardReturn>v.benchmarkReturn).length,underperformSessions=values.filter(v=>v.boardReturn<v.benchmarkReturn).length;
 const excess=boardReturn-benchmarkReturn;
 const role=boardReturn>0&&excess>0&&broadUpSessions>=3&&outperformSessions>=3?'broad-relative-strength':
  boardReturn<0&&excess<0&&broadDownSessions>=3&&underperformSessions>=3?'broad-relative-weakness':'mixed';
 return {...base,status:'observed-unverified',role,broadUpSessions,broadDownSessions,outperformSessions,underperformSessions,daily:values,migration:frontMigration(samples,dates,archiveClocks),leadLag:leadLagDiagnostic(daily,samples,dates,archiveClocks),earlyObservation:earlyBoardObservation(samples,values,dates,archiveClocks)};
}
function compareIndustries(boards,dates=[]){
 const industries=boards.filter(b=>b.category==='industry');
 const eligible=dates.length===5?industries.filter(b=>b.trend?.structure?.status==='observed-unverified'&&finite(b.trend.relativeReturn)):[];
 const ranked=[...eligible].sort((a,b)=>b.trend.relativeReturn-a.trend.relativeReturn||a.code.localeCompare(b.code));
 const ranks=new Map();ranked.forEach((b,i)=>{if(!ranks.has(b.trend.relativeReturn))ranks.set(b.trend.relativeReturn,i+1);});
 return {status:dates.length!==5?'unknown':eligible.length<2?'insufficient-comparable-industries':'observed-unverified',scope:'selected-snapshot-industries-only',
  totalIndustries:industries.length,eligibleIndustries:eligible.length,dates:[...dates],
  rows:ranked.map(b=>({code:b.code,name:b.name,relativeReturn:b.trend.relativeReturn,rank:eligible.length>=2?ranks.get(b.trend.relativeReturn):null,role:b.trend.structure.role,commonObserved:b.trend.structure.commonObserved,coverage:b.trend.structure.coverage})),canTrade:false,canNotify:false};
}

// This is a read-only comparison of existing daily snapshots, never a new archive.
function enrichMarketLinkageHistory(view, events, {selectedEvent, asOf} = {}) {
 const result = JSON.parse(JSON.stringify(view));
 const boards = Array.isArray(result.boards) ? result.boards : [];
 result.mainlineComparison=compareIndustries(boards);
 const clear = reason => {
  for (const board of boards) {
   board.trend = {...unknown(reason),structure:null};
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
 const days = throughSelected.slice(-6), snapshots = [], archiveClocks = [];
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
  snapshots.push(evidence);archiveClocks.push({recordedAt:event.recordedAt,asOf:d.asOf});
 }
 const first = snapshots[0];
 if (snapshots.some(e => e.returnBasis !== first.returnBasis || e.benchmark.provider !== first.benchmark.provider || e.benchmark.code !== first.benchmark.code || e.benchmark.methodologyVersion !== first.benchmark.methodologyVersion || e.classification.provider !== first.classification.provider || e.classification.version !== first.classification.version)) return clear('daily-method-changed');
 for (const board of boards) {
  const daily = snapshots.map(e => ({e, board:e.boards.find(b => b.code === board.code && b.category === board.category)}));
  if (daily.some(x => !x.board || !finite(x.board.return)) || daily.some(x => membersKey(x.board.members) !== membersKey(daily[0].board.members)) || membersKey((board.members || []).map(m => m.symbol)) !== membersKey(daily[0].board.members)) {
   board.trend={...unknown('board-membership-or-return-changed'),structure:null};
   for (const m of board.members || []) m.trend=unknown('board-membership-or-return-changed');
   if (board.stock) board.stock.trend=unknown('board-membership-or-return-changed');
   continue;
  }
  const samples = daily.map(({e,board:b}) => {
   const bySymbol = new Map(e.stocks.map(s => [s.symbol,s]));
   const rows = b.members.map(symbol => bySymbol.get(symbol)).filter(s => s && finite(s.return));
   return {board:b,rows,bySymbol,ranks:rankValues(rows),eligible:rows.length >= 5 && rows.length / b.members.length >= .8};
  });
  const boardReturn = compound(daily.map(x => x.board.return)), benchmarkReturn = compound(daily.map(x => x.e.benchmark.return));
  board.trend = boardReturn === null || benchmarkReturn === null ? unknown('compound-overflow') : {status:'observed-unverified',sessions:5,return:round(boardReturn),relativeReturn:round(boardReturn-benchmarkReturn),frontSessions:null,role:'mixed',reason:'board-return-relative-to-benchmark'};
  board.trend.structure=boardStructure(daily,samples,days.slice(1),boardReturn,benchmarkReturn,archiveClocks);
  for (const member of board.members || []) {
   const rows = samples.map(s => s.bySymbol.get(member.symbol));
   if (samples.some(s => !s.eligible) || rows.some(s => !s || !finite(s.return))) {member.trend=unknown('member-coverage-or-return-unavailable');continue;}
   const stockReturn=compound(rows.map(s=>s.return));
   if (stockReturn === null || boardReturn === null || !finite(stockReturn-boardReturn)) {member.trend=unknown('compound-overflow');continue;}
   let front=0, back=0;
   samples.forEach((s,i) => {const rank=s.ranks.get(rows[i].return);if(rank<=Math.ceil(s.rows.length*.2))front++;if(rank>s.rows.length*.8)back++;});
   const relative=stockReturn-boardReturn;
   member.trend={status:'observed-unverified',sessions:5,return:round(stockReturn),relativeReturn:round(relative),frontSessions:front,role:relative>0&&front>=3?'persistent-front-candidate':relative<0&&back>=3?'relative-weak-observation':'mixed',reason:'five-frozen-daily-snapshots'};
  }
  if (board.stock) board.stock.trend = board.members?.find(m=>m.symbol===board.stock.symbol)?.trend || unknown('stock-not-in-board');
 }
 result.mainlineComparison=compareIndustries(boards,days.slice(1));
 if(boards.some(b=>b.trend?.status==='observed-unverified'))result.unknownReasons=[...(result.unknownReasons||[]).filter(x=>x!=='history-not-verified'),'history-source-not-authenticated'];
 return result;
}
module.exports = {enrichMarketLinkageHistory};
