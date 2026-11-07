'use strict';
function reconcileAccount(report){
  if(!report||!Array.isArray(report.cashFlows)||!report.cashFlows.length)throw Error('资金流水缺失');
  let balance=0;
  for(const row of report.cashFlows){
    if(!Number.isFinite(row.amount)||!Number.isFinite(row.balance))throw Error('资金流水数值无效');
    balance+=row.amount;
    if(Math.abs(balance-row.balance)>0.011)throw Error('资金流水余额不符');
  }
  const last=report.equity?.at(-1);
  if(!last||!Number.isFinite(last.cash)||Math.abs(last.cash-balance)>0.011)throw Error('资金流水与账户现金不符');
  return {balanced:true,entries:report.cashFlows.length,finalCash:Math.round(balance*100)/100,scope:'cash-ledger',verifiedLive:false};
}
module.exports={reconcileAccount};
