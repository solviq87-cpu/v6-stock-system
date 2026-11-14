'use strict';
const pack=require('../../strategies/extended-factor-pack.json');
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
function scoreExtendedFactors(stock={},config=pack){
 const present=[],missing=[],groups={};
 for(const f of config.factors){
  const v=stock[f.field];
  if(!valid(v)){missing.push({id:f.id,label:f.label,reason:'未提供有效0-100实测因子'});continue;}
  present.push({id:f.id,label:f.label,group:f.group,score:v,weight:f.weight});
  (groups[f.group]??=[]).push({score:v,weight:f.weight});
 }
 const sum=xs=>xs.reduce((a,x)=>a+x.score*x.weight,0)/xs.reduce((a,x)=>a+x.weight,0);
 const byGroup=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,+sum(v).toFixed(2)]));
 const score=present.length?+sum(present).toFixed(2):null;
 return {score,coverage:+(present.length/config.factors.length).toFixed(3),available:present.length,
  total:config.factors.length,byGroup,signals:present,missing,
  note:'仅统计提供的有效因子；缺失因子不计分，不代表零分或50分'};
}
function mergeLegacyAndExtended(legacy,extended,{maxContribution=0.2,minCoverage=0.4}={}){
 const coverageOK=extended.coverage>=minCoverage&&extended.score!==null;
 const weight=coverageOK?Math.max(0,Math.min(.2,maxContribution)):0;
 const base=legacy.finalScore;
 return {...legacy,legacyScore:base,extendedFactors:extended,
  factorFusion:{applied:weight>0,weight,reason:weight?'有效扩展因子融合':'覆盖率不足，保留原策略评分'},
  finalScore:+(base*(1-weight)+(extended.score??base)*weight).toFixed(2)};
}
module.exports={scoreExtendedFactors,mergeLegacyAndExtended};
