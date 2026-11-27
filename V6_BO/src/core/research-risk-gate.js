'use strict';
/** Read-only evidence gate. No orders, no rewriting legacy scores. */
const {isDeepStrictEqual}=require('node:util');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const codeValue=x=>(typeof x==='string'||Number.isSafeInteger(x))&&/^\d{6}$/.test(String(x))?String(x):null;
const codeOf=x=>codeValue(x?.code??x?.symbol);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const scoreOK=x=>Number.isFinite(x)&&x>=0&&x<=100;
const riskFlags=['isST','suspended','halt','riskWarning','blocked','riskBlocked','excluded','bad','blacklisted'];
const negativeFlags=['tradable','canOpen','currentSourceConfirmed'];
const artificialFlags=['simulated','synthetic','fixture','mock','imported','readOnlyBackup'];
const conflict=x=>x?.sourceConflict===true||x?.quoteSourceConflict===true||x?.conflict===true||x?.quoteStatus==='conflict'||x?.evidenceStatus==='conflict';
const artificial=x=>artificialFlags.some(k=>x?.[k]===true)||/simulat|synthetic|fixture|mock|demo/i.test(typeof x?.source==='string'?x.source:'');
const identityOK=x=>!!codeOf(x)&&(x.code==null||x.symbol==null||codeValue(x.code)===codeValue(x.symbol));
const knownRisk=x=>riskFlags.some(k=>x[k]===true)||negativeFlags.some(k=>x[k]===false)||
 x.cap==='空仓'||x.decisionReview?.action==='sell'||(Number.isFinite(x.riskScore)&&x.riskScore>=85);
const missingRisk=x=>[...riskFlags,...negativeFlags,...artificialFlags].some(k=>x[k]!==undefined&&typeof x[k]!=='boolean')||
 (x.riskScore!==undefined&&!scoreOK(x.riskScore))||
 (x.selectionEvidenceStatus!==undefined&&x.selectionEvidenceStatus!=='complete')||conflict(x)||artificial(x);
