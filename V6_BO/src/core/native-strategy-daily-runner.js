'use strict';
/** Date-bounded native evaluation. Optional fundamentals/auction/sector snapshots must be
 * supplied for the SAME session. No future observations, synthetic funding or Python scores. */
const {validateDataset}=require('./historical-validation');
const fourteen=require('../../myrules');
const bazi=require('../../bazi');
const {evaluateMultiStrategy}=require('./multi-strategy-engine');
const pack=require('../../strategies/a-share-strategy-pack.json');
const {replayStrategyEvidence}=require('./strategy-evidence-replay');
const crypto=require('node:crypto');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
const {projectFourteenEvidence}=require('./native-fourteen-evidence');
const fingerprint=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const own=(x,k)=>x!=null&&Object.prototype.hasOwnProperty.call(x,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const score=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100;
const completeScores=(row,keys)=>object(row)&&keys.every(k=>own(row,k)&&score(row[k]));
const GPT_FIELDS=[...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))];
const MARKET_FIELDS=['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
function explicitTime(value){
 if(Number.isSafeInteger(value)&&value>0&&value<=8e15)return value;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!validDate(value.slice(0,10)))return null;
 const at=Date.parse(value);return Number.isSafeInteger(at)&&at>0?at:null;
}
// The daily evaluator is a research consumer, not a source of quote authority.
// Legacy undated inputs remain compatible, but explicit late/conflicting data
// must never enter any of the four native evaluators as same-session evidence.
const commonTimes=['knownAt','firstKnownAt','availableAt','receivedAt','recordedAt',
 'observedAt','retrievedAt','sourceTimestamp','quoteAt','publishedAt','generatedAt'];
const nullableSourceTimes=new Set(['sourceTimestamp','quoteAt','fundsSourceTimestamp']);
function availableWithinSession(row,date,{funds=false}={}){
 if(!row)return true;
 const cutoff=Date.parse(date+'T23:59:59.999+08:00'),times={};
 for(const key of [...commonTimes,...(funds?['fundsSourceTimestamp','fundsRetrievedAt']:[])]){
  if(!own(row,key))continue;
  if(row[key]===null&&nullableSourceTimes.has(key))continue;
  const at=explicitTime(row[key]);if(at===null||at>cutoff)return false;
  times[key]=at;
 }
 for(const [before,after] of [['quoteAt','receivedAt'],['sourceTimestamp','retrievedAt'],
  ['sourceTimestamp','receivedAt'],['fundsSourceTimestamp','fundsRetrievedAt'],
  ['knownAt','availableAt'],['firstKnownAt','availableAt'],['firstKnownAt','recordedAt'],
  ['receivedAt','recordedAt'],['observedAt','availableAt']]){
  if(own(times,before)&&own(times,after)&&times[before]>times[after])return false;
 }
 return true;
}
function legacyReceiptTimesVisible(row,date){
 if(!row)return true;
 const cutoff=Date.parse(date+'T23:59:59.999+08:00');
 return ['knownAt','availableAt','receivedAt','recordedAt','observedAt','sourceTimestamp'].every(key=>{
  if(!own(row,key))return true;
  const at=explicitTime(row[key]);return at!==null&&at<=cutoff;
 });
}
// Nested evidence must not bypass the enclosing same-session receipt. Missing
// optional legacy metadata is not fabricated; explicit metadata must agree.
function nestedSessionEvidence(row,symbol,date,parent){
 if(!object(row)||!legacyReceiptTimesVisible(row,date)||!availableWithinSession(row,date))return false;
 for(const k of ['symbol','code'])if(own(row,k)&&row[k]!==symbol)return false;
 for(const k of ['date','tradeDate','observedThrough'])if(own(row,k)&&row[k]!==date)return false;
 const keys=['knownAt','availableAt','receivedAt','recordedAt','observedAt','sourceTimestamp'];
 const outer=keys.filter(k=>own(parent,k)).map(k=>explicitTime(parent[k]));
 const inner=keys.filter(k=>own(row,k)).map(k=>explicitTime(row[k]));
 if(outer.some(at=>at===null)||inner.some(at=>at===null))return false;
 return !outer.length||!inner.length||Math.max(...inner)<=Math.max(...outer);
}
const normalizeDate=value=>typeof value==='string'&&/^\d{8}$/.test(value)?
 value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6):value;
