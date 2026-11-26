'use strict';
function applyRiskFilter(s={}) {
  const reasons=[];
  if (s.isST) reasons.push('ST/风险标的');
  if (s.suspended) reasons.push('停牌');
  if (s.tradable===false) reasons.push('当前不可交易');
  if (Number(s.amount||0)>0 && Number(s.amount)<5e6) reasons.push('成交额流动性不足');
  if (Number(s.riskScore||0)>=85) reasons.push('综合风险过高');
  const hardBlock=reasons.some(x=>/ST|停牌|不可交易|风险过高/.test(x));
  return {pass:!hardBlock,reasons,hardBlock};
}

// Candidate-only monetary evidence; account execution and the original
// applyRiskFilter contract are unchanged. Never infer turnover from volume/price.
const MIN_CANDIDATE_AMOUNT=5e6; // existing research liquidity threshold
const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
const scalar=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v));
const provided=v=>v!=null&&!(typeof v==='string'&&v.trim()==='');
function inspectCandidateAmount(raw={}){
 const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const values=['amount','成交额'].filter(k=>own(row,k)&&provided(row[k])).map(k=>row[k]);
 const result=(status,reportedAmount=null,amountYuan=null,unitBasis=null)=>({
  status,reportedAmount,amountYuan,unitBasis,minAmountYuan:MIN_CANDIDATE_AMOUNT,
  basis:'candidate-reported-amount-not-source-time-certified',canTrade:false
 });
 if(!values.length)return result('missing');
 if(values.some(v=>!scalar(v)||Number(v)<0))return result('invalid');
 const value=Number(values[0]);
 if(values.some(v=>Number(v)!==value))return result('conflict');
 const units=[row.amountUnit,row.quoteUnits?.amount].filter(v=>v!=null);
 if(units.some(v=>v!==units[0]))return result('unit-conflict',value);
 if(units.length&&units[0]!=='CNY')return result('invalid-unit',value);
 const normalized=typeof row.quoteSource==='string'&&/^(eastmoney|tencent|sina)$/.test(row.quoteSource)&&row.quoteMode==='public-live-unverified';
 const basis=units.length?'declared-CNY':normalized?'existing-normalized-quote-contract':'legacy-unspecified';
 const status=value===0?'zero':value<MIN_CANDIDATE_AMOUNT?'insufficient':'sufficient';
 return result(status,value,basis==='legacy-unspecified'?null:value,basis);
}
function prepareCandidateRisk(normalized,raw,{requireLiquidityEvidence=false}={}){
 const liquidity=inspectCandidateAmount(raw);
 const legacyAmount=liquidity.unitBasis==='legacy-unspecified'&&!requireLiquidityEvidence?liquidity.reportedAmount:null;
 const amount=liquidity.amountYuan??legacyAmount;
 const snapshot={...normalized,amount};
 // Preserve a separately supplied score for research display; it cannot override this gate.
 const declared=['liquidityScore','流动性评分'].filter(k=>own(raw||{},k)&&provided(raw[k]));
 if(!declared.length)snapshot.liquidityScore=amount===null?null:amount===0?0:amount>=5e7?80:amount>=1e7?60:30;
 const risk=applyRiskFilter(snapshot),reasons=[...risk.reasons];
 const malformed=['invalid','conflict','unit-conflict','invalid-unit'].includes(liquidity.status);
 const strictBlocked=requireLiquidityEvidence&&(liquidity.amountYuan===null||liquidity.status!=='sufficient');
 const blocked=malformed||liquidity.status==='zero'||strictBlocked;
 const reason=liquidity.status==='zero'?'原始成交额为零':
  malformed?'成交额数值或单位异常、冲突':
  requireLiquidityEvidence&&liquidity.amountYuan===null?'缺少可核对的人民币成交额':
  strictBlocked?'成交额流动性不足':null;
 if(reason&&!reasons.includes(reason))reasons.push(reason);
 return {snapshot,risk:{...risk,pass:risk.pass&&!blocked,hardBlock:risk.hardBlock||blocked,reasons,
  liquidity:{...liquidity,strict:!!requireLiquidityEvidence,blocked,
   eligibleForStrictCandidate:liquidity.amountYuan!==null&&liquidity.status==='sufficient'}}};
}
module.exports={applyRiskFilter,inspectCandidateAmount,prepareCandidateRisk};
