'use strict';
// Bounded, opt-in orchestration of the existing ledger. No alternative scoring
// engine, inferred fills, promotion, or ranking by a favorable cost scenario.
const {createHash}=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const roleOrder={train:0,validation:1,test:2};
function orderedWindowRoles(windows){
 return Array.isArray(windows)&&windows.length>=3&&Array.from(windows).every((w,i)=>w&&Object.hasOwn(roleOrder,w.role)&&(!i||roleOrder[w.role]>=roleOrder[windows[i-1].role]))&&Object.keys(roleOrder).every(role=>windows.some(w=>w.role===role));
}
function summarizeLedger(r,{start,end,initialCash,strategyId,universeSize}){
 if(!r||r.researchOnly!==true||r.canTrade!==false||r.executionModel!=='position-ledger'||r.research36?.strategyId!==strategyId||r.metrics?.initialCash!==initialCash||!Array.isArray(r.equity)||r.equity.length!==end-start+1||!Array.from(r.equity).every((e,i)=>e&&e.day===start+i&&[e.cash,e.value].every(finite)&&int(e.openPositions)&&Array.isArray(e.unpriced)&&!e.unpriced.length)||!Array.isArray(r.orders)||!Array.isArray(r.trades)||!Array.isArray(r.openPositions)||!Array.isArray(r.research36.signals))throw Error('original ledger or signal coverage unavailable');
 const last=r.equity.at(-1);if(last.openPositions!==r.openPositions.length||!finite(r.metrics.returnPct)||!finite(r.metrics.maxDrawdownPct)||Math.abs(r.metrics.returnPct-100*(last.value/initialCash-1))>.011)throw Error('original ledger return or final position mismatch');
 const coverage={attempted:r.research36.signals.length,matched:0,notMatched:0,unknown:0,disabled:0,notEvaluated:null};
 const seen=new Set();
 for(const s of r.research36.signals){const k=JSON.stringify([s?.code,s?.day]);if(!s||!int(s.day)||s.day<start||s.day>=end||typeof s.code!=='string'||!s.code||seen.has(k))throw Error('duplicate or invalid original signal');seen.add(k);
  const statuses={research_candidate:'matched',not_matched:'notMatched',insufficient_data:'unknown',disabled:'disabled'},field=Object.hasOwn(statuses,s.status)?statuses[s.status]:null;if(!field)throw Error('unknown original signal status');coverage[field]++;
 }
 const possible=universeSize*(end-start);if(coverage.attempted>possible)throw Error('original signal denominator mismatch');coverage.notEvaluated=possible-coverage.attempted;
 const buys=r.orders.filter(o=>o.side==='buy'&&o.status==='filled'),blockedBuys=r.orders.filter(o=>o.side==='buy'&&o.symbol&&['blocked','risk-paused'].includes(o.status)),blockedSells=r.orders.filter(o=>o.side==='sell'&&o.status==='blocked');
 const losses=[],returns=[];let unresolvedTrades=0;
 for(const t of r.trades){if(!int(t?.buyDay)||!int(t?.sellDay)||t.sellDay<=t.buyDay||!finite(t.netPnl)||!finite(t.costBasis)||t.costBasis<=0||!finite(100*t.netPnl/t.costBasis)){unresolvedTrades++;continue;}
  const ret=100*t.netPnl/t.costBasis;returns.push(ret);if(ret<0)losses.push({symbol:t.symbol,buyDay:t.buyDay,sellDay:t.sellDay,netPnl:t.netPnl,netReturnPct:ret});
 }
 const sorted=[...returns].sort((a,b)=>a-b),tailCount=Math.ceil(sorted.length*.1);
 return {coverage,buyFills:buys.length,blockedBuys:blockedBuys.length,blockedSells:blockedSells.length,openPositions:r.openPositions.length,cashSessions:r.equity.filter(e=>e.openPositions===0&&Math.abs(e.cash-e.value)<.011).length,
  markedReturnPct:buys.length?r.metrics.returnPct:null,settledReturnPct:buys.length&&r.trades.length&&!r.openPositions.length&&!unresolvedTrades?r.metrics.returnPct:null,drawdownPct:buys.length?r.metrics.maxDrawdownPct:null,
  realized:{count:returns.length,unresolvedTrades,negativeCount:losses.length,losses,worstPct:returns.length&&!unresolvedTrades?sorted[0]:null,tailMeanPct:tailCount&&!unresolvedTrades?sorted.slice(0,tailCount).reduce((n,v)=>n+v/tailCount,0):null,tailCount:unresolvedTrades?null:tailCount},
  status:!coverage.attempted?'not-evaluated':!coverage.matched?'no-matched-signal':!buys.length?'no-buy-fills':r.openPositions.length?'unsettled-paper-estimate':'paper-estimate',actualExecutionVerified:false};
}
function compareResearchFamilies(input,definitions,run){
 const {strategyIds,stocks,evidenceByDate,config={},options={}}=input||{};
 if(!plain(input)||Object.keys(input).some(k=>!['strategyIds','stocks','evidenceByDate','config','options'].includes(k))||!Array.isArray(strategyIds)||strategyIds.length<2||strategyIds.length>8||new Set(strategyIds).size!==strategyIds.length||!Array.isArray(definitions)||strategyIds.some(id=>!definitions.some(d=>d.id===id))||!Array.isArray(stocks)||!stocks.length||stocks.length>200||!plain(evidenceByDate)||!plain(config)||!plain(options)||typeof run!=='function')throw Error('bounded original strategy comparison input invalid');
 const o={initialCash:100000,topN:3,holdDays:1,feeBps:8,slippageBps:10,sellTaxBps:5,...options};
 if(!int(o.start)||o.start<27||!int(o.end)||o.end<=o.start||!int(o.topN)||o.topN<1||!int(o.holdDays)||o.holdDays<1||!finite(o.initialCash)||o.initialCash<=0||![o.feeBps,o.slippageBps,o.sellTaxBps].every(x=>finite(x)&&x>=0&&x<10000)||o.slippageBps+20>=10000||!Array.isArray(o.tradingDates)||o.tradingDates.length<=o.end||stocks.some(s=>!Array.isArray(s?.bars)||s.bars.length<=o.end))throw Error('explicit shared trading window, costs and calendar required');
 const workUnits=stocks.length*(o.end+1)*strategyIds.length*4;
 if(workUnits>400000)throw Error('comparison exceeds original ledger work budget');
 const scenarios=[{id:'original-cost',options:o},{id:'slippage-plus-20bps',options:{...o,slippageBps:o.slippageBps+20}}];
 const protocol={strategyIds:[...strategyIds],start:o.start,end:o.end,topN:o.topN,holdDays:o.holdDays,initialCash:o.initialCash,optionsFingerprint:hash(o),datasetFingerprint:hash({stocks,evidenceByDate}),configFingerprint:hash(config),scenarios:scenarios.map(s=>({id:s.id,feeBps:s.options.feeBps,slippageBps:s.options.slippageBps,sellTaxBps:s.options.sellTaxBps})),snapshotStage:'in-process-before-evaluation',comparison:'independent-original-ledgers; no identical-entry claim'};
 const rows=[],attempts=[],benchmarks={},base={mode:'original-research36-family-comparison-v1',protocol,protocolFingerprint:hash(protocol),workUnits,rows,attempts,benchmarks,cashBaseline:{returnPct:0,assumption:'no-interest cash only; not a realized account return'},preregistered:false,outOfSampleValidated:false,canTrade:false,canNotify:false,canApprove:false,productionWeightsChanged:false};
 let evidenceRows=0,configHash=null;
 for(const scenario of scenarios)for(const strategyId of strategyIds){
  try{
   const r=run({strategyId,stocks,evidenceByDate,config,options:scenario.options}),summary=summarizeLedger(r,{...o,strategyId,universeSize:stocks.length});
   const ch=r.research36.configHash;if(typeof ch!=='string'||!/^[a-f0-9]{64}$/.test(ch)||configHash!==null&&configHash!==ch)throw Error('original strategy configuration changed');configHash=ch;
   const {benchmark,...report}=r;if(!benchmark||benchmark.canTrade!==false||!Array.isArray(benchmark.equity)||benchmark.equity.length!==r.equity.length||benchmark.metrics?.initialCash!==o.initialCash)throw Error('original shared benchmark missing');
   const fingerprint=hash(benchmark);if(benchmarks[scenario.id]&&benchmarks[scenario.id].fingerprint!==fingerprint)throw Error('original benchmark differs across strategies');
   if(!benchmarks[scenario.id])benchmarks[scenario.id]={fingerprint,report:benchmark};
   evidenceRows+=r.equity.length+r.orders.length+r.trades.length+r.research36.signals.length;if(evidenceRows>100000)throw Error('comparison evidence exceeds bounded report budget');
   rows.push({strategyId,family:definitions.find(d=>d.id===strategyId).family,scenario:scenario.id,summary,report});attempts.push({strategyId,scenario:scenario.id,status:'completed'});
  }catch(e){attempts.push({strategyId,scenario:scenario.id,status:'failed',reason:String(e?.message||e).slice(0,200)});return {...base,status:'incomplete-original-ledger-comparison',comparisonAvailable:false};}
 }
 const fields=definitions.filter(d=>strategyIds.includes(d.id)).map(d=>({id:d.id,fields:[...new Set((d.rules||[]).map(r=>r.field))].sort()}));
 const sharedFields=[];for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++){const shared=fields[i].fields.filter(k=>fields[j].fields.includes(k));if(shared.length)sharedFields.push({a:fields[i].id,b:fields[j].id,fields:shared});}
 return {...base,status:'descriptive-only',comparisonAvailable:true,sharedFields,limitations:['same dates/capital/topN/holdDays and original costs; holdings and executed entries may differ','the +20bp scenario stresses slippage only; does not certify real execution','zero fills, missing signals and continued losses remain explicit; no automatic winner','shared fields are overlap clues, not proof of independent alpha']};
}
// Reuse the original RSV rule, not a newly tuned imitation. The adapter
// requires every consumed daily prefix row to be available at that close.
const NATIVE_REVERSAL='quality:rsv14_reversal_confirmation';
function nativeReversalSignal(stock,asOf){
 const code=String(stock?.symbol||stock?.code||''),bars=stock?.bars;
 const unknown={status:'insufficient_data',nativeEvidence:null};
 const validTime=t=>Number.isSafeInteger(t)&&t>0&&t<4102444800000;
 if(!/^\d{6}$/.test(code)||!validTime(asOf)||!Array.isArray(bars)||bars.length<45||bars.length>3000)return unknown;
 const day=new Date(asOf+28800000).toISOString().slice(0,10),last=bars.at(-1);
 if(last?.date!==day||!Array.from(bars).every((b,i)=>{if(!b||typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date||i&&b.date<=bars[i-1].date)return false;
  const close=Date.parse(b.date+'T15:00:00+08:00');return b.final===true&&b.priceBasis==='unadjusted'&&typeof b.source==='string'&&b.source.trim()&&b.source===last.source&&[b.observedAt,b.availableAt,b.recordedAt].every(validTime)&&close<=b.observedAt&&b.observedAt<=b.availableAt&&b.availableAt<=b.recordedAt&&b.recordedAt<=asOf&&(b.code==null||b.code===code)&&(b.symbol==null||b.symbol===code)&&!['simulated','synthetic','retracted','fixture','mock'].some(k=>b[k]===true);
 }))return unknown;
 const r=require('./quality-volume-reversal-research').evaluateQualityMomentumResearch({...stock,symbol:code});
 const row=r.strategies.find(s=>s.id==='rsv14_reversal_confirmation');if(!row||r.canTrade!==false)return unknown;
 const status=row.status==='candidate'?'research_candidate':row.status==='not_matched'||row.status==='risk_blocked'?'not_matched':'insufficient_data';
 return {status,nativeEvidence:{id:row.id,source:row.source,status:row.status,metrics:row.metrics,reasons:row.reasons,inputHash:hash(bars)}};
}
module.exports={orderedWindowRoles,summarizeLedger,compareResearchFamilies,nativeReversalSignal,NATIVE_REVERSAL};