function contradictory(row,allowSynthetic){
 return ['conflict','sourceConflict','quoteSourceConflict','fundsConflict','fundsSourceConflict','retracted','superseded'].some(k=>row[k]===true)||
  ['conflict','retracted'].includes(row.evidenceStatus)||
  !allowSynthetic&&(['simulated','synthetic','fixture','mock','testSample','isTest','fundsSynthetic'].some(k=>row[k]===true)||
   ['test','demo','fixture'].includes(row.sampleSet));
}
// Only explicit metadata is inspected; this is not vendor certification.
// Sector/market sections may legitimately contain other securities, while a
// stock-specific factor, fund or Python round may not borrow another symbol.
function visibleInput(value,{symbol,date,allowSynthetic,funds=false}){
 let visited=0;
 function inspect(v,depth=0){
  if(v==null||typeof v!=='object')return true;
  if(++visited>20000||depth>12)return false;
  if(Array.isArray(v))return v.every(x=>inspect(x,depth+1));
  if(!availableWithinSession(v,date,{funds})||contradictory(v,allowSynthetic))return false;
  if(symbol!==undefined&&['symbol','code'].some(k=>v[k]!=null&&v[k]!==symbol))return false;
  for(const k of ['date','tradeDate','observedThrough',...(funds?['fundsTradeDate']:[])]){
   if(v[k]==null)continue;
   const d=normalizeDate(v[k]);if(!validDate(d)||d>date)return false;
  }
  return Object.values(v).every(x=>inspect(x,depth+1));
 }
 return inspect(value);
}
function fundHistoryVisible(rows,date,symbol,allowSynthetic){
 if(!Array.isArray(rows)||!visibleInput(rows,{date,symbol,allowSynthetic,funds:true}))return false;
 let previous=null;
 // Keep undated legacy summaries compatible; a declared row date is not a
 // receipt timestamp and cannot override a later retrieval or known time.
 for(const row of rows){
  if(!object(row)||!legacyReceiptTimesVisible(row,date))return false;
  const declared=[row.date,row.tradeDate,row.fundsTradeDate].filter(x=>x!==undefined&&x!==null).map(normalizeDate);
  if(declared.some(d=>!validDate(d)||d>date||d!==declared[0]))return false;
  if(declared.length){if(previous!==null&&declared[0]<=previous)return false;previous=declared[0];}
 }
 return true;
}
function baziContext(context,date,symbol,allowSynthetic,gaps){
 const allowed=['name','sectorInfo','fundDays','mainInflow','thsNetAmt','fundsSourceTimestamp'];
 const out=Object.fromEntries(allowed.filter(k=>own(context,k)).map(k=>[k,context[k]]));
 if(own(out,'sectorInfo')&&!visibleInput(out.sectorInfo,{date,allowSynthetic})){
  delete out.sectorInfo;gaps.push('sectorInfo');
 }
 if(own(out,'fundDays')&&!fundHistoryVisible(out.fundDays,date,symbol,allowSynthetic)){
  delete out.fundDays;gaps.push('fundDays');
 }
 const metadata=Object.fromEntries(['fundsSourceTimestamp','fundsRetrievedAt','fundsTradeDate','fundsConflict','fundsSourceConflict','fundsSynthetic'].filter(k=>own(context,k)).map(k=>[k,context[k]]));
 if(own(metadata,'fundsSourceTimestamp')&&explicitTime(metadata.fundsSourceTimestamp)===null||
    !visibleInput(metadata,{date,symbol,allowSynthetic,funds:true})){
  for(const k of ['mainInflow','thsNetAmt','fundDays','fundsSourceTimestamp'])delete out[k];
  gaps.push('fundReceipt');
 }
 return out;
}
function fourteenContext(context,date,symbol,allowSynthetic,gaps){
 const out={...context};
 for(const k of ['sector','auction','profitRatio','fourteenEvidence','floatCap']){
  if(own(out,k)&&!visibleInput(out[k],{date,allowSynthetic,...(['auction','profitRatio','fourteenEvidence','floatCap'].includes(k)?{symbol}:{})})){
   delete out[k];gaps.push(k);
  }
 }
 return out;
}

