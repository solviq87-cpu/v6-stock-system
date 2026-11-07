'use strict';
// Keep the original evaluators and their independent replay alongside learned weights.
const crypto=require('node:crypto');
const {runNativeDaily}=require('./native-strategy-daily-runner');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SYSTEMS=['fourteen','bazi','gpt','python'];
function timestamp(s){
 const m=typeof s==='string'&&s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!m||!Number.isFinite(Date.parse(s))||new Date(m[1]).toISOString().slice(0,10)!==m[1]||+m[2]>23||+m[3]>59||+m[4]>59||(m[5]!=='Z'&&(+m[6]>23||+m[7]>59)))throw Error('原生证据需要带时区knownAt');
 return Date.parse(s);
}
function adaptNativeStrategies(input,stocks){
 const config=input.nativeEvidence;
 if(!config||typeof config!=='object'||Array.isArray(config)||config.schemaVersion!==1)throw Error('nativeEvidence需要schemaVersion 1');
 if(Object.keys(config).some(k=>!['schemaVersion','snapshots','pythonEvidence','splitDay'].includes(k)))throw Error('未知原生适配参数');
 const at=timestamp(input.decisionAt),allowed=new Map(),omitted=[];
 // Freeze one daily cutoff. Using the last run's wall-clock time would admit
 // an evening correction when that same date later becomes historical.
 const dailyDecisionTime='16:00:00+08:00';
 if(at<Date.parse(input.asOf+'T'+dailyDecisionTime))throw Error('原生自动适配要求目标日16:00上海时间之后运行');
 for(const stock of stocks)for(const bar of stock.bars){
  const key=String(stock.symbol||stock.code)+'/'+bar.date;
  const cut=Math.min(at,Date.parse(bar.date+'T'+dailyDecisionTime));
  if(timestamp(bar.knownAt)>cut)throw Error('原生日线在当日决策之后才获知: '+key);
  if(bar.originalRuleSignals!==undefined||bar.originalRuleEvidence!==undefined)throw Error('自动适配禁止混用手工原体系信号: '+key);
  allowed.set(key,{stock,bar,cut});
 }
 const filter=(collection,kind)=>{
  if(collection===undefined)return {};
  if(!collection||typeof collection!=='object'||Array.isArray(collection))throw Error(kind+'必须为股票/日期对象');
  const out={};
  for(const [key,e] of Object.entries(collection)){
   const row=allowed.get(key);if(!row)throw Error(kind+'包含未知股票或未来日期: '+key);
   if(!e||typeof e!=='object'||Array.isArray(e)||e.symbol!==String(row.stock.symbol||row.stock.code)||e.observedThrough!==row.bar.date)throw Error(kind+'股票或观察日期不一致');
   const known=timestamp(e.knownAt);
   if(known<Date.parse(row.bar.date+'T15:00:00+08:00'))throw Error(kind+'不能早于当日收盘');
   if(kind==='快照'){
    if(typeof e.provider!=='string'||!e.provider.trim()||typeof e.version!=='string'||!e.version.trim())throw Error('快照缺来源或版本');
    // The native evaluator spreads context into its arguments. Restrict it so a
    // snapshot cannot replace date-bounded bars, symbol or computed prices.
    const fields=['symbol','observedThrough','knownAt','provider','version','name','floatCap','sector','auction','profitRatio','gptSnapshot','gptSnapshotObservedThrough','market'];
    if(Object.keys(e).some(k=>!fields.includes(k)))throw Error('快照包含不支持的字段');
   }else evaluatePythonEvidence(e,{symbol:e.symbol,date:row.bar.date});
   if(known>row.cut){omitted.push({key,kind,reason:'NOT_KNOWN_AT_DAILY_DECISION'});continue;}
   out[key]=e;
  }
  return out;
 };
 const snapshots=filter(config.snapshots,'快照'),pythonEvidence=filter(config.pythonEvidence,'Python证据');
 const history={source:input.source,provider:input.provider,asOf:input.asOf,stocks};
 const native=runNativeDaily(history,{snapshots,pythonEvidence,splitDay:config.splitDay,generatedAt:input.decisionAt});
 const byKey=new Map();
 for(const s of native.signals){const key=s.symbol+'/'+s.date;if(!byKey.has(key))byKey.set(key,{});byKey.get(key)[s.system]=s;}
 const adapted=stocks.map(s=>({...s,bars:s.bars.map(b=>{
  const evidence=byKey.get(String(s.symbol||s.code)+'/'+b.date);
  return {...b,originalRuleSignals:Object.fromEntries(SYSTEMS.map(id=>[id,evidence[id].verdict==='pass'])),originalRuleEvidence:evidence};
 })}));
 return {stocks:adapted,audit:{schemaVersion:1,mode:'native-to-adaptive-research',canTrade:false,verifiedLive:false,
  dailyDecisionTime,inputEvidenceFingerprint:hash(config),adaptedStocksFingerprint:hash(adapted),coverage:native.coverage,omitted,
  signals:native.signals,details:native.details,replay:native.replay,
  limitations:['输入来源为用户声明，指纹不等于供应商认证','未知与失败均不触发信号，但逐日证据分别保留','原生独立回放与融合账本的选股、资金和成本口径不同，收益不可直接等同']}};
}
module.exports={adaptNativeStrategies};
