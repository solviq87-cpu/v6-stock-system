'use strict';
/**
 * One-way, read-only adaptation of an operator-supplied AUTHORIZED historical
 * dataset into forward-signal-observer's explicit market contract.
 * No network, retrospective clock substitution, quote inference or orders.
 */
const crypto=require('node:crypto');
const {validateImport}=require('./market-data-center');
const {aShareCalendarDate}=require('./a-share-calendar');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const closingCutoff=d=>Date.parse(d+'T16:00:00+08:00');
function adaptAuthorizedHistory(history,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0||!history||history.source!=='imported'||
    typeof history.provider!=='string'||!history.provider.trim()||
    typeof history.datasetId!=='string'||!history.datasetId.trim()||
    history.priceBasis!=='unadjusted'||!validDay(history.asOf)||
    !Number.isSafeInteger(history.observedAt)||history.observedAt<=0||
    history.observedAt>now||
    aShareCalendarDate(history.observedAt)!==history.asOf||
    history.observedAt<closingCutoff(history.asOf))
  throw Error('历史市场数据必须具备原始来源、未复权声明及同日16点后的上游采集时间');
 if(history.simulated===true||history.fixture===true||history.isMock===true)
  throw Error('模拟历史行情不得作为因子真实观察');
 // Full OHLCV and identical explicit trading-day bars: do not derive calendar
 // from the server clock, weekday arithmetic or current external APIs.
 const quality=validateImport(history,{
  provider:history.provider,datasetId:history.datasetId,now:history.observedAt
 });
 if(quality.lastDate!==history.asOf||quality.barsPerStock<32)
  throw Error('行情最后已知交易日与原始采集日不一致');
 const calendar=history.stocks[0].bars.map(b=>b.date);
 if(!calendar.length||calendar.at(-1)!==history.asOf)
  throw Error('行情未提供截至日真实交易日历');
 const symbols=new Set(),stocks=[];
 for(const row of history.stocks){
  const symbol=String(row.symbol??row.code??'');
  if(!/^\d{6}$/.test(symbol)||symbols.has(symbol)||
     row.symbol!==undefined&&row.code!==undefined&&row.symbol!==row.code||
     !Array.isArray(row.corporateActions))
   throw Error('股票代码、公司行为清单或重复来源无效');
  symbols.add(symbol);
  const actions=new Set();
  for(const date of row.corporateActions){
   if(!validDay(date)||date>history.asOf||!calendar.includes(date)||
      actions.has(date))throw Error('公司行为日期缺失、重复或不在原始交易日历');
   actions.add(date);
  }
  const bars=row.bars.map(b=>{
   if(b.suspended!==true&&b.suspended!==false)
    throw Error('未提供逐交易日的实际停牌状态，不得猜测停牌或有效价格');
   if(b.priceBasis!==undefined&&b.priceBasis!=='unadjusted')
    throw Error('发现非原始未复权价格');
   if(b.corporateAction&&!actions.has(b.date))
    throw Error('源K线权益变动未在股票公司行为日期清单中披露');
   if(!finite(b.close)||b.close<=0)
    throw Error('收盘价缺失，不得根据其他K线或选股分数补造');
   return {date:b.date,close:b.close,volume:b.volume,suspended:b.suspended};
  });
  stocks.push({symbol,bars,corporateActions:row.corporateActions.slice()});
 }
 const payload={
  schemaVersion:1,
  feed:{source:'imported',provider:history.provider,datasetId:history.datasetId,
   priceBasis:'unadjusted'},
  asOf:history.asOf,observedAt:history.observedAt,
  calendar,stocks,
  // Fingerprint describes supplied bytes' parsed content, NOT third-party
  // certification of collection time or provider licensing.
  externalSnapshotFingerprint:digest(history)
 };
 if(Buffer.byteLength(JSON.stringify(payload))>4*1024*1024)
  throw Error('转换后行情超过追踪器4MiB安全输入上限，必须由合法源分批');
 return payload;
}
module.exports={adaptAuthorizedHistory};
