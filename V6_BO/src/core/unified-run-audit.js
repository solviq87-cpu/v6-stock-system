'use strict';
/** Deterministic audit manifest for offline research; not a live-data certification. */
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function buildRunAudit(history,options,native,execution){
 // Bind the options actually supplied to the research runner. Hash rather
 // than exposing configuration or evidence values in the manifest.
 const pythonScriptSha256=execution?.scriptSha256||null;
 const executionView=execution?{mode:execution.mode,calls:execution.calls,verifiedStrategyRules:execution.verifiedStrategyRules}:null;
 const sources={history:sha(history),snapshots:sha(options.snapshots||{}),pythonEvidence:sha(options.pythonEvidence||{}),
  researchClock:sha({now:Number.isFinite(options.now)?options.now:null,generatedAt:options.generatedAt||'1970-01-01T00:00:00Z'}),
  marketQuality:sha(options.marketQuality||{}),portfolioConfig:sha(options.portfolioConfig||{}),
  strategyHealth:sha(options.strategyHealth||{}),pythonExecution:sha({scriptSha256:pythonScriptSha256,execution:executionView})};
 const strategyEvidence=sha(native.details);
 const splitDay=options.splitDay??history.splitDay??null;
 const inputs={...sources,splitDay,runner:'v6-unified-offline-audit-2',pythonScriptSha256};
 const runId=sha(inputs);
 return {schemaVersion:1,fingerprintVersion:2,runId,inputFingerprints:sources,splitDay,pythonScriptSha256:inputs.pythonScriptSha256,
  strategyEvidenceSha256:strategyEvidence,execution:executionView,
  assertions:{realMarketDataVerified:false,realOrdersPlaced:false,pythonRulesAudited:false},
  note:'指纹仅保证输入与本次输出可比对，不代表行情真实性、无前视偏差的外部审计或实盘可成交性'};
}
module.exports={buildRunAudit};