function runNativeDaily(history,{snapshots={},pythonEvidence={},splitDay,generatedAt='1970-01-01T00:00:00Z'}={}){
 const ds=validateDataset(history);
 const dates=history.stocks[0].bars.map(x=>x.date);
 // Reject unused, unknown and future evidence instead of silently hashing it into the run.
 const allowed=new Set(history.stocks.flatMap(stock=>{
  const symbol=String(stock.symbol||stock.code);
  return dates.map(date=>`${symbol}/${date}`);
 }));
 for(const [kind,collection] of [['快照',snapshots],['Python证据',pythonEvidence]]){
  if(!collection||typeof collection!=='object'||Array.isArray(collection))throw Error(kind+'必须是按股票/日期索引的对象');
  for(const key of Object.keys(collection))if(!allowed.has(key))throw Error(kind+'包含未知股票、非交易日或未来日期: '+key);
 }
 if(dates.some(x=>!x))throw Error('原生逐日回放要求完整交易日期');
 const signals=[],coverage={fourteen:{evaluated:0,unknown:0},bazi:{evaluated:0,unknown:0},gpt:{evaluated:0,unknown:0},python:{evaluated:0,unknown:0}};
 const details=[];
 const maxSignals=ds.stocks*ds.barsPerStock*4;
 for(const stock of history.stocks){
  const symbol=String(stock.symbol||stock.code);
  for(let i=0;i<dates.length;i++){
   const date=dates[i],bars=stock.bars.slice(0,i+1),last=bars.at(-1);
   const key=`${symbol}/${date}`;
   const extra=snapshots[key];
   if(extra!==undefined && (!extra||typeof extra!=='object'||Array.isArray(extra)||extra.observedThrough!==date||extra.symbol!==symbol))throw Error('快照来源或观察日期无效: '+key);
   // Never infer free-float, order flow, auction, sector or fundamentals from OHLCV.
   if(extra&&['rows','bars','price','code','ctx','stock'].some(k=>own(extra,k)))
    throw Error('快照不得覆盖原生证券身份、历史K线或收盘价: '+key);
   const allowSynthetic=['fixture','simulated'].includes(history.source);
   const context=legacyReceiptTimesVisible(extra,date)&&availableWithinSession(extra,date)&&(!extra||!contradictory(
    Object.fromEntries(Object.entries(extra).filter(([k])=>!k.startsWith('funds'))),allowSynthetic))?extra||{}:{};
   const inputGaps={fourteen:[],bazi:[],gpt:[],python:[]};
   if(extra&&context!==extra)for(const system of ['fourteen','bazi','gpt'])inputGaps[system].push('snapshot');
   const fourContext=fourteenContext(context,date,symbol,allowSynthetic,inputGaps.fourteen);
   const rows=bars.map((b,j)=>({...b,pct:j?100*(b.close/bars[j-1].close-1):0}));
   const four=projectFourteenEvidence(fourContext,{symbol,date,cutoff:Date.parse(date+'T23:59:59.999+08:00'),allowSynthetic});
   if(own(fourContext,'fourteenEvidence')&&!four)inputGaps.fourteen.push('fourteenEvidence');
   const stockInfo={code:symbol,name:context.name||symbol,price:last.close,...(fourContext.floatCap===undefined?{}:{floatCap:fourContext.floatCap}),...(four?.stock||{})};
   const results={};
   try{
    const r=fourteen.evaluateOne({stock:stockInfo,rows,sector:fourContext.sector,auction:fourContext.auction,profitRatio:fourContext.profitRatio,...(four?.sections||{})},undefined);
    const excludedKnown=r.items.some(x=>x.i===11&&!x.unknown);
    const sufficientlyObserved=excludedKnown&&r.known>=6;
    const verdict=r.excluded.length?'fail':sufficientlyObserved?r.verdict:'unknown';
    results.fourteen={verdict,hits:r.hits,known:r.known,unknown:r.unknown,excluded:r.excluded,
     exclusionPending:r.exclusionPending,evaluatorVersion:r.evaluatorVersion,
     snapshotEvidence:four?{status:'declared-same-session',source:four.source,knownAt:four.knownAt}:null};
   }catch(err){results.fourteen={verdict:'unknown',reason:'原生评估异常: '+err.message};}
   try{
    const r=bazi.evaluate({...baziContext(context,date,symbol,allowSynthetic,inputGaps.bazi),code:symbol,rows,price:last.close});
    const insufficient=r.insufficient||[],criticalMissing=r.coverage?.criticalMissing||[];
    // '观察' is neither a completed entry condition nor a confirmed rejection.
    // Keep the native score for diagnosis, but do not admit partial evidence.
    const verdict=insufficient.length||criticalMissing.length||r.verdict==='观察'?'unknown':
     r.verdict==='可介入'?'pass':r.verdict==='回避'?'fail':'unknown';
    results.bazi={verdict,score:r.total,insufficient,criticalMissing,nativeVerdict:r.verdict,
     evidenceComplete:insufficient.length===0&&criticalMissing.length===0};
   }catch(err){results.bazi={verdict:'unknown',reason:'原生评估异常: '+err.message};}
   // GPT rules require separately observed factor inputs. OHLCV alone cannot supply
   // flow/quality/market-state features. Never substitute zeros or neutral scores.
   if(context.gptSnapshot && context.gptSnapshotObservedThrough===date){
    const factorVisible=visibleInput(context.gptSnapshot,{date,symbol,allowSynthetic})&&nestedSessionEvidence(context.gptSnapshot,symbol,date,context);
    const marketVisible=visibleInput(context.market,{date,allowSynthetic})&&nestedSessionEvidence(context.market,symbol,date,context);
    if(!factorVisible)inputGaps.gpt.push('gptSnapshot');
    if(!marketVisible)inputGaps.gpt.push('market');
    if(factorVisible&&marketVisible&&completeScores(context.gptSnapshot,GPT_FIELDS)&&completeScores(context.market,MARKET_FIELDS)&&
       (!own(context,'marketObservedThrough')||context.marketObservedThrough===date)){
     const snapshot=Object.fromEntries(GPT_FIELDS.map(k=>[k,context.gptSnapshot[k]]));
     const market=Object.fromEntries(MARKET_FIELDS.map(k=>[k,context.market[k]]));
     try{const r=evaluateMultiStrategy({snapshot,market,strategies:pack.strategies});
      results.gpt={verdict:r.pass?'pass':'fail',score:r.finalScore,regime:r.regime?.regime||null};
     }catch(err){results.gpt={verdict:'unknown',reason:'GPT评估异常: '+err.message};}
    }else results.gpt={verdict:'unknown',reason:'缺少完整有效的同日GPT因子或六项市场环境快照'};
   }else results.gpt={verdict:'unknown',reason:'没有同日GPT因子快照'};
   // Python has a separate runtime and three-round provenance requirement; do not fake it.
   const py=pythonEvidence[key];
   const evaluatedPython=evaluatePythonEvidence(py,{symbol,date});
   const pythonVisible=visibleInput(py,{date,symbol,allowSynthetic})&&legacyReceiptTimesVisible(py,date)&&
    (!py||Array.isArray(py.rounds)&&py.rounds.every(r=>nestedSessionEvidence(r,symbol,date,py)));
   if(!pythonVisible)inputGaps.python.push('pythonEvidence');
   results.python=pythonVisible?evaluatedPython:
    {verdict:'unknown',reason:'Python回执或三轮原始证据的时点、身份或来源无效'};
   // A known negative result may still be retained; an invalid optional input
   // cannot help a strategy turn into a positive signal. Keep native scores
   // for diagnostics without presenting the rejected evidence as admitted.
   for(const [system,gaps] of Object.entries(inputGaps))if(gaps.length){
    const r=results[system];
    results[system]={...r,verdict:r.verdict==='pass'?'unknown':r.verdict,
     rejectedDataInputs:gaps,sourceEvidenceVerified:false};
   }
   for(const [system,r] of Object.entries(results)){
    coverage[system][r.verdict==='unknown'?'unknown':'evaluated']++;
    signals.push({system,symbol,date,observedThrough:date,verdict:r.verdict,
     provenance:system==='python'&&r.provenance?r.provenance:`native-daily/${system}/${fingerprint({key,system,rows,context}).slice(0,20)}`,
     evaluatorVersion:system==='fourteen'?'v6-fourteen-native-2':system==='python'&&r.evaluatorVersion?r.evaluatorVersion:
      ['bazi','gpt','python'].includes(system)?'v6-native-daily-2':'v6-native-daily-1'});
   }
   details.push({symbol,date,results});
  }
 }
 if(signals.length>maxSignals)throw Error('策略证据数量超限');
 const bundle={source:'native-date-bounded-replay',generatedAt,signals};
 const replay=replayStrategyEvidence(history,bundle,{splitDay});
 return {schemaVersion:1,mode:'native-daily-research',canTrade:false,verifiedLive:false,
  dataFingerprint:fingerprint(history),snapshotsFingerprint:fingerprint(snapshots),pythonEvidenceFingerprint:fingerprint(pythonEvidence),coverage,signals,details,
  replay,limitations:['缺失资金、板块、竞价或GPT因子不伪造','Python三轮需独立原生执行并提交可审计证据，导入器不执行Python代码','纸面回测不是可成交性或实盘收益证明']};
}
module.exports={runNativeDaily};
