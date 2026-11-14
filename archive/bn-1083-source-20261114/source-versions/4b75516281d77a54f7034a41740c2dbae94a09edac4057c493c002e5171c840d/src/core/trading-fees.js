'use strict';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function validateFeePolicy(p){if(!p||typeof p.version!=='string'||!p.version.trim()||!['feeBps','minFee','sellTaxBps'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0)||p.feeBps>100||p.sellTaxBps>100||p.transferBps!==undefined&&(!Number.isFinite(p.transferBps)||p.transferBps<0||p.transferBps>100))throw Error('费率配置无效');}
function validateFeeSchedules(rows){if(rows==null)return;if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('费率生效表无效');let prev='';const versions=new Set();for(const row of rows){validateFeePolicy(row);if(!validDate(row.effectiveFrom)||row.effectiveFrom<=prev||versions.has(row.version))throw Error('费率日期或版本重复/非递增');prev=row.effectiveFrom;versions.add(row.version);}}
function tradingFees({side,quantity,price,tradeDate,policy,schedules=null}){
 if(!['buy','sell'].includes(side)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<=0||!validDate(tradeDate))throw Error('费用计算输入无效');validateFeeSchedules(schedules);
 let selected=policy;if(schedules){selected=null;for(const row of schedules)if(row.effectiveFrom<=tradeDate)selected=row;if(!selected)throw Error('费率表没有覆盖交易日期');}validateFeePolicy(selected);
 const gross=round(quantity*price);if(!Number.isFinite(gross))throw Error('成交金额超出可计算范围');
 const commission=Math.max(selected.minFee,gross*selected.feeBps/10000),tax=side==='sell'?gross*selected.sellTaxBps/10000:0,transfer=gross*(selected.transferBps||0)/10000;
 const total=round(commission+tax+transfer),roundingAdjustment=round(total-round(commission)-round(tax)-round(transfer));
 return {gross,total,commission:round(commission),tax:round(tax),transfer:round(transfer),roundingAdjustment,rounding:'total-once',version:selected.version,effectiveFrom:selected.effectiveFrom||null};
}
module.exports={tradingFees,validateFeePolicy,validateFeeSchedules};
function maxAffordableQuantity({budget,price,lotSize=100,tradeDate,policy,schedules=null}){
 if(!Number.isFinite(budget)||budget<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(lotSize)||lotSize<1)throw Error('可买数量输入无效');
 let lo=0,hi=Math.min(Math.floor(budget/price/lotSize),Math.floor(Number.MAX_SAFE_INTEGER/lotSize));
 while(lo<hi){const mid=lo+Math.ceil((hi-lo)/2),q=mid*lotSize,fee=tradingFees({side:'buy',quantity:q,price,tradeDate,policy,schedules});if(q*price+fee.total<=budget+1e-8)lo=mid;else hi=mid-1;}
 return lo*lotSize;
}
module.exports.maxAffordableQuantity=maxAffordableQuantity;
