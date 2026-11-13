'use strict';
// Descriptive close outcomes only: not signal returns or model-training evidence.
const day=at=>new Date(at+28800000).toISOString().slice(0,10).replace(/-/g,'');
function dateKey(value){
 const s=String(value||'').replace(/-/g,'');if(!/^\d{8}$/.test(s))return null;
 const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8),at=Date.parse(iso+'T00:00:00Z');
 return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===iso?s:null;
}
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<8e15;
function codesOf(extra){
 if(extra&&typeof extra==='object'&&Array.isArray(extra.codes))return extra.codes.filter(x=>typeof x==='string'&&/^\d{6}$/.test(x));
 const match=/['"]codes['"]\s*:\s*\[([^\]]*)\]/.exec(typeof extra==='string'?extra:'');
 return match?match[1].split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,'')).filter(s=>/^\d{6}$/.test(s)):[];
}
function reviewPushedOutcomes({date,pushlog,histories,now=Date.now()}){
 const ds=dateKey(date);if(!ds||!validTime(now)||ds>day(now))throw Error('复盘日期无效或晚于当前日期');
 const closeAt=Date.parse(ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8)+'T15:00:00+08:00');
 if(now<closeAt)throw Error('目标交易日尚未收盘，不能生成收盘统计');
 if(!Array.isArray(pushlog))throw Error('缺少推送流水，不能写空学习库');
 const skipped={unconfirmed:0,invalidTime:0,afterClose:0,missingCodes:0,missingOutcome:0,invalidHistory:0,unclosedOutcome:0},groups=new Map();
 for(const entry of pushlog){
  if(!entry||!validTime(entry.ts)){skipped.invalidTime++;continue;}if(day(entry.ts)!==ds)continue;
  if(!/^✅ 已送达(?:\(私密\))?$/.test(entry.status||'')&&entry.status!=='gateway-accepted'){skipped.unconfirmed++;continue;}
  if(entry.ts>=closeAt){skipped.afterClose++;continue;}
  const codes=[...new Set(codesOf(entry.extra))];if(!codes.length){skipped.missingCodes++;continue;}
  for(const code of codes){const meta=groups.get(code)||{firstAcceptedAt:entry.ts,titles:new Set()};
   meta.firstAcceptedAt=Math.min(meta.firstAcceptedAt,entry.ts);if(typeof entry.title==='string')meta.titles.add(entry.title.slice(0,200));groups.set(code,meta);}
 }
 if(!groups.size)throw Error('目标日没有可核对的盘中网关接受记录；保留既有结果');
 const samples=[];
 for(const [code,meta] of groups){
  const history=histories instanceof Map?histories.get(code):histories?.[code];
  const rows=Array.isArray(history)?history:history?.rows;if(!Array.isArray(rows)){skipped.missingOutcome++;continue;}
  const target=rows.filter(row=>dateKey(row?.date)===ds);
  if(target.length!==1){if(target.length>1)skipped.invalidHistory++;else skipped.missingOutcome++;continue;}
  const bar=target[0];if(!finite(bar.close)||bar.close<=0||!finite(bar.pct)){skipped.missingOutcome++;continue;}
  const receivedAt=bar.receivedAt??history?.receivedAt;
  if(!validTime(receivedAt)||receivedAt<closeAt||receivedAt>now){skipped.unclosedOutcome++;continue;}
  // IPO/board limits cannot be inferred from an undated current snapshot.
  const zt=typeof bar.isLimitUp==='boolean'?bar.isLimitUp:typeof bar.limitUp==='boolean'?bar.limitUp:null;
  samples.push({id:ds+':'+code,ds,code,firstAcceptedAt:meta.firstAcceptedAt,titles:[...meta.titles].sort(),close:bar.close,pct:bar.pct,
   outcome:bar.pct>0?'up':bar.pct<0?'down':'flat',zt:zt===null?null:zt?1:0,outcomeTarget:'close-change-vs-previous-close',
   outcomeSource:history?.src||null,outcomeReceivedAt:receivedAt,sourceVerified:false,
   deliveryBasis:'recorded-gateway-acceptance-not-device-confirmed',featureStatus:'no-frozen-push-features',feat:null,trainEligible:false,canTrade:false});
 }
 if(!samples.length)throw Error('目标日没有完整的同日收盘观测；保留既有结果');
 samples.sort((a,b)=>a.code.localeCompare(b.code));
 return {schemaVersion:2,date:ds,mode:'pushed-close-outcome-review',trainEligible:false,canTrade:false,samples,skipped,summary:summarizeOutcomes(samples)};
}
function summarizeOutcomes(samples){
 const dates=[...new Set(samples.map(s=>s.ds))].sort().slice(-30),included=samples.filter(s=>dates.includes(s.ds)),titles=new Map();
 for(const sample of included)for(const title of sample.titles){const row=titles.get(title)||{title,n:0,up:0,zt:0,ztKnown:0};row.n++;
  if(sample.pct>0)row.up++;if(sample.zt!==null){row.ztKnown++;row.zt+=sample.zt;}titles.set(title,row);}
 const pct=(n,d)=>d?Number((n/d*100).toFixed(1)):null;
 return {observedDays:dates.length,samples:included.length,target:'close-change-vs-previous-close',strategyReturnVerified:false,
  titleStats:[...titles.values()].map(s=>({...s,closeUpRate:pct(s.up,s.n),closeLimitUpRate:pct(s.zt,s.ztKnown)})).sort((a,b)=>a.title.localeCompare(b.title))};
}
module.exports={dateKey,reviewPushedOutcomes,summarizeOutcomes};
