'use strict';
// Forecast quality uses observations received after a frozen prediction. It never
// treats a model-generated candle as a price, a fill, or a realized return.
const path=require('node:path');
const S=require('./research-workspace-store');
const VERSION='frozen-close-forecast-v1',HORIZONS=[1,5,20,60];
const MODEL_IDENTITY_FIELDS=['id','revision','weightsHash','tokenizerRevision','trainingCutoff','seed','temperature','topP','sampleCount'];
const modelIdentity=model=>Object.fromEntries(MODEL_IDENTITY_FIELDS.map(k=>[k,model[k]??null]));
const array=x=>Array.isArray(x)?x:[],finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=x=>Number.isSafeInteger(x)&&x>0;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const close=d=>Date.parse(d+'T15:10:00+08:00'),open=d=>Date.parse(d+'T09:30:00+08:00');
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const price=x=>finite(x)&&x>=0&&x<=1e9;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=x=>finite(x)?+x.toFixed(6):null;
const errors={INPUT:'缺少有效的封存股票与闭合日K',CALENDAR:'缺少可核对的交易日历与下一交易日',IDENTITY:'预测与股票、来源、输入指纹或观察日期不一致',
 TIME:'预测生成时点无效，或早于输入封存/晚于接收时间',LATE:'已超过下一交易日开盘，不能补存为前向预测',MODEL:'模型版本、训练截止期或运行参数无效',
 OUTPUT:'预测周期、目标日期、点值或分位数无效',ARCHIVE:'预测档案不可用或保存失败，原研究保留',REQUEST:'预测请求ID或字段无效'};
function fail(code){const e=Error(errors[code]);e.code='FORECAST_'+code;throw e;}
const fields=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const rootFor=workspace=>{const root=S.privateRoot(workspace);return path.join(path.dirname(root),path.basename(root)+'-forecasts');};
function prepareInput(event){
 const d=event?.data,bars=array(d?.bars),dates=array(d?.tradeDates);
 if(event?.kind!=='analysis'||!sha(event.hash)||!/^\d{6}$/.test(d?.symbol||'')||!['tencent','eastmoney'].includes(d.provider)||d.priceBasis!=='unadjusted'||
  !stamp(d.asOf)||!stamp(event.recordedAt)||event.recordedAt<d.asOf||!sha(d.observationHash)||!bars.length||bars.length>500||bars.at(-1).date!==d.tradeDate||
  bars.some((b,i)=>!date(b.date)||i&&bars[i-1].date>=b.date||!stamp(b.knownAt)||b.knownAt>d.asOf||b.knownAt<close(b.date)||
   !['open','high','low','close'].every(k=>price(b[k])&&b[k]>0)||!finite(b.volume)||b.volume<0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)))fail('INPUT');
 if(!dates.length||dates.length>1000||dates.some((v,i)=>!date(v)||i&&dates[i-1]>=v)||!dates.includes(d.tradeDate)||bars.some(b=>!dates.includes(b.date))||!dates[dates.indexOf(d.tradeDate)+1])fail('CALENDAR');
 const i=dates.indexOf(d.tradeDate),targets=HORIZONS.filter(h=>dates[i+h]).map(h=>({horizon:h,targetDate:dates[i+h]}));
 const body={schemaVersion:1,mode:'frozen-close-forecast-input',runId:event.hash,symbol:d.symbol,provider:d.provider,priceBasis:d.priceBasis,currency:'CNY',
  asOf:d.asOf,inputRecordedAt:event.recordedAt,originDate:d.tradeDate,observationHash:d.observationHash,calendarHash:S.digest(dates),tradeDates:dates,targets,
  bars:bars.map(b=>Object.fromEntries(['date','open','high','low','close','volume','amount','knownAt'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])))};
 return {...body,inputFingerprint:S.digest(body),freezeDeadline:open(dates[i+1]),...S.FLAGS};
}
function cleanModel(model,originDate){
 const keys=['id','revision','weightsHash','tokenizerRevision','trainingCutoff','seed','temperature','topP','sampleCount','latencyMs','peakMemoryMb'];
 const text=x=>typeof x==='string'&&/^[\w./@:+-]{1,160}$/.test(x)&&!x.includes('://');
 if(!fields(model,keys)||typeof model.id!=='string'||!/^[A-Za-z][\w-]{0,40}$/.test(model.id)||!text(model.revision)||
  model.weightsHash!=null&&!sha(model.weightsHash)||model.tokenizerRevision!=null&&!text(model.tokenizerRevision)||
  model.trainingCutoff!=null&&(!date(model.trainingCutoff)||model.trainingCutoff>originDate)||
  model.seed!=null&&(!Number.isSafeInteger(model.seed)||model.seed<0)||model.temperature!=null&&(!finite(model.temperature)||model.temperature<0||model.temperature>10)||
  model.topP!=null&&(!finite(model.topP)||model.topP<=0||model.topP>1)||model.sampleCount!=null&&(!Number.isSafeInteger(model.sampleCount)||model.sampleCount<1||model.sampleCount>100000)||
  ['latencyMs','peakMemoryMb'].some(k=>model[k]!=null&&(!finite(model[k])||model[k]<0||model[k]>1e9)))fail('MODEL');
 return Object.fromEntries(keys.map(k=>[k,model[k]??null]));
}
function outputTemplate(input){return {schemaVersion:1,inputFingerprint:input.inputFingerprint,symbol:input.symbol,provider:input.provider,originDate:input.originDate,generatedAt:null,
 model:{id:'custom',revision:null,weightsHash:null,tokenizerRevision:null,trainingCutoff:null,seed:null,temperature:null,topP:null,sampleCount:null},
 forecasts:input.targets.map(t=>({...t,point:null,pointKind:'point',quantiles:[{level:.1,value:null},{level:.5,value:null},{level:.9,value:null}]}))};}
