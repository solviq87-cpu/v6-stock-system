'use strict';
const pack=require('../../strategies/extended-factor-pack.json');
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
// 可选严格模式：只有可追溯、非模拟、未过期的因子才参与融合。
// 不启用时保持原有评分结果和阈值不变。
const own=(row,key)=>row!=null&&Object.prototype.hasOwnProperty.call(row,key);
const record=row=>row!=null&&typeof row==='object'&&!Array.isArray(row);
const instant=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15;
const age=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
function parseInstant(v){
 if(instant(v))return v;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))return null;
 const day=v.slice(0,10),midnight=Date.parse(day+'T00:00:00Z');
 if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==day)return null;
 const t=Date.parse(v);return instant(t)?t:null;
}
const negativeMode=/(?:simulat|synthetic|fixture|mock|backtest|(?:^|[-_:/ .])(?:test|demo|import(?:ed)?|historical|read[-_ ]?only)(?:$|[-_:/ .]))/i;
const defaultMode=/(?:^|[-_:/ .])(?:default(?:ed)?|imput(?:ed|ation)|placeholder|fallback)(?:$|[-_:/ .])/i;
const fail=reason=>({valid:false,reason});
function verifyFactorEvidence(field,evidence,options={}){
 const {asOf=Date.now(),maxAgeMs=15*60*1000,maxEvidenceAgeMs,requireFeedValidation=false,subject,value}=options;
 const maxAge=maxEvidenceAgeMs??maxAgeMs;
 const e=record(evidence)&&own(evidence,field)?evidence[field]:null;
 if(!record(e)||!own(e,'source')||!own(e,'timestamp'))return fail('缺少因子数据来源');
 if(!instant(asOf)||!age(maxAge))return fail('因子校验时点或有效期无效');
 if(['simulated','synthetic','mock','fixture','imported','readOnlyBackup'].some(k=>e[k]===true)||e.mode==='simulation')
  return fail('模拟或只读因子不得进入证据评分');
 if(typeof e.source!=='string'||!e.source.trim()||e.source!==e.source.trim())return fail('缺少可追溯来源');
 const modes=[e.mode,e.quoteMode,e.dataMode,e.evidenceMode,e.status].filter(v=>v!=null);
 if(modes.some(v=>typeof v!=='string'||defaultMode.test(v))||
    ['defaulted','imputed','placeholder','fallback'].some(k=>e[k]===true))
  return fail('默认或填补因子不是观测证据');
 if(requireFeedValidation&&(negativeMode.test(e.source)||modes.some(v=>negativeMode.test(v))))
  return fail('真实行情模式拒绝非真实来源或证据模式');
 const timestamp=parseInstant(e.timestamp);
 if(timestamp===null||timestamp>asOf||asOf-timestamp>maxAge)return fail('因子时间戳无效或已过期');
 // If raw observation/availability metadata is supplied, never overwrite it
 // with a newer ingestion timestamp or accept evidence not yet knowable.
 for(const key of ['sourceTimestamp','observedAt','quoteAt']){
  if(!own(e,key)||e[key]==null)continue;
  const raw=parseInstant(e[key]);
  if(raw===null||raw!==timestamp)return fail('因子原始观察时间冲突');
 }
 for(const key of ['receivedAt','knownAt','availableAt','recordedAt']){
  if(!own(e,key)||e[key]==null)continue;
  const at=parseInstant(e[key]);
  if(at===null||at<timestamp||at>asOf)return fail('因子接收或可知时间无效');
 }
 const identities=[e.code,e.symbol].filter(v=>v!=null);
 const ids=record(subject)?[subject.code,subject.symbol].filter(v=>v!=null):[];
 const goodId=v=>typeof v==='string'&&v.trim()!==''&&v===v.trim();
 if(identities.some(v=>!goodId(v)||v!==identities[0])||
    ids.some(v=>!goodId(v)||v!==ids[0])||
    (identities.length&&record(subject)&&(!ids.length||identities[0]!==ids[0])))
  return fail('因子证据与股票身份不一致');
 if(own(e,'field')&&e.field!==field)return fail('因子字段身份不一致');
 const declared=['value','score'].filter(k=>own(e,k));
 if(declared.some(k=>!valid(e[k])||e[k]!==e[declared[0]]||value!==undefined&&e[k]!==value))
  return fail('因子证据值与实际评分不一致');
 if(requireFeedValidation){
  const feed=subject?.feed,feedTime=parseInstant(feed?.timestamp);
  if(!record(feed)||e.source!==feed.source||feedTime===null||feedTime>asOf||timestamp>feedTime)
   return fail('因子来源或原时点与行情快照不一致');
 }
 return {valid:true,source:e.source,timestamp,
  identityBinding:identities.length&&ids.length?'explicit-match':'legacy-unbound',
  valueBinding:declared.length&&value!==undefined?'explicit-match':'legacy-unbound',
  verifiedLive:false};
}
function scoreExtendedFactors(stock={},config=pack,options={}){
 // Use one decision clock for every factor in the same scoring operation.
 options={...options,asOf:options.asOf===undefined?Date.now():options.asOf};
 const present=[],missing=[],groups={};
 for(const f of config.factors){
  const v=own(stock,f.field)?stock[f.field]:undefined;
  if(!valid(v)){missing.push({id:f.id,label:f.label,reason:'未提供有效0-100实测因子'});continue;}
  let proof=null;
  if(options.requireEvidence||options.requireFeedValidation){
   proof=verifyFactorEvidence(f.field,options.evidence||stock.factorEvidence,{...options,subject:stock,value:v});
   if(!proof.valid){missing.push({id:f.id,label:f.label,reason:proof.reason});continue;}
  }
  present.push({id:f.id,label:f.label,group:f.group,score:v,weight:f.weight,...(proof?{evidence:proof}:{})});
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
