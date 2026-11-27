'use strict';
// A bounded projection of the original account, plan observer and history
// archive. No account, quote, history, order or permission is persisted here.
const crypto=require('node:crypto');
const {auditCenterInputs}=require('./intelligence-research');
const {validatePlan,planFill}=require('./paper-decision-plan');
const {buildPortfolioDefense}=require('./portfolio-defense-evidence');
const {tradingFees,paperBuyLotSize:lotOf}=require('./trading-fees');
const {quoteUseEligibility}=require('./quote-observation-view');
const {capacityScenarios,exitRisk,previewPosition,previewPlanBatch,tailRisk,cashFlowPerformance,compareOpportunity}=require('./advanced-portfolio-evidence');
const flags={canTrade:false,writesAccount:false,automaticSwitch:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const stamp=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const codeOk=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hashOk=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const label=x=>typeof x==='string'&&x.length>0&&x.length<=128&&x.trim()===x&&!/[\x00-\x1f\x7f]/.test(x);
const dayOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const round=x=>Math.round(x*1e8)/1e8;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unknown=reason=>({status:'unknown',reason,...flags});
const own=(value,key)=>value&&typeof value==='object'&&Object.hasOwn(value,key)?value[key]:undefined;
const close=day=>Date.parse(day+'T15:00:00+08:00');
const policyVersion='fayo-portfolio-pressure-v1';

function scenarioPolicy(input){
 const defaults={version:policyVersion,maxParticipationPct:1,impactBpsAtLimit:50,horizonSessions:5,capitalMultipliers:[.5,1,2],confidence:.95};
 if(input==null)return defaults;
 if(!input||input.version!==policyVersion||Object.keys(input).some(k=>!Object.hasOwn(defaults,k)))return null;
 const p={...defaults,...input};
 return positive(p.maxParticipationPct)&&p.maxParticipationPct<=10&&finite(p.impactBpsAtLimit)&&p.impactBpsAtLimit>=0&&p.impactBpsAtLimit<=1000&&Number.isSafeInteger(p.horizonSessions)&&p.horizonSessions>=1&&p.horizonSessions<=20&&[.9,.95,.99].includes(p.confidence)&&Array.isArray(p.capitalMultipliers)&&p.capitalMultipliers.length>0&&p.capitalMultipliers.length<=10&&p.capitalMultipliers.every(x=>positive(x)&&x<=100)?p:null;
}

// The original archive already verifies receipt bytes and append-only hashes.
// Re-run its original multi-source gate; do not turn one provider or a hash
// supplied by an HTTP client into an admitted observation.
function portfolioHistory(history,{codes,now,day}){
 const unique=[...new Set(codes)],empty=reason=>({byCode:new Map(),observations:()=>[],prior:()=>null,
  coverage:{status:'unknown',reason,requestedCodes:unique,admittedGroups:0,alignedSamples:0,missing:[reason]}});
 if(unique.length>20)return empty('PORTFOLIO_HISTORY_SYMBOL_BUDGET');
 if(!history||!Array.isArray(history.bars)||history.bars.length>16000)return empty('ORIGINAL_HISTORY_UNAVAILABLE');
 const wanted=new Set(unique),bars=history.bars.filter(r=>wanted.has(r?.code));
 if(!bars.length)return empty('ORIGINAL_HISTORY_UNAVAILABLE');
 if(bars.some(r=>!hashOk(r.archiveHash)||!hashOk(r.rawHash)||!hashOk(r.rawRowHash)||!stamp(r.knownAt)||!stamp(r.availableAt??r.knownAt)||(r.availableAt??r.knownAt)<r.knownAt))return empty('ORIGINAL_HISTORY_VERSION_UNAVAILABLE');
 let checked;try{checked=auditCenterInputs(bars,{purpose:'backtest',now,marketCalendars:history.marketCalendars||{}});}catch{return empty('ORIGINAL_HISTORY_GATE_REJECTED');}
 const originals=new Map(bars.filter(r=>r.knownAt<=now&&(r.availableAt??r.knownAt)<=now).map(r=>[[r.code,r.date||r.day,r.source,r.rawRowHash].join('/'),r]));
 const calendar=history.marketCalendars?.CN,conflicts=new Set(calendar?.conflictingDays||[]),byCode=new Map();
 const edge=(from,to)=>{const e=own(calendar?.nextEvidenceByDay,from);return !conflicts.has(from)&&e?.nextTradingDay===to&&label(e.source)&&stamp(e.knownAt)&&e.knownAt<=now?e:null;};
 for(const row of checked.admitted){
  if(row.market!=='CN'||row.adjustment!=='hfq'||row.sampleSet!=='real'||!stamp(row.consensusKnownAt)||row.consensusKnownAt>now||row.day>day||!positive(row.close))continue;
  const evidence=row.evidence.map(e=>originals.get([e.code,e.day,e.source,e.rawRowHash].join('/'))).filter(Boolean);
  if(evidence.length<2||evidence.some(e=>(e.availableAt??e.knownAt)>now))continue;
  const refs=evidence.map(e=>({source:e.source,archiveHash:e.archiveHash,rawHash:e.rawHash,rawRowHash:e.rawRowHash,knownAt:e.knownAt,availableAt:e.availableAt??e.knownAt})).sort((a,b)=>a.source.localeCompare(b.source));
  const item={...row,evidence,source:row.supportingSources.slice().sort().join('+'),dataVersion:hash(refs),refs};
  if(!byCode.has(row.code))byCode.set(row.code,new Map());byCode.get(row.code).set(row.day,item);
 }
 const observations=selected=>{
  const ids=[...new Set(selected)];if(!ids.length||ids.some(c=>!byCode.has(c)))return [];
  const dates=[...byCode.get(ids[0]).keys()].filter(d=>ids.every(c=>byCode.get(c).has(d))).sort(),out=[];
  for(let i=1;i<dates.length;i++){
   const previousDate=dates[i-1],date=dates[i],calendarEdge=edge(previousDate,date);if(!calendarEdge)continue;
   const returns={},versions=[];let availableAt=calendarEdge.knownAt,valid=true;
   for(const code of ids){
    const a=byCode.get(code).get(previousDate),b=byCode.get(code).get(date);
    // A price ratio must keep a provider and adjustment basis across both ends.
    const common=a.evidence.map(e=>e.source).filter(s=>b.evidence.some(e=>e.source===s)).sort()[0];
    const left=a.evidence.find(e=>e.source===common),right=b.evidence.find(e=>e.source===common);
    if(!left||!right||!positive(left.close)||!positive(right.close)||left.suspended!==false||right.suspended!==false){valid=false;break;}
    returns[code]=right.close/left.close-1;versions.push([code,a.dataVersion,b.dataVersion,common]);availableAt=Math.max(availableAt,a.consensusKnownAt,b.consensusKnownAt);
   }
   if(valid&&availableAt<=now)out.push({date,previousDate,availableAt,source:'original-center-dual-source-hfq',dataVersion:hash(versions),factorVersion:'fayo-hfq-simple-return-v1',evidenceKind:'historical',returnBasis:'adjusted-price',returns});
  }
  return out;
 };
 const prior=code=>{
  const rows=[...(byCode.get(code)?.values()||[])].filter(r=>r.day<day).sort((a,b)=>a.day.localeCompare(b.day));
  const r=rows.at(-1);if(!r||!edge(r.day,day)||!positive(r.volume)||!positive(r.amount)||r.suspended!==false)return null;
  return {date:r.day,source:r.source,dataVersion:r.dataVersion,availableAt:Math.max(r.consensusKnownAt,edge(r.day,day).knownAt),priceBasis:'hfq',turnoverBasis:'original-turnover',evidenceKind:'historical',volume:r.volume,volumeUnit:'shares',amount:r.amount,amountUnit:'CNY',refs:r.refs};
 };
 const all=observations(unique),versions=[...byCode.values()].flatMap(m=>[...m.values()]),missing=[];
 if(unique.some(c=>!byCode.has(c)))missing.push('MISSING_HELD_OR_PLANNED_HISTORY');
 if(!calendar||!label(calendar.source)||!stamp(calendar.knownAt)||calendar.knownAt>now)missing.push('ORIGINAL_TRADING_CALENDAR_UNAVAILABLE');
 if(all.length<60)missing.push('FEWER_THAN_SIXTY_ALIGNED_RETURNS');
 return {byCode,observations,prior,coverage:{status:versions.length?'observed-unverified':'unknown',requestedCodes:unique,admittedGroups:versions.length,rejectedRecords:checked.excludedRecords,alignedSamples:all.length,start:all[0]?.date||null,end:all.at(-1)?.date||null,returnBasis:'adjusted-price',source:'original-center-dual-source-hfq',dataVersion:hash(versions.map(r=>[r.code,r.day,r.dataVersion]).sort()),factorVersion:'fayo-hfq-simple-return-v1',availableAt:versions.length?Math.max(...versions.map(r=>r.consensusKnownAt)):null,calendarSource:calendar?.source||null,missing,sourcePublicationVerified:false,sourceRevisionVerified:false}};
}

function classification(classifications,code,now){
 const row=own(classifications,code);
 if(!row||!label(row.source)||!label(row.dataVersion)||!stamp(row.knownAt)||row.knownAt>now)return {};
 return {industry:label(row.industry)?row.industry:null,theme:label(row.theme)?row.theme:null,classificationSource:row.source,classificationVersion:row.dataVersion,classificationKnownAt:row.knownAt};
}
function originalStrategy(book,position,eventMap){
 const strategies=position.lots.filter(l=>l.quantity>0).map(l=>book.orders[eventMap.get(l.sourceEventId)?.orderId]?.order?.strategyId);
 return strategies.length&&strategies.every(s=>label(s)&&s===strategies[0])?strategies[0]:null;
}
function originalReceipt(plan,receipt,{book,quote,quotes,diagnostic,now,day}){
 try{validatePlan(plan,now);}catch{return {status:'unknown',reason:'INVALID_OR_NONAUTHORITATIVE_PLAN'};}
 if(plan.intendedDate!==day)return {status:'blocked',reason:'PLAN_DAY_MISMATCH'};
 // The original frozen plan is single-entry across retained account periods.
 // A copied receipt must not revive it after even one persisted partial fill.
 if(planFill(book,plan.id))return {status:'blocked',reason:'ORIGINAL_PLAN_ALREADY_HAS_PERSISTED_ENTRY'};
 if(!receipt||receipt.scope!=='original-paper-account-observation'||receipt.planId!==plan.id||receipt.decisionId!==plan.decisionId||!stamp(receipt.checkedAt)||receipt.checkedAt>now||now-receipt.checkedAt>5000||receipt.accountRevision!==book.revision||!quote||receipt.quoteAt!==quote.quoteAt||receipt.quotePrice!==quote.price||receipt.quoteSource!==quote.quoteSource||!quoteUseEligibility(quote,now).canTrade)return {status:'unknown',reason:'ORIGINAL_PLAN_RECEIPTS_UNAVAILABLE'};
 if(receipt.allowed===false)return {status:'blocked',reason:label(receipt.reason)?receipt.reason:'ORIGINAL_PLAN_GATE_BLOCKED'};
 if(receipt.allowed!==true||!hashOk(book.fingerprint)||receipt.accountFingerprint!==book.fingerprint||!Number.isSafeInteger(receipt.quantity)||receipt.quantity<=0||receipt.quantity%lotOf(plan.code)!==0||!finite(receipt.fee)||receipt.fee<0||!positive(receipt.maxPositionPct)||receipt.maxPositionPct>plan.maxPosition)return {status:'unknown',reason:'ORIGINAL_PLAN_SIZING_UNAVAILABLE'};
 let riskBudget=null;
 if(book.riskPolicy){
  // The main-process observer has already verified issuance by the original
  // service. Across the worker boundary keep its exact immutable calculation,
  // account version and individual quote bindings, never re-derive policy from
  // optional display labels or omit the original imported prior-close evidence.
  const proof=receipt.accountPreview;
  if(!proof||typeof proof!=='object')return {status:'unknown',reason:'ORIGINAL_ACCOUNT_PREVIEW_UNAVAILABLE'};
  const {fingerprint,...payload}=proof;
  if(!hashOk(fingerprint)||fingerprint!==hash(payload)||proof.scope!=='original-automatic-entry-preview-v1'||proof.status!=='allowed'||proof.allowed!==true||
    proof.canTrade!==false||proof.writesAccount!==false||proof.reservesCash!==false||!stamp(proof.checkedAt)||proof.checkedAt>now||now-proof.checkedAt>5000||
    proof.accountRevision!==book.revision||proof.accountFingerprint!==book.fingerprint||proof.policyFingerprint!==hash(book.riskPolicy)||
    proof.symbol!==plan.code||proof.tradeDate!==day||proof.quantity!==receipt.quantity||proof.fee!==receipt.fee||proof.price!==quote.price||
    proof.quotePrice!==quote.price||proof.quoteAt!==quote.quoteAt||proof.quoteSource!==quote.quoteSource||proof.receivedAt!==(quote.receivedAt??null)||
    proof.cash!==diagnostic.cash||proof.reservedCash!==diagnostic.reservedCash||proof.availableCash!==diagnostic.availableCash||
    proof.strategyId!==null||proof.strategyAttribution!=='original-automatic-without-strategy-id'||!Array.isArray(proof.valuation))
    return {status:'unknown',reason:'ORIGINAL_ACCOUNT_PREVIEW_UNBOUND'};
  const held=Object.entries(book.account.positions).filter(([,position])=>position.quantity>0);
  if(proof.valuation.length!==held.length||new Set(proof.valuation.map(row=>row.symbol)).size!==held.length||held.some(([code,position])=>{
   const row=proof.valuation.find(value=>value.symbol===code),current=quotes[code]?.quote;
   return !row||!current||!quoteUseEligibility(current,now).canTrade||row.quantity!==position.quantity||row.price!==current.price||
    row.quoteAt!==current.quoteAt||row.quoteSource!==current.quoteSource||row.receivedAt!==(current.receivedAt??null);
  }))return {status:'unknown',reason:'ORIGINAL_ACCOUNT_PREVIEW_VALUATION_CHANGED'};
  if(!proof.riskBudget||proof.riskBudget.policyScope!=='original-account-readonly-preview'||proof.riskBudget.policyVersion!==book.riskPolicy.version||
    proof.riskBudget.estimatedConstraintsSatisfied!==true||proof.riskBudget.canTrade!==false||proof.riskBudget.writesAccount!==false||
    !finite(proof.riskBudget.originalEquityBasis)||Math.abs(proof.riskBudget.originalEquityBasis-diagnostic.equity)>.011)
    return {status:'unknown',reason:'ORIGINAL_ACCOUNT_POLICY_BUDGET_UNAVAILABLE'};
  riskBudget={...proof.riskBudget,evidenceRef:fingerprint};
 }
 return {status:'allowed',reason:label(receipt.reason)?receipt.reason:null,evidenceRef:hash([plan.id,plan.decisionId,receipt.checkedAt,receipt.quoteAt,receipt.accountRevision,receipt.accountFingerprint,receipt.quantity,receipt.fee,receipt.maxPositionPct]),quantity:receipt.quantity,fee:receipt.fee,maxPositionPct:receipt.maxPositionPct,riskBudget};
}
function performanceEvidence(e,{book,diagnostic,account,now}){
 const missing=reason=>({...unknown(reason),currentEquity:diagnostic.equity,currentCash:diagnostic.cash,externalNetFlow:null,investmentPnl:null,timeWeightedReturn:null,moneyWeightedAnnualReturn:null,benchmarkReturn:null,benchmarkExcess:null,riskAdjustedReturn:null,periodId:'original-period-'+(book.archives?.length||0),missing:['逐次外部入出金前后原权益边界','同一收益期起点和期末完整估值','同区间基准与连续交易日日历'],resetTreatment:'reset/setInitial starts a new original-account period; dividends are investment cash flows'});
 if(!e)return missing('MISSING_AUTHORITATIVE_EQUITY_BOUNDARIES');
 if(e.scope!=='original-paper-account-equity-boundaries-v1'||e.account!==account||e.periodId!=='original-period-'+(book.archives?.length||0)||e.accountRevision!==book.revision||!hashOk(book.fingerprint)||e.bookFingerprint!==book.fingerprint||!label(e.source)||!label(e.dataVersion)||!label(e.factorVersion)||!label(e.initialEvidenceRef)||!stamp(e.knownAt)||e.knownAt>now||!Array.isArray(e.rows)||!e.rows.length||e.rows.length>3000||e.rows.some(r=>!stamp(r.knownAt)||r.knownAt<r.at||r.knownAt>now)||!finite(diagnostic.equity)||Math.abs(e.rows.at(-1).equityAfterFlow-diagnostic.equity)>.011)return missing('UNBOUND_OR_FUTURE_EQUITY_EVIDENCE');
 // Imported opening holdings need independently marked opening equity. An
 // initialCash value, a first trade, or a reset archive is not that evidence.
 const benchmark=e.benchmark&&stamp(e.benchmark.knownAt)&&e.benchmark.knownAt>=e.rows.at(-1).at&&e.benchmark.knownAt<=now?e.benchmark:null;
 const value=cashFlowPerformance({...e,benchmark,asOf:now});
 return {...value,source:e.source,dataVersion:e.dataVersion,equityFactorVersion:e.factorVersion,knownAt:e.knownAt,periodId:e.periodId,currentEquity:diagnostic.equity,currentCash:diagnostic.cash,resetTreatment:'reset/setInitial starts a new original-account period; dividends are investment cash flows'};
}

function buildAdvancedPortfolioReport({book,diagnostic,account,day,now,quotes={},portfolioContext={},portfolioContextStatus}={}){
 if(!book||!diagnostic||diagnostic.status!=='observed-unverified'||diagnostic.revision!==book.revision||!['pool','pre'].includes(account)||!dayOk(day)||!stamp(now))return unknown('ORIGINAL_ACCOUNT_DIAGNOSTIC_UNAVAILABLE');
 const context=portfolioContext&&typeof portfolioContext==='object'?portfolioContext:{};
 const rawPlans=Array.isArray(context.plans)?context.plans:own(context.plans,account)||[];
 const plans=Array.isArray(rawPlans)&&rawPlans.length<=20?rawPlans:[];
 const checks=own(context.planChecks,account)||context.planChecks||{};
 const heldCodes=diagnostic.positions.map(p=>p.symbol),planCodes=plans.map(p=>p?.code).filter(codeOk),codes=[...new Set([...heldCodes,...planCodes])];
 const history=portfolioHistory(context.history,{codes,now,day}),policy=scenarioPolicy(context.scenarioPolicy),missing=[...history.coverage.missing];
 if(!policy)missing.push('INVALID_PRESSURE_SCENARIO_POLICY');
 if(!plans.length)missing.push('ORIGINAL_PLAN_RECEIPTS_UNAVAILABLE');
 if(portfolioContextStatus==='invalid-or-over-budget')missing.push('PORTFOLIO_CONTEXT_OVER_BUDGET');
 const marks=code=>{const raw=own(quotes,code),quote=raw?.quote;return quote?.code===code&&quoteUseEligibility(quote,now).canTrade?{...raw,quote}:null;};
 const sourceRef=hashOk(book.fingerprint)?book.fingerprint:null;
 const eventMap=new Map(book.account.events.map(e=>[e.eventId,e]));
 const snapshot=sourceRef&&positive(diagnostic.equity)&&finite(diagnostic.availableCash)?{evidenceRef:sourceRef,equity:diagnostic.equity,cash:diagnostic.cash,availableCash:diagnostic.availableCash,positions:diagnostic.positions.map(p=>({symbol:p.symbol,marketValue:marks(p.symbol)?p.quantity*marks(p.symbol).quote.price:NaN,...classification(context.classifications,p.symbol,now),strategy:originalStrategy(book,book.account.positions[p.symbol],eventMap)}))}:null;
 const fee=(side,quantity,price)=>tradingFees({side,quantity,price,tradeDate:day,policy:book.feePolicy,schedules:book.feeSchedules||null});
 const cost=(side,quantity,code)=>{
  const current=marks(code),prior=history.prior(code);
  if(!policy||!current||!prior||current.suspended!==false||current.limitDown!==false||!Number.isSafeInteger(quantity)||quantity<=0)return null;
  const cap=Math.floor(Math.min(prior.volume,prior.amount/current.quote.price)*policy.maxParticipationPct/100);
  if(!cap)return null;
  try{const fees=fee(side,quantity,current.quote.price),notional=quantity*current.quote.price,impactBps=policy.impactBpsAtLimit*Math.sqrt(Math.min(quantity,cap)*current.quote.price/prior.amount/(policy.maxParticipationPct/100));return {notional,fee:fees.total,feeVersion:fees.version,impact:round(notional*impactBps/10000),impactBps:round(impactBps),capacityShares:cap,source:prior.source,dataVersion:prior.dataVersion,availableAt:prior.availableAt,quoteAt:current.quote.quoteAt};}catch{return null;}
 };
 const exits=diagnostic.positions.map(position=>{
  const raw=own(quotes,position.symbol),prior=history.prior(position.symbol),detail=exitRisk({position:{symbol:position.symbol,quantity:position.quantity,sellable:position.matureUnreserved},quote:raw?.quote,now,limitDown:raw?.limitDown,suspended:raw?.suspended,prior,maxParticipationPct:policy?.maxParticipationPct}),estimated=cost('sell',position.matureUnreserved,position.symbol);
  const session=diagnostic.continuous&&book.legacy?.enabled!==false;
  // Session/permission restrictions apply to the subset estimate as well.
  const subsetSessions=session?detail.conditionalSellableSessions??null:null;
  const subsetCost=subsetSessions===1&&estimated&&finite(estimated.impact)&&finite(position.estimatedFee)?round(estimated.impact+position.estimatedFee):null;
  const estimatedSellableExitCost=finite(subsetCost)?subsetCost:null;
  return {...detail,symbol:position.symbol,conditionalSessions:session?detail.conditionalSessions??null:null,
   conditionalSellableSessions:subsetSessions,exitEstimateQuantity:session?detail.exitEstimateQuantity??null:null,
   estimatedSellableExitCost,estimatedFee:session?position.estimatedFee:null,feeVersion:session?position.feeVersion:null,
   estimatedMarketImpact:subsetSessions===1&&estimated&&finite(estimated.impact)?estimated.impact:null,
   exitCostBasis:estimatedSellableExitCost===null?'unavailable':'one-session-fee-plus-assumed-impact',
   estimatedFeeBasis:session&&finite(position.estimatedFee)?'current-mark-single-order-fee':null,
   multiSessionExitCost:null,actualExitCost:null,
   estimatedExitCost:session&&detail.conditionalSessions===1?estimatedSellableExitCost:null,
   costReason:!session?'SESSION_CLOSED_OR_ACCOUNT_PAUSED':detail.restrictedQuantity>0?'RESTRICTED_POSITION_EXIT_UNVERIFIED':subsetSessions>1?'MULTI_SESSION_FEES_AND_PRICES_UNAVAILABLE':estimatedSellableExitCost===null?'ORIGINAL_QUOTE_OR_PRIOR_LIQUIDITY_UNAVAILABLE':null,
   scenarioVersion:policy?.version||null,liquidityEvidence:prior?{date:prior.date,source:prior.source,dataVersion:prior.dataVersion,availableAt:prior.availableAt}:null,guaranteedFill:false,...flags};
 });
 const capacity=codes.slice(0,20).map(symbol=>{
  const raw=marks(symbol),plan=plans.find(p=>p.code===symbol),position=diagnostic.positions.find(p=>p.symbol===symbol);
  const targetWeight=position&&raw&&positive(diagnostic.equity)?position.quantity*raw.quote.price/diagnostic.equity:finite(plan?.maxPosition)?plan.maxPosition/100:null;
  if(!policy||!raw||!positive(diagnostic.equity)||!positive(targetWeight)||raw.suspended!==false||raw.limitDown!==false)return {symbol,...unknown('CAPITAL_QUOTE_OR_POLICY_UNAVAILABLE')};
  const value=capacityScenarios({prior:history.prior(symbol),asOf:now,price:raw.quote.price,lotSize:lotOf(symbol),capitalLevels:policy.capitalMultipliers.map(x=>round(diagnostic.equity*x)),targetWeight,maxParticipationPct:policy.maxParticipationPct,feeBps:0,impactBpsAtLimit:policy.impactBpsAtLimit,feeEstimator:quantity=>fee('buy',quantity,raw.quote.price).total});
  let feeVersion=null;try{feeVersion=fee('buy',lotOf(symbol),raw.quote.price).version;}catch{}
  return {symbol,...value,targetWeight,quoteAt:raw.quote.quoteAt,quoteSource:raw.quote.quoteSource,feeVersion,scenarioVersion:policy.version,capitalBasis:'multiples-of-original-current-equity'};
 });
 let verifiedPlanReceipts=0;
 const checkedPlans=[];
 const planCounts=new Map();for(const p of plans)if(p?.id)planCounts.set(p.id,(planCounts.get(p.id)||0)+1);
 const previews=plans.map(plan=>{
  if(planCounts.get(plan?.id)>1){missing.push('DUPLICATE_FROZEN_PLAN');return {planId:plan.id,symbol:plan.code,...unknown('DUPLICATE_FROZEN_PLAN'),originalGateStatus:'unknown',previewBlocked:true};}
  const quote=marks(plan?.code)?.quote,receipt=originalReceipt(plan,own(checks,plan?.id),{book,quote,quotes,diagnostic,now,day});
  if(receipt.status!=='allowed'){missing.push('ORIGINAL_PLAN_RECEIPTS_UNAVAILABLE');return {planId:plan?.id||null,symbol:plan?.code||null,...unknown(receipt.reason),originalGateStatus:receipt.status,previewBlocked:true};}
  verifiedPlanReceipts++;
  const projection={evidenceRef:plan.id,symbol:plan.code,price:quote.price,quantity:receipt.quantity,fee:receipt.fee,...classification(context.classifications,plan.code,now),strategy:null};
  const value=previewPosition({snapshot,plan:projection,gate:receipt,observations:history.observations([...heldCodes,plan.code]),asOf:now,returnBasis:'adjusted-price'});
  if(receipt.riskBudget)value.riskBudgetAfter=receipt.riskBudget;
  if(snapshot&&value.status!=='unknown'){
   const exposure=(snapshot.positions.find(p=>p.symbol===plan.code)?.marketValue||0)+projection.quantity*projection.price,limit=receipt.maxPositionPct;
   const budget={status:'observed-unverified',policyScope:'original-plan-effective-position-cap',policyVersion:'original-plan-'+plan.decisionId,evidenceRef:receipt.evidenceRef,originalEquityBasis:snapshot.equity,afterFeeEquity:value.equityAfter,estimatedConstraintsSatisfied:exposure<=snapshot.equity*limit/100+1e-9,reasonCodes:exposure>snapshot.equity*limit/100+1e-9?['ORIGINAL_PLAN_ALLOCATION_EXCEEDED']:[],budgets:[{kind:'single',limitPct:limit,exposureAfter:round(exposure),remainingAtOriginalEquity:round(snapshot.equity*limit/100-exposure),remainingAfterEstimatedFee:round(value.equityAfter*limit/100-exposure)}],...flags};
   value.planAllocationBudgetAfter=budget;if(!value.riskBudgetAfter)value.riskBudgetAfter=budget;
   if(!budget.estimatedConstraintsSatisfied)value.previewBlocked=true;
  }
  if(value.status==='estimated-unverified'&&value.previewBlocked===false)checkedPlans.push({plan,receipt,projection});
  return {planId:plan.id,symbol:plan.code,...value,quantity:receipt.quantity,price:quote.price,estimatedFee:receipt.fee,accountRevision:book.revision,accountEvidenceRef:sourceRef,gateEvidenceRef:receipt.evidenceRef,quoteAt:quote.quoteAt};
 });
 const batchPreview=previewPlanBatch({snapshot,plans:previews,policy:book.riskPolicy??null,accountRevision:book.revision});
 const assets=snapshot?.positions.filter(p=>p.marketValue>0).map(p=>({symbol:p.symbol,weight:p.marketValue/snapshot.equity,industry:p.industry,theme:p.theme}));
 const tail=assets?.length?tailRisk({assets,observations:history.observations(heldCodes),asOf:now,confidence:policy?.confidence||.95,returnBasis:'adjusted-price'}):unknown(heldCodes.length?'CURRENT_PORTFOLIO_VALUATION_UNAVAILABLE':'NO_OPEN_POSITION_RISK');
 const defense=buildPortfolioDefense({book,diagnostic,snapshot,account,day,now,previews,exits,tail,observations:history.observations(heldCodes)});
 const opportunityComparisons=[];
 for(const held of diagnostic.positions.slice(0,10))for(const candidate of checkedPlans.slice(0,5)){
  if(held.symbol===candidate.plan.code)continue;
  const base={holdSymbol:held.symbol,candidateSymbol:candidate.plan.code,planId:candidate.plan.id,comparedShares:held.matureUnreserved,lockedOrFrozenShares:held.quantity-held.matureUnreserved};
  const sell=cost('sell',held.matureUnreserved,held.symbol),quote=marks(candidate.plan.code)?.quote;
  if(!sell||!quote||!policy||!diagnostic.continuous||book.legacy?.enabled===false||sell.capacityShares<held.matureUnreserved){opportunityComparisons.push({...base,...unknown('SAME_TIME_EXIT_OR_ENTRY_COST_UNAVAILABLE')});continue;}
  if(Math.abs(sell.quoteAt-quote.quoteAt)>1000){opportunityComparisons.push({...base,...unknown('QUOTE_AS_OF_NOT_COMPARABLE'),maximumQuoteGapMs:1000});continue;}
  const capital=sell.notional,sellCost=sell.fee+sell.impact,lot=lotOf(candidate.plan.code);
  let lo=0,hi=Math.min(Math.floor((capital-sellCost)/quote.price/lot),Math.floor(candidate.receipt.quantity/lot));
  while(lo<hi){const mid=Math.ceil((lo+hi)/2),estimate=cost('buy',mid*lot,candidate.plan.code);if(estimate&&estimate.capacityShares>=mid*lot&&mid*lot*quote.price+sellCost+estimate.fee+estimate.impact<=capital+.00000001)lo=mid;else hi=mid-1;}
  const quantity=lo*lot,buy=cost('buy',quantity,candidate.plan.code),sellCandidate=cost('sell',quantity,candidate.plan.code);
  if(!buy||!sellCandidate){opportunityComparisons.push({...base,...unknown('COMPARABLE_CANDIDATE_ALLOCATION_UNAVAILABLE')});continue;}
  const entryCost=sellCost+buy.fee+buy.impact;
  const value=compareOpportunity({hold:{symbol:held.symbol,notional:capital,exitCost:sellCost,evidenceRef:sourceRef},candidate:{symbol:candidate.plan.code,notional:buy.notional,entryCost,exitCost:sellCandidate.fee+sellCandidate.impact,cashRemainder:Math.max(0,capital-buy.notional-entryCost),evidenceRef:candidate.receipt.evidenceRef},observations:history.observations([held.symbol,candidate.plan.code]),asOf:now,horizon:policy.horizonSessions,confidence:policy.confidence,returnBasis:'adjusted-price'});
  opportunityComparisons.push({...base,...value,candidateShares:quantity,quoteAt:{hold:sell.quoteAt,candidate:quote.quoteAt},maximumQuoteGapMs:1000,scenarioVersion:policy.version,feeVersions:[...new Set([sell.feeVersion,buy.feeVersion,sellCandidate.feeVersion])],originalGateStatus:'allowed',...flags});
 }
 const equity=own(context.equityEvidence,account)||context.equityEvidence;
 const performance=performanceEvidence(equity,{book,diagnostic,account,now});
 if(performance.status==='unknown')missing.push(performance.reason);
 return {mode:'original-account-portfolio-evidence',status:'observed-unverified',account,accountRevision:book.revision,accountEvidenceRef:sourceRef,checkedAt:now,day,capacity,previews,batchPreview,exits,defense,opportunityComparisons,performance,tail,coverage:{...history.coverage,contextStatus:portfolioContextStatus||'not-provided',planCount:plans.length,verifiedPlanReceipts,reportedSymbols:codes.slice(0,20),omittedSymbols:Math.max(0,codes.length-20),comparisonLimit:50,missing:[...new Set(missing)]},scenarioPolicy:policy,assumptions:['沿用原账户和原计划观察回执；本报告没有委托、冻结、调仓或审批功能','后复权场景不冒充账户净值或经认证总收益；供应商发布时间及修订时钟未知','历史容量、当前费率和冲击压力不保证未来成交'],...flags};
}
module.exports={buildAdvancedPortfolioReport,portfolioHistory};
