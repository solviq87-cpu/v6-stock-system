'use strict';
/** Deterministic audit manifest for offline research; not a live-data certification. */
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function buildRunAudit(history,options,native,execution){
 const sources={history:sha(history),snapshots:sha(options.snapshots||{}),pythonEvidence:sha(options.pythonEvidence||{})};
 const strategyEvidence=sha(native.details);
 const splitDay=options.splitDay??history.splitDay??null;
 const inputs={...sources,splitDay,runner:'v6-unified-offline-audit-1',pythonScriptSha256:execution?.scriptSha256||null};
 const runId=sha(inputs);
 return {schemaVersion:1,runId,inputFingerprints:sources,splitDay,pythonScriptSha256:inputs.pythonScriptSha256,
  strategyEvidenceSha256:strategyEvidence,execution:execution?{mode:execution.mode,calls:execution.calls,verifiedStrategyRules:execution.verifiedStrategyRules}:null,
  assertions:{realMarketDataVerified:false,realOrdersPlaced:false,pythonRulesAudited:false},
  note:'指纹仅保证输入与本次输出可比对，不代表行情真实性、无前视偏差的外部审计或实盘可成交性'};
}
module.exports={buildRunAudit};
