'use strict';
// Eastmoney's f124 is a provider-reported quote time (Unix seconds).
// Request/retrieval time is NEVER a replacement for a missing quote time.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CHINA_OFFSET_MS=8*3600000;
const chinaDay=ms=>new Date(ms+CHINA_OFFSET_MS).toISOString().slice(0,10);
const validClock=t=>Number.isSafeInteger(t)&&t>0&&t<=8e15;
const validAge=ms=>Number.isSafeInteger(ms)&&ms>=1000&&ms<=300000;
function captureTime(raw){
 if(typeof raw!=='string')return null;
 const t=Date.parse(raw);
 return validClock(t)&&new Date(t).toISOString()===raw?t:null;
}
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
/**
 * Clock-only A-share market window hint, never an exchange trading calendar.
 * A weekday holiday can fall in a nominal continuous trading window.
 * Market-window hints never certify live data or authorize orders.
 */
function chinaMarketWindowHint(now){
 if(!Number.isSafeInteger(now)||now<=0||!Number.isFinite(now+CHINA_OFFSET_MS))
  throw Error('行情交易时段提示时钟无效');
 const china=new Date(now+CHINA_OFFSET_MS);
 if(!Number.isFinite(china.getTime()))throw Error('行情交易时段提示时钟无效');
 const weekday=china.getUTCDay(),minute=china.getUTCHours()*60+china.getUTCMinutes();
 let window;
 if(weekday===0||weekday===6)window='weekend';
 else if(minute<9*60+15)window='pre-market';
 else if(minute<9*60+30)window='pre-open-or-auction-window';
 else if(minute<11*60+30)window='morning-continuous-window';
 else if(minute<13*60)window='lunch-break';
 else if(minute<14*60+57)window='afternoon-continuous-window';
 else if(minute<15*60)window='closing-auction-window';
 else window='post-market';
 return {window,
  continuousTradingWindowHint:window==='morning-continuous-window'||window==='afternoon-continuous-window',
  exchangeCalendarVerified:false,canTrade:false};
}
function sourceQuoteTimeSeconds(raw){
 let n;
 if(typeof raw==='number')n=raw;
 else if(typeof raw==='string'&&/^\d{10}$/.test(raw))n=Number(raw);
 else return null;
 // A ten-digit Unix second value; not a raw millisecond value or loose Number cast.
 if(!Number.isSafeInteger(n)||n<946684800||n>=4102444800)return null;
 return n*1000;
}
function snapshotCaptureWindow(snapshot){
 const originalRetrievedAt=captureTime(snapshot?.retrievedAt),startedAt=captureTime(snapshot?.startedAt);
 // An absent legacy start is distinct from explicitly invalid or reversed acquisition evidence.
 const invalidStart=snapshot?.startedAt!==undefined&&(startedAt===null||
   originalRetrievedAt!==null&&startedAt>originalRetrievedAt);
 return {originalRetrievedAt,startedAt,invalidStart};
}
function classifyQuoteTime(stock,{requestDate,retrievedAt,originalRetrievedAt=retrievedAt,maxAgeMs=90000,invalidStart=false}={}){
 if(!validClock(retrievedAt)||
    !validAge(maxAgeMs))
  throw Error('报价时效评价时钟或阈值无效');
 const at=stock?.vendorQuoteAt;
 const base={quoteAt:null,quoteDate:null,quoteAgeMs:null,
   quoteTimeStatus:'unknown',sourceTimeVerified:false,exchangeVerified:false,canTrade:false};
 if(!Number.isSafeInteger(at)||at<946684800000||at>=4102444800000)return base;
 if(!dateOK(requestDate))return {...base,quoteTimeStatus:'request-date-invalid'};
 const quotedDate=chinaDay(at),age=retrievedAt-at;
 const result={...base,quoteAt:at,quoteDate:quotedDate,quoteAgeMs:age};
 // A later read cannot repair future-at-receipt evidence or expose an
 // as-yet unreceived snapshot. Do not replace an unknown receipt with now.
 if(!validClock(originalRetrievedAt))return {...result,quoteTimeStatus:'receipt-time-unknown'};
 if(originalRetrievedAt>retrievedAt)return {...result,quoteTimeStatus:'snapshot-not-yet-observed'};
 if(age<0||at>originalRetrievedAt)return {...result,quoteTimeStatus:'future'};
 // A short age cannot renew yesterday's quote after the China-local date changes.
 if(quotedDate!==requestDate||chinaDay(originalRetrievedAt)!==requestDate||chinaDay(retrievedAt)!==requestDate)return {...result,quoteTimeStatus:'historical-snapshot'};
 if(age>maxAgeMs)return {...result,quoteTimeStatus:'stale-source-time'};
 if(invalidStart)return {...result,quoteTimeStatus:'invalid-capture-window'};
 return {...result,quoteTimeStatus:'recent-source-unverified'};
}
function auditSnapshotQuoteTimes(snapshot,{asOf,maxAgeMs=90000}={}){
 const {originalRetrievedAt,invalidStart}=snapshotCaptureWindow(snapshot),t=asOf??originalRetrievedAt;
 if(!validClock(t)||!validAge(maxAgeMs))throw Error('行情采样完成时钟或阈值无效');
 const rows=Array.isArray(snapshot?.stocks)?snapshot.stocks:[];
 const marketWindow=chinaMarketWindowHint(t);
 const states={},symbolCounts=new Map();
 // A duplicated security is ambiguous evidence, not two fresh observations.
 for(const stock of rows)if(typeof stock?.code==='string'&&/^\d{6}$/.test(stock.code))
  symbolCounts.set(stock.code,(symbolCounts.get(stock.code)||0)+1);
 for(const stock of rows){
  const state=symbolCounts.get(stock?.code)>1?'duplicate-symbol':classifyQuoteTime(stock,{requestDate:snapshot?.date,retrievedAt:t,originalRetrievedAt,maxAgeMs,invalidStart}).quoteTimeStatus;
  states[state]=(states[state]||0)+1;
 }
 return {mode:'market-quote-time-audit',asOf:new Date(t).toISOString(),
  requestDate:snapshot?.date||null,source:snapshot?.source||null,
  originalRetrievedAt,receiptTimeStatus:originalRetrievedAt===null?'unknown':originalRetrievedAt>t?'not-yet-observed':invalidStart?'invalid-capture-window':'observed-unverified',
  providerQuoteField:'f124',total:rows.length,counts:states,
  recentSourceTimeCount:states['recent-source-unverified']||0,
  unknownSourceTimeCount:states.unknown||0,
  marketWindowHint:marketWindow.window,
  continuousTradingWindowHint:marketWindow.continuousTradingWindowHint,
  exchangeCalendarVerified:false,
  quoteTimeVerified:false,exchangeVerified:false,canTrade:false,
  warning:'f124是供应商自报的报价时点，未经交易所认证；请求日期不等于逐股报价日期。交易时段仅为北京时间工作日时间窗提示，不识别法定休市日。'};
}
module.exports={sourceQuoteTimeSeconds,classifyQuoteTime,auditSnapshotQuoteTimes,chinaMarketWindowHint,snapshotCaptureWindow};
