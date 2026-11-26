'use strict';
// Research-only diagnostics. No changes to approved parameters or orders.
const {isDeepStrictEqual}=require('node:util');
const {barsToIndicators,ema}=require('../strategy/historical-indicators');
const report=fields=>({schemaVersion:1,mode:'research-only',canTrade:false,autoPromotion:false,...fields});
function auditPointInTime({evaluate,input,cutoff,variants}={}){
 if(typeof evaluate!=='function'||typeof cutoff!=='string'||!Array.isArray(variants)||!variants.length||variants.length>20)throw Error('因果审计参数无效');
 const baseline=evaluate(structuredClone(input),cutoff);
 const checks=variants.map(v=>{
  if(!v||typeof v.name!=='string'||typeof v.mutate!=='function')throw Error('缺失扰动定义');
  const changed=v.mutate(structuredClone(input),cutoff);
  if(changed===undefined||isDeepStrictEqual(input,changed))return {name:v.name,status:'not-evaluated',reason:'扰动没有改变输入'};
  return {name:v.name,status:isDeepStrictEqual(baseline,evaluate(changed,cutoff))?'pass':'fail'};
 });
 return report({cutoff,checks,status:checks.some(x=>x.status==='fail')?'fail':checks.every(x=>x.status==='pass')?'pass':'not-evaluated'});
}
const fields=x=>({ma5:x.ma5,ma10:x.ma10,ma20:x.ma20,macdDif:x.macd?.dif,macdDea:x.macd?.dea,macdHist:x.macd?.hist,rsi14:x.rsi14,k:x.kdj?.k,d:x.kdj?.d,j:x.kdj?.j,volumeRatio:x.volumeRatio});
function indicatorWarmup(bars,{lengths=[26,60,120,250],absTolerance=.001,relativeTolerance=.0001}={}){
 if(!Array.isArray(bars)||bars.length>50000||!Array.isArray(lengths)||lengths.length>20||!lengths.length||lengths.some(n=>!Number.isSafeInteger(n)||n<26)||!Number.isFinite(absTolerance)||absTolerance<0||!Number.isFinite(relativeTolerance)||relativeTolerance<0)throw Error('预热审计参数无效');
 if(!bars.length||bars.some((b,i)=>typeof b?.date!=='string'||i>0&&b.date<=bars[i-1].date))return report({status:'not-evaluated',reason:'需要严格递增日期的同周期已收盘K线',checks:[]});
 const baseline=barsToIndicators(bars);
 if(!baseline.valid||!baseline.ready)return report({status:'not-evaluated',reason:'完整历史不足或OHLCV无效',checks:[]});
 const reference=fields(baseline);
 const checks=[...new Set(lengths)].sort((a,b)=>a-b).map(length=>{
  if(length>=bars.length)return {length,status:'not-evaluated',reason:'缺少更长参考历史'};
  const values=fields(barsToIndicators(bars.slice(-length)));
  const differences=Object.keys(reference).map(key=>{
   const a=reference[key],b=values[key];
   const delta=Number.isFinite(a)&&Number.isFinite(b)?Math.abs(a-b):null;
   const limit=Number.isFinite(a)?absTolerance+relativeTolerance*Math.abs(a):null;
   return {key,delta,limit,status:delta===null?'not-evaluated':delta<=limit?'pass':'fail'};
  });
  return {length,status:differences.some(x=>x.status==='fail')?'fail':differences.every(x=>x.status==='pass')?'pass':'not-evaluated',differences};
 });
 return report({status:checks.some(x=>x.status==='fail')?'fail':checks.every(x=>x.status==='pass')?'pass':'not-evaluated',referenceLength:bars.length,absTolerance,relativeTolerance,checks,
 limitation:'仅比较现有计算器历史长度敏感性；不证明增量更新、重启一致性或独立实现稳定性'});
}

