'use strict';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function validateFeePolicy(p){if(p?.commissionScope!==undefined&&!['fill','order-day'].includes(p.commissionScope))throw Error('佣金汇总范围无效');if(p?.knownAt!==undefined&&(typeof p.knownAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(p.knownAt)||!Number.isFinite(Date.parse(p.knownAt))))throw Error('费率已知时点无效');if(!p||typeof p.version!=='string'||!p.version.trim()||!['feeBps','minFee','sellTaxBps'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0)||p.feeBps>100||p.sellTaxBps>100||p.transferBps!==undefined&&(!Number.isFinite(p.transferBps)||p.transferBps<0||p.transferBps>100))throw Error('费率配置无效');}
function validateFeeSchedules(rows){if(rows==null)return;if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('费率生效表无效');let prev='';const versions=new Set();for(const row of rows){validateFeePolicy(row);if(!validDate(row.effectiveFrom)||row.effectiveFrom<=prev||versions.has(row.version))throw Error('费率日期或版本重复/非递增');if(row.knownAt!==undefined&&(typeof row.knownAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(row.knownAt)||!Number.isFinite(Date.parse(row.knownAt))))throw Error('费率已知时点无效');prev=row.effectiveFrom;versions.add(row.version);}}
// Keep the original total-once rounding, but refuse amounts outside safe cents.
const safeMoney=n=>Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))&&round(n)===n;
function checkedMoney(n){if(!safeMoney(n))throw Error('成交金额或费用超出安全计算范围');return n;}
function feeTargets(gross,selected,side){
 const rawCommission=Math.max(selected.minFee,gross*selected.feeBps/10000),rawTax=side==='sell'?gross*selected.sellTaxBps/10000:0,rawTransfer=gross*(selected.transferBps||0)/10000;
 return {commission:checkedMoney(round(rawCommission)),tax:checkedMoney(round(rawTax)),transfer:checkedMoney(round(rawTransfer)),total:checkedMoney(round(rawCommission+rawTax+rawTransfer))};
}
function tradingFees({side,quantity,price,tradeDate,policy,schedules=null,priorFills=[]}){
 if(!['buy','sell'].includes(side)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<=0||!validDate(tradeDate))throw Error('费用计算输入无效');validateFeeSchedules(schedules);
 let selected=policy;if(schedules){selected=null;for(const row of schedules)if(row.effectiveFrom<=tradeDate)selected=row;if(!selected)throw Error('费率表没有覆盖交易日期');}validateFeePolicy(selected);
 if(selected.knownAt!==undefined&&Date.parse(selected.knownAt)>Date.parse(tradeDate+'T09:30:00+08:00'))throw Error('交易日开盘时费率尚未可知，禁止回填历史费用');
 const gross=checkedMoney(round(quantity*price));
 let priorGross=0,priorCommission=0,priorTax=0,priorTransfer=0,priorTotal=0;
 if(selected.commissionScope==='order-day'){
  if(!Array.isArray(priorFills))throw Error('历史成交费用证据无效');
  const seen=new Set();
  for(const e of priorFills){
   if(!e||typeof e!=='object'||Array.isArray(e))throw Error('历史成交费用证据无效');
   // Existing callers also pass the full order event list. Only explicit
   // non-fill events may be ignored without inspecting their date/evidence.
   if(e.type!==undefined&&e.type!=='fill'){
    if(e.feeEvidence)throw Error('非成交事件含有历史成交费用证据');
    continue;
   }
   if(!validDate(e.date)||e.date>tradeDate)throw Error('历史成交费用日期证据无效');
   if(e.date!==tradeDate)continue;
   const f=e.feeEvidence;
   if(!f||typeof f.version!=='string'||!f.version.trim())throw Error('历史成交费用版本证据缺失');
   if(e.eventId!==undefined){
    if(typeof e.eventId!=='string'||!e.eventId.trim()||seen.has(e.eventId))throw Error('历史成交费用事件重复或无效');
    seen.add(e.eventId);
   }
   // Different explicit fee versions have independent minimum commissions.
   if(f.version!==selected.version)continue;
   if((f.commissionScope!==undefined&&f.commissionScope!=='order-day')||(f.effectiveFrom!==undefined&&f.effectiveFrom!==(selected.effectiveFrom||null))||(f.rounding!==undefined&&f.rounding!=='total-once'))throw Error('历史成交费用口径证据不符');
   if(!['gross','commission','tax','transfer','total'].every(k=>safeMoney(f[k])))throw Error('历史成交费用证据无效');
   if(e.quantity!==undefined||e.price!==undefined){
    if(!Number.isFinite(e.quantity)||e.quantity<=0||!Number.isFinite(e.price)||e.price<=0||round(e.quantity*e.price)!==f.gross)throw Error('历史成交费用与成交金额证据不符');
   }
   if(e.fee!==undefined&&e.fee!==f.total)throw Error('历史成交费用与实记费用不符');
   const target=feeTargets(checkedMoney(round(f.gross+priorGross)),selected,side);
   // Verify every prefix against the immutable fee version, not only the
   // final sum. This prevents missing or inflated credits from later fills.
   if(f.commission!==round(target.commission-priorCommission)||f.tax!==round(target.tax-priorTax)||f.transfer!==round(target.transfer-priorTransfer)||f.total!==round(target.total-priorTotal))throw Error('历史成交费用证据与累计费率不符');
   if(f.roundingAdjustment!==undefined&&f.roundingAdjustment!==round(f.total-f.commission-f.tax-f.transfer))throw Error('历史成交费用舍入证据不符');
   priorGross+=f.gross;priorCommission+=f.commission;priorTax+=f.tax;priorTransfer+=f.transfer;priorTotal+=f.total;
  }
 }
 const cumulativeGross=checkedMoney(round(gross+priorGross)),target=feeTargets(cumulativeGross,selected,side);
 const commission=checkedMoney(round(target.commission-priorCommission)),tax=checkedMoney(round(target.tax-priorTax)),transfer=checkedMoney(round(target.transfer-priorTransfer)),total=checkedMoney(round(target.total-priorTotal));
 const roundingAdjustment=round(total-commission-tax-transfer);
 return {gross,total,commission:round(commission),tax:round(tax),transfer:round(transfer),roundingAdjustment,rounding:'total-once',commissionScope:selected.commissionScope||'fill',version:selected.version,effectiveFrom:selected.effectiveFrom||null};
}
module.exports={tradingFees,validateFeePolicy,validateFeeSchedules};
function maxAffordableQuantity({budget,price,lotSize=100,tradeDate,policy,schedules=null}){
 if(!Number.isFinite(budget)||budget<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(lotSize)||lotSize<1)throw Error('可买数量输入无效');
 let lo=0,hi=Math.min(Math.floor(budget/price/lotSize),Math.floor(Number.MAX_SAFE_INTEGER/lotSize));
 while(lo<hi){const mid=lo+Math.ceil((hi-lo)/2),q=mid*lotSize,fee=tradingFees({side:'buy',quantity:q,price,tradeDate,policy,schedules});if(q*price+fee.total<=budget+1e-8)lo=mid;else hi=mid-1;}
 return lo*lotSize;
}
module.exports.maxAffordableQuantity=maxAffordableQuantity;
// Match the original server paperLotOf sizing contract. Research deliberately
// keeps its conservative 200-share increment for 688/689, not a new exchange
// or broker execution rule.
function paperBuyLotSize(code){return /^(688|689)/.test(String(code||''))?200:100;}
module.exports.paperBuyLotSize=paperBuyLotSize;
