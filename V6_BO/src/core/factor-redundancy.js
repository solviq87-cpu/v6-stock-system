'use strict';
/**
 * Audits redundant frozen factor ranks using TRAINING data only. This cannot
 * measure incremental alpha causally, and never alters formal weights.
 *
 * Only strong positive rank co-movement between TWO independently reliable,
 * positive-direction factors can trigger a conservative shadow-only penalty.
 * Strong inverse relationships are flagged for review, not auto-pruned.
 */
const MIN_DAYS=15,MIN_COVERAGE=.75,MIN_CORRELATION=.92,MIN_STRONG_DAYS=.8;
const MAX_DAYS=400,MIN_PAIR_ROWS=5,SHADOW_PENALTY=-.02;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const denseFinite=xs=>Array.isArray(xs)&&Array.from({length:xs.length},(_,i)=>
 Object.hasOwn(xs,i)&&finite(xs[i])).every(Boolean);
const validSymbol=s=>typeof s==='string'&&s.length>0&&s.length<=128&&s.trim()===s&&!/[\x00-\x1f\x7f]/.test(s);
function ownIC(reliability,id){
 const r=Object.hasOwn(reliability,id)?reliability[id]:null;
 return r&&typeof r==='object'&&!Array.isArray(r)&&Object.hasOwn(r,'meanIC')&&
  finite(r.meanIC)&&Math.abs(r.meanIC)<=1?r.meanIC:null;
}
function reliablePositive(reliability,id){
 const r=Object.hasOwn(reliability,id)?reliability[id]:null,ic=ownIC(reliability,id);
 return r&&typeof r==='object'&&Object.hasOwn(r,'reliable')&&r.reliable===true&&ic!==null&&ic>=.03;
}
const round=(x,n=6)=>x===null?null:+x.toFixed(n);
const mean=x=>x.reduce((s,v)=>s+v,0)/x.length;
const median=x=>{
 const v=[...x].sort((a,b)=>a-b),m=Math.floor(v.length/2);
 return v.length%2?v[m]:(v[m-1]+v[m])/2;
};
function ranks(values){
 const ordered=values.map((value,index)=>({value,index}))
  .sort((a,b)=>a.value-b.value);
 const out=new Array(values.length);
 for(let i=0;i<ordered.length;){
  let j=i+1;while(j<ordered.length&&ordered[j].value===ordered[i].value)j++;
  const rank=(i+j-1)/2;
  for(let k=i;k<j;k++)out[ordered[k].index]=rank;
  i=j;
 }
 return out;
}
function spearman(x,y){
 if(!denseFinite(x)||!denseFinite(y)||x.length!==y.length||x.length<MIN_PAIR_ROWS)return null;
 const a=ranks(x),b=ranks(y),am=mean(a),bm=mean(b);
 let cov=0,aa=0,bb=0;
 for(let i=0;i<a.length;i++){
  const dx=a[i]-am,dy=b[i]-bm;cov+=dx*dy;aa+=dx*dx;bb+=dy*dy;
 }
 return aa&&bb?cov/Math.sqrt(aa*bb):null;
}
function assessFactorRedundancy(train,ids,reliability){
 if(!Array.isArray(train)||train.length>MAX_DAYS||
    !Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||
    ids.some(id=>typeof id!=='string'||!id)||
    !reliability||typeof reliability!=='object'||Array.isArray(reliability))
  throw Error('冻结因子冗余评估协议无效');
 let previous=null;
 const named=train.some(d=>Array.isArray(d?.rows)&&d.rows.some(row=>row&&Object.hasOwn(row,'symbol')));
 for(const d of train){
  if(!d||!validDay(d.day)||(previous!==null&&d.day<=previous))
   throw Error('冻结因子冗余训练日期无效、重复或倒序');
  if(!Array.isArray(d.rows)||d.rows.length<MIN_PAIR_ROWS)
   throw Error('冻结因子冗余横截面不足');
  if(named){
   const seen=new Set();
   for(const row of d.rows){
    if(!row||!Object.hasOwn(row,'symbol')||!validSymbol(row.symbol)||seen.has(row.symbol))
     throw Error('冻结因子冗余证券身份缺失、无效或重复');
    seen.add(row.symbol);
   }
  }
  previous=d.day;
 }
 const requiredDays=Math.max(MIN_DAYS,Math.ceil(train.length*MIN_COVERAGE));
 const pairs=[];
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],b=ids[j],daily=[];
  for(const d of train){
   const xa=[],xb=[];
   for(const row of d.rows){
    const values=row?.values;
    const x=values?.[a],y=values?.[b];
    if(!values||typeof values!=='object'||Array.isArray(values)||!Object.hasOwn(values,a)||!Object.hasOwn(values,b)||
       !finite(x)||!finite(y)||x<0||x>100||y<0||y>100)
     throw Error('因子冗余评估不可补造缺失或无效冻结分数');
    xa.push(x);xb.push(y);
   }
   const corr=spearman(xa,xb);
   daily.push(corr);
  }
  // Partition the declared chronological training window before removing
  // missing observations. Otherwise late correlations can masquerade as early.
  const observed=daily.filter(finite),count=observed.length;
  const med=count?median(observed):null;
  const split=Math.floor(daily.length/2);
  const earlyRows=daily.slice(0,split).filter(finite),recentRows=daily.slice(split).filter(finite);
  const early=earlyRows.length?mean(earlyRows):null,recent=recentRows.length?mean(recentRows):null;
  const halfCoverage=split>0&&earlyRows.length>=Math.ceil(split*MIN_COVERAGE)&&
   recentRows.length>=Math.ceil((daily.length-split)*MIN_COVERAGE);
  const positiveStrong=count?observed.filter(x=>x>=.9).length/count:0;
  const negativeStrong=count?observed.filter(x=>x<=-.9).length/count:0;
  const stablePositive=halfCoverage&&count>=requiredDays&&med>=MIN_CORRELATION&&
   early>=.9&&recent>=.9&&positiveStrong>=MIN_STRONG_DAYS;
  const stableNegative=halfCoverage&&count>=requiredDays&&med<=-MIN_CORRELATION&&
   early<=-.9&&recent<=-.9&&negativeStrong>=MIN_STRONG_DAYS;
  const eligiblePositive=stablePositive&&reliablePositive(reliability,a)&&reliablePositive(reliability,b);
  pairs.push({factorA:a,factorB:b,trainingDays:train.length,
   comparableDays:count,requiredDays,medianRankCorrelation:round(med),
   earlyMeanRankCorrelation:round(early),recentMeanRankCorrelation:round(recent),
   positiveStrongDayPct:round(positiveStrong*100,2),
   negativeStrongDayPct:round(negativeStrong*100,2),
   relationship:stablePositive?'strong-positive':
    stableNegative?'strong-inverse':'not-established',
   eligibleForSuppression:eligiblePositive});
 }
 // Keep the best previously reliable, positive IC factor in each observed
 // positive-collinearity cluster. This is deterministic under any id order.
 const ordered=[...ids].sort((a,b)=>{
  const delta=(ownIC(reliability,b)??-1)-(ownIC(reliability,a)??-1);
  return Math.abs(delta)>1e-10?delta:a.localeCompare(b);
 });
 const retained=[],suppressed=[];
 for(const id of ordered){
  const duplicateOf=retained.find(kept=>pairs.some(p=>
   p.eligibleForSuppression&&
   ((p.factorA===id&&p.factorB===kept)||
    (p.factorA===kept&&p.factorB===id))));
  if(duplicateOf)suppressed.push({factorId:id,duplicateOf,
   maxShadowAdjustment:SHADOW_PENALTY});
  else retained.push(id);
 }
 return {status:train.length<MIN_DAYS?'insufficient-training-days':'screened',
  evidenceBasis:'frozen-training-only',trainingDays:train.length,
  requiredPairDays:requiredDays,rankCorrelationCutoff:MIN_CORRELATION,
  conservativeShadowPenalty:SHADOW_PENALTY,pairs,suppressedFactors:suppressed,
  suppressedFactorIds:suppressed.map(x=>x.factorId),
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessFactorRedundancy,spearman};
