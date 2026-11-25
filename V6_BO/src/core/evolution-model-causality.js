'use strict';
// Research-only mutation audits over the original learning reducer and trusted
// Python bridge. No inferred strategy, upload execution, approval or persistence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const numeric=require('../../public/nova/shortline/numeric-factors');
const {executePythonNative}=require('./python-native-bridge');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
const {validateDataset}=require('./historical-validation');
const flags={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false,autoPromotion:false};
const report=fields=>({schemaVersion:1,...fields,...flags});
const unknown=(reason,fields={})=>report({status:'not-evaluated',reason,...fields});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fingerprint=value=>sha(JSON.stringify(value));
const instant=numeric.instant,clone=structuredClone;
const arr=x=>Array.isArray(x)?x:[];
const stamp=x=>Number.isSafeInteger(x)&&x>0&&x<8640000000000000-86400000;
const day=at=>new Date(at+28800000).toISOString().slice(0,10);

/** Only operator-owned environment supplies executable paths. The identity is
 * safe to persist/return; config is internal and MUST NOT enter HTTP output. */
function readTrustedPythonConfig(env=process.env){
 const supplied=env.V6_PYTHON_NATIVE_SCRIPT;
 if(!supplied)return {config:null,identity:{status:'not-configured',protocol:'operator-native-python-causality-v1'}};
 try{
  if(typeof supplied!=='string'||!path.isAbsolute(supplied)||supplied.includes('\0'))throw Error('path');
  const script=path.resolve(supplied),stat=fs.lstatSync(script);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8*1024*1024||fs.realpathSync(script)!==script)throw Error('script');
  const scriptSha256=sha(fs.readFileSync(script));
  if(env.V6_PYTHON_NATIVE_SHA256&&env.V6_PYTHON_NATIVE_SHA256!==scriptSha256)throw Error('version');
  const selected=env.V6_NATIVE_PYTHON||'python3';
  if(typeof selected!=='string'||!(path.isAbsolute(selected)||/^python(?:3(?:\.\d+)?)?$/.test(selected)))throw Error('interpreter');
  const candidates=path.isAbsolute(selected)?[selected]:(env.PATH||'').split(path.delimiter).filter(Boolean).map(root=>path.join(root,selected));
  const executable=candidates.find(file=>{try{return fs.statSync(file).isFile();}catch{return false;}});
  if(!executable)throw Error('interpreter');
  const python=fs.realpathSync(executable),runtime=fs.statSync(python);
  if(!runtime.isFile()||runtime.size>64*1024*1024)throw Error('interpreter');
  const interpreterFingerprint=sha(fs.readFileSync(python)),config={script,python,expectedScriptSha256:scriptSha256,timeoutMs:2000,totalTimeoutMs:12000,maxOutputBytes:65536};
  const identity={status:'configured',protocol:'operator-native-python-causality-v1',scriptSha256,interpreterFingerprint,
   configFingerprint:fingerprint({scriptSha256,interpreterFingerprint,timeoutMs:config.timeoutMs,totalTimeoutMs:config.totalTimeoutMs,maxOutputBytes:config.maxOutputBytes})};
  return {config,identity};
 }catch{return {config:null,identity:{status:'unavailable',protocol:'operator-native-python-causality-v1',reason:'原生Python脚本、固定版本或解释器不可核验'}};}
}

