'use strict';
/** Cost/risk evidence from the original settled simulation ledger. Adjusted
 * historical close labels are never passed off as executable strategy returns.
 * This report cannot approve a candidate or change a production weight.
 */
const {createHash}=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>{
 const t=typeof x==='string'?Date.parse(x):x;
 return Number.isSafeInteger(t)&&t>0&&t<8e15?t:null;
};
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
const money=n=>Math.round((n+Number.EPSILON)*100);
const precise=n=>finite(n)&&Number.isSafeInteger(money(n))&&Math.abs(n*100-money(n))<.0001;
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const round=x=>finite(x)?+x.toFixed(8):null;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const real=require('../../public/nova/shortline/numeric-factors').realEvidence;
const settings={minTrades:5,stressSlippageBps:[0,5,10,20],stressFeeMultipliers:[1,2],maximumIndividualLossPct:20};
const identity=x=>typeof x==='string'&&x.length>0&&x.length<=500&&x.trim()===x;
const centPrice=x=>finite(x)&&Number.isSafeInteger(money(x))&&
  Math.abs(x*100-money(x))<=Number.EPSILON*Math.max(1,Math.abs(x*100))*2;

// Native FIFO allocates rounded remaining cents, so historical fractional-cent
// prices cannot be reconstructed from an individual closed leg alone. Exact
// cent prices have no such allocation residual. Keep that evidence distinction
// instead of rejecting valid native splits or inventing a rounding tolerance.
function settlementContent(proof,planId){
  const {accountId,symbol,exitEventId,exitOrderId,exitTimestamp,exitQuantity,exitPrice,tradeDate,
    exitGrossCents,exitFeeCents,costBasisCents,realizedCents}=proof;
  return {accountId,symbol,exitEventId,exitOrderId,exitTimestamp,exitQuantity,exitPrice,tradeDate,
    exitGrossCents,exitFeeCents,costBasisCents,realizedCents,planId,
    entryFills:proof.entryFills.map(({eventId,orderId,time,price,quantity,grossCents,costCents})=>
      ({eventId,orderId,time,price,quantity,grossCents,costCents}))};
}

