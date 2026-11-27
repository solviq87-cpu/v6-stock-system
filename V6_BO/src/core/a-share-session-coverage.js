'use strict';
/**
 * Read-only daily A-share session coverage audit.  Numeric agreement between
 * two histories cannot prove that BOTH did not silently omit an open day.
 * This module never fills a bar (including at a suspended date), never grants
 * trading permission and never treats an operator's calendar as exchange proof.
 */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {readResearchCalendar}=require('./research-calendar-source');
const {aShareCalendarDate,assessDailyBarFinality}=require('./a-share-calendar');
const validClock=n=>Number.isSafeInteger(n)&&n>0&&n<=8e15;
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const zeroOrBlank=x=>x===undefined||x===null||x===''||
 ((typeof x==='number'||typeof x==='string')&&x!==true&&x!==false&&
  /^(?:0|0\.0+)$/.test(String(x)));
function expectedCode(symbol){
 if(typeof symbol!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(symbol))
  throw Error('停牌审计仅支持明确沪深A股代码');
 return (symbol.startsWith('6')?'sh.':'sz.')+symbol;
}
/**
 * BaoStock marks trading dates as tradestatus 1 and suspended dates as 0.
 * Split explicit status rows WITHOUT creating synthetic zero-price OHLC bars.
 * A suspended row's price fields, if any, are not interpreted as trades.
 */
function partitionBaoStockRows({code,rows,collectorObservedAt,now=Date.now()}={}){
 const expected=expectedCode(code);
 if(!Array.isArray(rows)||rows.length<1||rows.length>2000||
    !validClock(now)||
    (collectorObservedAt!==undefined&&(!validClock(collectorObservedAt)||collectorObservedAt>now)))
  throw Error('BaoStock停牌状态原始证据、采集时钟或大小无效');
 const seen=new Set(),tradingRows=[],suspensions=[];
 const observedDay=aShareCalendarDate(now);
 const capturedDay=collectorObservedAt===undefined?null:aShareCalendarDate(collectorObservedAt);
 let lastDate=null;
 for(const row of rows){
  if(!row||row.code!==expected||!day(row.date)||seen.has(row.date)||
     (row.adjustflag!==undefined&&row.adjustflag!=='3')||
     !['0','1'].includes(row.tradestatus)||
     (capturedDay!==null&&row.date>capturedDay)||row.date>observedDay||
     (lastDate!==null&&row.date<=lastDate))
   throw Error('BaoStock停牌源代码、状态、复权、日期或来源顺序无效');
  seen.add(row.date);lastDate=row.date;
  if(row.tradestatus==='0'&&collectorObservedAt===undefined)
   throw Error('BaoStock停牌记录缺少原始采集时间，不能当作已验证停牌证据');
  const finality=assessDailyBarFinality(row.date,{observedAt:collectorObservedAt,now});
  if(!finality.usable)throw Error('BaoStock逐日状态完成度: '+finality.reason);
  if(row.tradestatus==='1'){
   tradingRows.push(row);continue;
  }
  if(!zeroOrBlank(row.volume)||!zeroOrBlank(row.amount))
   throw Error('BaoStock声明停牌但成交股数或成交金额不为零');
  suspensions.push({
   symbol:code,date:row.date,source:'baostock',
   observedAt:collectorObservedAt,providerStatus:'suspended',
   sourceAuthenticated:false,exchangeVerified:false
  });
 }
 return {tradingRows,suspensions,rawFingerprint:hash({code,rows}),
  source:'baostock',sourceAuthenticated:false,canTrade:false};
}
function unavailable(reason,stockCount){
 return {schemaVersion:1,mode:'a-share-open-session-coverage-audit',
  status:'calendar-unavailable',reason:String(reason||'无法读取研究日历').slice(0,180),
  observedAt:null,calendarFingerprint:null,calendarSource:null,
  bySymbol:[],stocks:stockCount,coveredTradingDays:0,
  expectedTradingDays:null,coveredByBarDays:0,coveredByProviderHaltDays:0,openSessionCoveragePct:null,coverageScope:null,sourceObservationKnown:null,
  unexplainedOpenDayGaps:null,providerDeclaredSuspensionDays:null,
  holidayBars:null,unverifiedZeroVolumeBars:null,
  completeByProviderEvidence:false,sourceAuthenticated:false,
  exchangeVerified:false,corporateActionsVerified:false,
  pointInTimeBacktestReady:false,canTrade:false,canNotify:false,releaseReady:false};
}
/**
 * The comparison is made at audit time, NOT at the historical simulation date.
 * The bundled calendar's firstObservedAt is enforced by readResearchCalendar,
 * so a calendar discovered later can never masquerade as past knowledge.
 */
