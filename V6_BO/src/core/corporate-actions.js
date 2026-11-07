'use strict';
// Explicit provider entitlements only; never infer ex-rights adjustments from a price gap.
function corporateAction(bar){
  if(!bar.corporateAction)return null;
  const a=bar.corporateAction;
  if(typeof bar.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)||!Number.isFinite(Date.parse(bar.date))||typeof a!=='object'||a.type!=='cash-and-shares'||typeof a.source!=='string'||!a.source.trim()||
     !Number.isFinite(a.netCashPerShare)||a.netCashPerShare<0||!Number.isFinite(a.shareMultiplier)||a.shareMultiplier<=0||
     !Number.isFinite(a.referenceClose)||a.referenceClose<=0||
     typeof a.publishedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(a.publishedAt)||
     !Number.isFinite(Date.parse(a.publishedAt))||Date.parse(a.publishedAt)>Date.parse(bar.date+'T09:30:00+08:00')||
     a.cashDate!==bar.date||a.sharesAvailableDate!==bar.date)
    throw Error('公司行为缺少当日到账、可流通及盘前公布的完整权益证据');
  return a;
}
function entitlement(shares,action){
  const quantity=shares*action.shareMultiplier;
  if(!Number.isSafeInteger(quantity))throw Error('公司行为存在零碎股，需提供供应商结算结果');
  return {shares:quantity,cash:shares*action.netCashPerShare};
}
module.exports={corporateAction,entitlement};
