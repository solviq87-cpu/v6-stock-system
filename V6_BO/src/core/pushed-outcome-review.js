'use strict';
// Descriptive close outcomes only: not signal returns or model-training evidence.
const {projectPushLogDelivery}=require('./notification-delivery-view');
const day=at=>new Date(at+28800000).toISOString().slice(0,10).replace(/-/g,'');
function dateKey(value){
 if(typeof value!=='string'&&!(Number.isSafeInteger(value)&&value>=10000000&&value<=99999999))return null;
 const raw=String(value);if(!/^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(raw))return null;
 const s=raw.replace(/-/g,'');
 const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8),at=Date.parse(iso+'T00:00:00Z');
 return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===iso?s:null;
}
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<8e15;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validPct=n=>finite(n)&&n>=-100;
const direction=pct=>pct>0?'up':pct<0?'down':'flat';
const matchesCode=(x,code)=>['code','symbol'].every(k=>!Object.hasOwn(x,k)||x[k]===code);
const validFinality=x=>!Object.hasOwn(x,'final')||x.final===true;
const validReceipt=(n,closeAt,now)=>validTime(n)&&n>=closeAt&&n<=now;
function limitUpEvidence(bar){
 const values=['isLimitUp','limitUp'].filter(k=>Object.hasOwn(bar,k)).map(k=>bar[k]);
 if(!values.length||values.some(v=>typeof v!=='boolean'||v!==values[0])||values[0]&&bar.pct<=0)return null;
 return values[0]?1:0;
}
function codesOf(extra){
 if(extra&&typeof extra==='object'&&Array.isArray(extra.codes))return extra.codes.filter(x=>typeof x==='string'&&/^\d{6}$/.test(x));
 const match=/['"]codes['"]\s*:\s*\[([^\]]*)\]/.exec(typeof extra==='string'?extra:'');
 return match?match[1].split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,'')).filter(s=>/^\d{6}$/.test(s)):[];
}
function collectAcceptedGroups({date,pushlog,now=Date.now()}){
 const ds=dateKey(date);if(!ds||!validTime(now)||ds>day(now))throw Error('复盘日期无效或晚于当前日期');
 const closeAt=Date.parse(ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8)+'T15:00:00+08:00');
 if(now<closeAt)throw Error('目标交易日尚未收盘，不能生成收盘统计');
 if(!Array.isArray(pushlog))throw Error('缺少推送流水，不能写空学习库');
 const skipped={unconfirmed:0,invalidTime:0,afterClose:0,missingCodes:0,missingOutcome:0,invalidHistory:0,unclosedOutcome:0},groups=new Map();
 for(const entry of pushlog){
  if(!record(entry)||!validTime(entry.ts)){skipped.invalidTime++;continue;}if(day(entry.ts)!==ds)continue;
  if(typeof entry.status!=='string'||(!/^✅ 已送达(?:\(私密\))?$/.test(entry.status)&&entry.status!=='gateway-accepted')||
     projectPushLogDelivery(entry).gatewayAccepted!==true){skipped.unconfirmed++;continue;}
  if(entry.ts>=closeAt){skipped.afterClose++;continue;}
  // pushLog flattens metadata onto the record. Legacy exports nested it in extra.
  // Never resurrect stale nested codes when a newer top-level field is present.
  const codes=[...new Set(codesOf(Object.hasOwn(entry,'codes')?entry:entry.extra))];if(!codes.length){skipped.missingCodes++;continue;}
  for(const code of codes){const meta=groups.get(code)||{firstAcceptedAt:entry.ts,titles:new Set()};
   meta.firstAcceptedAt=Math.min(meta.firstAcceptedAt,entry.ts);if(typeof entry.title==='string')meta.titles.add(entry.title.slice(0,200));groups.set(code,meta);}
 }
 if(!groups.size)throw Error('目标日没有可核对的盘中网关接受记录；保留既有结果');
 return {ds,closeAt,groups,skipped};
}
function reviewPushedOutcomes({date,pushlog,histories,now=Date.now()}){
 const {ds,closeAt,groups,skipped}=collectAcceptedGroups({date,pushlog,now});
 const samples=[];
 for(const [code,meta] of groups){
  const history=histories instanceof Map?histories.get(code):histories?.[code];
  const rows=Array.isArray(history)?history:history?.rows;if(!Array.isArray(rows)){skipped.missingOutcome++;continue;}
  const target=rows.filter(row=>dateKey(row?.date)===ds);
  if(target.length!==1){if(target.length>1)skipped.invalidHistory++;else skipped.missingOutcome++;continue;}
  const bar=target[0];if(!record(bar)||!matchesCode(bar,code)||!matchesCode(history,code)){skipped.invalidHistory++;continue;}
  if(!finite(bar.close)||bar.close<=0||!validPct(bar.pct)){skipped.missingOutcome++;continue;}
  // Legacy cache receipt may supply an omitted per-bar receipt. An explicit
  // unknown or contradictory receipt must not be replaced by a later clock.
  const receivedAt=Object.hasOwn(bar,'receivedAt')?bar.receivedAt:history.receivedAt;
  if(!validFinality(bar)||!validFinality(history)||!validReceipt(receivedAt,closeAt,now)||
     Object.hasOwn(history,'receivedAt')&&!validReceipt(history.receivedAt,closeAt,now)){skipped.unclosedOutcome++;continue;}
  // Conflicting labels remain unknown; do not infer board/IPO limit status.
  const zt=limitUpEvidence(bar);
  samples.push({id:ds+':'+code,ds,code,firstAcceptedAt:meta.firstAcceptedAt,titles:[...meta.titles].sort(),close:bar.close,pct:bar.pct,
   outcome:direction(bar.pct),zt,outcomeTarget:'close-change-vs-previous-close',
   outcomeSource:typeof history.src==='string'&&history.src?history.src:null,outcomeReceivedAt:receivedAt,sourceVerified:false,
   deliveryBasis:'recorded-gateway-acceptance-not-device-confirmed',featureStatus:'no-frozen-push-features',feat:null,trainEligible:false,canTrade:false});
 }
 if(!samples.length)throw Error('目标日没有完整的同日收盘观测；保留既有结果');
 samples.sort((a,b)=>a.code.localeCompare(b.code));
 return {schemaVersion:2,date:ds,mode:'pushed-close-outcome-review',trainEligible:false,canTrade:false,samples,skipped,
  targetDayCoverage:{acceptedSymbols:groups.size,observedSymbols:samples.length,unobservedSymbols:groups.size-samples.length,observedPct:rate(samples.length,groups.size)},
  summary:summarizeOutcomes(samples,{now})};
}
const rate=(n,d)=>d?Number((n/d*100).toFixed(1)):null;
function validateSamples(samples,now){
 if(!Array.isArray(samples)||!validTime(now))throw Error('复盘记录或校验时钟无效');
 const ids=new Set();
 for(const s of samples){
  const ds=dateKey(s?.ds),closeAt=ds&&Date.parse(ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8)+'T15:00:00+08:00');
  if(!record(s)||!ds||ds!==s.ds||ds>day(now)||typeof s.code!=='string'||!/^\d{6}$/.test(s.code)||s.id!==ds+':'+s.code||ids.has(s.id)||
     !validTime(s.firstAcceptedAt)||day(s.firstAcceptedAt)!==ds||s.firstAcceptedAt>=closeAt||
     !validReceipt(s.outcomeReceivedAt,closeAt,now)||!finite(s.close)||s.close<=0||!validPct(s.pct)||s.outcome!==direction(s.pct)||
     ![null,0,1].includes(s.zt)||s.zt===1&&s.pct<=0||s.outcomeSource!==null&&typeof s.outcomeSource!=='string'||
     !Array.isArray(s.titles)||Array.from(s.titles).some(t=>typeof t!=='string'||t.length>200)||new Set(s.titles).size!==s.titles.length||
     s.trainEligible!==false||s.canTrade!==false||s.feat!==null||s.sourceVerified!==false||
     s.outcomeTarget!=='close-change-vs-previous-close'||
     s.deliveryBasis!=='recorded-gateway-acceptance-not-device-confirmed'||
     s.featureStatus!=='no-frozen-push-features')
   throw Error('既有复盘记录损坏或证据不兼容，保留原文件');
  ids.add(s.id);
 }
}
function summarizeOutcomes(samples,{now=Date.now()}={}){
 validateSamples(samples,now);
 const dates=[...new Set(samples.map(s=>s.ds))].sort().slice(-30),included=samples.filter(s=>dates.includes(s.ds)),titles=new Map();
 const outcomeCounts={up:0,down:0,flat:0,limitUpKnown:0,limitUpUnknown:0};
 for(const sample of included){
  outcomeCounts[sample.outcome]++;outcomeCounts[sample.zt===null?'limitUpUnknown':'limitUpKnown']++;
  for(const title of sample.titles){const row=titles.get(title)||{title,n:0,up:0,down:0,flat:0,zt:0,ztKnown:0,ztUnknown:0};row.n++;
   row[sample.outcome]++;if(sample.zt===null)row.ztUnknown++;else{row.ztKnown++;row.zt+=sample.zt;}titles.set(title,row);}
 }
 return {observedDays:dates.length,samples:included.length,target:'close-change-vs-previous-close',strategyReturnVerified:false,causalAttributionVerified:false,outcomeCounts,
  titleStats:[...titles.values()].map(s=>({...s,closeUpRate:rate(s.up,s.n),closeDownRate:rate(s.down,s.n),closeFlatRate:rate(s.flat,s.n),closeLimitUpRate:rate(s.zt,s.ztKnown)})).sort((a,b)=>a.title.localeCompare(b.title))};
}
function validateStoredReview(prior,now=Date.now()){
 if(!prior||prior.schemaVersion!==2||prior.mode!=='pushed-close-outcome-review'||
    prior.trainEligible!==false||prior.canTrade!==false||!Array.isArray(prior.samples))
  throw Error('既有复盘文件格式不兼容，保留原文件');
 validateSamples(prior.samples,now);return prior;
}
module.exports={dateKey,collectAcceptedGroups,reviewPushedOutcomes,summarizeOutcomes,validateStoredReview};
