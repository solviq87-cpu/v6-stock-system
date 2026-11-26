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
function availableWithinSession(row,date){
 if(!row)return true;
 const cutoff=Date.parse(date+'T23:59:59.999+08:00');
 return ['knownAt','availableAt','receivedAt','recordedAt'].every(key=>{
  if(!own(row,key))return true;
  const at=explicitTime(row[key]);return at!==null&&at<=cutoff;
 });
}
function fundHistoryVisible(rows,date){
 if(!Array.isArray(rows))return false;
 let previous=null;
 // Keep undated legacy summaries compatible, but never let an explicit
 // future, misordered or late fund record pass as a same-session observation.
 for(const row of rows){
  if(!object(row)||!availableWithinSession(row,date))return false;
  const declared=[row.date,row.tradeDate].filter(x=>x!==undefined);
  if(declared.some(d=>!validDate(d)||d>date||d!==declared[0]))return false;
  if(declared.length){if(previous!==null&&declared[0]<=previous)return false;previous=declared[0];}
 }
 return true;
}
function baziContext(context,date){
 const allowed=['name','sectorInfo','fundDays','mainInflow','thsNetAmt','fundsSourceTimestamp'];
 const out=Object.fromEntries(allowed.filter(k=>own(context,k)).map(k=>[k,context[k]]));
 if(!fundHistoryVisible(out.fundDays,date))delete out.fundDays;
 if(own(out,'fundsSourceTimestamp')){
  const at=explicitTime(out.fundsSourceTimestamp),cutoff=Date.parse(date+'T23:59:59.999+08:00');
  if(at===null||at>cutoff){delete out.mainInflow;delete out.thsNetAmt;delete out.fundDays;delete out.fundsSourceTimestamp;}
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
   const context=availableWithinSession(extra,date)?extra||{}:{};
   const rows=bars.map((b,j)=>({...b,pct:j?100*(b.close/bars[j-1].close-1):0}));
   const stockInfo={code:symbol,name:context.name||symbol,price:last.close,...(context.floatCap===undefined?{}:{floatCap:context.floatCap})};
   const results={};
   try{
    const r=fourteen.evaluateOne({stock:stockInfo,rows,sector:context.sector,auction:context.auction,profitRatio:context.profitRatio},undefined);
    const excludedKnown=r.items.some(x=>x.i===11&&!x.unknown);
    const sufficientlyObserved=excludedKnown && r.known>=6;
    results.fourteen={verdict:sufficientlyObserved?(r.pass?'pass':'fail'):'unknown',hits:r.hits,known:r.known,unknown:r.unknown,excluded:r.excluded};
   }catch(err){results.fourteen={verdict:'unknown',reason:'原生评估异常: '+err.message};}
   try{
    const r=bazi.evaluate({...baziContext(context,date),code:symbol,rows,price:last.close});
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
    if(completeScores(context.gptSnapshot,GPT_FIELDS)&&completeScores(context.market,MARKET_FIELDS)&&
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
   results.python=availableWithinSession(py,date)?evaluatedPython:
    {verdict:'unknown',reason:'Python回执在该历史交易日结束后才可知或时间无效'};
   for(const [system,r] of Object.entries(results)){
    coverage[system][r.verdict==='unknown'?'unknown':'evaluated']++;
    signals.push({system,symbol,date,observedThrough:date,verdict:r.verdict,
     provenance:system==='python'&&r.provenance?r.provenance:`native-daily/${system}/${fingerprint({key,system,rows,context}).slice(0,20)}`,
     evaluatorVersion:system==='python'&&r.evaluatorVersion?r.evaluatorVersion:
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
