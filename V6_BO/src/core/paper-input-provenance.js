'use strict';
// Describe the inputs the paper engine actually used, without certifying the feed.
const validTime=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15;
const at=v=>validTime(v)?v:null;
const clip=(v,n)=>typeof v==='string'?v.slice(0,n):null;
function boundedJson(value){
 const seen=new Set();let nodes=0;
 function walk(v,depth){
  if(++nodes>200||depth>8)throw Error('成交字段来源超出边界');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v==='string'&&v.length<=240)return;
  if(!v||typeof v!=='object'||Array.isArray(v)||seen.has(v))throw Error('成交字段来源不是受限JSON');
  seen.add(v);for(const [key,item] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))throw Error('成交字段来源键无效');walk(item,depth+1);}seen.delete(v);
 }
 walk(value,0);if(Buffer.byteLength(JSON.stringify(value),'utf8')>8192)throw Error('成交字段来源超过8KiB');
}
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===allowed.length&&allowed.every(k=>Object.hasOwn(v,k));
const recordKeys=['origin','source','sourceTruncated','mode','modeTruncated','quoteAt','receivedAt','rowQuoteAt','rowReceivedAt','timeScope'];
function validOrigin(v,price=false){
 return v&&v.origin==='S.stocks'&&(price?v.timeScope==='price-observation':v.timeScope==='row-metadata-only')&&
  (v.source===null||typeof v.source==='string'&&v.source.length<=80)&&typeof v.sourceTruncated==='boolean'&&
  (v.mode===null||typeof v.mode==='string'&&v.mode.length<=80)&&typeof v.modeTruncated==='boolean'&&
  [v.quoteAt,v.receivedAt,v.rowQuoteAt,v.rowReceivedAt].every(t=>t===null||validTime(t))&&
  (price||v.quoteAt===null&&v.receivedAt===null);
}
function validateInputProvenance(value,expected={}){
 boundedJson(value);
 if(!keys(value,['schemaVersion','mode','independentlyVerified','price','volume','limits','status'])||value.schemaVersion!==1||
  value.mode!=='paper-input-audit'||value.independentlyVerified!==false)throw Error('成交字段来源版本或结构无效');
 const {price,volume,limits,status}=value;
 const priceOrigin=price?.origin==='S.lastPx'?{...price,origin:'S.stocks'}:price;
 if(!keys(price,[...recordKeys,'value'])||!validOrigin(priceOrigin,true)||
  !['S.lastPx','S.stocks'].includes(price.origin)||!Number.isFinite(price.value)||price.value<=0||!validTime(price.quoteAt)||
  price.rowQuoteAt!==price.quoteAt||price.rowReceivedAt!==price.receivedAt||
  !keys(volume,[...recordKeys,'value','rawValue','rawUnit','unit','calculation'])||!validOrigin(volume)||
  !Number.isFinite(volume.rawValue)||volume.rawValue<=0||volume.value!==volume.rawValue*100||
  volume.rawUnit!=='engine-100-share-lot'||volume.unit!=='shares'||volume.calculation!=='rawValue * 100'||
  !keys(limits,['upperLimit','lowerLimit','preClose','rule','calculation'])||
  !keys(limits.preClose,[...recordKeys,'value','rawValue','rawTruncated'])||!validOrigin(limits.preClose)||
  !Number.isFinite(limits.preClose.value)||limits.preClose.value<=0||
  !['number','string','boolean'].includes(typeof limits.preClose.rawValue)||typeof limits.preClose.rawTruncated!=='boolean'||
  (typeof limits.preClose.rawValue==='string'&&limits.preClose.rawValue.length>120)||
  (!limits.preClose.rawTruncated&&Number(limits.preClose.rawValue)!==limits.preClose.value)||
  !keys(limits.rule,['method','code','name','nameTruncated','limitPct'])||limits.rule.method!=='limitPctOfCode(code,name)'||
  !/^\d{6}$/.test(limits.rule.code)||!(limits.rule.name===null||typeof limits.rule.name==='string'&&limits.rule.name.length<=120)||
  typeof limits.rule.nameTruncated!=='boolean'||!Number.isFinite(limits.rule.limitPct)||limits.rule.limitPct<=0||
  limits.calculation!=='Math.round(preClose * (1 +/- limitPct) * 100) / 100'||
  limits.upperLimit!==Math.round(limits.preClose.value*(1+limits.rule.limitPct)*100)/100||
  limits.lowerLimit!==Math.round(limits.preClose.value*(1-limits.rule.limitPct)*100)/100||
  !keys(status,['suspended','tradable']))throw Error('成交字段来源内容无效');
 for(const key of ['suspended','tradable']){
  const row=status[key];
  if(!keys(row,[...recordKeys,'value','rawBoolean','rawType','present','defaulted'])||!validOrigin(row)||
   typeof row.value!=='boolean'||typeof row.present!=='boolean'||typeof row.defaulted!=='boolean'||
   !['undefined','null','boolean','number','string','object','array','function','bigint','symbol'].includes(row.rawType)||
   !(row.rawBoolean===null||typeof row.rawBoolean==='boolean')||
   row.defaulted!==(row.rawType!=='boolean')||(row.rawType==='boolean')!==(row.rawBoolean!==null)||
   row.value!==(key==='suspended'?row.rawBoolean===true:row.rawBoolean!==false))throw Error('成交状态字段来源无效');
 }
 const actual={symbol:limits.rule.code,provider:price.source,price:price.value,quoteAt:price.quoteAt,receivedAt:price.receivedAt,
  volume:volume.value,upperLimit:limits.upperLimit,lowerLimit:limits.lowerLimit,suspended:status.suspended.value,tradable:status.tradable.value};
 for(const [key,v] of Object.entries(expected))if(v!==undefined&&actual[key]!==v)throw Error('成交字段来源与受检输入不一致');
 return value;
}
function createAutomaticInputProvenance({stock,observation,priceOrigin,limitPct}){
 const row=(input,origin,timeScope)=>({origin,source:clip(input.quoteSource,80),sourceTruncated:typeof input.quoteSource==='string'&&input.quoteSource.length>80,
  mode:clip(input.quoteMode||input.mode,80),modeTruncated:typeof (input.quoteMode||input.mode)==='string'&&(input.quoteMode||input.mode).length>80,
  quoteAt:timeScope==='price-observation'?at(input.quoteAt):null,receivedAt:timeScope==='price-observation'?at(input.receivedAt):null,
  rowQuoteAt:at(input.quoteAt),rowReceivedAt:at(input.receivedAt),timeScope});
 const origin=row(stock,'S.stocks','row-metadata-only'),previous=Number(stock.preClose);
 const status=key=>{const raw=stock[key],rawType=raw===null?'null':Array.isArray(raw)?'array':typeof raw;return {...origin,
  value:key==='suspended'?raw===true:raw!==false,rawBoolean:typeof raw==='boolean'?raw:null,rawType,
  present:Object.hasOwn(stock,key),defaulted:typeof raw!=='boolean'};};
 const value={schemaVersion:1,mode:'paper-input-audit',independentlyVerified:false,price:{...row(observation,priceOrigin,'price-observation'),value:Number(observation.price)},
  volume:{...origin,value:stock.volume*100,rawValue:stock.volume,rawUnit:'engine-100-share-lot',unit:'shares',calculation:'rawValue * 100'},
  limits:{upperLimit:Math.round(previous*(1+limitPct)*100)/100,lowerLimit:Math.round(previous*(1-limitPct)*100)/100,
   preClose:{...origin,value:previous,rawValue:typeof stock.preClose==='string'?stock.preClose.slice(0,120):stock.preClose,
    rawTruncated:typeof stock.preClose==='string'&&stock.preClose.length>120},
   rule:{method:'limitPctOfCode(code,name)',code:stock.code,name:clip(stock.name,120),nameTruncated:typeof stock.name==='string'&&stock.name.length>120,limitPct},
   calculation:'Math.round(preClose * (1 +/- limitPct) * 100) / 100'},
  status:{suspended:status('suspended'),tradable:status('tradable')}};
 // Validate on the fill boundary; do not serialize every unused full-market quote.
 return value;
}
module.exports={createAutomaticInputProvenance,validateInputProvenance};
