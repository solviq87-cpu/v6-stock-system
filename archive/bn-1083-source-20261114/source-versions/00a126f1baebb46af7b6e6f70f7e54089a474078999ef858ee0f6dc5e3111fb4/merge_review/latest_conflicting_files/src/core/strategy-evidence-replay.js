'use strict';
/** Audited, time-ordered strategy evidence replay. Never synthesizes native decisions. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {attributeIndependentStrategies,SYSTEMS}=require('./independent-strategy-attribution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function replayStrategyEvidence(history, evidenceBundle, options={}){
 const ds=validateDataset(history);
 if(!evidenceBundle||!Array.isArray(evidenceBundle.signals)||!evidenceBundle.generatedAt||!evidenceBundle.source)throw Error('需要带来源、生成时间和 signals 的策略证据包');
 if(evidenceBundle.signals.length>ds.stocks*ds.barsPerStock*4)throw Error('策略证据过多');
 const dates=history.stocks[0].bars.map(x=>x.date);
 if(dates.some(x=>!x))throw Error('逐日策略回放要求交易日期');
 const split=options.splitDay??history.splitDay;
 if(split!==undefined&&(!Number.isInteger(split)||split<2||split>=dates.length-2))throw Error('样本外分割位置无效');
 const symbols=new Set(history.stocks.map(s=>String(s.symbol||s.code)));
 const signals=evidenceBundle.signals.map((s,i)=>{
  if(!s||!SYSTEMS.includes(s.system)||!symbols.has(s.symbol)||!dates.includes(s.date))throw Error(`第${i}条策略信号无效`);
  if(!['pass','fail','unknown'].includes(s.verdict)||typeof s.provenance!=='string'||!s.provenance.trim())throw Error('策略结论或来源无效');
  if(typeof s.observedThrough!=='string'||s.observedThrough>s.date)throw Error('策略信号包含未来数据或缺少观察截止日期');
  if(!s.evaluatorVersion||typeof s.evaluatorVersion!=='string')throw Error('必须记录原生评估器版本');
  return {system:s.system,symbol:s.symbol,date:s.date,verdict:s.verdict,provenance:s.provenance,
   observedThrough:s.observedThrough,evaluatorVersion:s.evaluatorVersion};
 });
 const base=attributeIndependentStrategies(history,{...options,evidence:signals});
 const windows={inSample:[],outOfSample:[],unassigned:[]};
 for(const r of base.records){
  const idx=dates.indexOf(r.signalDate);
  const entry=idx+1,exit=idx+2;
  const group=split===undefined?'unassigned':exit<split?'inSample':entry>=split?'outOfSample':'unassigned';
  windows[group].push(r);
 }
 const stats=records=>Object.fromEntries(SYSTEMS.map(system=>{
  const items=records.filter(x=>x.system===system),done=items.filter(x=>x.outcome.status==='paper-estimate');
  const returns=done.map(x=>x.outcome.netReturnPct);
  return [system,{evidenceCount:items.length,paperTrades:done.length,blocked:items.filter(x=>x.outcome.status==='blocked').length,
   winRatePct:returns.length?+(100*returns.filter(x=>x>0).length/returns.length).toFixed(4):null,
   meanNetReturnPct:returns.length?+(returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(4):null}];
 }));
 return {schemaVersion:1,mode:'audited-strategy-evidence-replay',canTrade:false,verifiedLive:false,
  datasetFingerprint:base.datasetFingerprint,evidenceBundleFingerprint:hash(evidenceBundle),
  generatedAt:evidenceBundle.generatedAt,source:evidenceBundle.source,splitDay:split??null,
  splitDate:split===undefined?null:dates[split],systems:base.systems,
  windows:Object.fromEntries(Object.entries(windows).map(([k,v])=>[k,{systems:stats(v),records:v}])),
  limitations:['信号必须由原生策略评估器产生并提供独立来源','样本外仅按信号及成交日期严格划分','纸面估计不等于可成交或实盘有效性']};
}
module.exports={replayStrategyEvidence};
