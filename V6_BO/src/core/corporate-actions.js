'use strict';
// Explicit provider entitlements only; never infer ex-rights adjustments from a price gap.
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
function validPublication(t){
  // Date.parse alone can normalize impossible calendar dates into the next month.
  return typeof t==='string'&&/^\d{4}-\d{2}-\d{2}[T ]/.test(t)&&validDay(t.slice(0,10))&&
    /(Z|[+-]\d{2}:\d{2})$/.test(t)&&Number.isFinite(Date.parse(t));
}
function corporateAction(bar){
  if(!bar.corporateAction)return null;
  const a=bar.corporateAction;
  if(!validDay(bar.date)||typeof a!=='object'||a.type!=='cash-and-shares'||typeof a.source!=='string'||!a.source.trim()||
     !Number.isFinite(a.netCashPerShare)||a.netCashPerShare<0||!Number.isFinite(a.shareMultiplier)||a.shareMultiplier<=0||
     !Number.isFinite(a.referenceClose)||a.referenceClose<=0||
     !validPublication(a.publishedAt)||Date.parse(a.publishedAt)>Date.parse(bar.date+'T09:30:00+08:00')||
     a.cashDate!==bar.date||a.sharesAvailableDate!==bar.date)
    throw Error('公司行为缺少当日到账、可流通及盘前公布的完整权益证据');
  return a;
}
function entitlement(shares,action){
  if(!Number.isSafeInteger(shares)||shares<0)throw Error('公司行为原持仓股数无效');
  if(!action||!Number.isFinite(action.shareMultiplier)||action.shareMultiplier<=0||
     !Number.isFinite(action.netCashPerShare)||action.netCashPerShare<0)throw Error('公司行为权益证据无效');
  const quantity=shares*action.shareMultiplier;
  if(!Number.isSafeInteger(quantity)||(shares>0&&quantity<=0))throw Error('公司行为存在零碎股，需提供供应商结算结果');
  const cash=shares*action.netCashPerShare;
  if(!Number.isFinite(cash)||!Number.isSafeInteger(Math.round(cash*100)))throw Error('公司行为现金金额超出安全分范围');
  return {shares:quantity,cash};
}
module.exports={corporateAction,entitlement};
