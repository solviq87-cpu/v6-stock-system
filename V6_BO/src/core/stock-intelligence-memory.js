'use strict';
// Historical frequencies and immutable research decisions, never execution scores.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {detectPatterns}=require('../strategy/a-share-patterns');
const VERSION='stock-trend-momentum20-v1',MAX_EVENTS=500,MAX_FILE=512*1024;
const flags={researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const stamp=x=>{const t=typeof x==='number'?x:typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&day(x.slice(0,10))&&+x.slice(11,13)<24&&+x.slice(14,16)<60&&+x.slice(17,19)<60?Date.parse(x):NaN;return Number.isSafeInteger(t)&&t>0&&t<8640000000000000?t:NaN;};
const closeAt=d=>Date.parse(d+'T15:00:00+08:00');
const endAt=d=>Date.parse(d+'T23:59:59.999+08:00');
const chinaDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])]));return x;}
const encode=x=>JSON.stringify(canonical(x));
const hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
function calendar(dates){if(!Array.isArray(dates)||dates.length<2||dates.length>1000||dates.some((d,i)=>!day(d)||(i&&d<=dates[i-1])))throw Error('需要明确、递增且无重复的交易日历');return new Map(dates.map((d,i)=>[d,i]));}
function normalizeStock(stock){
 if(!stock||!/^\d{6}$/.test(String(stock.symbol||stock.code||''))||!Array.isArray(stock.bars)||stock.bars.length>500)throw Error('股票代码或历史上限无效');
 const fields=['date','open','high','low','close','volume','amount','knownAt','statusKnownAt','suspended','tradable','isST','corporateAction','priceBasis','limitUpPrice','limitReferencePrice','limitKnownAt','noPriceLimit','market','limitPct','ipoNoLimit'];
 let previous='';const bars=stock.bars.map(b=>{
  if(!b||!day(b.date)||b.date<=previous)throw Error('K线日期无效、重复或倒序');previous=b.date;
  if(!['open','high','low','close','volume'].every(k=>finite(b[k]))||Math.min(b.open,b.low,b.close)<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||!Number.isSafeInteger(b.volume)||b.volume<0)throw Error('OHLCV无效');
  if(b.amount!=null&&(!finite(b.amount)||b.amount<0))throw Error('成交额无效');
  if(b.priceBasis!==undefined&&b.priceBasis!==stock.priceBasis)throw Error('价格口径不一致');
  if(b.source!==undefined&&b.source!==stock.source||b.provider!==undefined&&b.provider!==(stock.provider||stock.source))throw Error('历史提供者不一致');
  // Amount belongs to this dated bar and its knownAt, never today's snapshot.
  return Object.fromEntries(fields.filter(k=>b[k]!==undefined&&(k!=='amount'||b[k]!==null)).map(k=>[k,b[k]]));
 });
 return {symbol:String(stock.symbol||stock.code),name:String(stock.name||'').slice(0,64),source:typeof stock.source==='string'?stock.source.trim().slice(0,160):'',...(stock.provider?{provider:String(stock.provider).slice(0,160)}:{}),priceBasis:typeof stock.priceBasis==='string'?stock.priceBasis.trim().slice(0,80):'',observedAt:stock.observedAt??null,bars};
}
function interval(w,n){if(!n)return null;const z=1.95996398454,p=w/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-r),Math.min(1,c+r)];}
function estimate(samples,minSamples){const wins=samples.reduce((s,x)=>s+x.y,0),n=samples.length;return {status:n>=minSamples?'empirical-research':'insufficient-samples',probability:n>=minSamples?(wins+1)/(n+2):null,samples:n,wins,confidenceInterval:n>=minSamples?interval(wins,n):null,confidenceLevel:.95,trainedThrough:samples.at(-1)?.targetDate||null,method:'laplace-conditional-frequency',sampleDependence:'same-stock daily observations may overlap'};}
function tradable(b,at){return b.volume>0&&b.suspended===false&&b.tradable===true&&b.isST===false&&finite(stamp(b.statusKnownAt))&&stamp(b.statusKnownAt)<=Math.min(at,closeAt(b.date))&&b.corporateAction===false;}
function limitLabel(b,basis,reference){
 const known=stamp(b.limitKnownAt),open=Date.parse(b.date+'T09:30:00+08:00');
 if(basis!=='unadjusted'||b.noPriceLimit!==false||!finite(b.limitUpPrice)||!finite(b.limitReferencePrice)||b.limitReferencePrice<=0||b.limitUpPrice<=b.limitReferencePrice||b.limitUpPrice/b.limitReferencePrice>1.5||b.high>b.limitUpPrice+.011||finite(reference)&&Math.abs(reference-b.limitReferencePrice)>.011||!finite(known)||known>open)return null;
 return Math.round(b.close*100)===Math.round(b.limitUpPrice*100)?1:0;
}
function stateAt(bars,i,cut,indices){
 if(i<20)return null;const rows=bars.slice(i-20,i+1),start=indices.get(rows[0].date);
 if(rows.some((b,j)=>indices.get(b.date)!==start+j||!finite(stamp(b.knownAt))||stamp(b.knownAt)>cut||stamp(b.knownAt)<closeAt(b.date)||!tradable(b,cut)))return null;
 const ma=mean(rows.slice(1).map(b=>b.close));
 return (bars[i].close>=ma?'above':'below')+'-'+(bars[i].close>=bars[i-5].close?'up':'down');
}
function causalStats(bars,states,labels,minSamples,asOf){
 const matured=[],oos=[];
 for(let i=20;i<bars.length;i++){
  const cut=Math.min(asOf,endAt(bars[i].date));
  const available=matured.filter(s=>s.knownAt<=cut),same=available.filter(s=>s.state===states[i]);
  const p=estimate(same,minSamples),base=estimate(available,minSamples);
  const label=labels[i];
  if(states[i]&&label){if(p.probability!==null&&base.probability!==null)oos.push({signalDate:bars[i].date,targetDate:label.targetDate,p:p.probability,baseline:base.probability,y:label.y});matured.push({...label,state:states[i]});}
 }
 const current=states.at(-1),usable=matured.filter(s=>s.knownAt<=asOf),selected=current?usable.filter(s=>s.state===current):[];
 const evaluated=oos.filter(s=>s.targetDate<=chinaDay(asOf));
 const brier=evaluated.length?mean(evaluated.map(s=>(s.p-s.y)**2)):null,baselineBrier=evaluated.length?mean(evaluated.map(s=>(s.baseline-s.y)**2)):null;
 return {...estimate(selected,minSamples),state:current,outOfSample:{evaluated:evaluated.length,brier,baselineBrier,brierSkill:baselineBrier>0?1-brier/baselineBrier:null,method:'rolling-prediction-before-next-session-label',prospective:false}};
}
function analyzeStockHistory(stock,{asOf=Date.now(),tradeDates,minSamples=20}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||!Number.isSafeInteger(minSamples)||minSamples<20||minSamples>200)throw Error('决策时间或最少样本数无效');
 const indices=calendar(tradeDates),s=normalizeStock(stock),observed=stamp(s.observedAt),missing=[];
 if(!s.source)missing.push('MISSING_SOURCE');if(!s.priceBasis)missing.push('MISSING_PRICE_BASIS');
 if(!finite(observed)||observed>asOf)missing.push('MISSING_OR_FUTURE_OBSERVATION_TIME');
 if(s.bars.some(b=>b.priceBasis!==undefined&&b.priceBasis!==s.priceBasis))throw Error('价格口径不一致');
 if(s.bars.some(b=>!indices.has(b.date)))throw Error('K线日期不在显式交易日历');
 const bars=s.bars.filter(b=>finite(observed)&&observed<=asOf&&b.date<=chinaDay(asOf)&&closeAt(b.date)<=asOf&&finite(stamp(b.knownAt))&&stamp(b.knownAt)<=Math.min(asOf,observed)&&stamp(b.knownAt)>=closeAt(b.date));
 if(s.bars.length!==bars.length)missing.push('UNAVAILABLE_OR_UNCLOSED_BARS_EXCLUDED');
 const states=bars.map((b,i)=>missing.some(x=>x!=='UNAVAILABLE_OR_UNCLOSED_BARS_EXCLUDED')?null:stateAt(bars,i,Math.min(asOf,endAt(b.date)),indices));
 const directionLabels=bars.map((b,i)=>{const next=bars[i+1];return next&&indices.get(next.date)===indices.get(b.date)+1&&tradable(b,asOf)&&tradable(next,asOf)?{y:next.close>b.close?1:0,targetDate:next.date,knownAt:stamp(next.knownAt)}:null;});
 const limitLabels=directionLabels.map((label,i)=>{if(!label)return null;const y=limitLabel(bars[i+1],s.priceBasis,bars[i].close);return y===null?null:{...label,y};});
 const last=bars.at(-1),direction=causalStats(bars,states,directionLabels,minSamples,asOf),limitUp=causalStats(bars,states,limitLabels,minSamples,asOf);
 const nextSession=last?tradeDates[indices.get(last.date)+1]||null:null;
 return {schemaVersion:1,mode:'stock-history-intelligence',featureVersion:VERSION,...flags,symbol:s.symbol,asOf,source:s.source,priceBasis:s.priceBasis,lastBarDate:last?.date||null,targetDate:nextSession,tradeDates:[...tradeDates],minSamples,
  coverage:{provided:s.bars.length,closedKnown:bars.length,eligibleFormationStates:states.filter(Boolean).length,missing,latestFormationUsable:states.at(-1)!=null},
  patterns:detectPatterns({...s,bars}),direction,limitUp,
  uncertainty:'历史条件频率与Wilson区间；同股样本相关，非统计独立认证。样本不足不输出概率。',
  limitations:['方向标签为下个明确交易日收盘相对本日收盘，不是可成交净收益','涨停标签仅使用未复权价格和逐日预先已知的涨停价/参考价','当前市场、情绪、板块和资金上下文不回填历史样本'],inputFingerprint:hash(s)};
}
function safePath(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('存储需要私有绝对路径');
 const full=path.resolve(value);if(full===path.parse(full).root||full.split(path.sep).includes('public'))throw Error('禁止公开存储路径');
 let current=path.parse(full).root;for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('存储路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return full;
}
function readEvents(root,symbol){
 if(!/^\d{6}$/.test(String(symbol)))throw Error('股票代码无效');
 const dir=safePath(path.join(safePath(root),String(symbol)));if(!fs.existsSync(dir))return [];
 // Only published numbered files are evidence. A killed writer may leave its
 // strictly named unpublished temporary file; that cannot hide a committed chain.
 const names=fs.readdirSync(dir).filter(n=>n!=='.lock'&&!/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(n));if(names.length>MAX_EVENTS||names.some(n=>!/^\d{6}\.json$/.test(n)))throw Error('历史事件目录损坏或超过上限');
 let previousHash=null,previousDecision=0,total=0;return names.sort().map((name,i)=>{
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('历史链缺失');const file=safePath(path.join(dir,name));
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let text;
  try{const st=fs.fstatSync(fd);total+=st.size;if(!st.isFile()||st.size>MAX_FILE||total>128*1024*1024)throw Error('历史文件类型或大小无效');text=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
  const event=JSON.parse(text),{eventHash,...payload}=event;
  if(eventHash!==hash(payload)||event.schemaVersion!==1||event.revision!==i+1||event.previousHash!==previousHash||event.stock?.symbol!==String(symbol)||!Number.isSafeInteger(event.decisionAt)||event.decisionAt<previousDecision||event.canTrade!==false)throw Error('历史链完整性校验失败');
  previousHash=eventHash;previousDecision=event.decisionAt;return event;
 });
}
function frozenOutcomes(events,asOf){
 const outcomes=[],scoredTargets=new Set();
 for(const frozen of events){
  const f=frozen.forecast;if(!f||!f.targetDate||f.lastBarDate!==chinaDay(frozen.decisionAt))continue;
  // A replay supplied today cannot be promoted into a forecast made last month.
  if(frozen.recordedAt>Math.min(endAt(f.lastBarDate),frozen.decisionAt+60000))continue;
  const entry=frozen.stock.bars.find(b=>b.date===f.lastBarDate);if(!entry)continue;
  for(const later of events){
   if(later.revision<=frozen.revision||later.recordedAt<=frozen.recordedAt||later.decisionAt>asOf||later.stock.priceBasis!==frozen.stock.priceBasis||later.stock.source!==frozen.stock.source||later.stock.provider!==frozen.stock.provider)continue;
   const b=later.stock.bars.find(b=>b.date===f.targetDate),known=stamp(b?.knownAt),observed=stamp(later.stock.observedAt);
   if(!b||!finite(known)||!finite(observed)||known>observed||known<=frozen.decisionAt||known>later.decisionAt||known>asOf||known<closeAt(b.date)||!tradable(b,asOf))continue;
   for(const kind of ['direction','limitUp']){
    const p=f[kind]?.probability,y=kind==='direction'?(b.close>entry.close?1:0):limitLabel(b,later.stock.priceBasis,entry.close);
    const key=JSON.stringify([f.featureVersion,kind,b.date,frozen.stock.source,frozen.stock.provider,frozen.stock.priceBasis]);
    // Re-saving context or correcting the same forecast is not a new outcome.
    // Keep every revision, but score the first frozen prediction once per target.
    if(finite(p)&&y!==null&&!scoredTargets.has(key)){scoredTargets.add(key);outcomes.push({revision:frozen.revision,labelRevision:later.revision,kind,targetDate:b.date,probability:p,outcome:y,brier:(p-y)**2,knownAt:known,canTrade:false});}
   }
   break; // First observed outcome is immutable; later corrections remain in history.
  }
 }
 return outcomes;
}
function readStockMemory(root,symbol,{asOf=Date.now(),limit=100}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||!Number.isSafeInteger(limit)||limit<1||limit>MAX_EVENTS)throw Error('历史查询上限或时间无效');
 const events=readEvents(root,symbol).filter(e=>e.decisionAt<=asOf&&e.recordedAt<=asOf),outcomes=frozenOutcomes(events,asOf);
 return {schemaVersion:1,mode:'stock-intelligence-memory',...flags,symbol:String(symbol),asOf,totalRevisions:events.length,revisions:events.slice(-limit),frozenPredictionOutcomes:outcomes,forwardValidation:Object.fromEntries(['direction','limitUp'].map(kind=>{const rows=outcomes.filter(o=>o.kind===kind);return [kind,{evaluated:rows.length,brier:rows.length?mean(rows.map(o=>o.brier)):null}];}))};
}
function appendSnapshot(root,{stock,context={},forecast=null,decisionAt}={}){
 if(!Number.isSafeInteger(decisionAt)||decisionAt<=0||decisionAt>Date.now())throw Error('决策时点无效或位于未来');
 const s=normalizeStock(stock),observed=stamp(s.observedAt);if(!finite(observed)||observed>decisionAt||!s.source||!s.priceBasis)throw Error('历史来源、口径或原始采集时间缺失');
 if(encode(context).length>32768)throw Error('上下文超过上限');
 if(forecast){const calculated=analyzeStockHistory(s,{asOf:decisionAt,tradeDates:forecast.tradeDates,minSamples:forecast.minSamples});if(hash(forecast)!==hash(calculated))throw Error('冻结预测与历史输入不一致');forecast=calculated;}
 const privateRoot=safePath(root);fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});
 if((fs.statSync(privateRoot).mode&0o077)!==0)throw Error('存储根目录必须为私有0700目录');
 const dir=safePath(path.join(privateRoot,s.symbol));fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
 const events=readEvents(root,s.symbol),intakeHash=hash({stock:s,context,forecast,decisionAt});
  const same=events.find(e=>e.intakeHash===intakeHash);if(same)return {revision:same.revision,eventHash:same.eventHash,reused:true,...flags};
  if(events.length>=MAX_EVENTS||decisionAt<(events.at(-1)?.decisionAt||0))throw Error('历史达到上限或决策时点倒退');
  const payload={schemaVersion:1,...flags,revision:events.length+1,previousHash:events.at(-1)?.eventHash||null,intakeHash,recordedAt:Date.now(),decisionAt,stock:s,context,forecast},event={...payload,eventHash:hash(payload)},raw=encode(event);
  if(Buffer.byteLength(raw)>MAX_FILE)throw Error('历史快照超过大小上限');
  const file=path.join(dir,String(event.revision).padStart(6,'0')+'.json'),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let dest;
  // Atomic no-overwrite publication is the compare-and-swap: concurrent writers
  // can build the same next revision, but only one may link it into the chain.
  // The loser gets EEXIST and can retry against the newly committed revision.
  try{dest=fs.openSync(temp,'wx',0o600);fs.writeFileSync(dest,raw);fs.fsyncSync(dest);fs.closeSync(dest);dest=undefined;fs.linkSync(temp,file);}finally{if(dest!==undefined)fs.closeSync(dest);try{fs.unlinkSync(temp);}catch{}}
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return {revision:event.revision,eventHash:event.eventHash,reused:false,...flags};
}
module.exports={analyzeStockHistory,appendSnapshot,readStockMemory,VERSION};
