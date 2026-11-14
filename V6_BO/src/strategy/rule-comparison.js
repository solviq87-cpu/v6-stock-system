'use strict';
// Read-only cross-system evidence. Never merges independent strategy scores.
const {evaluateOne,DEFAULTS}=require('../../myrules');
const bazi=require('../../bazi');
const {loadPack}=require('./strategy-service');
const OWN=Object.prototype.hasOwnProperty;
function status(value,op,threshold){
  if(typeof value!=='number'||!Number.isFinite(value))return 'unknown';
  if(op==='>=')return value>=threshold?'pass':'fail';
  if(op==='<=')return value<=threshold?'pass':'fail';
  if(op==='>')return value>threshold?'pass':'fail';
  if(op==='<')return value<threshold?'pass':'fail';
  return 'unknown';
}
function coverage(items){
  const total=items.length,known=items.filter(x=>x.status!=='unknown').length;
  const passed=items.filter(x=>x.status==='pass').length;
  return {total,known,passed,failed:known-passed,unknown:total-known,
    coverageRate:total?+(known/total).toFixed(4):0,
    knownPassRate:known?+(passed/known).toFixed(4):null};
}
function packComparison(scores={},pack=loadPack()){
  const strategies=Array.isArray(pack)?pack:pack.strategies||[];
  return strategies.map(strategy=>{
    const rules=(strategy.rules||[]).map(rule=>{
      const observed=OWN.call(scores,rule.field)?scores[rule.field]:null;
      return {id:rule.id,label:rule.label,field:rule.field,op:rule.op,threshold:rule.value,
        weight:rule.weight,observed:typeof observed==='number'&&Number.isFinite(observed)?observed:null,
        status:status(observed,rule.op,rule.value)};
    });
    return {name:strategy.name,weight:strategy.strategyWeight,minScore:strategy.minScore,
      coverage:coverage(rules),rules,verdict:'research-only'};
  });
}
function myrulesComparison(input,config){
  if(!input)return {available:false,reason:'未提供十四条原生评估上下文'};
  const result=evaluateOne(input,config);
  const c={...DEFAULTS,...config},thresholds={1:{capLo:c.capLo,capHi:c.capHi},2:c.priceMax,3:{glueSpread:c.glueSpread,channelR2:c.channelR2},4:{geneDays:c.geneDays,pileRatio:c.pileRatio},5:{secZtMin:c.secZtMin,secPctMin:c.secPctMin},6:{aucTurnLo:c.aucTurnLo,aucTurnHi:c.aucTurnHi,aucPctLo:c.aucPctLo,aucPctHi:c.aucPctHi},8:{jingliu:c.jingliu,fengliu:c.fengliu,fengcheng:c.fengcheng,jingzuo:c.jingzuo},9:c.sealRatio,10:c.profitMax,11:c.maxLianBan,13:c.volRatio};
  const rules=result.items.map(x=>({id:x.i,label:x.name,status:x.unknown?'unknown':x.ok?'pass':'fail',observed:x.unknown?null:x.val??null,op:[2,11].includes(x.i)?'<':'native-rule',threshold:thresholds[x.i]??null,reason:x.note,exclusion:x.i===11}));
  return {available:true,pass:result.pass,excluded:result.excluded,coverage:coverage(rules),rules,
    hits:result.hits,requiredHits:config?.minHits??6};
}
function baziComparison(input){
  if(!input)return {available:false,reason:'未提供八字原生评估上下文'};
  const result=bazi.evaluate(input);
  const dimensions=['trend','fund','position','support'].map(id=>{
    const item=result.dims?.[id]||{};
    return {id,score:Number.isFinite(item.score)?item.score:null,
      status:item.insufficient||!Number.isFinite(item.score)?'unknown':'pass',reason:item.why||''};
  });
  return {available:true,coverage:coverage(dimensions),dimensions,raw:result};
}
function compareRuleSystems({scores={},pack,myrulesInput,baziInput,pythonResult,myrulesConfig}={}){
  // Python source is a separate program: do not fabricate a score from incomplete snapshots.
  const python=pythonResult&&typeof pythonResult==='object'&&pythonResult.provenance&&pythonResult.date
    ?{available:true,provenance:pythonResult.provenance,date:pythonResult.date,
      score:Number.isFinite(pythonResult.score)?pythonResult.score:null,
      rules:Array.isArray(pythonResult.rules)?pythonResult.rules:[],
      coverage:coverage(Array.isArray(pythonResult.rules)?pythonResult.rules:[])}
    :{available:false,reason:'独立Python评分未提供可追溯来源和日期'};
  const systems={fourteen:myrulesComparison(myrulesInput,myrulesConfig),
    bazi:baziComparison(baziInput),gpt:packComparison(scores,pack),python};
  return {mode:'independent-research',rankingModified:false,systems,
    interpretation:require('../core/research-decision-review').summarizeRuleDisagreement(systems)};
}
module.exports={coverage,packComparison,compareRuleSystems};
