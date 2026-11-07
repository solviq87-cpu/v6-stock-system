'use strict';
const pack=require('../../strategies/extended-factor-pack.json');
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
// 可选严格模式：只有可追溯、非模拟、未过期的因子才参与融合。
// 不启用时保持原有评分结果和阈值不变。
function verifyFactorEvidence(field,evidence,{asOf=Date.now(),maxAgeMs=15*60*1000}={}){
 const e=evidence&&evidence[field];
 if(!e||typeof e!== 'object')return {valid:false,reason:'缺少因子数据来源'};
 if(e.simulated===true||e.mode==='simulation')return {valid:false,reason:'模拟因子不得进入实盘评分'};
 if(typeof e.source!=='string'||!e.source.trim())return {valid:false,reason:'缺少可追溯来源'};
 const timestamp=typeof e.timestamp==='number'?e.timestamp:Date.parse(e.timestamp);
 if(!Number.isFinite(timestamp)||timestamp>asOf+60000||asOf-timestamp>maxAgeMs)return {valid:false,reason:'因子时间戳无效或已过期'};
 return {valid:true,source:e.source,timestamp};
}
function scoreExtendedFactors(stock={},config=pack,options={}){
 const present=[],missing=[],groups={};
 for(const f of config.factors){
  const v=stock[f.field];
  if(!valid(v)){missing.push({id:f.id,label:f.label,reason:'未提供有效0-100实测因子'});continue;}
  if(options.requireEvidence){
   const proof=verifyFactorEvidence(f.field,options.evidence||stock.factorEvidence,options);
   if(!proof.valid){missing.push({id:f.id,label:f.label,reason:proof.reason});continue;}
  }
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
module.exports={scoreExtendedFactors,mergeLegacyAndExtended,verifyFactorEvidence};
