'use strict';
// Read-only views of the original candidate intersection and frozen plan
// observations. No new orders, notification, execution or approval rights.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const round=x=>finite(x)?+x.toFixed(6):null;
function candidateOpportunityReview(candidate,risk,intersection,asOf){
 const id=String(candidate?.code??candidate?.symbol??''),score=finite(candidate?.finalScore)?candidate.finalScore:null;
 const base={mode:'original-candidate-evidence-review-v1',symbol:code(id)?id:null,originalScore:score,riskStatus:'unknown',quoteStatus:'unknown',quote:null,priceOpportunity:null,netValue:null,executionStatus:'not-certified',canTrade:false,canNotify:false};
 if(!code(id)||!time(asOf))return base;
 const blocked=candidate.isST===true||candidate.suspended===true||candidate.tradable===false||finite(candidate.riskScore)&&candidate.riskScore>=85||risk?.code===id&&risk.riskStatus==='blocked';
 const riskStatus=blocked?'blocked':risk?.code===id&&risk.riskStatus==='research-only'&&risk.evidenceReady===true?'research-evidence-only':'unknown';
 const q=Array.isArray(intersection?.items)?intersection.items.filter(r=>r?.code===id):[];
 let quote=null,quoteStatus='unknown';
 if(q.length===1){const r=q[0];if(intersection.usable===true&&r.canTrade===false&&r.source===intersection.source&&typeof r.source==='string'&&r.source&&r.requestDate===intersection.date&&time(r.quoteAt)&&r.quoteAt<=asOf&&r.quoteDate===day(r.quoteAt)&&r.quoteDate===day(asOf)&&finite(r.observedLatestPrice)&&r.observedLatestPrice>0&&r.quoteTimeStatus==='recent-source-unverified'){
  quote={price:r.observedLatestPrice,quoteAt:r.quoteAt,source:r.source,ageMs:asOf-r.quoteAt};quoteStatus=asOf-r.quoteAt<=15000?'recent-source-unverified':'stale-for-15s-gate';
 }}
 return {...base,riskStatus,quoteStatus,quote,executionStatus:blocked?'blocked-by-original-risk':'not-certified'};
}
// Only consume the original matched-cost, mature review rows. A retrospective
// choice cannot become a claimed opportunity known at the decision time.
function compareOpportunityCost(frozen,rows,complete){
 const base={mode:'frozen-alternative-opportunity-cost-v1',status:'not-comparable',horizonDays:frozen?.horizonDays??null,period:null,rows:[],canTrade:false,actualExecutionClaim:false,independentValueCertified:false};
 if(complete!==true||frozen?.classification!=='prospective'||!time(frozen.recordedAt)||!Number.isSafeInteger(frozen.horizonDays)||frozen.horizonDays<1||frozen.horizonDays>60||!Array.isArray(rows)||rows.length<2||rows.length>5||new Set(rows.map(r=>r?.id)).size!==rows.length||!rows.every(r=>r&&r.status==='hypothetical-evaluated'&&[r.netPnl,r.grossPnl,r.totalCosts].every(finite)&&r.totalCosts>=0&&Math.abs(r.grossPnl-r.totalCosts-r.netPnl)<=.011&&time(r.periodStartAt)&&time(r.periodEndAt)&&r.periodStartAt<r.periodEndAt&&r.periodStartAt>=frozen.recordedAt&&r.periodStartAt===rows[0].periodStartAt&&r.periodEndAt===rows[0].periodEndAt))return base;
 const hold=rows.filter(r=>r.action==='hold'),cash=rows.filter(r=>r.action==='cash');
 return {...base,status:hold.length===1&&cash.length===1?'descriptive-both-baselines':'descriptive-partial-baselines',period:{from:rows[0].periodStartAt,to:rows[0].periodEndAt},rows:rows.map(r=>({id:r.id,action:r.action,netPnl:r.netPnl,totalCosts:r.totalCosts,differenceFromHold:hold.length===1?round(r.netPnl-hold[0].netPnl):null,differenceFromCash:cash.length===1?round(r.netPnl-cash[0].netPnl):null}))};
}
// Explicit original observations only. This is a path of sampled prices
// relative to a frozen range, not a registered breakout strategy or fill.
function observedPlanPath(plan,samples,{day:date,cutoff}={}){
 const base={mode:'frozen-range-sampled-path-v1',status:'unknown',planId:plan?.id??null,firstAbove:null,firstReturn:null,firstStop:null,firstTarget:null,invalidated:null,scenarios:[],pathComplete:false,preregisteredBreakout:false,canTrade:false,canNotify:false};
 const frozen=typeof plan?.frozenAt==='string'?Date.parse(plan.frozenAt):null;
 if(!time(cutoff)||!time(frozen)||frozen>cutoff||!code(plan?.code)||typeof date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!Array.isArray(samples)||samples.length>100000||![plan.entryMin,plan.entryMax,plan.stop,plan.target].every(x=>finite(x)&&x>0)||!(plan.stop<plan.entryMin&&plan.entryMin<=plan.entryMax&&plan.entryMax<plan.target))return base;
 const rows=[],seen=new Map();
 for(const r of samples){if(!r||r.planId!==plan.id||r.day!==date||!hash(r.fingerprint)||!time(r.quoteAt)||!time(r.receivedAt)||!time(r.observedAt)||r.quoteAt<frozen||r.quoteAt>r.receivedAt||r.receivedAt>r.observedAt||r.observedAt>cutoff||r.observedAt-r.quoteAt>15000||day(r.quoteAt)!==date||typeof r.source!=='string'||!r.source||!finite(r.price)||r.price<=0)return base;
  const k=r.source+'|'+r.quoteAt;if(seen.has(k)){if(seen.get(k)!==r.price)return {...base,status:'conflicting-samples'};continue;}seen.set(k,r.price);rows.push(r);}
 if(!rows.length)return base;
 if(new Set(rows.map(r=>r.source)).size!==1)return {...base,status:'incompatible-sources'};
 rows.sort((a,b)=>a.quoteAt-b.quoteAt||a.observedAt-b.observedAt);
 if(rows.some((r,i)=>i&&r.observedAt<rows[i-1].observedAt))return {...base,status:'out-of-order-receipts'};
 const ref=r=>r?{evidenceId:r.fingerprint,price:r.price,quoteAt:r.quoteAt,observedAt:r.observedAt,source:r.source}:null;
 const above=rows.find(r=>r.price>plan.entryMax),back=above&&rows.find(r=>r.quoteAt>above.quoteAt&&r.price>=plan.entryMin&&r.price<=plan.entryMax),stop=rows.find(r=>r.price<=plan.stop),target=rows.find(r=>r.price>=plan.target);
 return {...base,status:'sampled-observation-only',firstAbove:ref(above),firstReturn:ref(back),firstStop:ref(stop),firstTarget:ref(target),invalidated:stop?true:null,
  scenarios:[{id:'continuation',condition:'observed-price-above-frozen-entry-range',invalidatedBy:'observed-price-at-or-below-frozen-stop',observed:ref(above),invalidatingEvidence:ref(stop)},{id:'return-to-range',condition:'later-sample-inside-frozen-entry-range',invalidatedBy:'observed-price-at-or-below-frozen-stop',observed:ref(back),invalidatingEvidence:ref(stop)}],scope:'recorded-quote-samples-only; intervening path and OHLC order unknown',observedThrough:rows.at(-1).observedAt};
}
module.exports={candidateOpportunityReview,compareOpportunityCost,observedPlanPath};
