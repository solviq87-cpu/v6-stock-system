'use strict';
// Content observations are evidence of receipt, never proof of historical availability.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_REVISIONS=500,MAX_BARS=500,MAX_BYTES=512*1024,MAX_TOTAL_BYTES=128*1024*1024;
const flags={researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false,predictiveUseVerified:false};
const priceFields=['open','high','low','close','volume','amount','source','provider','priceBasis'];
const groups=[
 {fields:['suspended','tradable','isST','market','ipoNoLimit'],time:'statusKnownAt'},
 {fields:['corporateAction'],time:'corporateActionKnownAt'},
 {fields:['limitUpPrice','limitReferencePrice','noPriceLimit','limitPct'],time:'limitKnownAt'}
];
const times=['knownAt','priceKnownAt','amountKnownAt','firstObservedAt',...groups.map(g=>g.time)];
const allowed=new Set(['date',...priceFields,...groups.flatMap(g=>g.fields),...times,'provenance','derivation']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function stamp(x){const n=Number.isSafeInteger(x)?x:typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;return Number.isSafeInteger(n)&&n>0?n:NaN;}
function canonical(x,depth=0){
 if(depth>16)throw Error('观察数据嵌套过深');
 if(x===null||typeof x==='string'||typeof x==='boolean'||finite(x))return x;
 if(Array.isArray(x))return x.map(v=>canonical(v,depth+1));
 if(x&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
  const out={};for(const k of Object.keys(x).sort()){if(['__proto__','constructor','prototype'].includes(k))throw Error('观察数据键无效');if(x[k]!==undefined)out[k]=canonical(x[k],depth+1);}return out;
 }
 throw Error('观察数据必须是有限JSON值');
}
const encode=x=>JSON.stringify(canonical(x));
const hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]]));
function text(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+'无效');return value.trim();}
function identity(symbol,provider,priceBasis){
 if(!/^\d{6}$/.test(String(symbol||'')))throw Error('股票代码无效');
 provider=text(provider,'提供者');if(!['unadjusted','forward-adjusted'].includes(priceBasis))throw Error('价格口径无效');
 return {symbol:String(symbol),provider,priceBasis};
}
function privatePath(value,{create=false}={}){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('存储需要私有绝对路径');
 const full=path.resolve(value);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('禁止公开存储路径');
 let cursor=path.parse(full).root;
 for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);try{const st=fs.lstatSync(cursor);if(st.isSymbolicLink()||!st.isDirectory())throw Error('存储路径禁止符号链接或非目录');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)&&(fs.statSync(full).mode&0o077)!==0)throw Error('存储目录必须为私有0700');
 return full;
}
function location(root,id,create=false){
 const base=privatePath(root,{create}),symbol=privatePath(path.join(base,id.symbol),{create});
 return privatePath(path.join(symbol,hash([id.provider,id.priceBasis])),{create});
}
function validateStock(input,observedAt){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('股票观察无效');
 const id=identity(input.symbol||input.code,input.provider,input.priceBasis),source=text(input.source,'来源');
 if(!Array.isArray(input.bars)||!input.bars.length||input.bars.length>MAX_BARS)throw Error('观察K线需要1至500根');
 if(input.name!==undefined&&(typeof input.name!=='string'||input.name.length>64))throw Error('股票名称无效');
 const raw=canonical(input);if(Buffer.byteLength(encode(raw))>MAX_BYTES)throw Error('原始观察超过大小上限');
 const today=new Date(observedAt+8*3600000).toISOString().slice(0,10);let previous='';
 for(const b of raw.bars){
  if(!b||!day(b.date)||b.date<=previous||b.date>today||Object.keys(b).some(k=>!allowed.has(k)))throw Error('K线日期、顺序或字段无效');previous=b.date;
  if(!['open','high','low','close','volume'].every(k=>finite(b[k]))||Math.min(b.open,b.low,b.close)<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||!Number.isSafeInteger(b.volume)||b.volume<0)throw Error('OHLCV无效');
  if(b.amount!==undefined&&(!finite(b.amount)||b.amount<0))throw Error('成交额无效');
  for(const k of ['suspended','tradable','isST','ipoNoLimit','corporateAction','noPriceLimit'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw Error('交易状态无效');
  for(const k of ['limitUpPrice','limitReferencePrice','limitPct'])if(b[k]!==undefined&&(!finite(b[k])||b[k]<=0))throw Error('涨跌幅限制无效');
  for(const k of ['source','provider','market'])if(b[k]!==undefined)text(b[k],k);
  if(b.priceBasis!==undefined&&b.priceBasis!==id.priceBasis)throw Error('逐日价格口径不一致');
  for(const k of times)if(b[k]!==undefined&&(!finite(stamp(b[k]))||stamp(b[k])>observedAt))throw Error('观察已知时点无效');
  for(const k of ['provenance','derivation'])if(b[k]!==undefined&&Buffer.byteLength(encode(b[k]))>8192)throw Error('逐日来源声明超过上限');
 }
 return {id,raw,source};
}
function checkClaim(input,key,observedAt,old,unchanged){
 if(input[key]!==undefined&&stamp(input[key])!==observedAt&&!(unchanged&&old&&stamp(input[key])===old[key]))throw Error('禁止将新观察的'+key+'倒填为历史时点');
}
function project(raw,observedAt,prior){
 const bars=new Map((prior?.bars||[]).map(b=>[b.date,b]));
 for(const input of raw.bars){
  const old=bars.get(input.date),origin={source:input.source===undefined?raw.source.trim():input.source.trim(),provider:input.provider===undefined?raw.provider.trim():input.provider.trim(),priceBasis:raw.priceBasis};
  // Both the enclosing identity and this bar's origin must agree. Otherwise an
  // omitted field could relabel another provider's state as same-source evidence.
  const sameOrigin=!!old&&raw.source.trim()===prior.source&&raw.provider.trim()===prior.provider&&raw.priceBasis===prior.priceBasis&&['source','provider','priceBasis'].every(k=>old[k]===origin[k]);
  const inherited=sameOrigin?old:{},next={...inherited,...pick(input,['date',...priceFields]),...origin};
  const samePrice=sameOrigin&&encode(pick(next,priceFields))===encode(pick(old,priceFields));
  checkClaim(input,'knownAt',observedAt,old,samePrice);
  checkClaim(input,'firstObservedAt',observedAt,old,samePrice);
  const priceSame=sameOrigin&&encode(pick(next,priceFields.filter(k=>k!=='amount')))===encode(pick(old,priceFields.filter(k=>k!=='amount')));
  const amountSame=sameOrigin&&old&&next.amount===old.amount;
  checkClaim(input,'priceKnownAt',observedAt,old,priceSame);
  checkClaim(input,'amountKnownAt',observedAt,old,amountSame);
  next.priceKnownAt=priceSame?old.priceKnownAt:observedAt;
  if(next.amount!==undefined)next.amountKnownAt=amountSame?old.amountKnownAt:observedAt;
  next.knownAt=samePrice?old.knownAt:observedAt;
  next.firstObservedAt=samePrice?old.firstObservedAt:observedAt;
  for(const group of groups){
   const values={...pick(inherited,group.fields),...pick(input,group.fields)},has=Object.keys(values).length>0;
   const unchanged=sameOrigin&&encode(values)===encode(pick(old||{},group.fields));
   checkClaim(input,group.time,observedAt,old,unchanged);
   Object.assign(next,values);if(has)next[group.time]=unchanged?old[group.time]:observedAt;
   else if(input[group.time]!==undefined)throw Error('已知时点缺少对应状态证据');
  }
  // Repeated receipt does not overwrite the first raw declaration for an unchanged value.
  for(const k of ['provenance','derivation']){if(!samePrice)delete next[k];if(input[k]!==undefined&&(!samePrice||next[k]===undefined))next[k]=input[k];}
  bars.set(input.date,next);
 }
 if(bars.size>MAX_BARS)throw Error('同一身份累计K线超过500根');
 return {symbol:String(raw.symbol||raw.code),name:raw.name===undefined?(prior?.name||''):String(raw.name).slice(0,64),source:raw.source.trim(),provider:raw.provider.trim(),priceBasis:raw.priceBasis,observedAt,bars:[...bars.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
function content(stock){const {observedAt,...values}=stock;return values;}
function readChain(root,id,{asOf}={}){
 // Validate the complete immutable chain, but retain only the projection needed
 // for the next revision and small query metadata. Full historical events can
 // exceed the research worker's heap even while the archive is below its cap.
 const state={lastEvent:null,latestVisibleEvent:null,observations:[],count:0,totalBytes:0};
 const dir=location(root,id);if(!fs.existsSync(dir))return state;
 const names=fs.readdirSync(dir).filter(n=>!/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(n));
 if(names.length>MAX_REVISIONS||names.some(n=>!/^\d{6}\.json$/.test(n)))throw Error('观察历史目录损坏或超过上限');
 let previous=null;
 for(const [i,name]of names.sort().entries()){
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('观察历史链缺失');
  const file=path.join(dir,name),lst=fs.lstatSync(file);if(lst.isSymbolicLink()||!lst.isFile()||(lst.mode&0o077)!==0)throw Error('观察文件必须为私有0600普通文件');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let raw;
  try{const st=fs.fstatSync(fd);state.totalBytes+=st.size;if(st.size>MAX_BYTES||state.totalBytes>MAX_TOTAL_BYTES)throw Error('观察历史超过大小上限');raw=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
  const event=JSON.parse(raw),{observationHash,...payload}=event;
  if(hash(payload)!==observationHash||event.schemaVersion!==1||event.revision!==i+1||event.previousHash!==(previous?.observationHash||null)||encode(event.identity)!==encode(id)||!Number.isSafeInteger(event.observedAt)||event.observedAt<=0||!Number.isSafeInteger(event.recordedAt)||event.recordedAt<event.observedAt||previous&&(event.observedAt<previous.observedAt||event.recordedAt<previous.recordedAt)||Object.keys(flags).some(k=>event[k]!==flags[k]))throw Error('观察历史完整性校验失败');
  const validated=validateStock(event.rawStock,event.observedAt);if(encode(validated.id)!==encode(id)||encode(project(validated.raw,event.observedAt,previous?.stock))!==encode(event.stock))throw Error('观察历史投影校验失败');
  state.count++;state.lastEvent=event;previous=event;
  if(asOf!==undefined&&event.observedAt<=asOf&&event.recordedAt<=asOf){
   const {revision,observedAt,recordedAt,observationHash}=event;
   state.observations.push({revision,observedAt,recordedAt,observationHash});
   state.latestVisibleEvent={revision,stock:event.stock};
  }
 }
 return state;
}
function retainStockObservation(root,{stock,observedAt,context={}}={}){
 if(!Number.isSafeInteger(observedAt)||observedAt<=0||observedAt>Date.now())throw Error('观察时间无效或位于未来');
 const {id,raw}=validateStock(stock,observedAt),safeContext=canonical(context);
 if(Buffer.byteLength(encode(safeContext))>32768)throw Error('观察上下文超过上限');
 const dir=location(root,id,true);
 for(let attempt=0;attempt<5;attempt++){
  const state=readChain(root,id),last=state.lastEvent;
  if(last&&observedAt<last.observedAt)throw Error('观察时点不得倒退');
  const next=project(raw,observedAt,last?.stock);
  if(last&&encode(content(next))===encode(content(last.stock)))return {stock:last.stock,changed:false,revision:last.revision,observationHash:last.observationHash,...flags};
  if(state.count>=MAX_REVISIONS)throw Error('观察版本达到500上限');
  const recordedAt=Date.now();if(last&&recordedAt<last.recordedAt)throw Error('记录时钟倒退');
  const payload={schemaVersion:1,...flags,identity:id,revision:state.count+1,previousHash:last?.observationHash||null,observedAt,recordedAt,rawStock:raw,stock:next,context:safeContext};
  const observationHash=hash(payload),serialized=encode({...payload,observationHash});
  if(Buffer.byteLength(serialized)>MAX_BYTES||state.totalBytes+Buffer.byteLength(serialized)>MAX_TOTAL_BYTES)throw Error('观察档案超过大小上限');
  const file=path.join(dir,String(payload.revision).padStart(6,'0')+'.json'),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd,conflict=false;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}
  catch(e){if(e.code==='EEXIST')conflict=true;else throw e;}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(conflict)continue;
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return {stock:next,changed:true,revision:payload.revision,observationHash,...flags};
 }
 throw Error('观察并发发布冲突，请稍后重试');
}
function readObservedStock(root,symbol,{provider,priceBasis,asOf=Date.now()}={}){
 const id=identity(symbol,provider,priceBasis);if(!Number.isSafeInteger(asOf)||asOf<=0)throw Error('观察查询时点无效');
 const state=readChain(root,id,{asOf}),latest=state.latestVisibleEvent;
 return {stock:latest?.stock||null,revision:latest?.revision||0,observationCount:state.observations.length,observations:state.observations,...flags};
}
module.exports={retainStockObservation,readObservedStock};
