'use strict';
/** Cost/risk evidence from the original settled simulation ledger. Adjusted
 * historical close labels are never passed off as executable strategy returns.
 * This report cannot approve a candidate or change a production weight.
 */
const {createHash}=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0?x:typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
const money=n=>Math.round((n+Number.EPSILON)*100);
const precise=n=>finite(n)&&Number.isSafeInteger(money(n))&&Math.abs(n*100-money(n))<.0001;
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const round=x=>finite(x)?+x.toFixed(8):null;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const real=row=>row&&!['test','demo'].includes(row.sampleSet)&&!['test','demo'].includes(row.scope)&&
  !['test','demo'].includes(row.sampleScope)&&row.synthetic!==true&&row.mock!==true&&row.quality!=='教学样本'&&
  ![true,1,'true','1','是'].includes(row.testSample)&&![true,1,'true','1','是'].includes(row.isTest)&&
  !/^合成教学样本/.test(row.name||'')&&!/(?:^|[-_: /])(fixture|simulated|synthetic|mock|demo)(?:$|[-_: /])/i.test(String(row.source||''));
const settings={minTrades:5,stressSlippageBps:[0,5,10,20],stressFeeMultipliers:[1,2],maximumIndividualLossPct:20};

function verifiedSettlement(trade,plan,now) {
  const p=trade.paperSettlement,entry=time(trade.entryTimestamp),exit=time(trade.exitTimestamp),recorded=time(trade.createdAt),frozen=time(plan?.frozenAt);
  if(!real(trade)||!real(plan)||trade.planVerified!==true||trade.snapshotVerified!==true||!plan||trade.code!==plan.code||
      trade.planId!==plan.id||frozen===null||entry===null||frozen>entry)return {reason:'missing-prior-verified-plan'};
  if(exit===null||recorded===null||exit<=entry||recorded<exit||recorded>now)return {reason:'unmatured-or-unrecorded-settlement'};
  if(!p||p.symbol!==trade.code||p.exitTimestamp!==exit||trade.sourceFingerprint!==digest(p)||
      !Array.isArray(p.entryFills)||!p.entryFills.length||p.entryFills.length>500||
      !Number.isSafeInteger(p.exitQuantity)||p.exitQuantity<=0||!finite(p.exitPrice)||p.exitPrice<=0||
      !Number.isSafeInteger(p.exitGrossCents)||p.exitGrossCents!==money(p.exitPrice*p.exitQuantity)||
      !Number.isSafeInteger(p.exitFeeCents)||p.exitFeeCents<0||!Number.isSafeInteger(p.costBasisCents)||p.costBasisCents<=0||
      !Number.isSafeInteger(p.realizedCents))return {reason:'missing-or-inconsistent-original-ledger-proof'};
  if(p.entryFills.some(leg=>!Number.isSafeInteger(leg.quantity)||leg.quantity<=0||!Number.isSafeInteger(leg.grossCents)||leg.grossCents<=0||
      !Number.isSafeInteger(leg.costCents)||leg.costCents<leg.grossCents||!time(leg.time)||leg.time>=exit||day(leg.time)>=day(exit))||
      Math.min(...p.entryFills.map(row=>row.time))!==entry||
      p.entryFills.reduce((sum,row)=>sum+row.quantity,0)!==p.exitQuantity||
      p.entryFills.reduce((sum,row)=>sum+row.costCents,0)!==p.costBasisCents)
    return {reason:'settlement-quantity-basis-or-t-plus-one-mismatch'};
  const entryGross=p.entryFills.reduce((sum,row)=>sum+row.grossCents,0),cost=p.costBasisCents-entryGross+p.exitFeeCents,
    net=p.exitGrossCents-p.exitFeeCents-p.costBasisCents;
  if(net!==p.realizedCents||!precise(trade.cost)||money(trade.cost)!==cost||!precise(trade.pnlAmount)||money(trade.pnlAmount)!==net||
      !precise(trade.costBasis)||money(trade.costBasis)!==p.costBasisCents||trade.shares!==p.exitQuantity)
    return {reason:'recorded-cost-or-net-pnl-mismatch'};
  const quality=trade.blackSwan===true||trade.quality==='黑天鹅'?'black-swan':
    trade.extreme===true||trade.repeatable===false||trade.quality==='不可复制极端行情'?'extreme':'standard';
  return {row:{id:trade.id,planId:plan.id,code:trade.code,signalDay:day(frozen),entry,exit,recorded,knownAt:Math.max(recorded,exit),
    entryGrossCents:entryGross,exitGrossCents:p.exitGrossCents,costBasisCents:p.costBasisCents,costCents:cost,netCents:net,
    strategy:plan.strategy||trade.strategy||'unknown',regime:plan.trend||trade.trend||'unknown',
    cycle:plan.frozenSnapshot?.emotion?.stage||trade.frozenLabels?.cycle||trade.frozenLabels?.emotion||'unknown',quality,
    fingerprint:trade.sourceFingerprint,canTrade:false}};
}
function summary(rows,{slippageBps=0,feeMultiplier=1}={}) {
  const ordered=[...rows].sort((a,b)=>a.exit-b.exit||a.id.localeCompare(b.id));
  let cumulative=0,peak=0,drawdown=0;
  const outcomes=ordered.map(row=>{
    const additionalSlippage=(row.entryGrossCents+row.exitGrossCents)*slippageBps/10000;
    const additionalFees=row.costCents*(feeMultiplier-1),net=row.netCents-additionalSlippage-additionalFees;
    cumulative+=net;peak=Math.max(peak,cumulative);drawdown=Math.max(drawdown,peak-cumulative);
    return {id:row.id,net,returnPct:net/row.costBasisCents*100};
  });
  const positives=outcomes.filter(row=>row.net>0),negatives=outcomes.filter(row=>row.net<0),wins=positives.reduce((s,r)=>s+r.net,0),loss=-negatives.reduce((s,r)=>s+r.net,0);
  return {trades:rows.length,meanTradeNetReturnPct:round(mean(outcomes.map(row=>row.returnPct))),
    winRatePct:rows.length?round(positives.length/rows.length*100):null,netPnlCny:rows.length?round(cumulative/100):null,
    profitFactor:loss>0?round(wins/loss):null,maximumIndividualLossPct:rows.length?round(Math.max(0,...outcomes.map(row=>-row.returnPct))):null,
    maxSettledPnlDrawdownCny:rows.length?round(drawdown/100):null,portfolioDrawdownPct:null,
    slippageBps,feeMultiplier,executionBasis:'original-unadjusted-verified-simulation-fills',
    returnBasis:'per-settlement-cost-basis',riskBasis:'cumulative-settled-pnl; no-continuous-equity-series',
    note:'原账本费用已扣；压力只叠加额外双边滑点及费用。累计结算盈亏回撤不冒充全账户权益最大回撤。'};
}
function stress(rows,config=settings) {
  const scenarios=[];
  for(const slippageBps of config.stressSlippageBps)for(const feeMultiplier of config.stressFeeMultipliers)
    scenarios.push(summary(rows,{slippageBps,feeMultiplier}));
  const enough=rows.length>=config.minTrades;
  return {status:enough?'evaluated-settlement-costs':'insufficient-verified-settlements',samples:rows.length,
    minimumSamples:config.minTrades,scenarios,
    costStressPassed:enough?scenarios.every(row=>row.meanTradeNetReturnPct>0):null,
    individualRiskPassed:enough?scenarios.every(row=>row.maximumIndividualLossPct<=config.maximumIndividualLossPct):null,
    portfolioRiskStatus:'missing-continuous-equity-evidence',portfolioDrawdownPct:null,
    productionPromotionAllowed:false};
}
function buildExecutionValidation(archive,walkforward,{now=Date.now()}={}) {
  if(!Number.isSafeInteger(now)||now<=0)throw Error('执行验证时钟无效');
  const plans=new Map((archive?.plans||[]).filter(real).map(row=>[row.id,row])),accepted=[],excluded=[],seen=new Set();
  for(const trade of archive?.scope==='demo'?[]:archive?.trades||[]) {
    const result=verifiedSettlement(trade,plans.get(trade.planId),now);
    if(result.reason){excluded.push({id:trade.id||null,reason:result.reason});continue;}
    if(seen.has(result.row.fingerprint)){excluded.push({id:trade.id,reason:'duplicate-ledger-settlement'});continue;}
    seen.add(result.row.fingerprint);accepted.push(result.row);
  }
  const standard=accepted.filter(row=>row.quality==='standard');
  const strata=Object.fromEntries(['standard','black-swan','extreme'].map(key=>[key,summary(accepted.filter(row=>row.quality===key))]));
  const groups=key=>Object.fromEntries([...new Set(standard.map(row=>row[key]))].map(value=>[value,stress(standard.filter(row=>row[key]===value))]));
  const folds=(walkforward?.folds||[]).map(fold=>{
    const phases={};
    for(const phase of ['train','validation','test']) {
      const range=fold.ranges[phase],cutoff=phase==='train'?Date.parse(fold.trainLabelCutoff):phase==='validation'?Date.parse(fold.validationLabelCutoff):now+1;
      phases[phase]=stress(standard.filter(row=>row.signalDay>=range.start&&row.signalDay<=range.end&&row.knownAt<cutoff));
    }
    return {id:fold.id,phases,passed:Object.values(phases).every(row=>row.costStressPassed&&row.individualRiskPassed),
      portfolioRiskStatus:'missing-continuous-equity-evidence',productionPromotionAllowed:false};
  });
  return {status:standard.length?'observed-verified-simulation-settlements':'missing-verified-frozen-settlements',
    method:'frozen-plan-and-original-ledger-cost-validation',acceptedTrades:accepted.length,standardTrades:standard.length,
    excludedCount:excluded.length,excluded:excluded.slice(-40),settings:{...settings,stressSlippageBps:[...settings.stressSlippageBps],
      stressFeeMultipliers:[...settings.stressFeeMultipliers]},strata,byRegime:groups('regime'),byCycle:groups('cycle'),
    overall:stress(standard),folds,fingerprint:digest(accepted.map(row=>({id:row.id,planId:row.planId,fingerprint:row.fingerprint}))),
    canTrade:false,canApprove:false,productionWeightsChanged:false,
    note:'只验证已经发生且与事前计划匹配的原模拟结算；hfq 次日标签 IC 不当作成交收益。正式晋级仍需原五项验证及人工批准。'};
}
module.exports={verifiedSettlement,buildExecutionValidation};
