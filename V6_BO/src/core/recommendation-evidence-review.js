'use strict';
// Purpose-specific review of this exact row. No code lookup, IO, or permissions are granted here.
const {quoteUseEligibility,quoteSourceAllowsUse,quoteSnapshotFields}=require('./quote-observation-view');
const PURPOSES=new Set(['intraday-recommendation','dated-observation','fact-broadcast']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0&&value<=8e15;
const text=value=>typeof value==='string'?value.trim().slice(0,500):'';
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const simulated=value=>/simulat|synthetic|mock|模拟/i.test(text(value));
const activeFlag=value=>value===true||value===1||(typeof value==='string'&&!!text(value)&&!/^(false|none|normal|no|0|无|正常|否)$/i.test(text(value)));

// Copy provenance alongside the originating price. It never manufactures a source,
// timestamp, notification permission, or canTrade:true for a scored candidate.
function reviewQuoteSnapshotFields(row){
 const input=row&&typeof row==='object'?row:{};
 const copied={...quoteSnapshotFields(input)};
 for(const field of ['mode','simulated','imported','fixture','mock','synthetic','readOnlyBackup','tradable','suspended','halt','riskWarning','isST','volume','amount']){
  if(Object.hasOwn(input,field))copied[field]=input[field];
 }
 return copied;
}

function reviewRecommendationEvidence(row,{purpose,now=Date.now()}={}){
 if(!time(now))throw Error('推荐证据审核时钟无效');
 const input=row&&typeof row==='object'?row:{};
 // Resolve the real module unconditionally: a missing dependency must fail visibly.
 const quote=quoteUseEligibility(input,now),support=[],contra=[],missing=[];
 const add=(list,code,message,fields)=>{if(!list.some(item=>item.code===code))list.push({code,message,...(fields?{fields}:{})});};
 const addSupport=(...args)=>add(support,...args),addContra=(...args)=>add(contra,...args),addMissing=(...args)=>add(missing,...args);
 let canRecommend=false,canObserve=false,canBroadcast=false;
 const attachedQuote=()=>{
  if(quote.canNotify===true)addSupport('ATTACHED_QUOTE_USE_ELIGIBLE','附带报价通过同一原始行的通知用途校验。',{quoteAt:quote.quoteAt,source:quote.quoteSource});
  else addMissing('ATTACHED_QUOTE_UNAVAILABLE','附带报价不具备即时推荐资格，保留其缺失或不可用原因。',{reason:quote.missingReason||'notification-permission-unknown',quoteAt:quote.quoteAt,source:quote.quoteSource});
 };
 const checkDatedEvidence=(evidence,timeField,label)=>{
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)){addMissing('MISSING_'+label+'_EVIDENCE','缺少此用途的原始日期和来源证据。');return false;}
  const source=text(evidence.source),date=evidence.tradeDate,at=evidence[timeField];
  if(!source)addMissing('MISSING_'+label+'_SOURCE','缺少此用途证据的来源。');
  const isSimulated=simulated(source)||simulated(evidence.mode)||evidence.simulated===true||input.simulated===true||
    ['fixture','mock','synthetic'].some(field=>evidence[field]===true||input[field]===true)||
    (label==='RESEARCH'&&(simulated(input.quoteSource)||simulated(input.quoteMode||input.mode)));
  if(isSimulated)addContra('SIMULATED_'+label+'_EVIDENCE','模拟来源不能作为真实观察或事实播报依据。');
  if(!validDate(date))addMissing('INVALID_'+label+'_DATE','缺少合法的 YYYY-MM-DD 证据日期。');
  else if(date>day(now))addContra('FUTURE_'+label+'_DATE','证据日期晚于当前北京时间日期。',{tradeDate:date});
  if(!time(at))addMissing('MISSING_'+label+'_TIME','缺少合法的证据接收或观察时点。');
  else if(at>now)addContra('FUTURE_'+label+'_TIME','证据接收或观察时点晚于当前时点。',{[timeField]:at});
  else if(validDate(date)&&date>day(at))addContra('MISORDERED_'+label+'_TIME','证据日期晚于其接收或观察时点，因果顺序无效。',{tradeDate:date,[timeField]:at});
  return !!source&&validDate(date)&&date<=day(now)&&time(at)&&at<=now&&date<=day(at)&&!isSimulated;
 };

 if(!PURPOSES.has(purpose))addMissing('UNKNOWN_PURPOSE','必须明确即时推荐、带日期观察或事实播报用途。');
 else if(purpose==='intraday-recommendation'){
  if(!text(input.quoteMode||input.mode))addMissing('MISSING_QUOTE_MODE','缺少同一原始报价行的用途模式。');
  const name=text(input.name);
  if(input.isST===true||activeFlag(input.riskWarning)||/^(?:S\*?ST|\*+\s*ST|ST)|退市/i.test(name))addContra('ST_OR_RISK_WARNING','ST、退市或明确风险警示标的不能进入即时推荐。');
  if(activeFlag(input.suspended)||activeFlag(input.halt)||input.tradable===false)addContra('HALTED_OR_UNTRADABLE','停牌、暂停或明确不可交易标的不能进入即时推荐。');
  if(finite(input.price)&&input.price<=0)addContra('NONPOSITIVE_PRICE','明确为零或负的价格不能作为即时推荐依据。',{price:input.price});
  for(const field of ['volume','amount']){
   if(finite(input[field])&&input[field]<=0)addContra(input[field]===0?'ZERO_'+field.toUpperCase():'NEGATIVE_'+field.toUpperCase(),field==='volume'?'明确零成交量或负成交量不能进入即时推荐。':'明确零成交额或负成交额不能进入即时推荐。',{[field]:input[field]});
  }
  if((finite(input.volume)&&input.volume>0)||(finite(input.amount)&&input.amount>0))addSupport('OBSERVED_POSITIVE_ACTIVITY','同一原始行至少有一项正成交量或正成交额。',{volume:finite(input.volume)?input.volume:null,amount:finite(input.amount)?input.amount:null});
  else addMissing('MISSING_POSITIVE_ACTIVITY','缺少同一原始行的正成交量或正成交额。');
  if(quote.canNotify===true)addSupport('LIVE_QUOTE_USE_ELIGIBLE','同一原始报价行通过时间、来源及通知用途校验；这不认证供应商或预测收益。',{quoteAt:quote.quoteAt,receivedAt:quote.receivedAt,source:quote.quoteSource});
  else{
   const reason=quote.missingReason;
   if(input.canNotify===false||input.canTrade===false)addContra('QUOTE_USE_DISABLED','原始行明确禁止该报价用途。');
   if(!quoteSourceAllowsUse(input))addContra('QUOTE_SOURCE_USE_BLOCKED','原始行情用途合同拒绝该来源、模式或交易状态。');
   if(['future-original-time','invalid-reception-time','different-trade-date','stale-original-time'].includes(reason))addContra('INVALID_QUOTE_TIMING','原始报价过期、未来、跨日或接收顺序无效。',{reason,quoteAt:quote.quoteAt,receivedAt:quote.receivedAt});
   else if(reason&&reason!=='observation-only-source'&&reason!=='use-disabled-by-source')addMissing('MISSING_ORIGINAL_QUOTE','缺少同一原始报价行的有效价格、来源或时点。',{reason});
   if(input.canNotify!==true&&input.canTrade!==true&&input.canNotify!==false&&input.canTrade!==false)addMissing('MISSING_NOTIFICATION_PERMISSION','原始行没有明确通知用途许可。');
   if(!reason&&input.canNotify===true)addMissing('QUOTE_USE_NOT_ELIGIBLE','原始行情用途合同未批准该报价。');
  }
  canRecommend=quote.canNotify===true&&contra.length===0&&missing.length===0;
 }else if(purpose==='dated-observation'){
  attachedQuote();
  const evidence=input.researchEvidence,valid=checkDatedEvidence(evidence,'receivedAt','RESEARCH');
  if(!finite(input.price))addMissing('MISSING_RESEARCH_PRICE','带日期观察缺少真实数值价格。');
  else if(input.price<=0)addContra('NONPOSITIVE_RESEARCH_PRICE','带日期观察价格必须为正。',{price:input.price});
  canObserve=valid&&finite(input.price)&&input.price>0;
  if(canObserve)addSupport('DATED_RESEARCH_EVIDENCE','记录具有日期、来源和接收时点的观察，不能转成即时推荐。',{tradeDate:evidence.tradeDate,source:text(evidence.source),receivedAt:evidence.receivedAt});
 }else{
  attachedQuote();
  const evidence=input.factEvidence,valid=checkDatedEvidence(evidence,'observedAt','FACT');
  if(!text(evidence?.kind))addMissing('MISSING_FACT_KIND','事实播报缺少明确事实种类。');
  canBroadcast=valid&&!!text(evidence?.kind);
  if(canBroadcast)addSupport('DATED_FACT_EVIDENCE','可播报有原始来源、观察时点和日期的事实；不授予价格推荐资格。',{kind:text(evidence.kind),tradeDate:evidence.tradeDate,source:text(evidence.source),observedAt:evidence.observedAt});
 }
 const allowed=canRecommend||canObserve||canBroadcast;
 return {schemaVersion:1,purpose:typeof purpose==='string'?purpose:null,decision:allowed?'support':contra.length?'contra':'missing',support,contra,missing,
  reasons:[...new Set([...contra,...missing,...support].map(item=>item.message))],canRecommend,canObserve,canBroadcast,quote};
}
module.exports={reviewRecommendationEvidence,reviewQuoteSnapshotFields};
