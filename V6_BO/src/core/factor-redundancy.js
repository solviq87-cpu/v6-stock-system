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
const round=(x,n=6)=>x===null?null:+x.toFixed(n);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const validLabel=v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v);
const reliablePositive=r=>r?.reliable===true&&finite(r.meanIC)&&r.meanIC>=.03&&r.meanIC<=1;
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
 if(!Array.isArray(x)||!Array.isArray(y)||x.length!==y.length||x.length<MIN_PAIR_ROWS||
  !x.every(finite)||!y.every(finite))return null;
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
    !reliability||typeof reliability!=='object')
  throw Error('冻结因子冗余评估协议无效');
 const seenDays=new Set();
 for(const [i,d] of train.entries()){
  if(!d||!validDay(d.day)||seenDays.has(d.day)||i>0&&train[i-1].day>=d.day||
     !Array.isArray(d.rows)||d.rows.length<MIN_PAIR_ROWS)
   throw Error('冻结因子冗余训练日日期无效、重复、顺序异常或横截面不足');
  seenDays.add(d.day);
  // Existing value-only diagnostic inputs remain compatible, but whenever
  // identities are declared, a partial or repeated cross-section is not
  // independent evidence. Market is part of a declared security identity.
  const identified=d.rows.some(row=>row&&['symbol','code','market'].some(k=>Object.hasOwn(row,k)));
  if(identified){
   const securities=new Set();
   for(const row of d.rows){
    const symbol=row?.symbol??row?.code,market=row?.market;
    if(!validLabel(symbol)||row.symbol!=null&&row.code!=null&&row.symbol!==row.code||
       market!=null&&!validLabel(market))
     throw Error('冻结因子冗余证券身份无效或缺失');
    const key=JSON.stringify([market??null,symbol]);
    if(securities.has(key))throw Error('冻结因子冗余横截面证券重复');
    securities.add(key);
   }
  }
 }
 const requiredDays=Math.max(MIN_DAYS,Math.ceil(train.length*MIN_COVERAGE));
 const pairs=[];
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],b=ids[j],daily=[];let comparedRows=0,exactEqualRows=0,exactEqualDays=0;
  for(const d of train){
   const xa=[],xb=[];
   for(const row of d.rows){
    const x=row?.values?.[a],y=row?.values?.[b];
    if(!finite(x)||!finite(y)||x<0||x>100||y<0||y>100)
     throw Error('因子冗余评估不可补造缺失或无效冻结分数');
    xa.push(x);xb.push(y);
   }
   comparedRows+=xa.length;const equal=xa.filter((x,k)=>x===xb[k]).length;exactEqualRows+=equal;if(equal===xa.length)exactEqualDays++;
   const corr=spearman(xa,xb);
   if(corr!==null)daily.push(corr);
  }
  const count=daily.length;
  const med=count?median(daily):null;
  const split=Math.floor(count/2);
  const early=count>=2?mean(daily.slice(0,split)):null;
  const recent=count>=2?mean(daily.slice(split)):null;
  const positiveStrong=count?daily.filter(x=>x>=.9).length/count:0;
  const negativeStrong=count?daily.filter(x=>x<=-.9).length/count:0;
  const stablePositive=count>=requiredDays&&med>=MIN_CORRELATION&&
   early>=.9&&recent>=.9&&positiveStrong>=MIN_STRONG_DAYS;
  const stableNegative=count>=requiredDays&&med<=-MIN_CORRELATION&&
   early<=-.9&&recent<=-.9&&negativeStrong>=MIN_STRONG_DAYS;
  const eligiblePositive=stablePositive&&
   reliablePositive(reliability[a])&&reliablePositive(reliability[b]);
  pairs.push({factorA:a,factorB:b,trainingDays:train.length,
   comparableDays:count,requiredDays,medianRankCorrelation:round(med),
   earlyMeanRankCorrelation:round(early),recentMeanRankCorrelation:round(recent),
   positiveStrongDayPct:round(positiveStrong*100,2),
   negativeStrongDayPct:round(negativeStrong*100,2),
   exactValueEvidence:{basis:'original-frozen-training-values',comparedRows,exactEqualRows,exactEqualDays,expectedDays:train.length,
    status:train.length<MIN_DAYS?'insufficient-training-days':exactEqualDays===train.length?'identical-observed-values':'not-identical-across-window',
    definitionEquivalent:null,changesOriginalSuppression:false},
   relationship:stablePositive?'strong-positive':
    stableNegative?'strong-inverse':'not-established',
   eligibleForSuppression:eligiblePositive});
 }
 // Keep the best previously reliable, positive IC factor in each observed
 // positive-collinearity cluster. This is deterministic under any id order.
 const ordered=[...ids].sort((a,b)=>{
  const strength=id=>reliablePositive(reliability[id])?reliability[id].meanIC:-1;
  const delta=strength(b)-strength(a);
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
  conservativeShadowPenalty:SHADOW_PENALTY,pairs,exactValueDuplicatePairs:pairs.filter(p=>p.exactValueEvidence.status==='identical-observed-values').map(p=>({factorA:p.factorA,factorB:p.factorB,...p.exactValueEvidence})),suppressedFactors:suppressed,
  suppressedFactorIds:suppressed.map(x=>x.factorId),
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessFactorRedundancy,spearman};
