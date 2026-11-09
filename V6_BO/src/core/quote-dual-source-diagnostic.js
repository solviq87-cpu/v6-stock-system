'use strict';
/**
 * Bounded public quote diagnostics; two independently timestamped observations
 * must agree before being described as consistent.  Never certifies licensing,
 * exchange authenticity, exchange calendar or actual tradability.
 */
const {probePublicQuotes,projectProbe}=require('./public-quote-probe');
function session(now){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('无效检查时间');
 const d=new Date(now+8*3600000),day=d.getUTCDay();
 const minute=d.getUTCHours()*60+d.getUTCMinutes();
 return day>=1&&day<=5&&
  ((minute>=570&&minute<690)||(minute>=780&&minute<900));
}
const finite=x=>typeof x==='number'&&Number.isFinite(x);
async function checkTwoPublicSources({code,now=Date.now(),probe=probePublicQuotes}={}){
 if(typeof code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(code))
  throw Error('证券代码格式不合法');
 if(typeof probe!=='function')throw Error('探测器无效');
 const base={schemaVersion:1,mode:'two-source-public-quote-diagnostic',
  code,asOf:new Date(now).toISOString(),source1:'tencent',source2:'eastmoney',
  providerLicensed:false,exchangeVerified:false,calendarVerified:false,
  certifiedLive:false,canTrade:false,canNotify:false};
 if(!session(now))return {...base,status:'outside-weekday-session-window',
  discrepancyBps:null,quoteAt:null,sourceStatuses:[],
  note:'未处于中国大陆常规工作日连续竞价时段；节假日未认证，不进行联网探测。'};
 const raw=await probe({code,providers:['tencent','eastmoney']});
 const projected=projectProbe(raw,now);
 const sources=projected.sources||[];
 const entries=['tencent','eastmoney'].map(id=>sources.find(s=>s.id===id));
 const sourceStatuses=entries.map((s,i)=>({provider:['tencent','eastmoney'][i],
  status:s?.status||'unavailable',quoteAt:s?.quote?.quoteAt||null}));
 const ready=entries.every(e=>e?.status==='fresh-unverified'&&e.quote&&
  finite(e.quote.price)&&e.quote.price>0&&Number.isSafeInteger(e.quote.quoteAt)&&
  e.quote.quoteAt<=now&&now-e.quote.quoteAt<=15000);
 if(!ready)return {...base,status:'insufficient-fresh-sources',
  discrepancyBps:null,quoteAt:null,sourceStatuses,
  note:'公开源不稳定、停牌或时间失效时不补虚构实时报价。'};
 const [a,b]=entries.map(e=>e.quote);
 const difference=10000*Math.abs(a.price-b.price)/Math.max(a.price,b.price);
 const timeGap=Math.abs(a.quoteAt-b.quoteAt);
 const conflicting=difference>50||timeGap>15000;
 return {...base,status:conflicting?'source-conflict':'sources-agree-unverified',
  discrepancyBps:Number(difference.toFixed(2)),
  quoteAt:Math.min(a.quoteAt,b.quoteAt),
  quoteTimeGapMs:timeGap,sourceStatuses,
  note:'双源与原始时点对照仅证明当次观测一致，不证明交易所授权、节假日状态、商业展示许可或稳定实时采集。'};
}
module.exports={session,checkTwoPublicSources};
