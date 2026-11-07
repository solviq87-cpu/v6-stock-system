'use strict';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function validateFeePolicy(p){if(p?.commissionScope!==undefined&&!['fill','order-day'].includes(p.commissionScope))throw Error('佣金汇总范围无效');if(!p||typeof p.version!=='string'||!p.version.trim()||!['feeBps','minFee','sellTaxBps'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0)||p.feeBps>100||p.sellTaxBps>100||p.transferBps!==undefined&&(!Number.isFinite(p.transferBps)||p.transferBps<0||p.transferBps>100))throw Error('费率配置无效');}
function validateFeeSchedules(rows){if(rows==null)return;if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('费率生效表无效');let prev='';const versions=new Set();for(const row of rows){validateFeePolicy(row);if(!validDate(row.effectiveFrom)||row.effectiveFrom<=prev||versions.has(row.version))throw Error('费率日期或版本重复/非递增');prev=row.effectiveFrom;versions.add(row.version);}}
function tradingFees({side,quantity,price,tradeDate,policy,schedules=null,priorFills=[]}){
 if(!['buy','sell'].includes(side)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<=0||!validDate(tradeDate))throw Error('费用计算输入无效');validateFeeSchedules(schedules);
 let selected=policy;if(schedules){selected=null;for(const row of schedules)if(row.effectiveFrom<=tradeDate)selected=row;if(!selected)throw Error('费率表没有覆盖交易日期');}validateFeePolicy(selected);
 const gross=round(quantity*price);if(!Number.isFinite(gross))throw Error('成交金额超出可计算范围');
 let priorGross=0,priorCommission=0,priorTax=0,priorTransfer=0,priorTotal=0;
 if(selected.commissionScope==='order-day'){
  if(!Array.isArray(priorFills))throw Error('历史成交费用证据无效');
  for(const e of priorFills){const f=e.feeEvidence;if(!f||e.date!==tradeDate||f.version!==selected.version)continue;
   if(!['gross','commission','tax','transfer','total'].every(k=>Number.isFinite(f[k])&&f[k]>=0))throw Error('历史成交费用证据无效');
   priorGross+=f.gross;priorCommission+=f.commission;priorTax+=f.tax;priorTransfer+=f.transfer;priorTotal+=f.total;
  }
 }
 const cumulativeGross=round(gross+priorGross),commission=round(Math.max(selected.minFee,cumulativeGross*selected.feeBps/10000))-priorCommission,tax=round(side==='sell'?cumulativeGross*selected.sellTaxBps/10000:0)-priorTax,transfer=round(cumulativeGross*(selected.transferBps||0)/10000)-priorTransfer;
 if([commission,tax,transfer].some(n=>n<-.001))throw Error('历史费用证据与累计费率不符');
 const target=selected.commissionScope==='order-day'?round(Math.max(selected.minFee,cumulativeGross*selected.feeBps/10000)+(side==='sell'?cumulativeGross*selected.sellTaxBps/10000:0)+cumulativeGross*(selected.transferBps||0)/10000):round(Math.max(selected.minFee,gross*selected.feeBps/10000)+(side==='sell'?gross*selected.sellTaxBps/10000:0)+gross*(selected.transferBps||0)/10000);
 const total=round(target-priorTotal),roundingAdjustment=round(total-round(commission)-round(tax)-round(transfer));
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
