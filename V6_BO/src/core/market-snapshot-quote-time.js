'use strict';
// Eastmoney's f124 is a provider-reported quote time (Unix seconds).
// Request/retrieval time is NEVER a replacement for a missing quote time.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const chinaDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
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
  quoteTimeVerified:false,exchangeVerified:false,canTrade:false,
  warning:'f124是供应商自报的报价时点，未经交易所认证；请求日期不等于逐股报价日期。'};
}
module.exports={sourceQuoteTimeSeconds,classifyQuoteTime,auditSnapshotQuoteTimes};