// A genuinely separate constant-space update path, with a versioned restart checkpoint.
// Native batch indicators remain untouched. This state is only diagnostic, never persisted
// to the authoritative market, signal, parameter or account stores.
function createIndicatorState(){return {schemaVersion:1,count:0,lastDate:null,ema12:null,ema26:null,dea:null};}
function restoreIndicatorState(serialized){
 const state=typeof serialized==='string'?JSON.parse(serialized):structuredClone(serialized);
 if(!state||state.schemaVersion!==1||!Number.isSafeInteger(state.count)||state.count<0||
   (state.count===0?(state.lastDate!==null||state.ema12!==null||state.ema26!==null||state.dea!==null):
    (typeof state.lastDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(state.lastDate)||![state.ema12,state.ema26,state.dea].every(Number.isFinite))))throw Error('指标重启检查点无效');
 return state;
}
function updateIndicatorState(previous,bar){
 const state=restoreIndicatorState(previous),validation=barsToIndicators([bar]);
 if(!validation.valid||typeof bar.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)||!Number.isFinite(Date.parse(bar.date))||new Date(bar.date).toISOString().slice(0,10)!==bar.date||state.lastDate!==null&&bar.date<=state.lastDate)throw Error('增量指标需要递增且完整的已收盘K线');
 // Intentionally use a recurrence distinct from the production batch implementation.
 const fast=state.count?state.ema12+(bar.close-state.ema12)*2/13:bar.close;
 const slow=state.count?state.ema26+(bar.close-state.ema26)*2/27:bar.close;
 const dif=fast-slow,dea=state.count?state.dea+(dif-state.dea)*2/10:dif;
 return {schemaVersion:1,count:state.count+1,lastDate:bar.date,ema12:fast,ema26:slow,dea};
}
const stateValues=s=>({ema12:s.ema12,ema26:s.ema26,macdDif:s.ema12-s.ema26,macdDea:s.dea,macdHist:2*(s.ema12-s.ema26-s.dea)});
function indicatorPathDiagnostics(bars,{lengths=[26,60,120,250],absTolerance=.001,relativeTolerance=.0001,restartAt}={}){
 const warmup=indicatorWarmup(bars,{lengths,absTolerance,relativeTolerance});
 if(!barsToIndicators(bars).ready||!warmup.referenceLength)return report({status:'not-evaluated',reason:'缺少完整有效历史',warmup});
 const split=restartAt??Math.floor(bars.length/2);
 if(!Number.isInteger(split)||split<1||split>=bars.length)throw Error('指标重启位置无效');
 const close=bars.map(b=>b.close),fast=ema(close,12),slow=ema(close,26),dif=fast.map((v,i)=>v-slow[i]),dea=ema(dif,9);
 const full={ema12:fast.at(-1),ema26:slow.at(-1),macdDif:dif.at(-1),macdDea:dea.at(-1),macdHist:2*(dif.at(-1)-dea.at(-1))};
 let incremental=createIndicatorState();for(const bar of bars)incremental=updateIndicatorState(incremental,bar);
 let restarted=createIndicatorState();for(const bar of bars.slice(0,split))restarted=updateIndicatorState(restarted,bar);
 const checkpoint=JSON.stringify(restarted);restarted=restoreIndicatorState(checkpoint);
 for(const bar of bars.slice(split))restarted=updateIndicatorState(restarted,bar);
 const compare=(name,values)=>({name,differences:Object.keys(full).map(key=>{
  const delta=Math.abs(values[key]-full[key]),limit=absTolerance+relativeTolerance*Math.abs(full[key]);
  return {key,reference:full[key],value:values[key],delta,limit,status:delta<=limit?'pass':'fail'};
 })});
 const paths=[compare('constant-space-incremental',stateValues(incremental)),compare('serialized-checkpoint-restart',stateValues(restarted))];
 for(const p of paths)p.status=p.differences.every(x=>x.status==='pass')?'pass':'fail';
 const cold=[...new Set(lengths)].filter(n=>n<bars.length).sort((a,b)=>a-b).map(length=>{
  let state=createIndicatorState();for(const bar of bars.slice(-length))state=updateIndicatorState(state,bar);
  const check=compare('cold-start',stateValues(state));return {length,...check,status:check.differences.every(x=>x.status==='pass')?'pass':'fail'};
 });
 const first=cold.findIndex((x,i)=>x.status==='pass'&&cold.slice(i).every(y=>y.status==='pass'));
 return report({status:paths.every(p=>p.status==='pass')?'pass':'fail',referenceLength:bars.length,restartAt:split,
  absTolerance,relativeTolerance,paths,cold,warmup,minimumObservedHistory:first<0?null:cold[first].length,
  checkpoint:{schemaVersion:1,bytes:Buffer.byteLength(checkpoint),count:split},
  method:'native-full-batch vs independent incremental recurrence vs JSON checkpoint reload',
  limitations:['最少历史只在所给价格路径与容差下成立，不是所有标的通用承诺','冷启动不稳定单列，不用截断窗口替代完整历史','原批量指标四位小数输出与增量内部浮点误差分别披露']});
}