function visible(value,point){
 if(Array.isArray(value))return value.map(v=>visible(v,point)).filter(v=>v!==undefined);
 if(!value||typeof value!=='object')return value;
 const keys=['knownAt','availableAt','receivedAt','recordedAt','createdAt'].filter(k=>value[k]!==undefined);
 if(keys.some(k=>instant(value[k])===null||instant(value[k])>point))return undefined;
 const result={};
 for(const [key,item]of Object.entries(value)){
  if(['label','labels','outcome','outcomes','futureReturn','targetReturn'].includes(key))continue;
  const next=visible(item,point);if(next!==undefined)result[key]=next;
 }
 return result;
}
function pythonInput(history,cutoff){
 const stocks=history.stocks.map(stock=>({...stock,bars:stock.bars.filter(b=>b.date<=cutoff).map(b=>{
  const filtered=visible(b,Date.parse(b.date+'T23:59:59.999+08:00'));
  if(!filtered)throw Error('历史价格晚到，不能回填当时输入');
  return filtered;
 })}));
 // The bridge sends only symbol/date/source/full prefix bars, so unrelated
 // future metadata is intentionally not passed to external native code.
 return {source:history.source,provider:history.provider,datasetId:history.datasetId,priceBasis:history.priceBasis,asOf:cutoff,stocks};
}
function pythonCausalDiagnostics({history,cutoff,trustedPython,deadlineAt=Date.now()+12000}={}){
 const identity=trustedPython?.identity||{status:'not-configured',protocol:'operator-native-python-causality-v1'};
 if(!trustedPython?.config)return unknown(identity.reason||'未提供操作者认可的原始Python三轮脚本；只读回执不代表执行模型',{identity,executed:false,calls:0});
 if(!history)return unknown('缺少真实封存历史，未执行Python',{identity,executed:false,calls:0});
 let calls=0,attemptedRuns=0;
 try{
  validateDataset(history);
  if(history.stocks.length>2||history.stocks[0].bars.length>600)return unknown('原生Python交互审计最多2只股票、每只600根历史',{identity,executed:false,calls:0});
  if(!stamp(deadlineAt)||deadlineAt<=Date.now())return unknown('原生Python审计总预算已耗尽',{identity,executed:false,calls:0});
  const dates=history.stocks[0].bars.map(b=>b.date),index=dates.indexOf(cutoff);
  if(index<31||index>=dates.length-1)return unknown('Python截断日需32根完整历史及至少一个未来交易日',{identity,executed:false,calls:0});
  const config=trustedPython.config,stop=Math.min(deadlineAt,Date.now()+config.totalTimeoutMs);
  if(!/^[a-f0-9]{64}$/.test(identity.scriptSha256||'')||config.expectedScriptSha256!==identity.scriptSha256)throw Error('unverified-identity');
  const evaluate=input=>{
   const remaining=stop-Date.now();if(remaining<100)throw Error('budget-exhausted');
   if(sha(fs.readFileSync(config.python))!==identity.interpreterFingerprint)throw Error('interpreter-version-changed');
   const source=pythonInput(input,cutoff);attemptedRuns++;
   const result=executePythonNative(source,{...config,targetDates:[cutoff],totalTimeoutMs:Math.min(config.totalTimeoutMs,remaining)});
   calls+=result.execution.calls;
   const outputs=Object.entries(result.evidence).map(([key,value])=>{
    const [symbol,date]=key.split('/'),checked=evaluatePythonEvidence(value,{symbol,date});
    return {symbol,date,evaluatorVersion:checked.evaluatorVersion,verdict:checked.verdict,rounds:checked.rounds};
   }).sort((a,b)=>a.symbol.localeCompare(b.symbol));
   return {inputFingerprint:fingerprint(source),outputs};
  };
  const baseline=evaluate(history),after=Date.parse(cutoff+'T23:59:59.999+08:00')+1;
  const cases=[
   ['truncate-future-bars',input=>{input.asOf=cutoff;for(const stock of input.stocks)stock.bars=stock.bars.filter(b=>b.date<=cutoff);}],
   ['perturb-future-OHLCV',input=>{for(const stock of input.stocks)for(const b of stock.bars)if(b.date>cutoff){for(const k of ['open','high','low','close'])b[k]*=1.8;b.volume*=2;}}],
   ['perturb-future-labels',input=>{for(const stock of input.stocks)for(const b of stock.bars){b.labels={netReturnPct:99999};b.futureReturn=99999;}}],
   ['late-announcement-factor',input=>{for(const stock of input.stocks)stock.bars[index].lateAnnouncement={knownAt:after,availableAt:after,profitRatio:99999,signal:'pass'};}]
  ];
  const checks=[];
  for(const [name,mutate]of cases){const changed=clone(history);mutate(changed);const output=evaluate(changed);checks.push({name,status:isDeepStrictEqual(output,baseline)?'pass':'fail',executed:true});}
  const evaluated=baseline.outputs.filter(r=>r.verdict!=='unknown').length;
  return report({status:checks.some(c=>c.status==='fail')?'fail':evaluated?'pass':'not-evaluated',identity,executed:true,executionAttempted:true,calls,attemptedRuns,cutoff,
   reason:evaluated?null:'原生程序已执行，但所有三轮判断仍缺证据；不报告策略验证通过',checks,
   // Native reasons can contain local filenames or arbitrary external text.
   // Compare them in memory, but publish only verdicts and their fingerprint.
   systems:baseline.outputs.map(({symbol,date,evaluatorVersion,verdict,rounds})=>({symbol,date,evaluatorVersion,verdict,
    rounds:rounds.map(({round,verdict})=>({round,verdict}))})),
   baselineInputFingerprint:baseline.inputFingerprint,outputFingerprint:fingerprint(baseline.outputs),
   verifiedStrategyRules:false,inputPurpose:['fixture','simulated'].includes(history.source)?'synthetic-diagnostic-fixture':'stored-source-evidence',
   scope:'original-bridge-target-date-prefix-and-frozen-native-execution',
   limitations:['实际执行操作者脚本，不代表该脚本已获原三轮规则认证；缺源码时不猜测替代规则',
    '比较同一历史时点的三轮判断与依据；完整前缀保留预热，未改变生产权重或账户',
    '只审计经桥接传入的数据；操作者脚本自行读取外部文件或网络不在此因果保证范围内']});
 }catch(error){return unknown(/预算|budget|ETIMEDOUT/.test(error.message)?'Python实际调用超过有界执行预算':'Python实际调用或时点合同未完成；原脚本及档案保留',
  {identity,executed:calls>0,executionAttempted:attemptedRuns>0,calls,attemptedRuns,errorCode:/ETIMEDOUT/.test(error.message)?'TIMEOUT':'NATIVE_AUDIT_UNAVAILABLE'});}
}

