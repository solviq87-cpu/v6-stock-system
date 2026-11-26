'use strict';
function validateExecutionRisk({maxParticipationPct=null,minPriorTurnover=null}={}){
  if(maxParticipationPct!==null&&(!Number.isFinite(maxParticipationPct)||maxParticipationPct<=0||maxParticipationPct>100))throw Error('成交参与率无效');
  if(minPriorTurnover!==null&&(!Number.isFinite(minPriorTurnover)||minPriorTurnover<0))throw Error('最小成交额无效');
}
function executionCapacity(stock,prior,requested,lotSize,config={}){
  validateExecutionRisk(config);
  if(!Number.isSafeInteger(requested)||requested<0||!Number.isSafeInteger(lotSize)||lotSize<1)return {shares:0,reason:'委托股数或手数单位无效'};
  // Explicit per-bar unknown metadata must not be revived by a stock default.
  // Preserve the legacy amount contract only when no amount metadata exists.
  const field=key=>prior?.[key]!==undefined?prior[key]:stock?.[key];
  if(config.minPriorTurnover!=null){
    const unit=field('amountUnit'),basis=field('amountBasis');
    if(!Number.isFinite(prior?.amount)||prior.amount<config.minPriorTurnover||
      unit!==undefined&&unit!=='CNY'||basis!==undefined&&basis!=='actual-unadjusted-turnover')return {shares:0,reason:'前日成交额不足或未知'};
  }
  if(config.maxParticipationPct==null)return {shares:requested,reason:null};
  if(field('volumeUnit')!=='shares'||!Number.isSafeInteger(prior?.volume)||prior.volume<0)return {shares:0,reason:'前日成交量或股数单位未知'};
  const cap=Math.floor(prior.volume*config.maxParticipationPct/100/lotSize)*lotSize;
  return {shares:Math.min(requested,cap),reason:cap<requested?'前日流动性参与率限制':null};
}
module.exports={validateExecutionRisk,executionCapacity};
