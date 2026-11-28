'use strict';

// F28 / F08.4: offline, conditional CNY cash-settled index derivative research.
// No data collection, provider certification, trade permission or production
// thresholds. A supplied permission/receipt reference is a declaration, not
// a verified entitlement. The original market-context collector is unchanged.
const DAY=86400000,YEAR=365*DAY,MAX_QUOTE_AGE=15000,MAX_RATE_AGE=7*DAY;
const FLAGS=Object.freeze({researchOnly:true,authorizationVerified:false,sourceVerified:false,
 liveDataVerified:false,modelIndependentlyValidated:false,riskPreference:null,
 canTrade:false,canTrain:false,canNotify:false});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:/-]{1,120}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const bad=x=>['synthetic','simulated','fixture','mock','conflict','retracted','sourceConflict','testSample'].some(k=>x?.[k]===true);
const positive=x=>finite(x)&&x>0&&x<=1e8;
const policy=Object.freeze({model:'black-scholes-merton',dayCount:'ACT/365F',carryBasis:'continuous-rate-and-yield',
 exercise:'European',settlement:'cash',currency:'CNY',unit:'index-points',
 quoteAgeMs:MAX_QUOTE_AGE,quotePairSkewMs:MAX_QUOTE_AGE,rateAgeMs:MAX_RATE_AGE,
 maxRelativeSpread:0.2,minTimeMs:3600000,maxTimeMs:2*YEAR,
 minVolatility:0.0001,maxVolatility:5,logMoneynessTolerance:0.005,
 minNormalizedVega:0.0001});
const unknown=(contractId,reason)=>({contractId, status:'unknown',reason});
function base(reason){return {status:'unknown',reason,model:policy,options:[],termStructure:[],
 skew:[],basis:[],...FLAGS};}
function receipt(r,p,maxAge){
 return r&&r.provider===p.provider&&r.datasetId===p.datasetId&&!bad(r)&&hash(r.receiptHash)&&
  time(r.observedAt)&&time(r.receivedAt)&&r.observedAt<=r.receivedAt&&r.receivedAt<=p.asOf&&
  p.asOf-r.observedAt<=maxAge&&p.scope.knownAt<=r.observedAt;
}
function quote(r,p){
 return receipt(r,p,MAX_QUOTE_AGE)&&positive(r.bid)&&positive(r.ask)&&r.ask>=r.bid&&
  (r.ask-r.bid)/(r.bid+(r.ask-r.bid)/2)<=policy.maxRelativeSpread;
}
function validContract(r,p,kind){
 const duration=r?.expiryAt-p.asOf;
 return r?.kind===kind&&id(r.contractId)&&r.underlyingId===p.underlyingId&&r.currency===policy.currency&&
  r.unit===policy.unit&&r.settlement===policy.settlement&&time(r.expiryAt)&&
  duration>=policy.minTimeMs&&duration<=policy.maxTimeMs&&time(r.contractKnownAt)&&
  r.contractKnownAt<=r.observedAt&&hash(r.contractReceiptHash)&&quote(r,p)&&
  Math.abs(r.observedAt-p.spot.observedAt)<=policy.quotePairSkewMs;
}
function findCarry(r,p){
 const matching=p.carry.filter(c=>c?.expiryAt===r.expiryAt);
 if(matching.length!==1)return null;
 const c=matching[0],before=Math.min(p.spot.observedAt,r.observedAt);
 if(!receipt(c,p,MAX_RATE_AGE)||c.underlyingId!==p.underlyingId||c.currency!==policy.currency||
   c.basis!==policy.carryBasis||c.receivedAt>before||!finite(c.rate)||c.rate < -0.2||c.rate>0.3||
   !finite(c.dividendYield)||c.dividendYield<0||c.dividendYield>0.3)return null;
 const t=(r.expiryAt-p.asOf)/YEAR,discount=Math.exp(-c.rate*t),
  forward=p.spot.value*Math.exp((c.rate-c.dividendYield)*t);
 return positive(forward)&&finite(discount)&&discount>0?{t,discount,forward,rate:c.rate,
  dividendYield:c.dividendYield,receiptHash:c.receiptHash}:null;
}
// Standard normal CDF approximation. Normalization and a minimum-vega guard
// avoid reporting numerically indeterminate volatility as a precise answer.
function cdf(x){
 if(x>=9)return 1;if(x<=-9)return 0;
 const z=Math.abs(x),t=1/(1+0.2316419*z);
 const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*
  (0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 return x<0?tail:1-tail;
}
function valueAndVega(right,k,c,sigma){
 const root=Math.sqrt(c.t),w=sigma*root,d1=(Math.log(c.forward/k)+w*w/2)/w,d2=d1-w;
 const price=right==='call'?c.discount*(c.forward*cdf(d1)-k*cdf(d2)):
  c.discount*(k*cdf(-d2)-c.forward*cdf(-d1));
 const vega=c.discount*c.forward*root*Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI);
 return {price,vega};
}
function solve(right,k,c,price,spot){
 const floor=c.discount*Math.max(right==='call'?c.forward-k:k-c.forward,0);
 const ceiling=c.discount*(right==='call'?c.forward:k);
 const eps=Math.max(spot*1e-7,1e-9);
 if(!finite(price)||price<=floor+eps||price>=ceiling-eps)return null;
 let lo=policy.minVolatility,hi=policy.maxVolatility;
 if(price<=valueAndVega(right,k,c,lo).price+eps||
    price>=valueAndVega(right,k,c,hi).price-eps)return null;
 for(let i=0;i<60;i++){
  const mid=(lo+hi)/2;
  if(valueAndVega(right,k,c,mid).price<price)lo=mid;else hi=mid;
 }
 const sigma=(lo+hi)/2,v=valueAndVega(right,k,c,sigma);
 return finite(v.price)&&Math.abs(v.price-price)<=eps&&
  v.vega/spot>=policy.minNormalizedVega?sigma:null;
}
function refs(r,p,c){return {spot:p.spot.receiptHash,quote:r.receiptHash,
 contract:r.contractReceiptHash,carry:c.receiptHash};}