function availability(row){
 const values=[row?.knownAt,row?.availableAt,row?.receivedAt].filter(x=>x!==undefined);
 return values.length&&values.every(x=>Number.isSafeInteger(x)&&x>=0)?Math.max(...values):null;
}
function sanitizeKnown(value,at){
 if(Array.isArray(value))return value.map(v=>sanitizeKnown(v,at)).filter(v=>v!==undefined);
 if(!value||typeof value!=='object')return value;
 const known=availability(value);if(known!==null&&known>at||known===null&&['knownAt','availableAt','receivedAt'].some(k=>Object.hasOwn(value,k)))return undefined;
 const out={};for(const [key,v]of Object.entries(value)){
  // Outcomes are not features, even if a historical import embeds them on a bar.
  if(['labels','outcomes','futureReturn','targetReturn','label'].includes(key))continue;
  const visible=sanitizeKnown(v,at);if(visible!==undefined)out[key]=visible;
 }
 return out;
}
function nativePointInTime({history,snapshots={},pythonEvidence={},announcements=[]},cutoff){
 const {runNativeDaily}=require('./native-strategy-daily-runner');
 const {projectFourteenEvidence}=require('./native-fourteen-evidence');
 if(typeof cutoff!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(cutoff))throw Error('原生因果审计缺少有效截断日');
 const at=Date.parse(cutoff+'T23:59:59.999+08:00');
 const trimmed={...history,asOf:cutoff,stocks:history.stocks.map(stock=>({...stock,bars:stock.bars.filter(b=>b.date<=cutoff).map(b=>sanitizeKnown(b,Date.parse(b.date+'T23:59:59.999+08:00')))}))};
 if(history.settlements)trimmed.settlements=history.settlements.filter(e=>e.effectiveDate<=cutoff&&Date.parse(e.publishedAt)<=at);
 if(history.universeHistory)trimmed.universeHistory=history.universeHistory.filter(e=>e.from<=cutoff&&Date.parse(e.knownAt)<=at);
 const visibleSnapshots={},visiblePython={};
 for(const stock of trimmed.stocks)for(const bar of stock.bars){
  if(!bar)throw Error('历史价格首次取得时间晚于该交易日，缺少可用因果历史');
  const symbol=String(stock.symbol||stock.code),key=symbol+'/'+bar.date,close=Date.parse(bar.date+'T23:59:59.999+08:00');
  const extra=snapshots[key],python=pythonEvidence[key];
  if(extra&&availability(extra)!==null&&availability(extra)<=close){
   const projected=sanitizeKnown(extra,close);
   if(projected){
    // Validate the raw frozen child BEFORE recursive filtering. Removing a
    // late section must not make the remaining bundle look timely.
    delete projected.fourteenEvidence;
    if(projectFourteenEvidence(extra,{symbol,date:bar.date,cutoff:close,
       allowSynthetic:['fixture','simulated'].includes(history.source)}))
     projected.fourteenEvidence=structuredClone(extra.fourteenEvidence);
    visibleSnapshots[key]=projected;
   }
  }
  if(python&&availability(python)!==null&&availability(python)<=close)visiblePython[key]=sanitizeKnown(python,close);
  // Optional announcement-derived factors have separate publication AND receipt times.
  // Late reports never overwrite the context visible at that historical close.
  const docs=announcements.filter(d=>d.symbol===symbol&&d.observedThrough===bar.date&&Number.isSafeInteger(d.availableAt)&&Number.isSafeInteger(d.receivedAt)&&Math.max(d.availableAt,d.receivedAt)<=close).sort((a,b)=>Math.max(a.availableAt,a.receivedAt)-Math.max(b.availableAt,b.receivedAt));
  for(const doc of docs)if(doc.snapshot&&typeof doc.snapshot==='object'){
   const projected=sanitizeKnown(doc.snapshot,close);
   if(!projected)continue;
   // Announcement-derived features are not the original close/streak bundle.
   delete projected.fourteenEvidence;
   visibleSnapshots[key]={...(visibleSnapshots[key]||{}),...projected,symbol,observedThrough:bar.date};
  }
 }
 const output=runNativeDaily(trimmed,{snapshots:visibleSnapshots,pythonEvidence:visiblePython,generatedAt:new Date(at).toISOString()});
 const ranks=[];
 for(const date of [...new Set(output.details.map(d=>d.date))])for(const system of ['fourteen','bazi','gpt','python']){
  const ranked=output.details.filter(d=>d.date===date&&d.results[system].verdict!=='unknown').map(d=>({symbol:d.symbol,verdict:d.results[system].verdict,score:d.results[system].score??d.results[system].hits??null})).sort((a,b)=>Number(b.verdict==='pass')-Number(a.verdict==='pass')||(b.score??0)-(a.score??0)||a.symbol.localeCompare(b.symbol));
  ranks.push({date,system,ranked});
 }
 return {coverage:output.coverage,details:output.details,ranks,
  indicators:trimmed.stocks.map(s=>({symbol:String(s.symbol||s.code),indicators:barsToIndicators(s.bars)}))};
}
function nativeCausalDiagnostics({history,snapshots={},pythonEvidence={},announcements=[],labels=[],cutoff}={}){
 const {validateDataset}=require('./historical-validation');
 const ds=validateDataset(history);
 if(ds.stocks>20||ds.barsPerStock>600||ds.stocks*ds.barsPerStock>6000)throw Error('原生诊断超出交互历史限制');
 if(!Array.isArray(announcements)||announcements.length>10000||!Array.isArray(labels)||labels.length>10000)throw Error('公告或标签诊断输入无效');
 const dates=history.stocks[0].bars.map(b=>b.date),index=dates.indexOf(cutoff);
 if(index<31||index>=dates.length-1)return report({status:'not-evaluated',reason:'截断日需至少 32 根参考历史及其后至少一根未来行情',checks:[]});
 const input={history,snapshots,pythonEvidence,announcements,labels},after=Date.parse(cutoff+'T23:59:59.999+08:00')+1;
 let baseline;try{baseline=nativePointInTime(input,cutoff);}catch(e){return report({status:'not-evaluated',reason:e.message,checks:[]});}
 const variants=[
  {name:'truncate-future-bars-and-evidence',mutate:s=>({...s,history:{...s.history,asOf:cutoff,stocks:s.history.stocks.map(stock=>({...stock,bars:stock.bars.filter(b=>b.date<=cutoff)}))},
    snapshots:Object.fromEntries(Object.entries(s.snapshots).filter(([k])=>k.split('/')[1]<=cutoff)),pythonEvidence:Object.fromEntries(Object.entries(s.pythonEvidence).filter(([k])=>k.split('/')[1]<=cutoff))})},
  {name:'perturb-future-OHLCV',mutate:s=>({...s,history:{...s.history,stocks:s.history.stocks.map(stock=>({...stock,bars:stock.bars.map(b=>b.date<=cutoff?b:{...b,open:b.open*1.8,high:b.high*1.8,low:b.low*1.8,close:b.close*1.8,volume:b.volume*2})}))}})},
  {name:'perturb-future-labels',mutate:s=>({...s,labels:[...s.labels.map(l=>({...l,netReturnPct:99999})),{date:dates[index+1],availableAt:after,netReturnPct:99999}],
    history:{...s.history,stocks:s.history.stocks.map(stock=>({...stock,bars:stock.bars.map(b=>({...b,outcomes:{futureReturn:99999},label:99999}))}))}})},
  {name:'late-announcement-and-receipt',mutate:s=>({...s,announcements:[...s.announcements.map(d=>Math.max(d.availableAt||0,d.receivedAt||0)>after?{...d,snapshot:{...d.snapshot,floatCap:1e15,profitRatio:100}}:d),
    {symbol:String(s.history.stocks[0].symbol||s.history.stocks[0].code),observedThrough:cutoff,availableAt:Date.parse(cutoff+'T14:00:00+08:00'),receivedAt:after,snapshot:{name:'ST late',floatCap:1e15,profitRatio:100,gptSnapshot:Object.fromEntries(Object.keys(s.snapshots[String(s.history.stocks[0].symbol||s.history.stocks[0].code)+'/'+cutoff]?.gptSnapshot||{}).map(k=>[k,99999]))}}]})}
 ];
 const audited=auditPointInTime({input,cutoff,variants,evaluate:nativePointInTime});
 const systems=Object.entries(baseline.coverage).map(([system,coverage])=>({system,...coverage,status:coverage.evaluated?audited.status:'not-evaluated',reason:coverage.evaluated?null:'缺少当时可知的原生策略/三轮 Python 证据'}));
 return report({...audited,status:audited.status==='fail'?'fail':systems.every(s=>s.status==='pass')?'pass':'not-evaluated',systems,
  cutoffAt:after-1,decisionTimePolicy:'closed-session-day-end-before-next-open',
  testedOutputs:['native-four-strategy-verdicts','native-model-scores','same-date-cross-stock-rank','native-batch-indicators'],
  evaluator:'native-strategy-daily-runner.runNativeDaily + point-in-time availability projection',
  limitations:['Python 路径校验已导入三轮原生执行证据，不在 Node 中冒充执行 Python 模型','缺少时间戳的辅助快照不补成可知信息；各策略覆盖不足单列不可评估','扰动不改变原数据、生产参数或权威成交记录']});
}
module.exports={auditPointInTime,indicatorWarmup,createIndicatorState,restoreIndicatorState,updateIndicatorState,indicatorPathDiagnostics,nativePointInTime,nativeCausalDiagnostics};