// The cache and the audit share this original-model input projection. Deliberately
// omit the query clock: only crossing an actual eligibility/evidence boundary may
// change its identity. This is an input state, not a fitted model or a pass verdict.
async function numericDiagnosticInputState({archive={},cutoffAt=Date.now()}={}){
 if(!stamp(cutoffAt))throw Error('数值模型输入时点无效');
 const schema='original-numeric-effective-input-v1';
 const unavailable=reason=>({schema,status:'not-evaluated',reason,rows:[],scoringVectors:[]});
 if(!numeric.realEvidence(archive)||['demo','test','synthetic'].includes(archive.scope))return unavailable('教学档案不用于真实模型诊断');
 if(['trades','checks','plans'].some(k=>arr(archive[k]).length>2000)||arr(archive.bars).length>10000||Buffer.byteLength(JSON.stringify(archive))>24*1024*1024)
  return unavailable('数值模型交互审计超过2000条成交/检查/计划或24MiB档案边界');
 const {readLearningRows}=await import('../../public/nova/shortline/learning.mjs');
 const {dictionaryVersion}=await import('../../public/nova/shortline/factor-dictionary.mjs');
 if(archive.dictionaryVersion&&archive.dictionaryVersion!==dictionaryVersion)return unavailable('档案因子字典与原数值模型定义不一致');
 try{
  const rows=readLearningRows(archive,cutoffAt,{numericOnly:true}).filter(r=>r.numericFactors.settlementKnownAt<cutoffAt);
  const current=new Map();
  for(const check of arr(archive.checks).slice().sort((a,b)=>(instant(a.createdAt)||0)-(instant(b.createdAt)||0)||String(a.id).localeCompare(String(b.id)))){
   if(!numeric.realEvidence(check)||instant(check.createdAt)===null||instant(check.createdAt)>cutoffAt||instant(check.asOf)===null||instant(check.asOf)>cutoffAt)continue;
   const vector=numeric.readNumericCheck(check,archive.catalog||[],cutoffAt);
   current.set(check.code,{symbol:check.code,checkId:check.id,vector});
  }
  const scoringVectors=[...current.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
  return {schema,status:'ready',dictionaryVersion,rows,scoringVectors};
 }catch{return unavailable('原数值学习链的输入投影未完成');}
}

async function numericCausalDiagnostics({archive={},asOf=Date.now(),cutoffAt=asOf,deadlineAt=Date.now()+6000}={}){
 if(!stamp(asOf)||!stamp(cutoffAt)||cutoffAt>asOf)throw Error('数值模型因果审计时点无效');
 let fits=0,completedEvaluations=0;
 const evaluate=async input=>{
  if(Date.now()>=deadlineAt)throw Error('budget-exhausted');
  const state=await numericDiagnosticInputState({archive:input,cutoffAt});
  if(state.status!=='ready')return {model:null,ranking:[],eligibleRows:0,inputUnavailable:state.reason};
  if(Date.now()>=deadlineAt)throw Error('budget-exhausted');
  fits++;
  const model=numeric.fitNumericModel(state.rows,{dictionaryVersion:state.dictionaryVersion,trainCutoff:new Date(cutoffAt).toISOString()});
  if(!model)return {model:null,ranking:[],eligibleRows:state.rows.length};
  const ranking=state.scoringVectors.map(({symbol,checkId,vector})=>{
   const value=numeric.numericScore(model,vector);return {symbol,checkId,score:value.score,missing:value.missing};
  }).sort((a,b)=>Number(Number.isFinite(b.score))-Number(Number.isFinite(a.score))||(b.score??0)-(a.score??0)||a.symbol.localeCompare(b.symbol));
  completedEvaluations++;return {model,ranking,eligibleRows:state.rows.length};
 };
 try{
  const baseline=await evaluate(clone(archive));
  if(baseline.inputUnavailable)return unknown(baseline.inputUnavailable,{executed:false,fits,completedEvaluations});
  if(!baseline.model)return unknown('原学习链尚无至少12条同定义、当时已成熟且可核验的数值训练样本',{executed:true,fits,completedEvaluations,eligibleRows:baseline.eligibleRows});
  const future=at=>at===null||at>cutoffAt;
  const cases=[
   ['truncate-future-archive',input=>{for(const key of ['trades','checks','plans','bars','notes','corrections'])if(Array.isArray(input[key]))input[key]=input[key].filter(r=>
    !['createdAt','recordedAt','knownAt','frozenAt'].some(k=>r[k]!==undefined&&future(instant(r[k]))));}],
   ['perturb-future-OHLCV',input=>{for(const b of arr(input.bars))if(String(b.date)>day(cutoffAt)||future(instant(b.knownAt))){for(const k of ['open','high','low','close'])if(Number.isFinite(b[k]))b[k]*=1.8;if(Number.isFinite(b.volume))b.volume*=2;}}],
   ['perturb-future-settlement-labels',input=>{for(const r of arr(input.trades))if(future(instant(r.createdAt))||future(instant(r.exitTimestamp??r.exitTime))){r.pnl=99999;r.pnlAmount=99999;}}],
   ['late-announcement-and-factor',input=>{
    const base=arr(input.checks).find(c=>instant(c.createdAt)!==null&&instant(c.createdAt)<=cutoffAt);
    if(base){const check=clone(base);check.id='diagnostic-late-factor-'+fingerprint(base).slice(0,12);check.createdAt=new Date(cutoffAt+1).toISOString();
     for(const item of Object.values(check.factorObservations||{})){item.value=99999;item.knownAt=cutoffAt+1;}input.checks.push(check);}
    input.pressureNews=[...arr(input.pressureNews),{code:base?.code,knownAt:cutoffAt+1,publishedAt:cutoffAt-1000,content:'仅本次隔离诊断的晚到资料扰动'}];
   }]
  ];
  const checks=[];
  for(const [name,mutate]of cases){const changed=clone(archive);mutate(changed);
   if(isDeepStrictEqual(changed,archive)){checks.push({name,status:'not-evaluated',reason:'没有对应未来输入可扰动'});continue;}
   const output=await evaluate(changed);
   checks.push(output.inputUnavailable?{name,status:'not-evaluated',reason:output.inputUnavailable,executed:false}:
    {name,status:isDeepStrictEqual(output,baseline)?'pass':'fail',executed:true});
  }
  const scorable=baseline.ranking.filter(r=>Number.isFinite(r.score)).length;
  return report({status:checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')&&scorable?'pass':'not-evaluated',
   executed:true,fits,completedEvaluations,checks,cutoffAt,modelSchema:numeric.MODEL,modelFingerprint:baseline.model.fingerprint,
   trainingFingerprint:baseline.model.trainingFingerprint,trainingRows:baseline.model.trainingRows,eligibleRows:baseline.eligibleRows,
   factorCount:baseline.model.parameters.length,scorable,ranking:baseline.ranking,
   evaluator:'original-readLearningRows + fitNumericModel + readNumericCheck + numericScore',
   scope:'diagnostic-refit-from-available-original-settlements; no production candidate or approval',
   limitations:['只读复用原冻结计划、成交成本、因子定义和时间门禁；所有扰动仅在内存副本中',
    '重拟合用于检测未来输入影响，不替换获批模型，不宣称这是历史已批准模型或独立样本效果',
    '没有对应未来资料时该攻击未评估，不能把无变化输入算作通过']});
 }catch(error){return unknown(error.message==='budget-exhausted'?'数值模型审计达到执行预算':'原数值学习链的输入或计算未完成',{executed:fits>0,fits,completedEvaluations,errorCode:'NUMERIC_AUDIT_UNAVAILABLE'});}
}

async function modelCausalDiagnostics({archive={},history,cutoff,asOf=Date.now(),trustedPython=null,deadlineAt=Date.now()+18000}={}){
 const cutoffAt=cutoff?Date.parse(cutoff+'T23:59:59.999+08:00'):asOf;
 const numericResult=await numericCausalDiagnostics({archive,asOf,cutoffAt:Math.min(asOf,cutoffAt),deadlineAt:Math.min(deadlineAt,Date.now()+6000)});
 const python=pythonCausalDiagnostics({history,cutoff,trustedPython,deadlineAt:Math.min(deadlineAt,Date.now()+12000)});
 return report({status:[numericResult,python].some(r=>r.status==='fail')?'fail':[numericResult,python].every(r=>r.status==='pass')?'pass':'not-evaluated',
  numeric:numericResult,python,externalModelsInvoked:python.executionAttempted===true,
  modelLibrary:{status:'separate-existing-regression',tests:['tests/model-research.test.js','tests/model-public-features.test.js'],
   reason:'原ridge/extraTrees/histBoost因果回归实际运行模型；180秒训练入口不并入55秒交互任务'}});
}
module.exports={readTrustedPythonConfig,pythonCausalDiagnostics,numericDiagnosticInputState,numericCausalDiagnostics,modelCausalDiagnostics};
