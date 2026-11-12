'use strict';
// A preregistered raw-candle experiment. No return, trading eligibility, limit
// price, corporate-action assertion, production weight or external model API.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {detectPatterns}=require('../strategy/a-share-patterns');
const OBJECTIVE='next-session-reported-candle-direction-v1',RULE='fixed-pattern-balance-candle-v1';
const MIN_DAYS=20,MAX_EVENTS=500,MAX_FILE=1024*1024,MAX_TOTAL=128*1024*1024;
const flags={researchOnly:true,canTrade:false,canNotify:false,verifiedLive:false,productionWeightsChanged:false,autoPromotion:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const time=x=>Number.isSafeInteger(x)&&x>0;
const at=(d,t)=>Date.parse(d+'T'+t+'+08:00');
const stamp=x=>time(x)?x:typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&day(x.slice(0,10))&&+x.slice(11,13)<24&&+x.slice(14,16)<60&&+x.slice(17,19)<60&&time(Date.parse(x))?Date.parse(x):NaN;
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
const encode=x=>JSON.stringify(canonical(x)),hash=x=>digest(encode(x));
const sealed=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const CODE_FINGERPRINT=digest(fs.readFileSync(__filename));
const direction=b=>b.close>b.open?'up':b.close<b.open?'down':'flat';
const labelHash=b=>hash({date:b.date,open:b.open,close:b.close});
function identity(stock){
 if(!stock||!/^\d{6}$/.test(stock.symbol||'')||typeof stock.provider!=='string'||! /^[A-Za-z0-9_.:-]{1,100}$/.test(stock.provider)||typeof stock.source!=='string'||! /^[A-Za-z0-9_.:-]{1,160}$/.test(stock.source)||stock.priceBasis!=='unadjusted')throw Error('研究需要明确股票、来源、提供者与未复权口径');
 return {symbol:stock.symbol,provider:stock.provider,source:stock.source,priceBasis:stock.priceBasis};
}
function privateDir(value,create=false){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('研究档案需要私有绝对路径');
 const full=path.resolve(value);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('研究档案不得公开');
 let cursor=path.parse(full).root;
 for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{const st=fs.lstatSync(cursor);if(st.isSymbolicLink()||!st.isDirectory())throw Error('研究目录类型无效');}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)&&(fs.statSync(full).mode&0o077))throw Error('研究目录必须为0700');
 return full;
}
function location(root,id,create=false){return privateDir(path.join(privateDir(path.join(privateDir(root,create),id.symbol),create),hash([id.provider,id.priceBasis])),create);}
function readChain(dir,asOf){
 const chain={count:0,bytes:0,last:null,selected:null};
 if(!fs.existsSync(dir))return chain;
 const names=fs.readdirSync(dir).filter(n=>!/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(n));
 if(names.length>MAX_EVENTS||names.some(n=>!/^\d{6}\.json$/.test(n)))throw Error('研究历史目录损坏或达到上限');
 for(const [i,name]of names.sort().entries()){
  const prior=chain.last;
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('研究历史链缺失');
  const file=path.join(dir,name),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let raw;
  try{const st=fs.fstatSync(fd);chain.bytes+=st.size;if(!st.isFile()||(st.mode&0o077)||st.size>MAX_FILE||chain.bytes>MAX_TOTAL)throw Error('研究档案权限或大小无效');raw=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
  const event=JSON.parse(raw),{eventHash,...body}=event;
  if(eventHash!==hash(body)||event.schemaVersion!==1||event.objective!==OBJECTIVE||event.revision!==i+1||event.previousHash!==(prior?.eventHash||null)||!time(event.recordedAt)||!time(event.decisionAt)||event.decisionAt>event.recordedAt||prior&&(event.recordedAt<prior.recordedAt||event.decisionAt<prior.decisionAt||encode(event.identity)!==encode(prior.identity))||Object.keys(flags).some(k=>event[k]!==flags[k])||!Array.isArray(event.state?.hypotheses)||!Array.isArray(event.state?.outcomes)||!Array.isArray(event.state?.corrections))throw Error('研究历史完整性校验失败');
  identity(event.identity);chain.last=event;chain.count++;
  if(asOf!==undefined&&event.recordedAt<=asOf&&event.decisionAt<=asOf)chain.selected=event;
  // Continue through the tail even for historical reads, but release each
  // superseded full state instead of retaining the entire quadratic history.
 }
 return chain;
}
function validate(input,now){
 const {stock,observationHash,evidenceBundleHash,decisionAt,tradeDates}=input||{},id=identity(stock);
 if(!time(now)||!time(decisionAt)||decisionAt>now||!sealed(observationHash)||!sealed(evidenceBundleHash)||!Array.isArray(tradeDates)||tradeDates.length<2||tradeDates.length>1000||tradeDates.some((d,i)=>!day(d)||(i&&d<=tradeDates[i-1])))throw Error('观察引用、决策时间或明确交易日历无效');
 const observedAt=stamp(stock.observedAt);if(!time(observedAt)||observedAt>decisionAt||!Array.isArray(stock.bars)||!stock.bars.length||stock.bars.length>500)throw Error('观察时间或K线范围无效');
 let previous='';const indices=new Map(tradeDates.map((d,i)=>[d,i]));
 const bars=stock.bars.map(b=>{
  if(!b||b.closed===false||b.isClosed===false||!day(b.date)||b.date<=previous||!indices.has(b.date)||!['open','high','low','close','volume'].every(k=>finite(b[k]))||Math.min(b.open,b.close,b.low)<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||!Number.isSafeInteger(b.volume)||b.volume<0)throw Error('研究OHLCV或日期无效');previous=b.date;
  for(const key of ['source','provider','priceBasis'])if(b[key]!==undefined&&b[key]!==id[key])throw Error('研究逐日来源混用');
  const knownAt=stamp(b.knownAt);if(!time(knownAt)||knownAt>observedAt||knownAt<at(b.date,'15:00:00'))throw Error('日K实际可得时间缺失、未来或早于收盘');
  const bar={date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,knownAt};
  // Known turnover is a pattern input; absent turnover is never reconstructed
  // as close*volume. An explicit field clock cannot be borrowed from price.
  if(b.amount!=null){
   if(!finite(b.amount)||b.amount<0)throw Error('研究成交额无效');
   if(b.amountKnownAt!==undefined){const amountKnownAt=stamp(b.amountKnownAt);if(!time(amountKnownAt)||amountKnownAt>observedAt||amountKnownAt<at(b.date,'15:00:00'))throw Error('成交额实际可得时间无效');bar.amountKnownAt=amountKnownAt;}
   bar.amount=b.amount;
  }
  return bar;
 });
 return {id,bars,observedAt,indices,tradeDates,observationHash,evidenceBundleHash,decisionAt};
}
function statistics(state){
 const outcomes=state.outcomes,days=new Set(outcomes.map(o=>o.targetDate)),scored=outcomes.filter(o=>o.brier!==null);
 return {objective:OBJECTIVE,evaluated:outcomes.length,independentTargetDays:days.size,matched:outcomes.filter(o=>o.matched).length,
  rawCandleMatchFrequency:days.size>=MIN_DAYS?outcomes.filter(o=>o.matched).length/outcomes.length:null,
  brier:scored.length?scored.reduce((s,o)=>s+o.brier,0)/scored.length:null,brierEvaluated:scored.length,
  probabilityMeaning:'仅同一原始日K收盘相对开盘三态事件；不是收益、涨停或可成交胜率',minIndependentDays:MIN_DAYS,...flags};
}
function version(state){const n=new Set(state.outcomes.map(o=>o.targetDate)).size;return {number:1+Math.max(0,n-MIN_DAYS+1),stage:n<MIN_DAYS?'collecting-frozen-outcomes':'research-statistics-ready',independentTargetDays:n,ruleVersion:RULE,candidateSeed:'fixed-pattern-library-seed-v1',candidateBudget:1,productionWeightsChanged:false};}
function summarize(id,state,revision,status){return {status,objective:OBJECTIVE,...id,revision,currentHypothesis:state.hypotheses.at(-1)||null,
 pendingTargets:state.hypotheses.filter(h=>!state.outcomes.some(o=>o.hypothesisHash===h.hypothesisHash)).map(h=>({symbol:id.symbol,provider:id.provider,priceBasis:id.priceBasis,targetDate:h.targetDate,dueAt:h.dueAt,createdAt:h.recordedAt,calendarHash:h.calendarHash,hypothesisHash:h.hypothesisHash})),
 forwardValidation:statistics(state),version:version(state),correctionCount:state.corrections.length,...flags};}
function advancePriceEventResearch(root,input){
 const now=Date.now(),v=validate(input,now),dir=location(root,v.id,true);
 for(let attempt=0;attempt<5;attempt++){
  const chain=readChain(dir),last=chain.last,recordedAt=Date.now();
  if(last&&(encode(last.identity)!==encode(v.id)||v.decisionAt<last.decisionAt||recordedAt<last.recordedAt))throw Error('研究来源或时钟不允许切换/倒退');
  const state=last?structuredClone(last.state):{hypotheses:[],outcomes:[],corrections:[]};let changed=false;
  for(const h of state.hypotheses){
   const b=v.bars.find(b=>b.date===h.targetDate);if(!b||b.knownAt<=h.decisionAt||b.knownAt>v.decisionAt||v.decisionAt<at(b.date,'16:00:00'))continue;
   const old=state.outcomes.find(o=>o.hypothesisHash===h.hypothesisHash),barHash=labelHash(b);
   if(old){
    const prior=state.corrections.filter(c=>c.hypothesisHash===h.hypothesisHash).at(-1);
    if(barHash!==(prior?.barHash||old.barHash)){state.corrections.push({hypothesisHash:h.hypothesisHash,barHash,knownAt:b.knownAt,observedAt:v.observedAt,recordedAt,observationHash:v.observationHash,evidenceBundleHash:v.evidenceBundleHash,originalOutcomeUnchanged:true});changed=true;}
    continue;
   }
   const outcome=direction(b),probabilities=h.probabilities;
   state.outcomes.push({hypothesisHash:h.hypothesisHash,targetDate:b.date,outcome,prediction:h.prediction,matched:outcome===h.prediction,state:h.state,knownAt:b.knownAt,observedAt:v.observedAt,recordedAt,barHash,observationHash:v.observationHash,evidenceBundleHash:v.evidenceBundleHash,
    brier:probabilities?['up','down','flat'].reduce((s,k)=>s+(probabilities[k]-(k===outcome?1:0))**2,0):null});changed=true;
  }
  const lastBar=v.bars.at(-1),targetDate=v.tradeDates[v.indices.get(lastBar.date)+1]||null,targetOpen=targetDate?at(targetDate,'09:30:00'):NaN;
  const mayFreeze=targetDate&&v.decisionAt>=at(lastBar.date,'16:00:00')&&v.decisionAt<targetOpen&&recordedAt<=Math.min(targetOpen,v.decisionAt+60000);
  if(mayFreeze&&!state.hypotheses.some(h=>h.targetDate===targetDate)){
   // Use a contiguous currently known prefix; never pad missing market sessions.
   let start=v.bars.length-1;while(start>0&&v.indices.get(v.bars[start].date)===v.indices.get(v.bars[start-1].date)+1)start--;
   const prefix=v.bars.slice(start),patterns=detectPatterns({symbol:v.id.symbol,bars:prefix});
   if(patterns.usable){
    const bucket=patterns.positiveCount>patterns.riskCount?'bullish':patterns.riskCount>patterns.positiveCount?'bearish':'balanced';
    const prediction=bucket==='bullish'?'up':bucket==='bearish'?'down':direction(lastBar);
    const available=state.outcomes.filter(o=>o.knownAt<=v.decisionAt&&o.recordedAt<=recordedAt),same=available.filter(o=>o.state===bucket);
    const enough=new Set(available.map(o=>o.targetDate)).size>=MIN_DAYS&&new Set(same.map(o=>o.targetDate)).size>=MIN_DAYS;
    const probabilities=enough?Object.fromEntries(['up','down','flat'].map(k=>[k,same.filter(o=>o.outcome===k).length/same.length])):null;
    const body={objective:OBJECTIVE,...v.id,ruleVersion:RULE,codeFingerprint:CODE_FINGERPRINT,candidateSeed:'fixed-pattern-library-seed-v1',candidateBudget:1,researchVersion:version(state).number,
     signalDate:lastBar.date,targetDate,dueAt:at(targetDate,'16:10:00'),decisionAt:v.decisionAt,recordedAt,prediction,state:bucket,probabilities,
     trainedThrough:available.length?available.map(o=>o.targetDate).sort().at(-1):null,trainingOutcomeHashes:available.map(o=>hash(o)),conditionalSamples:same.length,
     observationHash:v.observationHash,evidenceBundleHash:v.evidenceBundleHash,inputHash:hash(prefix),calendarHash:hash(v.tradeDates),matchedPatternIds:patterns.matched.map(p=>p.id),...flags};
    state.hypotheses.push({...body,hypothesisHash:hash(body)});changed=true;
   }
  }
  if(!changed)return summarize(v.id,state,last?.revision||0,last?'unchanged':'no-eligible-prospective-hypothesis');
  if(chain.count>=MAX_EVENTS||state.hypotheses.length>500||state.corrections.length>1000)throw Error('研究历史达到有界上限');
  const body={schemaVersion:1,objective:OBJECTIVE,identity:v.id,revision:chain.count+1,previousHash:last?.eventHash||null,decisionAt:v.decisionAt,recordedAt,state,...flags};
  const event={...body,eventHash:hash(body)},raw=encode(event);
  if(Buffer.byteLength(raw)>MAX_FILE||chain.bytes+Buffer.byteLength(raw)>MAX_TOTAL)throw Error('研究档案超过大小上限');
  const file=path.join(dir,String(event.revision).padStart(6,'0')+'.json'),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd,conflict=false;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}catch(e){if(e.code==='EEXIST')conflict=true;else throw e;}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(conflict)continue;
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return summarize(v.id,state,event.revision,'research-observation-recorded');
 }
 throw Error('研究并发发布冲突，请稍后重试');
}
function readPriceEventResearch(root,{symbol,provider,asOf=Date.now()}={}){
 if(!time(asOf)||asOf>Date.now()||symbol!==undefined&&!/^\d{6}$/.test(symbol)||provider!==undefined&&(typeof provider!=='string'||! /^[A-Za-z0-9_.:-]{1,100}$/.test(provider)))throw Error('研究查询身份或时间无效');
 const base=privateDir(root),streams=[],targetDays=new Set();
 if(fs.existsSync(base)){
  const symbols=fs.readdirSync(base);if(symbols.length>500||symbols.some(s=>!/^\d{6}$/.test(s)))throw Error('研究股票目录无效');
  for(const s of symbols.filter(s=>symbol===undefined||s===symbol)){
   const dir=privateDir(path.join(base,s)),ids=fs.readdirSync(dir);if(ids.length>20||ids.some(id=>!sealed(id)))throw Error('研究身份目录无效');
   for(const id of ids){if(provider!==undefined&&id!==hash([provider,'unadjusted']))continue;
    const last=readChain(privateDir(path.join(dir,id)),asOf).selected;
    if(last){if(last.identity.symbol!==s||hash([last.identity.provider,last.identity.priceBasis])!==id)throw Error('研究档案身份不一致');streams.push(summarize(last.identity,last.state,last.revision,'stored-research'));for(const outcome of last.state.outcomes)targetDays.add(outcome.targetDate);}
   }
  }
 }
 return {status:streams.length?'available':'empty',objective:OBJECTIVE,asOf,streams,pendingTargets:streams.flatMap(s=>s.pendingTargets),independentTargetDays:targetDays.size,...flags};
}
module.exports={advancePriceEventResearch,readPriceEventResearch,OBJECTIVE};