function groupRows(rows){
 const groups=new Map(),badCodes=new Set();
 for(const row of Array.isArray(rows)?rows:[]){
  if(!record(row))continue;
  const code=codeOf(row);
  if(!identityOK(row)){
   for(const raw of [row.code,row.symbol]){const id=codeValue(raw);if(id)badCodes.add(id);}
  }
  if(!code)continue;
  if(!groups.has(code))groups.set(code,[]);
  groups.get(code).push(row);
 }
 return {groups,badCodes};
}
function sameRows(rows){return rows.length>0&&rows.every(row=>isDeepStrictEqual(rows[0],row));}
function compatibleContext(value,snapshot){
 return record(value)&&(value.date===undefined||value.date===snapshot?.date)&&
  (value.source===undefined||value.source===snapshot?.source)&&!conflict(value)&&!artificial(value);
}
function assessCandidateEvidence(snapshot, breadth, regime, candidates=[], intersection={}, {requireOriginalQuoteTime=false}={}) {
 const originals=groupRows(snapshot?.stocks),joined=groupRows(intersection?.items),candidateGroups=groupRows(candidates);
 const snapshotReady=record(snapshot)&&dateOK(snapshot.date)&&typeof snapshot.source==='string'&&!!snapshot.source.trim()&&
  !conflict(snapshot)&&!artificial(snapshot)&&Array.isArray(snapshot.stocks);
 const breadthReady=snapshotReady&&breadth?.usable===true&&compatibleContext(breadth,snapshot);
 const regimeReady=snapshotReady&&regime?.usable===true&&compatibleContext(regime,snapshot)&&
  (regime.breadth===undefined||(regime.breadth?.usable===true&&compatibleContext(regime.breadth,snapshot)));
 const intersectionReady=snapshotReady&&compatibleContext(intersection,snapshot)&&
  (intersection.usable===undefined||intersection.usable===true)&&Array.isArray(intersection.items);
 const items=[];
 for(const [code,rows] of candidateGroups.groups){
  if(items.length>=50)break;
  const c=rows[0],reasons=[],raws=originals.groups.get(code)||[],matches=joined.groups.get(code)||[];
  const observed=raws[0],match=matches[0];
  const risk=rows.some(knownRisk),riskUnknown=rows.some(missingRisk);
  const identityReady=!candidateGroups.badCodes.has(code)&&sameRows(rows);
  const scoreReady=scoreOK(c.finalScore)&&(match?.candidateScore===undefined||Object.is(match.candidateScore,c.finalScore));
  const rawReady=!originals.badCodes.has(code)&&sameRows(raws)&&!conflict(observed)&&!artificial(observed)&&
   (observed?.source===undefined||observed.source===snapshot?.source)&&
   Number.isFinite(observed?.pctChange)&&Math.abs(observed.pctChange)<=100;
  const matchReady=intersectionReady&&rawReady&&!joined.badCodes.has(code)&&sameRows(matches)&&
   compatibleContext(match,snapshot)&&(match.requestDate===undefined||match.requestDate===snapshot.date)&&
   (match.pctChange===undefined||Object.is(match.pctChange,observed.pctChange));
  let timeStatus=matchReady&&typeof match.quoteTimeStatus==='string'?match.quoteTimeStatus:'unknown';
  let timeReady=requireOriginalQuoteTime===false;
  if(matchReady&&requireOriginalQuoteTime===true&&timeStatus==='recent-source-unverified'){
   // Use the same original provider-time classifier. The later decision clock
   // may increase age relative to the receipt; it cannot decrease that age.
   const receipt=typeof snapshot.retrievedAt==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.retrievedAt)?Date.parse(snapshot.retrievedAt):NaN;
   if(Number.isSafeInteger(receipt)&&receipt>0){
    const original=classifyQuoteTime(observed,{requestDate:snapshot.date,retrievedAt:receipt});
    timeReady=original.quoteTimeStatus==='recent-source-unverified'&&match.source===snapshot.source&&match.requestDate===snapshot.date&&
     match.quoteAt===original.quoteAt&&match.quoteDate===original.quoteDate&&Number.isSafeInteger(match.quoteAgeMs)&&
     match.quoteAgeMs>=original.quoteAgeMs&&match.quoteAgeMs<=90000;
   }
   if(!timeReady)timeStatus='unknown';
  }
  if(risk)reasons.push('已有候选标记为高风险或不可交易');
  if(!identityReady)reasons.push('候选证券身份或重复证据存在冲突');
  if(riskUnknown)reasons.push('原风险或选股证据缺失、异常或冲突');
  if(!breadthReady)reasons.push('市场宽度覆盖不足或来源日期不一致');
  if(!matchReady)reasons.push('未匹配到唯一一致的原始公开行情');
  if(!regimeReady)reasons.push('缺少独立且同日期的市场环境评分');
  if(!timeReady)reasons.push('缺少该股可核对的近期供应商自报报价时点；请求日期不能冒充报价时间');
  if(!scoreReady)reasons.push('原候选评分未知、越界或与交集评分不一致');
  if(risk)reasons.push('风险拦截优先于研究证据完整性');
  const evidenceReady=Boolean(!risk&&!riskUnknown&&identityReady&&breadthReady&&matchReady&&regimeReady&&timeReady&&scoreReady);
  items.push({code,name:String(c.name||code).slice(0,64),originalScore:Number.isFinite(c.finalScore)?c.finalScore:null,
   riskStatus:risk?'blocked':evidenceReady?'research-only':'unknown',
   evidenceReady,quoteTimeStatus:timeStatus,canTrade:false,
   reason:reasons.length?reasons.join('；'):'仅研究候选；原始报价时点仍未获得交易所独立认证及交易放行'});
 }
 return {mode:'read-only',rankingModified:false,canTrade:false,items,
  counts:{total:items.length,blocked:items.filter(x=>x.riskStatus==='blocked').length,
   unknown:items.filter(x=>x.riskStatus==='unknown').length,evidenceReady:items.filter(x=>x.evidenceReady).length},
  warning:'研究门禁仅根据明确字段判定；未知不等于通过；未执行交易前完整风控或回测，不生成买入指令'};
}
module.exports={assessCandidateEvidence};
