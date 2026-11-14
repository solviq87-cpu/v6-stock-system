'use strict';
/** One entry point for date-bounded native evidence, research ranking and paper ledger.
 * Every subsystem consumes the same validated dataset. No real orders or fabricated Python results. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {runNativeDaily}=require('./native-strategy-daily-runner');
const {runOfflineResearchClosure}=require('./offline-research-closure');
const {buildRunAudit}=require('./unified-run-audit');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function runUnifiedStrategyProject(history,options={}){
 const validation=validateDataset(history);
 const native=runNativeDaily(history,{snapshots:options.snapshots||{},pythonEvidence:options.pythonEvidence||{},splitDay:options.splitDay??history.splitDay,generatedAt:options.generatedAt||'1970-01-01T00:00:00Z'});
 const research=runOfflineResearchClosure(history,{now:options.now});
 // The ranking and paper ledger are research-only; never promote a pass into an order.
 const coverage=native.coverage;
 const blockers=['未核验真实行情供应商与公司行为','没有独立模拟盘持续样本外验收'];
 for(const [system,v] of Object.entries(coverage))if(!v.evaluated)blockers.push(`${system}无可评估原生信号`);
 return {schemaVersion:1,mode:'unified-offline-strategy-project',canTrade:false,verifiedLive:false,
  datasetFingerprint:hash(history),validation,asOf:research.asOf,coverage,
  audit:buildRunAudit(history,options,native,options.pythonExecution),
  native:{details:native.details,replay:native.replay},ranking:research.ranking,
  paper:research.paper,backtest:research.backtest,gate:{eligible:false,blockers},
  warnings:['研究排行榜不是交易指令','历史回测和纸面撮合不能证明真实成交或未来收益']};
}
module.exports={runUnifiedStrategyProject};
