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
   const context=extra||{};
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
    const r=bazi.evaluate({code:symbol,rows,price:last.close,...context});
    results.bazi={verdict:r.insufficient?.length?'unknown':r.verdict==='可介入'?'pass':'fail',score:r.total,insufficient:r.insufficient||[],nativeVerdict:r.verdict};
   }catch(err){results.bazi={verdict:'unknown',reason:'原生评估异常: '+err.message};}
   // GPT rules require separately observed factor inputs. OHLCV alone cannot supply
   // flow/quality/market-state features. Never substitute zeros or neutral scores.
   if(context.gptSnapshot && context.gptSnapshotObservedThrough===date){
    const fields=[...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))];
    if(fields.every(f=>typeof context.gptSnapshot[f]==='number'&&Number.isFinite(context.gptSnapshot[f]))){
     try{const r=evaluateMultiStrategy({snapshot:context.gptSnapshot,market:context.market||{},strategies:pack.strategies});
      results.gpt={verdict:r.pass?'pass':'fail',score:r.finalScore,regime:r.regime?.regime||null};
     }catch(err){results.gpt={verdict:'unknown',reason:'GPT评估异常: '+err.message};}
    }else results.gpt={verdict:'unknown',reason:'缺少完整的同日GPT因子快照'};
   }else results.gpt={verdict:'unknown',reason:'没有同日GPT因子快照'};
   // Python has a separate runtime and three-round provenance requirement; do not fake it.
   results.python=evaluatePythonEvidence(pythonEvidence[key],{symbol,date});
   for(const [system,r] of Object.entries(results)){
    coverage[system][r.verdict==='unknown'?'unknown':'evaluated']++;
    signals.push({system,symbol,date,observedThrough:date,verdict:r.verdict,
     provenance:system==='python'&&r.provenance?r.provenance:`native-daily/${system}/${fingerprint({key,system,rows,context}).slice(0,20)}`,
     evaluatorVersion:system==='python'&&r.evaluatorVersion?r.evaluatorVersion:'v6-native-daily-1'});
   }
   details.push({symbol,date,results});
  }
 }
 if(signals.length>maxSignals)throw Error('策略证据数量超限');
 const bundle={source:'native-date-bounded-replay',generatedAt,signals};
 const replay=replayStrategyEvidence(history,bundle,{splitDay});
 return {schemaVersion:1,mode:'native-daily-research',canTrade:false,verifiedLive:false,
  dataFingerprint:fingerprint(history),snapshotsFingerprint:fingerprint(snapshots),pythonEvidenceFingerprint:fingerprint(pythonEvidence),coverage,details,
  replay,limitations:['缺失资金、板块、竞价或GPT因子不伪造','Python三轮需独立原生执行并提交可审计证据，导入器不执行Python代码','纸面回测不是可成交性或实盘收益证明']};
}
module.exports={runNativeDaily};
