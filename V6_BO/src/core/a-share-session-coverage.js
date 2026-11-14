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
const {aShareCalendarDate}=require('./a-share-calendar');
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
    !Number.isSafeInteger(now)||now<=0||
    (collectorObservedAt!==undefined&&(!Number.isSafeInteger(collectorObservedAt)||
      collectorObservedAt<=0||collectorObservedAt>now)))
  throw Error('BaoStock停牌状态原始证据、采集时钟或大小无效');
 const seen=new Set(),tradingRows=[],suspensions=[];
 const capturedDay=collectorObservedAt===undefined?null:aShareCalendarDate(collectorObservedAt);
 for(const row of rows){
  if(!row||row.code!==expected||!day(row.date)||seen.has(row.date)||
     (row.adjustflag!==undefined&&row.adjustflag!=='3')||
     !['0','1'].includes(row.tradestatus)||
     (capturedDay!==null&&row.date>capturedDay))
   throw Error('BaoStock停牌源代码、状态、复权、日期或来源顺序无效');
  seen.add(row.date);
  if(row.tradestatus==='1'){
   tradingRows.push(row);continue;
  }
  if(collectorObservedAt===undefined)
   throw Error('BaoStock停牌记录缺少原始采集时间，不能当作已验证停牌证据');
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
 now=Date.now(),calendarFile,suspensions=[]
}={}){
 const ds=validateDataset(history);
 if(history.source!=='imported'||!Number.isSafeInteger(now)||now<=0||
    !Array.isArray(suspensions)||suspensions.length>2000)
  throw Error('交易日覆盖审计仅接受合法的导入历史与明确的停牌证据');
 const observedDay=aShareCalendarDate(now);
 if(history.asOf>observedDay)throw Error('历史日期位于本次研究检查时点之后');
 const calendarByStock=[],suspensionsBySymbol=new Map(),used=new Set();
 for(const entry of suspensions){
  const sym=entry?.symbol,d=entry?.date;
  if(!day(d)||typeof sym!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(sym)||
     !ds.stocks||!history.stocks.some(s=>(s.code||s.symbol)===sym)||
     entry.source!=='baostock'||entry.providerStatus!=='suspended'||
     !Number.isSafeInteger(entry.observedAt)||entry.observedAt<=0||entry.observedAt>now||
     d>aShareCalendarDate(entry.observedAt)||used.has(sym+':'+d))
   throw Error('停牌原始证据日期、股票、身份、时点、重复项无效');
  used.add(sym+':'+d);
  if(!suspensionsBySymbol.has(sym))suspensionsBySymbol.set(sym,new Map());
  suspensionsBySymbol.get(sym).set(d,entry);
 }
 let missingTotal=0,declaredTotal=0,holidayTotal=0,zeroTotal=0,covered=0,unknownSpan=false;
 for(const stock of history.stocks){
  const symbol=String(stock.symbol||stock.code);
  const cal=readResearchCalendar({asOf:now,symbol,...(calendarFile===undefined?{}:{calendarFile})});
  if(cal.status!=='available')return unavailable(cal.reason,history.stocks.length);
  const dates=stock.bars.map(x=>x.date),first=dates[0],last=dates.at(-1);
  const inRange=first>=cal.calendar.from&&last<=cal.calendar.to;
  const availableDates=new Set(cal.tradeDates);
  const barred=new Set(dates),halted=suspensionsBySymbol.get(symbol)||new Map();
  const holidays=dates.filter(d=>!availableDates.has(d));
  const missing=inRange?cal.tradeDates.filter(d=>d>=first&&d<=last&&!barred.has(d)):[];
  const declared=[],unexplained=[];
  for(const d of missing)(halted.has(d)?declared:unexplained).push(d);
  const contradiction=[...halted.keys()].filter(d=>barred.has(d)||!availableDates.has(d));
  const zeroBars=stock.bars.filter(x=>x.volume===0).map(x=>x.date);
  const unexplainedActiveRows=stock.bars.filter(x=>x.suspended===true&&x.volume>0).map(x=>x.date);
  const outsideCalendar=dates.filter(d=>d<cal.calendar.from||d>cal.calendar.to);
  const beyondSpan=[...halted.keys()].filter(d=>d<first||d>last);
  if(holidays.length||unexplained.length||declared.length||zeroBars.length||
     contradiction.length||outsideCalendar.length||unexplainedActiveRows.length){
    // Inspectable audit findings; no guessed closure or fake substitute bar.
  }
  missingTotal+=unexplained.length;declaredTotal+=declared.length;
  holidayTotal+=holidays.length;zeroTotal+=zeroBars.length;
  covered+=missing.length+dates.length;unknownSpan ||= !inRange;
  calendarByStock.push({
   symbol,exchange:cal.calendar.exchange,span:{first,last},
   totalBars:stock.bars.length,
   calendarOpenSessionsInSpan:inRange?missing.length+dates.length-holidays.length:null,
   missingOpenSessions:missing.length,
   providerDeclaredSuspensionDays:declared,
   unexplainedMissingOpenDays:unexplained,
   holidayOrClosedSessionBars:holidays,
   suspensionContradictions:contradiction,
   rawSuspensionEvidenceOutsideSpan:beyondSpan,
   zeroVolumeBarsNotProofOfSuspension:zeroBars,
   declaredSuspendedWithTrades:unexplainedActiveRows,
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
  s.declaredSuspendedWithTrades.length);
 const unsupported=unknownSpan;
 const incomplete=missingTotal>0||zeroTotal>0;
 const status=conflicts?'source-calendar-conflict':unsupported?
  'outside-calendar-coverage':incomplete?'unexplained-or-zero-volume-gaps':
  declaredTotal?'provider-declared-halts-unverified':'open-session-shape-consistent-unverified';
 const complete=!conflicts&&!unsupported&&!incomplete;
 return {schemaVersion:1,mode:'a-share-open-session-coverage-audit',
  status,observedAt:new Date(now).toISOString(),
  calendarSource:'operator-bundled-sse-szse-2026-research',
  calendarFingerprints:[...new Set(calendarByStock.map(s=>s.calendarFingerprint))],
  stocks:calendarByStock.length,coveredTradingDays:covered,
  unexplainedOpenDayGaps:missingTotal,providerDeclaredSuspensionDays:declaredTotal,
  holidayBars:holidayTotal,unverifiedZeroVolumeBars:zeroTotal,
  bySymbol:calendarByStock,completeByProviderEvidence:complete,
  // Calendar is recorded at audit time. It is NOT historic exchange attestation.
  sourceAuthenticated:false,exchangeVerified:false,corporateActionsVerified:false,
  pointInTimeBacktestReady:false,canTrade:false,canNotify:false,releaseReady:false,
  warning:'仅审计逐股交易日日期形状。官方日历来源仍为首次观察后取得的研究证据；BaoStock停牌标志为供应商自报，未由交易所核验。休市、停牌、缺数据不得相互代替。'};
}
module.exports={partitionBaoStockRows,auditDailySessionCoverage};
