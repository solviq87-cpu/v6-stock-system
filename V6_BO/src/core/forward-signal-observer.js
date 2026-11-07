'use strict';
// Research price observations, independent of strategy rules and execution ledgers.
const crypto=require('node:crypto');
const HORIZONS=[1,5,20,60],hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x),text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
function date(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('日期无效');return d;}
const cutoff=d=>Date.parse(date(d)+'T16:00:00+08:00');
function contract(f){if(!f||!['imported','fixture','simulated'].includes(f.source)||!text(f.provider)||!text(f.datasetId)||f.priceBasis!=='unadjusted')throw Error('需要同来源未复权证据协议');return {source:f.source,provider:f.provider,datasetId:f.datasetId,priceBasis:f.priceBasis};}
function freezeCohort(input,{now=Date.now()}={}){
 if(!finite(now)||now<=0)throw Error('冻结时钟无效');
 if(!input||input.schemaVersion!==1||!Array.isArray(input.signals)||!input.signals.length||input.signals.length>500)throw Error('需要1至500条独立信号');
 const feed=contract(input.feed),ids=new Set();const signals=input.signals.map(s=>{
 if(!s||!text(s.signalId)||ids.has(s.signalId)||!/^\d{6}$/.test(s.symbol)||!['fourteen','bazi','gpt','python','manual'].includes(s.system)||!text(s.cohort)||!text(s.provenance)||!finite(s.signalAt)||s.signalAt<cutoff(s.signalDate)||s.signalAt>now||!finite(s.baselineClose)||s.baselineClose<=0)throw Error('信号ID/时间/来源或基准收盘无效');ids.add(s.signalId);
 return {signalId:s.signalId,symbol:s.symbol,system:s.system,cohort:s.cohort,provenance:s.provenance,signalDate:s.signalDate,signalAt:s.signalAt,baselineClose:s.baselineClose};});
 const payload={schemaVersion:1,mode:'frozen-forward-signal-cohort',feed,signals,frozenAt:now,canTrade:false,prospectiveCertified:false};return {...payload,fingerprint:hash(payload)};
}
function verifyCohort(cohort,now){const {fingerprint,...payload}=cohort||{};if(fingerprint!==hash(payload)||payload.mode!=='frozen-forward-signal-cohort'||!finite(payload.frozenAt)||payload.frozenAt>now||payload.canTrade!==false||payload.prospectiveCertified!==false)throw Error('冻结信号指纹或时点不符');const again=freezeCohort({schemaVersion:1,feed:payload.feed,signals:payload.signals},{now:payload.frozenAt});if(hash(again)!==hash(cohort))throw Error('冻结信号结构不符');return payload;}
function evaluateForward(cohort,market,{now=Date.now()}={}){
 if(!finite(now)||now<=0)throw Error('观察时钟无效');
 const frozen=verifyCohort(cohort,now);if(!market||market.schemaVersion!==1||hash(contract(market.feed))!==hash(frozen.feed)||!finite(market.observedAt)||market.observedAt>now||market.observedAt<cutoff(market.asOf))throw Error('观察快照来源或收盘截止时点无效');
 const calendar=market.calendar;if(!Array.isArray(calendar)||!calendar.length||calendar.length>10000)throw Error('需要显式交易日历');calendar.forEach((d,i)=>{date(d);if(i&&d<=calendar[i-1])throw Error('交易日历重复或乱序');});
 const calendarSet=new Set(calendar);if(!calendarSet.has(market.asOf))throw Error('截至日不在交易日历');
 if(!Array.isArray(market.stocks)||!market.stocks.length||market.stocks.length>500)throw Error('股票池无效');const stocks=new Map();
 for(const s of market.stocks){if(!s||!/^\d{6}$/.test(s.symbol)||stocks.has(s.symbol)||!Array.isArray(s.bars)||s.bars.length>10000||!Array.isArray(s.corporateActions))throw Error('股票/价格/公司行为说明无效');const bars=new Map();let previous='';for(const b of s.bars){date(b.date);if(b.date<=previous||b.date>market.asOf||!calendarSet.has(b.date)||b.close!==null&&(!finite(b.close)||b.close<=0)||!Number.isSafeInteger(b.volume)||b.volume<0||typeof b.suspended!=='boolean')throw Error('价格日期/数值或未来数据无效');previous=b.date;bars.set(b.date,b);}for(const d of s.corporateActions){date(d);if(!calendarSet.has(d)||d>market.asOf)throw Error('公司行为日期无效');}stocks.set(s.symbol,{bars,actions:s.corporateActions});}
 const records=frozen.signals.map(s=>{const i=calendar.indexOf(s.signalDate),stock=stocks.get(s.symbol),base=stock?.bars.get(s.signalDate);if(i<0||s.signalAt>market.observedAt||!base||base.close!==s.baselineClose||base.suspended||base.volume<=0)throw Error('信号缺基准或冻结基准价格变化');
 const windows=HORIZONS.map(h=>{const targetDate=calendar[i+h]||null;const out={tradingDays:h,targetDate,status:'pending',priceReturnPct:null};if(!targetDate){out.status='calendar-incomplete';return out;}if(targetDate>market.asOf)return out;if(stock.actions.some(d=>d>s.signalDate&&d<=targetDate)){out.status='corporate-action-unresolved';return out;}const b=stock.bars.get(targetDate);if(!b||b.close===null||b.suspended||b.volume<=0){out.status='missing-or-suspended';return out;}out.status='observed';out.priceReturnPct=(b.close/s.baselineClose-1)*100;return out;});
 return {signalId:s.signalId,symbol:s.symbol,system:s.system,cohort:s.cohort,signalDate:s.signalDate,signalAt:s.signalAt,baselineClose:s.baselineClose,windows};});
 const groups=[...new Set(records.map(r=>JSON.stringify([r.system,r.cohort])))].map(key=>{const [system,cohort]=JSON.parse(key),members=records.filter(r=>r.system===system&&r.cohort===cohort);return {system,cohort,signalCount:members.length,windows:HORIZONS.map((h,i)=>{const observed=members.map(r=>r.windows[i]).filter(w=>w.status==='observed');return {tradingDays:h,observedCount:observed.length,unobservedCount:members.length-observed.length,meanPriceReturnPct:observed.length?observed.reduce((v,w)=>v+w.priceReturnPct,0)/observed.length:null};})};});
 return {schemaVersion:1,mode:'forward-signal-price-observation',asOf:market.asOf,observedAt:market.observedAt,cohortFingerprint:cohort.fingerprint,marketFingerprint:hash(market),feed:frozen.feed,canTrade:false,verifiedLive:false,prospectiveCertified:false,executionSimulated:false,returnBasis:'signal-day-close-to-future-session-close-unadjusted-gross',records,groups,warning:'仅冻结信号后的价格观察，非T+1成交、净收益或概率。未独立认证信号当时已产生、交易日历或供应商。公司行为区间不计算。'};
}
module.exports={freezeCohort,evaluateForward,HORIZONS};
