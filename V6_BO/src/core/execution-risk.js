'use strict';
function validateExecutionRisk({maxParticipationPct=null,minPriorTurnover=null}={}){
  if(maxParticipationPct!==null&&(!Number.isFinite(maxParticipationPct)||maxParticipationPct<=0||maxParticipationPct>100))throw Error('成交参与率无效');
  if(minPriorTurnover!==null&&(!Number.isFinite(minPriorTurnover)||minPriorTurnover<0))throw Error('最小成交额无效');
}
function executionCapacity(stock,prior,requested,lotSize,config={}){
  validateExecutionRisk(config);
  if(config.minPriorTurnover!=null&&(!Number.isFinite(prior?.amount)||prior.amount<config.minPriorTurnover))return {shares:0,reason:'前日成交额不足或未知'};
  if(config.maxParticipationPct==null)return {shares:requested,reason:null};
  if((prior?.volumeUnit??stock.volumeUnit)!=='shares'||!Number.isFinite(prior?.volume)||prior.volume<0)return {shares:0,reason:'前日成交量或股数单位未知'};
  const cap=Math.floor(prior.volume*config.maxParticipationPct/100/lotSize)*lotSize;
  return {shares:Math.min(requested,cap),reason:cap<requested?'前日流动性参与率限制':null};
}
module.exports={validateExecutionRisk,executionCapacity};
