'use strict';
/** Read-only evidence gate. No orders, no rewriting legacy scores. */
const codeOf=x=>String(x?.code??x?.symbol??'');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const declared=x=>typeof x==='string'&&x.trim().length>0?x:null;
const rank=x=>Number.isSafeInteger(x)&&x>0?x:null;
const hardRisk=c=>c.isST===true||c.suspended===true||c.tradable===false||
 (finite(c.riskScore)&&c.riskScore>=85);
function candidateOrigin(c,inputPosition){
 return {inputPosition,candidateId:declared(c.candidateId),signalId:declared(c.signalId),
  strategyId:declared(c.strategyId),strategyVersion:declared(c.strategyVersion),
  originalRank:rank(c.originalRank??c.rank),originalScore:finite(c.finalScore)?c.finalScore:null,
  explicitHardRisk:hardRisk(c)};
}
function assessCandidateEvidence(snapshot, breadth, regime, candidates=[], intersection={}, {requireOriginalQuoteTime=false}={}) {
 const observations=new Map();
 for(const row of Array.isArray(intersection?.items)?intersection.items:[]){
  const code=String(row?.code||'');if(!/^\d{6}$/.test(code))continue;
  if(!observations.has(code))observations.set(code,new Set());
  observations.get(code).add(row.quoteTimeStatus||'unknown');
 }
 const grouped=new Map(),items=[];
 const supplied=Array.isArray(candidates)?candidates:[];
 let validCount=0,invalidCount=0;
 for(let i=0;i<supplied.length;i++){
  const c=supplied[i],code=codeOf(c);
  if(!c||typeof c!=='object'||!/^\d{6}$/.test(code)){invalidCount++;continue;}
  validCount++;
  if(!grouped.has(code))grouped.set(code,{first:c,origins:[]});
  grouped.get(code).origins.push(candidateOrigin(c,i+1));
 }
 // Preserve first-seen display order and score, but never allow a duplicate
 // candidate to hide a hard risk. Disclose the existing 50-code display cap.
 for(const [code,{first:c,origins}] of grouped){
  if(items.length>=50)break;
  const statuses=observations.get(code);
  const quoteTimeStatus=statuses?.size===1?[...statuses][0]:statuses?.size>1?'conflicting':'unknown';
  const reasons=[];
  const knownRisk=origins.some(x=>x.explicitHardRisk);
  if(knownRisk)reasons.push('已有候选标记为高风险或不可交易');
  const breadthReady=breadth?.usable&&breadth.decisionUsable!==false;
  if(!breadthReady)reasons.push('市场宽度覆盖不足');
  if(!observations.has(code))reasons.push('未匹配到公开行情');
  if(!regime?.usable)reasons.push('缺少独立且同日期的市场环境评分');
  const timeStatus=quoteTimeStatus;
  const quoteTimeReady=!requireOriginalQuoteTime||timeStatus==='recent-source-unverified';
  if(!quoteTimeReady)reasons.push('缺少该股可核对的近期供应商自报报价时点；请求日期不能冒充报价时间');
  if(!Number.isFinite(c.finalScore))reasons.push('原候选评分未知');
  if(knownRisk)reasons.push('风险拦截优先于研究证据完整性');
  const evidenceReady=Boolean(!knownRisk&&breadthReady&&observations.has(code)&&regime?.usable&&
   quoteTimeReady&&Number.isFinite(c.finalScore));
  items.push({code,name:String(c.name||code).slice(0,64),originalScore:Number.isFinite(c.finalScore)?c.finalScore:null,
   origins,originCount:origins.length,
   riskStatus:knownRisk?'blocked':evidenceReady?'research-only':'unknown',
   evidenceReady,quoteTimeStatus:timeStatus,canTrade:false,
   reason:reasons.length?reasons.join('；'):'仅研究候选；原始报价时点仍未获得交易所独立认证及交易放行'});
 }
 return {mode:'read-only',rankingModified:false,canTrade:false,items,
  candidateCoverage:{suppliedCount:supplied.length,validCount,invalidCount,
   uniqueCodeCount:grouped.size,displayedCodeCount:items.length,
   omittedCodeCount:grouped.size-items.length,
   omittedOriginCount:validCount-items.reduce((n,x)=>n+x.originCount,0),
   duplicateOriginCount:validCount-grouped.size},
  // No matured executable return evidence is supplied to this gate.
  tradingValueStatus:'not-assessed',canQualify:false,canNotify:false,
  counts:{total:items.length,blocked:items.filter(x=>x.riskStatus==='blocked').length,
   unknown:items.filter(x=>x.riskStatus==='unknown').length,evidenceReady:items.filter(x=>x.evidenceReady).length},
  warning:'研究门禁仅根据明确字段判定；未知不等于通过；未执行交易前完整风控或回测，不生成买入指令'};
}
module.exports={assessCandidateEvidence};
