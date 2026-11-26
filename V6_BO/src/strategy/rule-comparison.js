'use strict';
// Read-only cross-system evidence. Never merges independent strategy scores.
const {evaluateOne,DEFAULTS}=require('../../myrules');
const bazi=require('../../bazi');
const {loadPack}=require('./strategy-service');
const OWN=Object.prototype.hasOwnProperty;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const score=v=>finite(v)&&v>=0&&v<=100;
const scalar=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v));
const record=x=>x!=null&&typeof x==='object'&&!Array.isArray(x);
function signature(rule){
  if(!record(rule)||typeof rule.field!=='string'||!rule.field.trim()||rule.field!==rule.field.trim())return null;
  if(rule.op==='between')return scalar(rule.min)&&scalar(rule.max)&&Number(rule.min)<=Number(rule.max)?
    JSON.stringify([rule.field,rule.op,Number(rule.min),Number(rule.max)]):null;
  return ['>=','<=','>','<','==='].includes(rule.op)&&scalar(rule.value)?
    JSON.stringify([rule.field,rule.op,Number(rule.value)]):null;
}
function status(value,rule){
  if(!score(value)||!signature(rule))return 'unknown';
  const t=Number(rule.value);
  if(rule.op==='>=')return value>=t?'pass':'fail';
  if(rule.op==='<=')return value<=t?'pass':'fail';
  if(rule.op==='>')return value>t?'pass':'fail';
  if(rule.op==='<')return value<t?'pass':'fail';
  if(rule.op==='===')return value===t?'pass':'fail';
  if(rule.op==='between')return value>=Number(rule.min)&&value<=Number(rule.max)?'pass':'fail';
  return 'unknown';
}
function coverage(items){
  items=Array.isArray(items)?items:[];
  const total=items.length,passed=items.filter(x=>x?.status==='pass').length,
    failed=items.filter(x=>x?.status==='fail').length,known=passed+failed;
  return {total,known,passed,failed,unknown:total-known,
    coverageRate:total?+(known/total).toFixed(4):0,
    knownPassRate:known?+(passed/known).toFixed(4):null};
}
function packComparison(scores={},pack=loadPack()){
  const strategies=Array.isArray(pack)?pack:Array.isArray(pack?.strategies)?pack.strategies:[];
  return strategies.map(strategy=>{
    const input=Array.isArray(strategy?.rules)?strategy.rules:[];
    const ids=new Map(),signatures=new Map();
    for(const rule of input){
      const key=signature(rule),id=rule?.id;
      if(key)signatures.set(key,(signatures.get(key)||0)+1);
      if(typeof id==='string'&&id)ids.set(id,(ids.get(id)||0)+1);
    }
    const rules=input.map(rule=>{
      const key=signature(rule),observed=record(scores)&&rule&&OWN.call(scores,rule.field)?scores[rule.field]:null;
      const duplicate=!!key&&(signatures.get(key)>1||ids.get(rule.id)>1);
      const state=duplicate||!key?'unknown':status(observed,rule);
      return {id:rule?.id,label:rule?.label,field:rule?.field,op:rule?.op,
        threshold:rule?.op==='between'?{min:rule.min,max:rule.max}:rule?.value,
        weight:rule?.weight,observed:state==='unknown'?null:observed,status:state,
        ...(state==='unknown'?{reason:duplicate?'重复条件或规则身份冲突':!key?'规则条件或阈值无效':'缺少有效0-100原始评分'}:{})};
    });
    return {name:strategy.name,weight:strategy.strategyWeight,minScore:strategy.minScore,
      coverage:coverage(rules),rules,verdict:'research-only'};
  });
}
function myrulesComparison(input,config){
  if(!input)return {available:false,reason:'未提供十四条原生评估上下文'};
  const result=evaluateOne(input,config);
  const c={...DEFAULTS,...config},thresholds={1:{capLo:c.capLo,capHi:c.capHi},2:c.priceMax,3:{glueSpread:c.glueSpread,channelR2:c.channelR2},4:{geneDays:c.geneDays,pileRatio:c.pileRatio},5:{secZtMin:c.secZtMin,secPctMin:c.secPctMin},6:{aucTurnLo:c.aucTurnLo,aucTurnHi:c.aucTurnHi,aucPctLo:c.aucPctLo,aucPctHi:c.aucPctHi},8:{jingliu:c.jingliu,fengliu:c.fengliu,fengcheng:c.fengcheng,jingzuo:c.jingzuo},9:c.sealRatio,10:c.profitMax,11:c.maxLianBan,13:c.volRatio};
  const stock=input.stock||{},prior=Array.isArray(input.rows)?input.rows.at(-2):null;
  const count=v=>Number.isSafeInteger(v)&&v>=0,positive=v=>finite(v)&&v>0,
    nonnegative=v=>finite(v)&&v>=0;
  const missingNativeFields={
    8:!nonnegative(input.auction?.auctionAmount)||!positive(stock.floatCap)||
      !nonnegative(stock.sealAmount)||!positive(stock.amount)||!positive(prior?.amount),
    9:!count(stock.limitUpCount)||!count(stock.breakCount)||!nonnegative(stock.sealAmount)||!positive(stock.amount),
    11:!count(stock.limitUpCount)
  };
  const rules=result.items.map(x=>{
    const missing=!!missingNativeFields[x.i]||x.unknown;
    const notFirstBoard=x.i===9&&!missing&&stock.limitUpCount!==1;
    return {id:x.i,label:x.name,status:missing?'unknown':notFirstBoard?'fail':x.ok?'pass':'fail',
      observed:missing?null:x.val??null,op:[2,11].includes(x.i)?'<':'native-rule',
      threshold:thresholds[x.i]??null,reason:notFirstBoard?'原始连板数不为1，不能认定首板':missingNativeFields[x.i]?
        '原始金额或连板/封板证据不足；不采用缺失比率、默认零或成交量替代金额':x.note,
      exclusion:x.i===11};
  });
  const counts=coverage(rules),exclusion=rules.find(x=>x.exclusion),requiredHits=c.minHits;
  const validThreshold=Number.isSafeInteger(requiredHits)&&requiredHits>=1&&requiredHits<=rules.length;
  const verdict=!validThreshold||!exclusion?'unknown':exclusion.status==='fail'?'fail':
    exclusion.status!=='pass'?'unknown':counts.passed>=requiredHits?'pass':
    counts.passed+counts.unknown<requiredHits?'fail':'unknown';
  return {available:true,pass:verdict==='pass',verdict,excluded:exclusion?.status==='fail'?result.excluded:[],
    coverage:counts,rules,hits:counts.passed,requiredHits,
    nativePass:result.pass,nativeHits:result.hits,nativeExcluded:result.excluded};
}
function baziComparison(input){
  if(!input)return {available:false,reason:'未提供八字原生评估上下文'};
  const result=bazi.evaluate(input);
  const dimensions=['trend','fund','position','support'].map(id=>{
    const item=result.dims?.[id]||{};
    const complete=score(item.score)&&!item.insufficient&&!(Array.isArray(item.miss)&&item.miss.length);
    return {id,score:complete?item.score:null,partialScore:score(item.score)?item.score:null,
      status:complete?'pass':'unknown',reason:item.why||'',missing:Array.isArray(item.miss)?item.miss:[]};
  });
  return {available:true,coverage:coverage(dimensions),dimensions,raw:result};
}
function compareRuleSystems({scores={},pack,myrulesInput,baziInput,pythonResult,myrulesConfig}={}){
  // Python source is a separate program: do not fabricate a score from incomplete snapshots.
  const day=pythonResult?.date,validDate=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&
    Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
  const pythonRules=Array.isArray(pythonResult?.rules)?pythonResult.rules:[];
  const validPython=record(pythonResult)&&typeof pythonResult.provenance==='string'&&
    !!pythonResult.provenance.trim()&&validDate&&pythonRules.length===3&&
    pythonRules.every((rule,i)=>record(rule)&&rule.id==='round-'+(i+1)&&['pass','fail','unknown'].includes(rule.status));
  const python=validPython
    ?{available:true,provenance:pythonResult.provenance,date:pythonResult.date,
      score:score(pythonResult.score)?pythonResult.score:null,rules:pythonRules,coverage:coverage(pythonRules),
      evidenceStatus:'declared-three-round-research-only',verifiedLive:false}
    :{available:false,reason:'独立Python评分未提供有效日期、可追溯来源及按序三轮结果'};
  const systems={fourteen:myrulesComparison(myrulesInput,myrulesConfig),
    bazi:baziComparison(baziInput),gpt:packComparison(scores,pack),python};
  return {mode:'independent-research',rankingModified:false,systems,
    interpretation:require('../core/research-decision-review').summarizeRuleDisagreement(systems)};
}
module.exports={coverage,packComparison,compareRuleSystems};
