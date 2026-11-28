'use strict';
// Read-only projections of the existing original risk and replay outputs.
// Money entering jointStress/reverseGross is already reconciled integer cents.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const qty=n=>Number.isSafeInteger(n)&&n>=0;
const rate=n=>finite(n)&&n>0&&n<=100;
const yuan=n=>qty(n)?n/100:null;
const round=n=>finite(n)?Number(n.toFixed(6)):null;
const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,executionGuaranteed:false,maximumLossGuarantee:false};
function jointStress(h,p,a){
 const base={status:'unknown',combinedDeclinePct:null,heldMarkLoss:null,heldEquityAfter:null,restrictedMarkLoss:null,allPendingFillLoss:null,allPendingFillEquityAfter:null,hypotheticalSellableExitCost:null,realizedLoss:null,actualExitProceeds:null,...flags};
 if(!h||!qty(h.value)||!qty(h.equity)||!qty(h.cash)||h.cash+h.value!==h.equity||!rate(a?.gapPct)||!rate(a?.liquidityPriceShockPct)||!finite(a.additionalLiquidationCostBps)||a.additionalLiquidationCostBps<0||a.additionalLiquidationCostBps>10000)return base;
 const factor=(1-a.gapPct/100)*(1-a.liquidityPriceShockPct/100),after=Math.round(h.value*factor),loss=h.value-after;
 const locked=qty(h.locked)&&h.locked<=h.value?h.locked:null;
 const pendingKnown=p&&qty(p.gross)&&qty(p.available)&&qty(p.fee)&&qty(p.pending)&&p.gross===h.value+p.pending&&p.available+p.pending+p.fee===h.cash;
 const allAfter=pendingKnown?p.available+Math.round(p.gross*factor):null;
 const validAll=qty(allAfter)&&allAfter<=h.equity;
 return {...base,status:validAll&&locked!==null?'estimated-unverified':'partial',combinedDeclinePct:round((1-factor)*100),heldMarkLoss:yuan(loss),heldEquityAfter:yuan(h.equity-loss),restrictedMarkLoss:locked===null?null:yuan(locked-Math.round(locked*factor)),
  allPendingFillLoss:validAll?yuan(h.equity-allAfter):null,allPendingFillEquityAfter:validAll?yuan(allAfter):null,
  hypotheticalSellableExitCost:locked===null?null:yuan(Math.round((h.value-locked)*factor*a.additionalLiquidationCostBps/10000)),
  assumptionVersion:a.version??null,includesPendingOrders:!!validAll,liquidationCostBps:a.additionalLiquidationCostBps,exitAssumption:'no-exit-mark-loss; separate optional current-sellable cost',statisticalCorrelation:null,
  note:'跳空与流动性价格冲击连续作用，同一持仓只计算一次；未成买单全部成交及冻结费用仅为条件假设。无退出损失不加未发生的卖出费用；另列当前可卖批次假设费用，不保证成交或解除风险。'};
}
function reverseGross(h,p,rule){
 const base={status:'unknown',policyVersion:null,limitPct:null,heldOnly:null,allPendingFill:null,...flags};
 if(!h||!p||!rule||typeof rule.version!=='string'||!rule.version||!rate(rule.limitPct)||![h.cash,h.value,h.equity,p.gross,p.available,p.pending,p.fee].every(qty)||h.cash+h.value!==h.equity||p.gross!==h.value+p.pending||p.available+p.pending+p.fee!==h.cash||h.equity===0||!finite(rule.currentOriginalUsedPct)||typeof rule.currentOriginalExceeded!=='boolean'||Math.abs(100*p.gross/h.equity-rule.currentOriginalUsedPct)>0.00001||rule.currentOriginalExceeded!==(100*p.gross/h.equity>rule.limitPct+1e-9))return base;
 function path(exposure,cash){
  const total=exposure+cash;if(!qty(total)||total===0)return null;
  const current=100*exposure/total,already=current>=rule.limitPct,strict=current>rule.limitPct+1e-9;
  const need=already?0:exposure===0||rule.limitPct===100?null:rule.limitPct/(100-rule.limitPct)*cash-exposure;
  return {currentGrossPct:round(current),alreadyAboveLimit:strict,touchReachable:need!==null&&finite(need),gainToTouch:need===null?null:round(need/100),uniformMarkRiseToTouchPct:need!==null&&exposure>0?round(100*need/exposure):null};
 }
 return {...base,status:'estimated-unverified',policyVersion:rule.version,limitPct:rule.limitPct,heldOnly:path(h.value,h.cash),allPendingFill:path(p.gross,p.available),
  note:'基于原生效总仓位限额的等比例价格上涨触线情景；触线不是原严格超限，待买全成是假设，不等于实际新权益或风险解除。'};
}
function replayExecutionCoverage(orders,finalHoldings){
 const base={status:'unknown',buy:null,sell:null,openPositionCount:null,allExitCompleted:null,realizedNetPnl:null,actualExecutionClaim:false};
 if(!Array.isArray(orders)||!Array.isArray(finalHoldings)||orders.length>10000||finalHoldings.length>1000)return base;
 const sides={buy:{requestedQuantity:0,filledQuantity:0,unfilledQuantity:0,filledRecords:0,blockedRecords:0},sell:{requestedQuantity:0,filledQuantity:0,unfilledQuantity:0,filledRecords:0,blockedRecords:0}};
 for(const row of orders){
  if(!['buy','sell'].includes(row?.side))return base;
  const s=sides[row.side];if(!['hypothetical-filled','hypothetical-blocked'].includes(row.status)||!qty(row.quantity)||row.quantity===0)return base;
  s.requestedQuantity+=row.quantity;
  if(row.status==='hypothetical-filled'){s.filledQuantity+=row.quantity;s.filledRecords++;}else{s.unfilledQuantity+=row.quantity;s.blockedRecords++;}
  if(!qty(s.requestedQuantity))return base;
 }
 if(finalHoldings.some(h=>!h||typeof h.symbol!=='string'||!/^\d{6}$/.test(h.symbol)||!qty(h.quantity))||new Set(finalHoldings.map(h=>h.symbol)).size!==finalHoldings.length)return base;
 const openPositionCount=finalHoldings.filter(h=>h.quantity>0).length;
 return {...base,status:'hypothetical-replay-only',...sides,openPositionCount,allExitCompleted:openPositionCount===0,
  note:'填充与受阻余量分别累计，未强制期末清仓；不等于真实成交、实际已实现净收益或成交概率。'};
}
module.exports={jointStress,reverseGross,replayExecutionCoverage};
