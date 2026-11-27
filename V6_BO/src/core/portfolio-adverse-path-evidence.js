'use strict';
// Read-only extension of the original risk workbench. Its inputs are the
// projections built from one authority read, not client-supplied account data.
const {aShareCalendarDate}=require('./a-share-calendar');
const VERSION='fayo-adverse-path-research-v1';
const FLAGS=Object.freeze({researchOnly:true,canTrade:false,canNotify:false,writesAccount:false,accountMutated:false,executionGuaranteed:false,maximumLossGuarantee:false});
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const qty=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=240;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const array=x=>Array.isArray(x)?x:[];
const unique=x=>new Set(x).size===x.length;
function cents(x){
 if(!finite(x)||x<0)return null;
 const raw=x*100,n=Math.round(raw);
 return Number.isSafeInteger(n)&&Math.abs(raw-n)<=0.001?n:null;
}
const yuan=x=>Number.isSafeInteger(x)&&x>=0?x/100:null;
const sum=xs=>{
 let total=0;
 for(const x of xs){if(!qty(x)||!qty(total+x))return null;total+=x;}
 return total;
};
const percent=(x,y)=>qty(x)&&qty(y)&&y>0?100*x/y:null;
const round=x=>finite(x)?Number(x.toFixed(6)):null;
const rate=x=>positive(x)&&x<=100;
const fresh=(at,now,day)=>time(at)&&time(now)&&at<=now&&now-at<=15000&&aShareCalendarDate(at)===day;
function authority(e,now){
 return !!(e&&e.protocol==='fayo-account-equity-evidence-v1'&&e.schemaVersion===1&&['pool','pre'].includes(e.accountId)&&
  hash(e.accountEpoch)&&hash(e.fingerprint)&&hash(e.source?.snapshotFingerprint)&&qty(e.source?.accountRevision)&&e.source.accountRevision>0&&
  e.source?.kind==='authoritative-paper-account'&&e.canTrade===false&&e.canNotify===false&&e.accountMutated===false&&e.manualHoldingsIncluded===false&&
  time(now)&&e.observedAt===now&&e.day===aShareCalendarDate(now));
}
function bound(e,r,now){
 return authority(e,now)&&r?.accountId===e.accountId&&r.accountEpoch===e.accountEpoch&&
  r.authoritySnapshotFingerprint===e.source.snapshotFingerprint&&r.accountRevision===e.source.accountRevision&&r.generatedAt===now&&
  r.readOnly===true&&r.canTrade===false;
}
function identity(e){
 return {accountId:e?.accountId??null,accountEpoch:e?.accountEpoch??null,accountRevision:e?.source?.accountRevision??null,
  authoritySnapshotFingerprint:e?.source?.snapshotFingerprint??null,equityEvidenceId:e?.fingerprint??null};
}
function holdings(e,now){
 if(!authority(e,now)||e.status!=='complete'||e.cashMovements?.status!=='reconciled'||
    !Array.isArray(e.positions)||e.positions.length>1000||!unique(e.positions.map(p=>p?.symbol)))return null;
 const cash=cents(e.cash),value=cents(e.marketValue),equity=cents(e.equity);
 if([cash,value,equity].some(x=>x===null)||sum([cash,value])!==equity)return null;
 const rows=[];
 for(const p of e.positions){
  const v=cents(p?.marketValue),q=p?.quote;
  if(!code(p?.symbol)||!qty(p.quantity)||p.quantity===0||!positive(p.price)||v===null||
     cents(Math.round(p.quantity*p.price*100)/100)!==v||p.evidenceStatus!=='available'||
     !fresh(q?.quoteAt,now,e.day)||!time(q?.receivedAt)||q.receivedAt<q.quoteAt||q.receivedAt>now||
     q.tradeDate!==e.day||!text(q.quoteSource)||q.quoteStatus!=='recent-unverified'||q.missingReason!==null)return null;
  const locked=qty(p.sellableQuantity)&&p.sellableQuantity<=p.quantity?Math.round(v*(p.quantity-p.sellableQuantity)/p.quantity):null;
  rows.push({symbol:p.symbol,value:v,locked,quantity:p.quantity,sellableQuantity:locked===null?null:p.sellableQuantity,quoteAt:q.quoteAt});
 }
 if(sum(rows.map(p=>p.value))!==value)return null;
 return {cash,value,equity,rows,locked:sum(rows.map(p=>p.locked))};
}
function pendingBudget(e,r,h,now){
 if(!bound(e,r,now)||!h)return null;
 const o=r.occupancy;
 const held=cents(o?.heldValue),equity=cents(o?.equity),pending=cents(o?.pendingBuyValue),gross=cents(o?.totalExposure),
  reserved=cents(o?.reservedCash),available=cents(o?.availableCash);
 if(held!==h.value||equity!==h.equity||[pending,gross,reserved,available].some(x=>x===null)||
    sum([held,pending])!==gross||reserved<pending||reserved>h.cash||h.cash-reserved!==available||
    !qty(o.pendingOrderCount)||!Array.isArray(o.pendingOrderIds)||o.pendingOrderIds.length!==o.pendingOrderCount||
    !unique(o.pendingOrderIds)||!o.pendingOrderIds.every(text)||(pending===0)!==(o.pendingOrderCount===0)||
    pending===0&&reserved!==0)return null;
 const fee=reserved-pending;
 if(fee>equity)return null;
 return {pending,gross,reserved,available,fee,orderIds:o.pendingOrderIds.slice(),orderCount:o.pendingOrderCount};
}
function grossRule(r,h,p){
 if(!p||!h||h.equity<=0||!text(r?.policyVersion)||!Array.isArray(r.rules))return null;
 const matches=r.rules.filter(x=>x?.id==='maxGrossExposurePct');
 if(matches.length!==1)return null;
 const row=matches[0],used=percent(p.gross,h.equity);
 if(row.enabled!==true||row.configurationStatus!=='active'||row.evidenceStatus!=='available'||
    !rate(row.limit)||!finite(row.used)||row.used<0||typeof row.exceeded!=='boolean'||Math.abs(used-row.used)>0.00001||
    row.exceeded!==(p.gross/h.equity*100>row.limit+1e-9))return null;
 return {version:r.policyVersion,limitPct:row.limit,currentOriginalUsedPct:row.used,currentOriginalExceeded:row.exceeded};
}
function themeUnion(stress,h,asOf,day){
 if(!Array.isArray(stress?.classifications)||stress.classifications.length!==h.rows.length||
    !unique(stress.classifications.map(c=>c?.symbol)))return null;
 const held=new Map(h.rows.map(r=>[r.symbol,r])),groups=new Map();
 for(const c of stress.classifications){
  if(!held.has(c?.symbol)||c.status!=='available'||!Array.isArray(c.themes)||!c.themes.length||
     !c.themes.every(text)||!Array.isArray(c.sourceRefs)||!c.sourceRefs.length||
     c.sourceRefs.some(r=>!time(r?.knownAt)||r.knownAt>asOf||r.day!==day||!text(r.source)))return null;
  for(const theme of new Set(c.themes.map(t=>t.trim()))){
   if(!groups.has(theme))groups.set(theme,new Set());
   groups.get(theme).add(c.symbol);
  }
 }
 const overlapping=[...groups].filter(([,symbols])=>symbols.size>=2);
 const symbols=[...new Set(overlapping.flatMap(([,members])=>[...members]))].sort();
 const value=sum(symbols.map(s=>held.get(s).value));
 return value===null?null:{symbols,value,themeCount:overlapping.length};
}
function buildAdversePathEvidence({equity:e,rules:r,stress,now=Date.now()}={}){
 const result={protocol:VERSION,...identity(e),asOf:time(now)?now:null,status:'unknown',reason:null,paths:[],simultaneousThemeRetreat:null,
  pendingBudget:null,grossLimit:null,actualFutureLimitDownPath:null,...FLAGS};
 const h=holdings(e,now),a=stress?.assumptions;
 if(!h||!stress||stress.current!==true||stress.generatedAt!==now||stress.asOf!==e.observedAt||
    stress.accountId!==e.accountId||stress.accountEpoch!==e.accountEpoch||stress.equityEvidenceId!==e.fingerprint||
    stress.authoritySnapshotFingerprint!==e.source.snapshotFingerprint||stress.researchOnly!==true||stress.canTrade!==false||
    stress.accountMutated!==false||!text(a?.version)||!text(a?.source)||!rate(a.gapPct)||!rate(a.themeRetreatPct)){
  result.reason='CURRENT_BOUND_HOLDING_OR_SCENARIO_EVIDENCE_UNAVAILABLE';return result;
 }
 const p=pendingBudget(e,r,h,now),rule=grossRule(r,h,p);
 result.assumptions={version:VERSION,parentVersion:a.version,source:a.source,shockPerStepPct:a.gapPct,
  themeShockPct:a.themeRetreatPct,steps:[1,2,3],exitAssumption:'no-exit',calibrated:false,actualLimitDownRateKnown:false};
 result.pendingBudget=p?{status:'observed-original-budget',remainingBuyNotional:yuan(p.pending),reservedCash:yuan(p.reserved),
  estimatedRemainingFees:yuan(p.fee),availableCash:yuan(p.available),orderCount:p.orderCount,orderIds:p.orderIds,
  totalExposureAtOrderPrices:yuan(p.gross),currentEquity:yuan(h.equity),includesFilledHoldingsOnce:true}:
  {status:'unknown',reason:'ORIGINAL_PENDING_BUDGET_OR_ACCOUNT_IDENTITY_UNVERIFIED',remainingBuyNotional:null,reservedCash:null,
   estimatedRemainingFees:null,availableCash:null,orderCount:null,orderIds:[],totalExposureAtOrderPrices:null,currentEquity:yuan(h.equity)};
 result.grossLimit=rule;
 for(const steps of [1,2,3]){
  const factor=(1-a.gapPct/100)**steps,heldAfter=Math.round(h.value*factor),heldLoss=h.value-heldAfter;
  const lockedLoss=h.locked===null?null:Math.round(heldLoss*(h.value>0?h.locked/h.value:0));
  const after=p?Math.round(p.gross*factor):null,allEquity=p?sum([p.available,after]):null;
  const allLoss=allEquity!==null&&allEquity<=h.equity?h.equity-allEquity:null;
  const grossAfterPct=allEquity!==null?percent(after,allEquity):null;
  result.paths.push({steps,title:steps===1?'隔夜跳空且无法退出':steps+'段连续下跌且无法退出',compoundDeclinePct:round((1-factor)*100),
   heldMarkLoss:yuan(heldLoss),heldLossPctOfEquity:round(percent(heldLoss,h.equity)),heldEquityAfter:yuan(h.equity-heldLoss),
   currentlyRestrictedLotLoss:yuan(lockedLoss),otherHoldingLoss:lockedLoss===null?null:yuan(heldLoss-lockedLoss),
   allPendingFillLoss:yuan(allLoss),allPendingFillLossPctOfOriginalEquity:round(percent(allLoss,h.equity)),
   allPendingFillEquityAfter:yuan(allEquity),allPendingFillGrossAfterPct:round(grossAfterPct),
   aboveOriginalGrossLimit:rule&&finite(grossAfterPct)?grossAfterPct>rule.limitPct+1e-9:null,
   realizedLoss:null,exitProceedsAssumed:0,guaranteedFill:false});
 }
 const union=themeUnion(stress,h,now,e.day);
 result.simultaneousThemeRetreat=union?{status:union.symbols.length?'estimated':'no-observed-overlap',symbols:union.symbols,
  themeCount:union.themeCount,coveredHoldingValue:yuan(union.value),loss:yuan(union.value-Math.round(union.value*(1-a.themeRetreatPct/100))),
  includesPendingOrders:false,overlapDeduplicated:true,statisticalCorrelation:null}:
  {status:'unknown',symbols:[],themeCount:null,coveredHoldingValue:null,loss:null,includesPendingOrders:false,overlapDeduplicated:true,statisticalCorrelation:null};
 result.status=p&&union&&h.locked!==null?'estimated':'partial';
 result.reason=result.status==='partial'?'SOME_PENDING_CLASSIFICATION_OR_SELLABILITY_EVIDENCE_UNAVAILABLE':null;
 result.note='复合下跌是假设每段相同跌幅且全程不退出，不是未来交易日或逐股跌停价预测。买单按原未成交剩余委托金额与原估算费用假设全部成交，再承受下跌；不是已成交权益或保证可成交。当前受限批次损失仅为估值分解，不预测何时可卖。题材退潮仅对已持有的多股重叠取并集。情景仓位比例不用于释放风险额度。';
 return result;
}
function buildPlanOddsEvidence({equity:e,actions,plans=[],now=Date.now()}={}){
 const result={protocol:'fayo-frozen-plan-odds-research-v1',...identity(e),asOf:time(now)?now:null,status:'unknown',rows:[],omittedPlans:0,...FLAGS};
 if(!bound(e,actions,now)||actions.authorityStatus!=='verified'||!Array.isArray(actions.items)||actions.items.length>11000||
    !Array.isArray(plans)||plans.length>10000||!Array.isArray(e.positions)||e.positions.length>1000||
    !unique(e.positions.map(p=>p?.symbol))||e.positions.some(p=>!code(p?.symbol)||!qty(p.quantity)))return result;
 const holdingsBySymbol=new Map(e.positions.map(p=>[p.symbol,p.quantity]));
 const byId=new Map(),duplicates=new Set();
 for(const plan of plans){if(!text(plan?.id))continue;if(byId.has(plan.id))duplicates.add(plan.id);else byId.set(plan.id,plan);}
 const items=new Map(),duplicateItems=new Set();
 for(const item of actions.items){if(!text(item?.planId))continue;if(items.has(item.planId))duplicateItems.add(item.planId);else items.set(item.planId,item);}
 let eligible=0,verified=0;
 for(const [id,item] of items){
  const p=byId.get(id),quantity=item.constraints?.remainingQuantity,held=text(item.entryEventId)&&qty(quantity)&&quantity>0;
  // Completed plans and genuinely old unfilled candidates are not new offers.
  if(item.status==='filled'||!held&&!duplicates.has(id)&&!duplicateItems.has(id)&&p&&p.intendedDate<e.day&&quantity===0&&!item.entryEventId)continue;
  eligible++;
  if(result.rows.length>=100)continue;
  const out={planId:id,symbol:code(item.code)?item.code:null,scope:held?'held-position':'unfilled-candidate',status:'unknown',
   currentPrice:null,stopPrice:null,targetPrice:null,quoteAt:null,source:null,rewardPct:null,riskPct:null,grossRewardRiskRatio:null,
   costAdjustedRatio:null,winProbability:null,expectedValue:null,canTrade:false};
  result.rows.push(out);
  if(duplicates.has(id)||duplicateItems.has(id)||!p||p.decisionAuthority!=='fayo-decision-center'||!hash(p.decisionId)||
     p.code!==item.code||!code(p.code)||item.id!=='risk-action:'+e.accountId+':'+id||
     ['unknown','pending-reconciliation'].includes(item.status)||!qty(quantity)||
     (held?quantity===0:quantity!==0||item.entryEventId!=null||p.intendedDate!==e.day||item.status!=='observing'))continue;
  const actualShares=holdingsBySymbol.get(item.code)||0;
  if(held&&actualShares<quantity)continue;
  if(!held&&actualShares>0){
   // A fresh unfilled plan for an already held symbol is not a new entry
   // opportunity. Its old lot/plan attribution must be resolved separately.
   out.scope='held-unlinked';out.status='already-held-unlinked';verified++;continue;
  }
  const frozen=typeof p.frozenAt==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(p.frozenAt)?Date.parse(p.frozenAt):NaN;
  const {stop,target,entryMin,entryMax}=p,price=item.constraints?.price,c=item.condition;
  if(!time(frozen)||frozen>now||!held&&aShareCalendarDate(frozen)!==e.day||
     ![stop,target,entryMin,entryMax].every(positive)||!(stop<entryMin&&entryMin<=entryMax&&entryMax<target)||
     !positive(price?.current)||price.stop!==stop||price.target!==target||!text(price.source)||
     !fresh(price.quoteAt,now,e.day)||price.quoteAt<frozen||c?.observedAt!==now||c.quoteAt!==price.quoteAt||
     c.source!==price.source||c.price!==price.current||!['triggered','not-triggered'].includes(c.status))continue;
  const mark=price.current,expectedKind=held?(mark<=stop?'stop':mark>=target?'target':null):null;
  if(expectedKind?c.status!=='triggered'||c.kind!==expectedKind:c.status!=='not-triggered'||c.kind!=null)continue;
  Object.assign(out,{currentPrice:mark,stopPrice:stop,targetPrice:target,quoteAt:price.quoteAt,source:price.source});
  if(held&&mark<=stop)out.status='stop-reached';
  else if(held&&mark>=target)out.status='target-reached';
  else if(!held&&(mark<entryMin||mark>entryMax))out.status='entry-range-expired';
  else{
   const reward=(target-mark)/mark*100,risk=(mark-stop)/mark*100,ratio=(target-mark)/(mark-stop);
   if(positive(reward)&&positive(risk)&&positive(ratio)){
    Object.assign(out,{status:'price-geometry-only',rewardPct:round(reward),riskPct:round(risk),grossRewardRiskRatio:round(ratio)});
   }
  }
  if(out.status!=='unknown')verified++;
 }
 result.omittedPlans=eligible-result.rows.length;
 result.status=eligible===0?'no-applicable-plan':verified===eligible?'observed-research':verified?'partial':'unknown';
 result.note='只按原冻结止损、目标和新鲜同股报价计算未扣费的价格空间；不推断胜率、期望收益或保证止损成交。持仓与未持仓分开，候选超出原区间不再给入场赔率；实际行动仍由原账户权限与风控复核。';
 return result;
}
module.exports={buildAdversePathEvidence,buildPlanOddsEvidence,VERSION};