function option(r,p){
 const no=reason=>unknown(r.contractId,reason);
 if(!validContract(r,p,'option')||r.exercise!==policy.exercise||
   !['call','put'].includes(r.right)||!positive(r.strike)||
   r.strike/p.spot.value<0.1||r.strike/p.spot.value>10)return no('INVALID_OPTION_CONTRACT_OR_QUOTE');
 const c=findCarry(r,p);
 if(!c)return no('MISSING_OR_AMBIGUOUS_TENOR_CARRY');
 const mid=r.bid+(r.ask-r.bid)/2;
 const bid=solve(r.right,r.strike,c,r.bid,p.spot.value),
  center=solve(r.right,r.strike,c,mid,p.spot.value),
  ask=solve(r.right,r.strike,c,r.ask,p.spot.value);
 if([bid,center,ask].some(x=>x===null)||bid>center||center>ask)
  return no('NO_RELIABLE_IMPLIED_VOLATILITY_ROOT');
 return {contractId:r.contractId,status:'conditional-model-implied',right:r.right,strike:r.strike,
  expiryAt:r.expiryAt,observedAt:r.observedAt,logForwardMoneyness:Math.log(r.strike/c.forward),
  forwardReference:c.forward,volatility:{bid,mid:center,ask},quote:{bid:r.bid,ask:r.ask},
  carry:{rate:c.rate,dividendYield:c.dividendYield},evidenceRefs:refs(r,p,c)};
}
function pairResult(first,second){
 const a=first.volatility,b=second.volatility;
 return {mid:a.mid-b.mid,lower:a.bid-b.ask,upper:a.ask-b.bid};
}
function term(pair,opts){
 const a=opts.get(pair.nearId),b=opts.get(pair.farId);
 const out={nearId:pair.nearId,farId:pair.farId,status:'unknown',
  reason:'NONCOMPARABLE_TERM_PAIR',farMinusNear:null};
 if(a?.status!=='conditional-model-implied'||b?.status!=='conditional-model-implied'||
  a.right!==b.right||a.expiryAt>=b.expiryAt||
  Math.abs(a.observedAt-b.observedAt)>policy.quotePairSkewMs||
  Math.abs(a.logForwardMoneyness-b.logForwardMoneyness)>policy.logMoneynessTolerance)return out;
 return {...out,status:'conditional-matched-moneyness',reason:null,
  farMinusNear:pairResult(b,a),nearLogMoneyness:a.logForwardMoneyness,
  farLogMoneyness:b.logForwardMoneyness};
}
function skew(pair,opts){
 const p=opts.get(pair.putId),c=opts.get(pair.callId);
 const out={putId:pair.putId,callId:pair.callId,status:'unknown',
  reason:'NONCOMPARABLE_SKEW_PAIR',putMinusCall:null};
 if(p?.status!=='conditional-model-implied'||c?.status!=='conditional-model-implied'||
  p.right!=='put'||c.right!=='call'||p.expiryAt!==c.expiryAt||
  Math.abs(p.observedAt-c.observedAt)>policy.quotePairSkewMs||
  p.logForwardMoneyness>=0||c.logForwardMoneyness<=0||
  Math.abs(Math.abs(p.logForwardMoneyness)-c.logForwardMoneyness)>policy.logMoneynessTolerance)return out;
 return {...out,status:'conditional-symmetric-otm-skew',reason:null,putMinusCall:pairResult(p,c),
  putLogMoneyness:p.logForwardMoneyness,callLogMoneyness:c.logForwardMoneyness};
}
// One shared F08.4/F28.4 carry reference, not a second basis definition.
// Continuous carry is a conditional theoretical reference; futures margin,
// daily settlement convexity, fees and actual executable arbitrage are unknown.
function basis(r,p){
 if(!validContract(r,p,'future'))return unknown(r.contractId,'INVALID_FUTURE_CONTRACT_OR_QUOTE');
 const c=findCarry(r,p);
 if(!c)return unknown(r.contractId,'MISSING_OR_AMBIGUOUS_TENOR_CARRY');
 const mid=r.bid+(r.ask-r.bid)/2,s=p.spot.value;
 return {contractId:r.contractId,status:'conditional-carry-reference',expiryAt:r.expiryAt,
  observedAt:r.observedAt,spot:s,futureMid:mid,carryFairReference:c.forward,
  rawBasisPoints:mid-s,rawBasisPct:(mid/s-1)*100,
  carryAdjustedPoints:mid-c.forward,carryAdjustedPct:(mid/c.forward-1)*100,
  carryAdjustedBounds:{lower:r.bid-c.forward,upper:r.ask-c.forward},
  realizedCarry:null,executionCost:null,arbitrageVerified:false,
  carry:{rate:c.rate,dividendYield:c.dividendYield},evidenceRefs:refs(r,p,c)};
}
function validPairs(rows,a,b,ids){
 if(!Array.isArray(rows)||rows.length>32)return false;
 const seen=new Set();
 for(const r of rows){
  if(!r||!ids.has(r[a])||!ids.has(r[b])||r[a]===r[b])return false;
  const key=r[a]+'/'+r[b];
  if(seen.has(key))return false;seen.add(key);
 }
 return true;
}
function reviewDerivativeRisk(p,{asOf}={}){
 const no=base('MISSING_DECLARED_RESEARCH_SCOPE_OR_SNAPSHOT');
 if(!p||bad(p)||p.schemaVersion!==1||p.source!=='imported'||
  !time(asOf)||p.asOf!==asOf||!id(p.provider)||!id(p.datasetId)||!id(p.underlyingId)||
  !hash(p.snapshotReceiptHash)||p.model!==policy.model||p.dayCount!==policy.dayCount||
  p.scope?.usage!=='private-derivatives-research'||bad(p.scope)||
  !id(p.scope.permissionRef)||p.scope.provider!==p.provider||p.scope.datasetId!==p.datasetId||
  p.scope.underlyingId!==p.underlyingId||!time(p.scope.knownAt)||!time(p.scope.validUntil)||
  p.scope.knownAt>asOf||p.scope.validUntil<=asOf||
  !Array.isArray(p.scope.allowedKinds)||new Set(p.scope.allowedKinds).size!==p.scope.allowedKinds.length||
  !p.scope.allowedKinds.every(k=>['option','future'].includes(k))||
  !Array.isArray(p.options)||p.options.length>64||
  !Array.isArray(p.futures)||p.futures.length>16||
  !Array.isArray(p.carry)||p.carry.length>32||
  p.options.length&&!p.scope.allowedKinds.includes('option')||
  p.futures.length&&!p.scope.allowedKinds.includes('future'))return no;
 if(!receipt(p.spot,p,MAX_QUOTE_AGE)||!positive(p.spot.value)||
  p.spot.underlyingId!==p.underlyingId||p.spot.currency!==policy.currency||
  p.spot.unit!==policy.unit)return {...no,reason:'MISSING_MATCHED_ORIGINAL_SPOT'};
 const ids=new Set();
 for(const r of [...p.options,...p.futures]){
  if(!id(r?.contractId)||ids.has(r.contractId))return {...no,reason:'AMBIGUOUS_CONTRACT_IDENTITY'};
  ids.add(r.contractId);
 }
 const optIds=new Set(p.options.map(r=>r.contractId));
 if(!validPairs(p.termPairs,'nearId','farId',optIds)||!validPairs(p.skewPairs,'putId','callId',optIds))
  return {...no,reason:'INVALID_EXPLICIT_COMPARISON_PLAN'};
 const options=p.options.map(r=>option(r,p)),opts=new Map(options.map(r=>[r.contractId,r]));
 const termStructure=p.termPairs.map(pair=>term(pair,opts)),skews=p.skewPairs.map(pair=>skew(pair,opts));
 const futures=p.futures.map(r=>basis(r,p));
 const available=[...options,...futures].some(r=>r.status!=='unknown');
 return {...no,status:available?'conditional-research':'unknown',
  reason:available?null:'NO_USABLE_CONTRACT',snapshotReceiptHash:p.snapshotReceiptHash,asOf,
  options,termStructure,skew:skews,basis:futures,
  note:'输入为声明的研究许可和原始时点回执引用；未独立认证。波动率为小数，价差区间不是置信区间；不生成方向、训练或下单信号。'};
}
module.exports={reviewDerivativeRisk};
