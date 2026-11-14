'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../config/research-calendar-2026.json');
const {normalizeBaoStockDaily}=require('../src/core/baostock-historical-normalizer');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const {partitionBaoStockRows,auditDailySessionCoverage}=require('../src/core/a-share-session-coverage');
const now=Date.parse('2026-11-15T12:00:00+08:00');
const dates=calendar.sessions.filter(s=>s.open&&s.date<='2026-11-13').map(s=>s.date).slice(-38);
const one=(date,overrides={})=>({date,code:'sh.600000',open:'10',high:'11',low:'9',close:'10',
 volume:'10000',amount:'100000',adjustflag:'3',tradestatus:'1',...overrides});
const raw=(ds=dates)=>ds.map(date=>one(date));
const dataset=(ds=dates)=>normalizeBaoStockDaily({code:'600000',rows:raw(ds),collectorObservedAt:now}).dataset;
test('real recorded 2026 Shanghai/Shenzhen calendar retains 242 explicit sessions',()=>{
 assert.equal(calendar.sessions.length,365);
 assert.equal(calendar.sessions.filter(d=>d.open).length,242);
 assert.equal(dates.length,38);
 assert.ok(dates.includes('2026-09-28'));
 assert.ok(!dates.includes('2026-10-01'));
 assert.ok(!dates.includes('2026-09-25'));
});
test('complete observed daily bars report provider-calendar shape consistency, never exchange/live certification',()=>{
 const r=auditDailySessionCoverage(dataset(),{now});
 assert.equal(r.status,'open-session-shape-consistent-unverified');
 assert.equal(r.stocks,1);
 assert.equal(r.coveredTradingDays,38);
 assert.equal(r.unexplainedOpenDayGaps,0);
 assert.equal(r.providerDeclaredSuspensionDays,0);
 assert.equal(r.holidayBars,0);
 assert.equal(r.completeByProviderEvidence,true);
 assert.equal(r.bySymbol[0].exchange,'SSE');
 assert.equal(r.bySymbol[0].calendarOpenSessionsInSpan,38);
 assert.match(r.bySymbol[0].calendarFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(r.sourceAuthenticated,false);
 assert.equal(r.exchangeVerified,false);
 assert.equal(r.corporateActionsVerified,false);
 assert.equal(r.pointInTimeBacktestReady,false);
 assert.equal(r.canTrade,false);
});
test('two numerically identical histories may BOTH omit an open day; explicit coverage audit catches it',()=>{
 const omission=dates[14],reduced=dates.filter(x=>x!==omission);
 const first=dataset(reduced),second=structuredClone(first);
 second.provider='eastmoney-public-history';second.datasetId='em-unit-v2-research';
 second.priceAdjustment={mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'};
 assert.equal(compareMarketFeeds(first,second).consensus,true,'numeric parity cannot notice shared missing dates');
 const r=auditDailySessionCoverage(first,{now});
 assert.equal(r.status,'unexplained-or-zero-volume-gaps');
 assert.deepEqual(r.bySymbol[0].unexplainedMissingOpenDays,[omission]);
 assert.equal(r.bySymbol[0].missingOpenSessions,1);
 assert.equal(r.completeByProviderEvidence,false);
 assert.equal(r.canTrade,false);
});
test('a verified-shape BaoStock suspension row is only provider-declared, no fake candle is created',()=>{
 const skipped=dates[14];
 const sample=[...raw(dates.filter(x=>x!==skipped)),one(skipped,{open:'',high:'',low:'',close:'',volume:'0',amount:'0',tradestatus:'0'})];
 const ordered=sample.sort((a,b)=>a.date.localeCompare(b.date));
 const parts=partitionBaoStockRows({code:'600000',rows:ordered,collectorObservedAt:now,now});
 assert.equal(parts.suspensions.length,1);
 assert.equal(parts.tradingRows.length,37);
 assert.equal(parts.suspensions[0].providerStatus,'suspended');
 assert.equal(parts.suspensions[0].exchangeVerified,false);
 const d=normalizeBaoStockDaily({code:'600000',rows:parts.tradingRows,collectorObservedAt:now}).dataset;
 assert.equal(d.stocks[0].bars.some(b=>b.date===skipped),false);
 const r=auditDailySessionCoverage(d,{now,suspensions:parts.suspensions});
 assert.equal(r.status,'provider-declared-halts-unverified');
 assert.equal(r.unexplainedOpenDayGaps,0);
 assert.deepEqual(r.bySymbol[0].providerDeclaredSuspensionDays,[skipped]);
 assert.equal(r.completeByProviderEvidence,true);
 assert.equal(r.exchangeVerified,false);
 assert.equal(r.pointInTimeBacktestReady,false);
 assert.equal(r.canTrade,false);
});
test('suspended source record claiming real turnover is contradictory and never normalized',()=>{
 const skipped=dates[14];
 for(const o of [{volume:'100',amount:'0'}, {volume:'0',amount:'999'},
   {adjustflag:'1'}, {date:'2026-02-30'}, {code:'sz.600000'},
   {tradestatus:'unknown'}]){
  const row=one(skipped,{volume:'0',amount:'0',tradestatus:'0',...o});
  assert.throws(()=>partitionBaoStockRows({code:'600000',rows:[row],collectorObservedAt:now,now}));
 }
 assert.throws(()=>partitionBaoStockRows({code:'600000',rows:[one(skipped,{tradestatus:'0',volume:'0',amount:'0'})],now}),/采集时间/);
 assert.throws(()=>partitionBaoStockRows({code:'600000',rows:[one(skipped),one(skipped)],collectorObservedAt:now,now}),/状态|日期|重复/);
 assert.throws(()=>partitionBaoStockRows({code:'600000',rows:[one(skipped)],collectorObservedAt:now+1000,now}),/时钟/);
});
test('a purported suspension on an existing OHLC trading date is quarantined, not accepted as a real halt',()=>{
 const d=dataset(),suspension=[{symbol:'600000',date:dates[14],
  source:'baostock',providerStatus:'suspended',observedAt:now}];
 const result=auditDailySessionCoverage(d,{now,suspensions:suspension});
 assert.equal(result.status,'source-calendar-conflict');
 assert.deepEqual(result.bySymbol[0].suspensionContradictions,[dates[14]]);
 assert.equal(result.completeByProviderEvidence,false);
});
test('nontrading official holidays cannot become daily price bars even if prices are self-consistent',()=>{
 const d=dataset(),bar={...d.stocks[0].bars[0],date:'2026-10-01'};
 d.stocks[0].bars.push(bar);
 d.stocks[0].bars.sort((a,b)=>a.date.localeCompare(b.date));
 const result=auditDailySessionCoverage(d,{now});
 assert.equal(result.status,'source-calendar-conflict');
 assert.deepEqual(result.bySymbol[0].holidayOrClosedSessionBars,['2026-10-01']);
 assert.equal(result.completeByProviderEvidence,false);
});
test('zero-volume day cannot be inferred to be a certified suspended stock',()=>{
 const d=dataset();
 const bar=d.stocks[0].bars[10];
 bar.volume=0;bar.amount=0;
 const r=auditDailySessionCoverage(d,{now});
 assert.equal(r.status,'unexplained-or-zero-volume-gaps');
 assert.deepEqual(r.bySymbol[0].zeroVolumeBarsNotProofOfSuspension,[bar.date]);
 assert.equal(r.completeByProviderEvidence,false);
});
test('bad explicit halt evidence rejects missing time, wrong symbol and future claims',()=>{
 const d=dataset();
 for(const change of [
  {symbol:'000001'},
  {source:'eastmoney'},
  {observedAt:now+1},
  {observedAt:0},
  {date:'2027-01-05'},
  {providerStatus:'normal'},
  {date:'2026-02-30'}
 ]){
  const s={symbol:'600000',date:dates[14],source:'baostock',providerStatus:'suspended',
   observedAt:now,...change};
  assert.throws(()=>auditDailySessionCoverage(d,{now,suspensions:[s]}));
 }
});
test('before calendar was first observed or outside 2026 coverage, audit status remains unavailable',()=>{
 const older=dataset(dates.slice(0,32));
 const preClock=Date.parse('2026-10-28T10:00:00+08:00');
 assert.ok(older.asOf<='2026-10-28');
 const early=auditDailySessionCoverage(older,{now:preClock});
 assert.equal(early.status,'calendar-unavailable');assert.equal(early.completeByProviderEvidence,false);
 assert.equal(early.unexplainedOpenDayGaps,null);
 const futureDays=Array.from({length:45},(_,i)=>new Date(Date.UTC(2027,0,1+i)).toISOString().slice(0,10))
   .filter(date=>![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())).slice(0,32);
 const next={...dataset(),asOf:futureDays.at(-1),stocks:[{...dataset().stocks[0],bars:futureDays.map(date=>({
   date,open:10,high:11,low:9,close:10,volume:10000,amount:100000
  }))}]};
 const t=Date.parse('2027-03-01T12:00:00+08:00');
 const r=auditDailySessionCoverage(next,{now:t});
 assert.equal(r.status,'calendar-unavailable');
 assert.equal(r.exchangeVerified,false);assert.equal(r.canTrade,false);
});
test('source dataset and optional suspension arrays must obey strict A-share constraints',()=>{
 const d=dataset();
 for(const arg of [{now:NaN},{now:0},{now:Date.parse('2026-01-01T10:00:00+08:00')},
  {suspensions:'suspended'}, {suspensions:Array(2001).fill(null)}]){
  assert.throws(()=>auditDailySessionCoverage(d,arg),/数据|时点|证据|日期|无效/);
 }
 const mock={...d,source:'fixture'};
 assert.throws(()=>auditDailySessionCoverage(mock,{now}),/导入历史/);
});
