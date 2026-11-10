'use strict';
// Eastmoney's f124 is a provider-reported quote time (Unix seconds).
// Request/retrieval time is NEVER a replacement for a missing quote time.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CHINA_OFFSET_MS=8*3600000;
const chinaDay=ms=>new Date(ms+CHINA_OFFSET_MS).toISOString().slice(0,10);
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
 else if(minute<15*60)window='afternoon-continuous-window';
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
function classifyQuoteTime(stock,{requestDate,retrievedAt,maxAgeMs=90000}={}){
 if(!Number.isSafeInteger(retrievedAt)||retrievedAt<=0||
    !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>300000)
  throw Error('报价时效评价时钟或阈值无效');
 const at=stock?.vendorQuoteAt;
 const base={quoteAt:null,quoteDate:null,quoteAgeMs:null,
   quoteTimeStatus:'unknown',sourceTimeVerified:false,exchangeVerified:false,canTrade:false};
 if(!Number.isSafeInteger(at)||at<946684800000||at>=4102444800000)return base;
 if(!dateOK(requestDate))return {...base,quoteTimeStatus:'request-date-invalid'};
 const quotedDate=chinaDay(at),age=retrievedAt-at;
 const result={...base,quoteAt:at,quoteDate:quotedDate,quoteAgeMs:age};
 if(age<0)return {...result,quoteTimeStatus:'future'};
 if(quotedDate!==requestDate)return {...result,quoteTimeStatus:'historical-snapshot'};
 if(age>maxAgeMs)return {...result,quoteTimeStatus:'stale-source-time'};
 return {...result,quoteTimeStatus:'recent-source-unverified'};
}
function auditSnapshotQuoteTimes(snapshot,{asOf,maxAgeMs=90000}={}){
 const t=asOf??Date.parse(snapshot?.retrievedAt||'');
 if(!Number.isSafeInteger(t)||t<=0)throw Error('行情采样完成时钟缺失');
 const rows=Array.isArray(snapshot?.stocks)?snapshot.stocks:[];
 const marketWindow=chinaMarketWindowHint(t);
 const states={};
 for(const stock of rows){
  const state=classifyQuoteTime(stock,{requestDate:snapshot?.date,retrievedAt:t,maxAgeMs}).quoteTimeStatus;
  states[state]=(states[state]||0)+1;
 }
 return {mode:'market-quote-time-audit',asOf:new Date(t).toISOString(),
  requestDate:snapshot?.date||null,source:snapshot?.source||null,
  providerQuoteField:'f124',total:rows.length,counts:states,
  recentSourceTimeCount:states['recent-source-unverified']||0,
  unknownSourceTimeCount:states.unknown||0,
  marketWindowHint:marketWindow.window,
  continuousTradingWindowHint:marketWindow.continuousTradingWindowHint,
  exchangeCalendarVerified:false,
  quoteTimeVerified:false,exchangeVerified:false,canTrade:false,
  warning:'f124是供应商自报的报价时点，未经交易所认证；请求日期不等于逐股报价日期。交易时段仅为北京时间工作日时间窗提示，不识别法定休市日。'};
}
module.exports={sourceQuoteTimeSeconds,classifyQuoteTime,auditSnapshotQuoteTimes,chinaMarketWindowHint};