function auditDailySessionCoverage(history,{
 now=Date.now(),calendarFile,suspensions=[],expectedWindow
}={}){
 validateDataset(history);
 if(history.source!=='imported'||!validClock(now)||
    !Array.isArray(suspensions)||suspensions.length>2000)
  throw Error('交易日覆盖审计仅接受合法的导入历史与明确的停牌证据');
 const observedDay=aShareCalendarDate(now);
 if(history.asOf>observedDay)throw Error('历史日期位于本次研究检查时点之后');
 if(history.observedAt!==undefined&&(!validClock(history.observedAt)||history.observedAt>now))
  throw Error('历史原始采集时点无效');
 for(const stock of history.stocks){
  for(const field of ['code','symbol'])if(stock[field]!==undefined&&
     (typeof stock[field]!=='string'||!/^\d{6}$/.test(stock[field])))throw Error('历史证券身份须为六位字符串');
  const finality=assessDailyBarFinality(stock.bars.at(-1).date,{observedAt:history.observedAt??now,now});
  if(!finality.usable)throw Error('历史日K完成度: '+finality.reason);
 }
 if(expectedWindow!==undefined&&(!expectedWindow||typeof expectedWindow!=='object'||Array.isArray(expectedWindow)||
    Object.keys(expectedWindow).sort().join(',')!=='from,to'||!day(expectedWindow.from)||!day(expectedWindow.to)||
    expectedWindow.from>expectedWindow.to||expectedWindow.to>history.asOf||
    history.stocks.some(s=>s.bars[0].date<expectedWindow.from||s.bars.at(-1).date>expectedWindow.to)))
  throw Error('明确历史请求窗口无效或不包含实际K线');
 const calendarByStock=[],suspensionsBySymbol=new Map(),used=new Set(),calendarSources=new Set();
 for(const entry of suspensions){
  const sym=entry?.symbol,d=entry?.date;
  if(!day(d)||typeof sym!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(sym)||
     !history.stocks.some(s=>(s.code||s.symbol)===sym)||
     entry.source!=='baostock'||entry.providerStatus!=='suspended'||
     !validClock(entry.observedAt)||entry.observedAt>now||
     d>aShareCalendarDate(entry.observedAt)||used.has(sym+':'+d)||
     !zeroOrBlank(entry.volume)||!zeroOrBlank(entry.amount)||
     (entry.sourceAuthenticated!=null&&entry.sourceAuthenticated!==false)||
     (entry.exchangeVerified!=null&&entry.exchangeVerified!==false))
   throw Error('停牌原始证据日期、股票、身份、时点、重复项无效');
  // Imported halt claims must themselves have full-day observation evidence;
  // an audit conducted days later cannot upgrade an intraday status to a daily halt.
  const finality=assessDailyBarFinality(d,{observedAt:entry.observedAt,now});
  if(!finality.usable)throw Error('停牌逐日状态完成度: '+finality.reason);
  used.add(sym+':'+d);
  if(!suspensionsBySymbol.has(sym))suspensionsBySymbol.set(sym,new Map());
  suspensionsBySymbol.get(sym).set(d,entry);
 }
 let missingTotal=0,declaredTotal=0,holidayTotal=0,zeroTotal=0,covered=0,expectedTotal=0,barCovered=0,haltCovered=0,unknownSpan=false;
 for(const stock of history.stocks){
  const symbol=String(stock.symbol||stock.code);
  const cal=readResearchCalendar({asOf:now,symbol,...(calendarFile===undefined?{}:{calendarFile})});
  if(cal.status!=='available')return unavailable(cal.reason,history.stocks.length);
  const dates=stock.bars.map(x=>x.date),first=dates[0],last=dates.at(-1);
  const windowFrom=expectedWindow?.from??first,windowTo=expectedWindow?.to??last;
  const inRange=windowFrom>=cal.calendar.from&&windowTo<=cal.calendar.to;
  calendarSources.add(cal.metadata.source);
  const availableDates=new Set(cal.tradeDates);
  const barred=new Set(dates),halted=suspensionsBySymbol.get(symbol)||new Map();
  const holidays=dates.filter(d=>d>=cal.calendar.from&&d<=cal.calendar.to&&!availableDates.has(d));
  const expected=inRange?cal.tradeDates.filter(d=>d>=windowFrom&&d<=windowTo):[];
  if(inRange&&expected.includes(observedDay)&&!assessDailyBarFinality(observedDay,{observedAt:now,now}).usable)
   throw Error('历史请求窗口包含尚未完成的当日交易日');
  const missing=expected.filter(d=>!barred.has(d));
  const declared=[],unexplained=[];
  for(const d of missing)(halted.has(d)?declared:unexplained).push(d);
  const contradiction=[...halted.keys()].filter(d=>barred.has(d)||!availableDates.has(d));
  const zeroBars=stock.bars.filter(x=>x.volume===0).map(x=>x.date);
  const unexplainedActiveRows=stock.bars.filter(x=>x.suspended===true&&(x.volume>0||x.amount>0)).map(x=>x.date);
  const malformedHaltFlags=stock.bars.filter(x=>x.suspended!=null&&typeof x.suspended!=='boolean').map(x=>x.date);
  const turnoverContradictions=stock.bars.filter(x=>x.amount!=null&&((x.volume===0)!==(x.amount===0))).map(x=>x.date);
  const outsideCalendar=dates.filter(d=>d<cal.calendar.from||d>cal.calendar.to);
  const beyondSpan=[...halted.keys()].filter(d=>d<first||d>last);
  const outsideWindow=[...halted.keys()].filter(d=>d<windowFrom||d>windowTo);
  const invalidBars=new Set([...holidays,...contradiction,...zeroBars,...unexplainedActiveRows,...malformedHaltFlags,...turnoverContradictions]);
  const barDays=inRange?expected.filter(d=>barred.has(d)&&!invalidBars.has(d)).length:0;
  const haltDays=inRange?declared.length:0;
  missingTotal+=unexplained.length;declaredTotal+=declared.length;
  holidayTotal+=holidays.length;zeroTotal+=zeroBars.length;
  covered+=barDays+haltDays;barCovered+=barDays;haltCovered+=haltDays;
  expectedTotal+=expected.length;unknownSpan ||= !inRange;
  calendarByStock.push({
   symbol,exchange:cal.calendar.exchange,span:{first,last},
   totalBars:stock.bars.length,
   auditWindow:{from:windowFrom,to:windowTo,basis:expectedWindow?'explicit-request-window':'observed-bar-span-only'},
   calendarOpenSessionsInSpan:inRange?cal.tradeDates.filter(d=>d>=first&&d<=last).length:null,
   expectedOpenSessions:inRange?expected.length:null,
   coveredByBarDays:inRange?barDays:null,coveredByProviderHaltDays:inRange?haltDays:null,
   coveredOpenSessions:inRange?barDays+haltDays:null,
   openSessionCoveragePct:inRange&&expected.length?Number((100*(barDays+haltDays)/expected.length).toFixed(4)):null,
   missingOpenSessions:missing.length,
   providerDeclaredSuspensionDays:declared,
   unexplainedMissingOpenDays:unexplained,
   holidayOrClosedSessionBars:holidays,
   suspensionContradictions:contradiction,
   rawSuspensionEvidenceOutsideSpan:beyondSpan,
   rawSuspensionEvidenceOutsideAuditWindow:outsideWindow,
   zeroVolumeBarsNotProofOfSuspension:zeroBars,
   declaredSuspendedWithTrades:unexplainedActiveRows,
   malformedHaltFlags,turnoverContradictions,
   outsideCalendarCoverage:outsideCalendar,
   // Existing per-stock declaration is NOT external authenticated evidence.
   corporateActionsProviderClaimed:stock.corporateActionsVerified===true,
   corporateActionsExternallyVerified:false,
   calendarFingerprint:cal.metadata.sha256,
   calendarFirstObservedAt:cal.metadata.observedAt
  });
 }
 const conflicts=calendarByStock.some(s=>
  s.holidayOrClosedSessionBars.length||s.suspensionContradictions.length||
  s.declaredSuspendedWithTrades.length||s.malformedHaltFlags.length||s.turnoverContradictions.length);
 const unsupported=unknownSpan;
 const incomplete=missingTotal>0||zeroTotal>0;
 const status=unsupported?'outside-calendar-coverage':conflicts?
  'source-calendar-conflict':incomplete?'unexplained-or-zero-volume-gaps':
  declaredTotal?'provider-declared-halts-unverified':'open-session-shape-consistent-unverified';
 const complete=!conflicts&&!unsupported&&!incomplete;
 return {schemaVersion:1,mode:'a-share-open-session-coverage-audit',
  status,observedAt:new Date(now).toISOString(),
  calendarSources:[...calendarSources].sort(),
  calendarFingerprints:[...new Set(calendarByStock.map(s=>s.calendarFingerprint))],
  stocks:calendarByStock.length,coveredTradingDays:covered,
  expectedTradingDays:unknownSpan?null:expectedTotal,
  coveredByBarDays:barCovered,coveredByProviderHaltDays:haltCovered,
  openSessionCoveragePct:!unknownSpan&&expectedTotal?Number((100*covered/expectedTotal).toFixed(4)):null,
  coverageScope:expectedWindow?'explicit-request-window':'observed-bar-span-only',
  sourceObservationKnown:history.observedAt!==undefined,
  unexplainedOpenDayGaps:missingTotal,providerDeclaredSuspensionDays:declaredTotal,
  holidayBars:holidayTotal,unverifiedZeroVolumeBars:zeroTotal,
  bySymbol:calendarByStock,completeByProviderEvidence:complete,
  // Calendar is recorded at audit time. It is NOT historic exchange attestation.
  sourceAuthenticated:false,exchangeVerified:false,corporateActionsVerified:false,
  pointInTimeBacktestReady:false,canTrade:false,canNotify:false,releaseReady:false,
  warning:'仅审计逐股交易日日期形状。官方日历来源仍为首次观察后取得的研究证据；BaoStock停牌标志为供应商自报，未由交易所核验。休市、停牌、缺数据不得相互代替。'};
}
module.exports={partitionBaoStockRows,auditDailySessionCoverage};