function validatePrediction(input,prediction,now){
 if(!fields(prediction,['schemaVersion','inputFingerprint','symbol','provider','originDate','generatedAt','model','forecasts'])||prediction.schemaVersion!==1||
  prediction.inputFingerprint!==input.inputFingerprint||prediction.symbol!==input.symbol||prediction.provider!==input.provider||prediction.originDate!==input.originDate)fail('IDENTITY');
 if(!stamp(now)||now>Date.now()||!stamp(prediction.generatedAt)||prediction.generatedAt<input.inputRecordedAt||prediction.generatedAt>now)fail('TIME');
 if(now>=input.freezeDeadline)fail('LATE');
 const model=cleanModel(prediction.model,input.originDate),seen=new Set();
 if(!Array.isArray(prediction.forecasts)||!prediction.forecasts.length||prediction.forecasts.length>4)fail('OUTPUT');
 const forecasts=prediction.forecasts.map(f=>{
  if(!fields(f,['horizon','targetDate','point','pointKind','quantiles'])||!HORIZONS.includes(f.horizon)||seen.has(f.horizon)||
   input.targets.find(t=>t.horizon===f.horizon)?.targetDate!==f.targetDate||!price(f.point)||!['point','mean','median'].includes(f.pointKind??'point'))fail('OUTPUT');seen.add(f.horizon);
  if(f.quantiles!==undefined&&(!Array.isArray(f.quantiles)||f.quantiles.length>19))fail('OUTPUT');
  const quantiles=array(f.quantiles).map((q,i,all)=>{
   if(!fields(q,['level','value'])||!finite(q.level)||q.level<=0||q.level>=1||!price(q.value)||i&&(all[i-1].level>=q.level||all[i-1].value>q.value))fail('OUTPUT');return {level:q.level,value:q.value};
  });
  const median=quantiles.find(q=>q.level===.5);if(f.pointKind==='median'&&median&&Math.abs(median.value-f.point)>1e-8*Math.max(1,f.point))fail('OUTPUT');
  return {horizon:f.horizon,targetDate:f.targetDate,point:f.point,pointKind:f.pointKind??'point',quantiles};
 });
 return {model,forecasts};
}
function freezeForecast(workspace,events,request,{now=Date.now()}={}){
 if(!fields(request,['action','runId','requestId','prediction'])||request.action!=='freeze-forecast'||!sha(request.runId)||typeof request.requestId!=='string'||!/^[\w-]{8,100}$/.test(request.requestId))fail('REQUEST');
 const fingerprint=S.digest({runId:request.runId,prediction:request.prediction}),root=rootFor(workspace);
 let old;try{old=S.readEvents(root).find(e=>e.requestId===request.requestId);}catch{fail('ARCHIVE');}
 if(old){if(old.data?.requestFingerprint!==fingerprint)fail('REQUEST');return {ok:true,forecastId:old.hash,reused:true,...S.FLAGS};}
 const event=events.find(e=>e.kind==='analysis'&&e.hash===request.runId&&e.recordedAt<=now&&e.data.asOf<=now);
 const input=prepareInput(event),{model,forecasts}=validatePrediction(input,request.prediction,now);
 const data={schemaVersion:1,mode:'frozen-model-forecast',evaluationVersion:VERSION,asOf:input.asOf,originDate:input.originDate,runId:input.runId,
  inputFingerprint:input.inputFingerprint,symbol:input.symbol,provider:input.provider,priceBasis:input.priceBasis,model,forecasts,
  generatedAt:request.prediction.generatedAt,freezeDeadline:input.freezeDeadline,requestFingerprint:fingerprint,
  provenance:'explicit-import-unverified',contextRows:input.bars.length,lastClose:input.bars.at(-1).close,tradeDates:input.tradeDates,
  inputAvailability:'recorded-closed-prices-only',modelExecutionVerified:false,costReportsVerified:false};
 let saved;try{saved=S.appendEvent(root,'analysis',data,{requestId:request.requestId,now});}catch{fail('ARCHIVE');}
 return {ok:true,forecastId:saved.hash,reused:saved.reused,...S.FLAGS};
}
function observations(events,asOf){
 const first=new Map(),latest=new Map();
 for(const e of events.filter(e=>e.kind==='analysis'&&e.recordedAt<=asOf&&e.data.asOf<=asOf).sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence)){
  const d=e.data;for(const b of array(d.bars))if(date(b.date)&&stamp(b.knownAt)&&b.knownAt>=close(b.date)&&b.knownAt<=d.asOf&&b.knownAt<=e.recordedAt&&e.recordedAt>=close(b.date)&&price(b.close)&&b.close>=.01){
   const key=[d.symbol,d.provider,d.priceBasis,b.date].join('|'),row={bar:b,runId:e.hash,recordedAt:e.recordedAt};if(!first.has(key))first.set(key,row);latest.set(key,row);
  }
 }return {first,latest};
}
function pairedComparisons(rows){
 const matches=new Map(),pairs=new Map();let limited=0;
 for(const r of rows.filter(r=>r.status==='observed-unverified')){const k=[r.inputFingerprint,r.provider,r.horizon,r.targetDate].join('|');if(!matches.has(k))matches.set(k,[]);matches.get(k).push(r);}
 for(const same of matches.values()){
  const unique=[...new Map(same.map(r=>[r.modelKey,r])).values()].sort((a,b)=>a.modelKey.localeCompare(b.modelKey));
  if(unique.length>16){limited++;continue;}
  for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
   const a=unique[i],b=unique[j],key=[a.modelKey,b.modelKey,a.provider,a.horizon,a.pointKind,b.pointKind].join('|');
   if(!pairs.has(key)){if(pairs.size>=256){limited++;continue;}pairs.set(key,{modelA:{...a.model,modelKey:a.modelKey,pointKind:a.pointKind},modelB:{...b.model,modelKey:b.modelKey,pointKind:b.pointKind},provider:a.provider,horizon:a.horizon,n:0,sumA:0,sumB:0,winsA:0,ties:0,days:new Set(),symbols:new Set()});}
   const p=pairs.get(key);p.n++;p.sumA+=a.absoluteError;p.sumB+=b.absoluteError;if(a.absoluteError<b.absoluteError)p.winsA++;if(a.absoluteError===b.absoluteError)p.ties++;p.days.add(a.originDate);p.symbols.add(a.symbol);
  }
 }
 return {rows:[...pairs.values()].map(p=>({modelA:p.modelA,modelB:p.modelB,provider:p.provider,horizon:p.horizon,samples:p.n,signalDays:p.days.size,symbols:p.symbols.size,
  maeA:round(p.sumA/p.n),maeB:round(p.sumB/p.n),deltaMaeAminusB:round((p.sumA-p.sumB)/p.n),lowerErrorCountA:p.winsA,ties:p.ties,
  status:'paired-descriptive-only',profitComparison:null,independenceCertified:false})),limitedGroups:limited,meaning:'仅在完全相同输入指纹、来源、目标日和周期的交集中比较价格误差；不作收益排名'};
}
function evaluateForecasts(forecasts,events,{asOf=Date.now(),symbol,runId,offset=0,limit=20}={}){
 if(!stamp(asOf)||asOf>Date.now()||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('REQUEST');
 const observed=observations(events,asOf),rows=[],groups=new Map(),dedup=new Set();
 for(const event of forecasts.filter(e=>e.kind==='analysis'&&e.recordedAt<=asOf&&e.data.asOf<=asOf).sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence)){
  const d=event.data;if(d.mode!=='frozen-model-forecast'||d.evaluationVersion!==VERSION||!stamp(d.generatedAt)||event.recordedAt>=d.freezeDeadline||d.generatedAt>event.recordedAt)fail('ARCHIVE');
  const model=modelIdentity(d.model),modelKey=S.digest(model);
  const origin=events.find(e=>e.hash===d.runId),input=origin?prepareInput(origin):null;
  for(const f of d.forecasts){
   const key=[modelKey,d.provider,f.horizon,f.pointKind,JSON.stringify(f.quantiles.map(q=>q.level))].join('|');
   const selected=(!symbol||d.symbol===symbol)&&(!runId||d.runId===runId);
   if(!selected){const unique=[modelKey,d.symbol,d.provider,d.originDate,f.horizon].join('|');dedup.add(unique);continue;}
   if(!groups.has(key))groups.set(key,{key,model:d.model,provider:d.provider,horizon:f.horizon,pointKind:f.pointKind,quantileLevels:f.quantiles.map(q=>q.level),total:0,pending:0,missing:0,invalid:0,repeated:0,values:[],days:new Set(),symbols:new Set(),windows:[]});
   const group=groups.get(key);group.total++;
   const row={id:event.hash,runId:d.runId,inputFingerprint:d.inputFingerprint,symbol:d.symbol,provider:d.provider,modelKey,model,modelId:d.model.id,revision:d.model.revision,
    horizon:f.horizon,originDate:d.originDate,targetDate:f.targetDate,recordedAt:event.recordedAt,point:f.point,pointKind:f.pointKind,quantiles:f.quantiles,status:'pending',actual:null,absoluteError:null,naiveError:null,driftError:null,pinballLoss:null,covered:null};
   const unique=[modelKey,d.symbol,d.provider,d.originDate,f.horizon].join('|');
   if(dedup.has(unique)){row.status='repeated-origin';group.repeated++;rows.push(row);continue;}dedup.add(unique);
   if(!input||input.inputFingerprint!==d.inputFingerprint){row.status='input-unavailable';group.invalid++;rows.push(row);continue;}
   if(asOf<close(f.targetDate)){group.pending++;rows.push(row);continue;}
   const observationKey=[d.symbol,d.provider,d.priceBasis,f.targetDate].join('|'),actual=observed.first.get(observationKey),newer=observed.latest.get(observationKey);
   if(!actual){row.status='missing-outcome';group.missing++;rows.push(row);continue;}
   if(actual.recordedAt<event.recordedAt||!(actual.bar.volume>0)){row.status='unusable-outcome';group.invalid++;rows.push(row);continue;}
   const value=actual.bar.close,error=Math.abs(value-f.point),naive=Math.abs(value-d.lastClose);
   const tail=input.bars.slice(-21),dates=d.tradeDates,indices=tail.map(b=>dates.indexOf(b.date));
   let drift=null;if(tail.length>=2&&indices.every((x,i)=>x>=0&&(!i||x===indices[i-1]+1))){const predicted=d.lastClose*Math.exp(Math.log(d.lastClose/tail[0].close)/(tail.length-1)*f.horizon);if(price(predicted))drift=Math.abs(value-predicted);}
   const losses=f.quantiles.map(q=>{const residual=value-q.value;return Math.max(q.level*residual,(q.level-1)*residual);});
   const bounds=f.quantiles.length>=2?[f.quantiles[0],f.quantiles.at(-1)]:null;
   Object.assign(row,{status:'observed-unverified',actual:value,absoluteError:error,naiveError:naive,driftError:drift,pinballLoss:mean(losses),
    covered:bounds?value>=bounds[0].value&&value<=bounds[1].value:null,nominalCoveragePct:bounds?100*(bounds[1].level-bounds[0].level):null,
    intervalWidth:bounds?round(bounds[1].value-bounds[0].value):null,outcomeRunId:actual.runId,outcomeKnownAt:actual.bar.knownAt,
    revisedOutcome:newer?.bar.close!==value,latestObservedClose:newer?.bar.close??null,corporateActionEvidence:actual.bar.corporateAction===false?'declared-no-action':actual.bar.corporateAction===true?'action-observed':'unknown'});
   group.values.push(row);group.days.add(d.originDate);group.symbols.add(d.symbol);group.windows.push({from:d.originDate,to:f.targetDate});rows.push(row);
  }
 }
 const summaries=[...groups.values()].map(g=>{let end='',windows=0;for(const w of g.windows.sort((a,b)=>a.to.localeCompare(b.to)))if(w.from>end){windows++;end=w.to;}
  const n=g.values.length,intervals=g.values.filter(r=>r.covered!==null),baseline=mean(g.values.map(r=>r.naiveError)),mae=mean(g.values.map(r=>r.absoluteError));
  return {model:g.model,provider:g.provider,horizon:g.horizon,pointKind:g.pointKind,quantileLevels:g.quantileLevels,total:g.total,matured:n,pending:g.pending,missing:g.missing,invalid:g.invalid,repeated:g.repeated,
   signalDays:g.days.size,symbols:g.symbols.size,nonOverlappingWindows:windows,mae:round(mae),naiveMae:round(baseline),driftMae:round(mean(g.values.map(r=>r.driftError).filter(finite))),
   relativeMae:baseline>0?round(mae/baseline):null,pinballLoss:round(mean(g.values.map(r=>r.pinballLoss).filter(finite))),intervalSamples:intervals.length,
   intervalCoveragePct:intervals.length?round(100*intervals.filter(r=>r.covered).length/intervals.length):null,nominalCoveragePct:intervals[0]?.nominalCoveragePct??null,
   meanIntervalWidth:round(mean(intervals.map(r=>r.intervalWidth))),
   revisedOutcomes:g.values.filter(r=>r.revisedOutcome).length,status:n>=30&&windows>=10&&g.symbols.size>=5?'descriptive-only':'insufficient-independent-samples',
   trainingCoverage:g.model.trainingCutoff?'declared-not-verified':'unknown',costReportsVerified:false};});
 const selected=rows.filter(r=>(!symbol||r.symbol===symbol)&&(!runId||r.runId===runId));
 return {schemaVersion:1,mode:'frozen-model-forward-evaluation',evaluationVersion:VERSION,status:'available',groups:summaries.slice(offset,offset+limit),groupTotal:summaries.length,
  rows:selected.slice().reverse().slice(offset,offset+limit),total:selected.length,offset,limit,
  scope:{symbol:symbol||null,runId:runId||null},pairs:pairedComparisons(selected),inputComparison:'各模型覆盖范围可能不同；不能据原始MAE跨范围排名',
  limitations:['这里只评价未复权收盘价预测误差，不是可成交收益或获利概率','导入版本、权重/训练截止期及耗时均未由本系统核验；不执行上传代码或调模型API',
   '首次到达的闭合行情用于首次评价；后续修订单列，不改写首次值','同股同日同版本重复预测不增加样本；重叠窗口非独立证据'],...S.FLAGS};
}
function evaluationView(workspace,events,query){
 try{return evaluateForecasts(S.readEvents(rootFor(workspace),{asOf:query.asOf}),events,query);}catch{return {mode:'frozen-model-forward-evaluation',status:'unavailable',groups:[],rows:[],total:0,reason:errors.ARCHIVE,...S.FLAGS};}
}
module.exports={VERSION,rootFor,prepareInput,outputTemplate,validatePrediction,freezeForecast,evaluateForecasts,evaluationView};