// Historical attribution may use only the prior plan and the receipt
// actually visible at the report cutoff. Exact native links disambiguate
// old plan revisions; legacy declarations cannot select a conflicting copy.
function priorPlan(plan,trade){
 const frozen=time(plan?.frozenAt),entry=time(trade?.entryTimestamp);
 return real(plan)&&identity(plan.id)&&trade?.planId===plan.id&&trade.code===plan.code&&
  frozen!==null&&entry!==null&&frozen<=entry&&
  ['createdAt','recordedAt','knownAt'].every(k=>!Object.hasOwn(plan,k)||
   (time(plan[k])!==null&&time(plan[k])<=entry));
}
function selectPriorPlan(plans,trade){
 const candidates=new Map();
 const linked=Object.hasOwn(trade||{},'decisionLink');
 for(const plan of plans||[]){
  if(!priorPlan(plan,trade))continue;
  const fingerprint=digest(plan);
  if(linked&&trade.decisionLink?.planFingerprint!==fingerprint)continue;
  candidates.set(fingerprint,plan);
 }
 if(candidates.size>1)return {reason:'conflicting-prior-plan-evidence'};
 if(!candidates.size)return {reason:linked?'missing-or-inconsistent-original-plan-link':'missing-prior-verified-plan'};
 return {plan:candidates.values().next().value};
}
function futureReceipt(trade,now){
 // A not-yet-visible correction cannot invalidate an already visible exit.
 // Unknown/malformed timestamps remain subject to the normal conflict gate.
 return [trade?.createdAt,trade?.exitTimestamp,trade?.paperSettlement?.exitTimestamp,
  trade?.planLinkedAt,trade?.decisionLink?.knownAt].some(v=>time(v)!==null&&time(v)>now);
}
function verifiedSettlement(trade,plan,now) {
  if(!trade||typeof trade!=='object')return {reason:'missing-prior-verified-plan'};
  const p=trade.paperSettlement,entry=time(trade.entryTimestamp),exit=time(trade.exitTimestamp),recorded=time(trade.createdAt),frozen=time(plan?.frozenAt);
  if(!real(trade)||!identity(trade.id)||trade.planVerified!==true||trade.snapshotVerified!==true||
      !priorPlan(plan,trade))return {reason:'missing-prior-verified-plan'};
  if(exit===null||recorded===null||exit<=entry||recorded<exit||futureReceipt(trade,now))return {reason:'unmatured-or-unrecorded-settlement'};
  const planFingerprint=digest(plan);
  const linked=Object.hasOwn(trade,'decisionLink'),link=trade.decisionLink;
  const linkKnown=linked?time(link?.knownAt):null;
  const linkedAt=Object.hasOwn(trade,'planLinkedAt')?time(trade.planLinkedAt):null;
  if(Object.hasOwn(trade,'planLinkedAt')&&(linkedAt===null||linkedAt<exit)||
     linked&&(!link||linkKnown===null||linkKnown<exit||link.planId!==plan.id||
      !identity(plan.decisionId)||link.decisionId!==plan.decisionId||link.planFingerprint!==planFingerprint||
      (linkedAt!==null&&linkedAt!==linkKnown)))
    return {reason:'missing-or-inconsistent-original-plan-link'};
  if(!p||!['pool','pre'].includes(p.accountId)||!identity(p.exitEventId)||!identity(p.exitOrderId)||
      p.tradeDate!==day(exit)||p.symbol!==trade.code||p.exitTimestamp!==exit||trade.sourceFingerprint!==digest(p)||
      !Array.isArray(p.entryFills)||!p.entryFills.length||p.entryFills.length>500||
      !Number.isSafeInteger(p.exitQuantity)||p.exitQuantity<=0||!finite(p.exitPrice)||p.exitPrice<=0||
      !Number.isSafeInteger(p.exitGrossCents)||p.exitGrossCents<=0||p.exitGrossCents!==money(p.exitPrice*p.exitQuantity)||
      !Number.isSafeInteger(p.exitFeeCents)||p.exitFeeCents<0||!Number.isSafeInteger(p.costBasisCents)||p.costBasisCents<=0||
      !Number.isSafeInteger(p.realizedCents))return {reason:'missing-or-inconsistent-original-ledger-proof'};
  if(p.entryFills.some(leg=>!leg||!identity(leg.eventId)||!identity(leg.orderId)||!finite(leg.price)||leg.price<=0||
      !Number.isSafeInteger(leg.quantity)||leg.quantity<=0||!Number.isSafeInteger(leg.grossCents)||leg.grossCents<=0||
      (centPrice(leg.price)&&leg.grossCents!==money(leg.price*leg.quantity))||
      !Number.isSafeInteger(leg.costCents)||leg.costCents<leg.grossCents||!Number.isSafeInteger(leg.time)||!time(leg.time)||leg.time>=exit||day(leg.time)>=day(exit))||
      new Set(p.entryFills.map(row=>row.eventId)).size!==p.entryFills.length||
      Math.min(...p.entryFills.map(row=>row.time))!==entry||
      p.entryFills.reduce((sum,row)=>sum+row.quantity,0)!==p.exitQuantity||
      p.entryFills.reduce((sum,row)=>sum+row.costCents,0)!==p.costBasisCents)
    return {reason:'settlement-quantity-basis-or-t-plus-one-mismatch'};
  if(linked&&(!Array.isArray(link.entryEventIds)||link.entryEventIds.length!==p.entryFills.length||
      new Set(link.entryEventIds).size!==p.entryFills.length||p.entryFills.some(f=>!link.entryEventIds.includes(f.eventId))))
    return {reason:'missing-or-inconsistent-original-plan-link'};
  const entryGross=p.entryFills.reduce((sum,row)=>sum+row.grossCents,0),cost=p.costBasisCents-entryGross+p.exitFeeCents,
    net=p.exitGrossCents-p.exitFeeCents-p.costBasisCents;
  if(![entryGross,cost,net].every(Number.isSafeInteger)||net!==p.realizedCents||!precise(trade.cost)||money(trade.cost)!==cost||!precise(trade.pnlAmount)||money(trade.pnlAmount)!==net||
      !precise(trade.costBasis)||money(trade.costBasis)!==p.costBasisCents||trade.shares!==p.exitQuantity)
    return {reason:'recorded-cost-or-net-pnl-mismatch'};
  const quality=trade.blackSwan===true||trade.quality==='黑天鹅'?'black-swan':
    trade.extreme===true||trade.repeatable===false||trade.quality==='不可复制极端行情'?'extreme':'standard';
  const strategy=plan.strategy||trade.strategy||'unknown',regime=plan.trend||trade.trend||'unknown',
    cycle=plan.frozenSnapshot?.emotion?.stage||trade.frozenLabels?.cycle||trade.frozenLabels?.emotion||'unknown';
  return {row:{id:trade.id,planId:plan.id,planFingerprint,planEvidenceBasis:linked?'original-plan-link-reconciled':'legacy-plan-declaration',
    code:trade.code,signalDay:day(frozen),entry,exit,recorded,knownAt:Math.max(recorded,exit,linkKnown||0,linkedAt||0),
    entryGrossCents:entryGross,exitGrossCents:p.exitGrossCents,costBasisCents:p.costBasisCents,costCents:cost,netCents:net,
    strategy,regime,cycle,quality,
    fingerprint:trade.sourceFingerprint,settlementIdentity:digest([p.accountId,p.exitEventId]),
    settlementContentFingerprint:digest({settlement:settlementContent(p,plan.id),planFingerprint,strategy,regime,cycle,quality}),
    entryPriceEvidence:p.entryFills.every(leg=>centPrice(leg.price))?'exact-cent-price-reconciled':'fifo-allocation-not-replayed',canTrade:false}};
}
function settledPnlAttribution(rows,{slippageBps=0,feeMultiplier=1}={}) {
 const sum=fn=>rows.reduce((a,r)=>a+fn(r),0);
 const gross=sum(r=>r.exitGrossCents-r.entryGrossCents),fees=sum(r=>r.costCents),net=sum(r=>r.netCents);
 const slip=sum(r=>(r.entryGrossCents+r.exitGrossCents)*slippageBps/10000),extra=fees*(feeMultiplier-1);
 const cny=n=>rows.length?+(n/100).toFixed(8):null;
 return {scope:'verified-original-simulation-settlements-only',samples:rows.length,actual:{grossPricePnlCny:cny(gross),recordedCostsCny:cny(fees),netPnlCny:cny(net),reconciliationResidualCny:cny(net-(gross-fees))},estimatedStress:{additionalSlippageCny:cny(slip),additionalFeesCny:cny(extra),netPnlCny:cny(net-slip-extra)},unattributed:{marketCny:null,industryCny:null,selectionCny:null,positionCny:null,actualSlippageCny:null,delayCny:null,unfilledCny:null},portfolioEquity:null,canTrade:false,note:'仅拆分已验证原模拟盘结算，实际费用和假设压力分开；缺少统一权益、基准、计划及委托时间证据的因素保持未知。'};
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
    attribution:settledPnlAttribution(rows,{slippageBps,feeMultiplier}),
    slippageBps,feeMultiplier,executionBasis:'original-unadjusted-verified-simulation-fills',
    returnBasis:'per-settlement-cost-basis',riskBasis:'cumulative-settled-pnl; no-continuous-equity-series',
    entryPriceEvidence:{exactCentPriceReconciled:rows.filter(r=>r.entryPriceEvidence==='exact-cent-price-reconciled').length,
      fifoAllocationNotReplayed:rows.filter(r=>r.entryPriceEvidence==='fifo-allocation-not-replayed').length},
    note:'原账本费用已扣；压力只叠加额外双边滑点及费用。高精度价格的FIFO拆分缺原批次分摊链，未逐批重放；累计结算盈亏回撤不冒充全账户权益最大回撤。'};
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
  if(!Number.isSafeInteger(now)||time(now)===null)throw Error('执行验证时钟无效');
  const plans=new Map(),accepted=[],excluded=[],seen=new Set(),attempts=[],events=new Map(),claims=new Map(),verifiedCounts=new Map();
  for(const plan of (archive?.plans||[]).filter(real)){
    if(!identity(plan.id))continue;
    if(!plans.has(plan.id))plans.set(plan.id,[]);
    plans.get(plan.id).push(plan);
  }
  for(const trade of real(archive)?archive.trades||[]:[]) {
    const p=trade?.paperSettlement;
    if(real(trade)&&futureReceipt(trade,now)){
      attempts.push({id:trade?.id||null,reason:'unmatured-or-unrecorded-settlement'});
      continue;
    }
    if(real(trade)&&p&&['pool','pre'].includes(p.accountId)&&identity(p.exitEventId)){
      const key=digest([p.accountId,p.exitEventId]);claims.set(key,(claims.get(key)||0)+1);
    }
    const selected=selectPriorPlan(plans.get(trade?.planId),trade);
    const result=selected.reason?selected:verifiedSettlement(trade,selected.plan,now);
    attempts.push({id:trade?.id||null,...result});
    if(result.reason)continue;
    const row=result.row;
    if(!events.has(row.settlementIdentity))events.set(row.settlementIdentity,new Set());
    events.get(row.settlementIdentity).add(row.settlementContentFingerprint);
    verifiedCounts.set(row.settlementIdentity,(verifiedCounts.get(row.settlementIdentity)||0)+1);
  }
  const seenEvents=new Set();
  for(const result of attempts){
    if(result.reason){excluded.push({id:result.id,reason:result.reason});continue;}
    const row=result.row;
    if(events.get(row.settlementIdentity).size>1||claims.get(row.settlementIdentity)>verifiedCounts.get(row.settlementIdentity)){
      excluded.push({id:row.id,reason:'conflicting-ledger-settlement'});continue;
    }
    if(seen.has(row.fingerprint)||seenEvents.has(row.settlementIdentity)){excluded.push({id:row.id,reason:'duplicate-ledger-settlement'});continue;}
    seen.add(row.fingerprint);seenEvents.add(row.settlementIdentity);accepted.push(row);
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
      stressFeeMultipliers:[...settings.stressFeeMultipliers]},strata,byRegime:groups('regime'),byCycle:groups('cycle'),byStrategy:groups('strategy'),
    overall:stress(standard),folds,
    planEvidence:{originalLinkReconciled:accepted.filter(row=>row.planEvidenceBasis==='original-plan-link-reconciled').length,
      legacyDeclarationOnly:accepted.filter(row=>row.planEvidenceBasis==='legacy-plan-declaration').length},
    fingerprint:digest(accepted.map(row=>({id:row.id,planId:row.planId,planFingerprint:row.planFingerprint,
      fingerprint:row.fingerprint,knownAt:row.knownAt,contentFingerprint:row.settlementContentFingerprint,
      planEvidenceBasis:row.planEvidenceBasis}))),
    canTrade:false,canApprove:false,productionWeightsChanged:false,
    note:'只验证已经发生且与事前计划匹配的原模拟结算；hfq 次日标签 IC 不当作成交收益。正式晋级仍需原五项验证及人工批准。'};
}
module.exports={verifiedSettlement,buildExecutionValidation,settledPnlAttribution};
