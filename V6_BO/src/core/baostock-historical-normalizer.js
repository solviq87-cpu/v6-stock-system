'use strict';
/**
 * Bounded RESEARCH-ONLY BaoStock daily-bar adapter. Only explicit unadjusted
 * volumes in SHARES and turnover in CNY; raw collection time never becomes
 * vendor event time. Refuses suspended/missing rows instead of fabricating bars.
 */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {assessDailyTurnoverBar}=require('./daily-turnover-sanity');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const decimal=/^(?:0|[1-9]\d*)(?:\.\d+)?$/;
function amount(value,field,{integer=false,positive=false}={}){
 if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='string'&&!decimal.test(value))||
     (typeof value==='number'&&!Number.isFinite(value)))
  throw Error('BaoStock '+field+'数值无效');
 const n=Number(value);
 if(!Number.isFinite(n)||(integer&&!Number.isSafeInteger(n))||
    (positive?n<=0:n<0))throw Error('BaoStock '+field+'数值越界');
 return n;
}
function normalizeBaoStockDaily({code,rows,collectorObservedAt}={}){
 if(typeof code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(code)||
    !Array.isArray(rows)||rows.length<32||rows.length>1000)
  throw Error('BaoStock日线需要32到1000条沪深A股记录');
 if(collectorObservedAt!==undefined&&(!Number.isSafeInteger(collectorObservedAt)||collectorObservedAt<=0))
  throw Error('BaoStock采集时钟无效');
 const market=code.startsWith('6')?'sh':'sz',expected=market+'.'+code;
 const seen=new Set(),bars=[];
 for(const r of rows){
  if(!r||r.code!==expected||!validDate(r.date)||seen.has(r.date)||
      r.adjustflag!=='3'||r.tradestatus!=='1')
   throw Error('BaoStock日线代码、日期、复权或停牌状态不符');
  if(bars.length&&r.date<=bars.at(-1).date)throw Error('BaoStock日线日期非递增');
  seen.add(r.date);
  const open=amount(r.open,'开盘价',{positive:true});
  const high=amount(r.high,'最高价',{positive:true});
  const low=amount(r.low,'最低价',{positive:true});
  const close=amount(r.close,'收盘价',{positive:true});
  const volume=amount(r.volume,'成交量',{integer:true});
  const cash=amount(r.amount,'成交额');
  if(high<Math.max(open,close,low)||low>Math.min(open,close)||
     ((volume===0)!==(cash===0)))
   throw Error('BaoStock OHLC或成交量金额相互矛盾');
  // tradestatus=1 is explicit vendor evidence of an active trading day;
  // this false flag must never be inferred from positive volume alone.
  const daily={date:r.date,open,high,low,close,volume,amount:cash,suspended:false};
  if(!['in-range','no-trades'].includes(assessDailyTurnoverBar(daily).status))
   throw Error('BaoStock未复权日K成交额/股数隐含均价超出高低价范围');
  bars.push(daily);
 }
 const asOf=bars.at(-1).date;
 if(collectorObservedAt!==undefined&&
    asOf>new Date(collectorObservedAt+8*3600000).toISOString().slice(0,10))
  throw Error('BaoStock数据日期晚于采集时钟');
 const hash=crypto.createHash('sha256').update(JSON.stringify({code,rows})).digest('hex');
 const dataset={source:'imported',provider:'baostock',datasetId:'baostock-unadjusted-v1-'+hash.slice(0,20),
  asOf,volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
  priceAdjustment:{mode:'unadjusted',provider:'baostock-adjustflag-3'},
  stocks:[{code,market:code.startsWith('68')?'star':code.startsWith('30')?'chinext':'main',
   corporateActionsVerified:false,bars}]};
 validateDataset(dataset);
 return {dataset,provenance:{provider:'baostock',sourceVersion:'unadjusted-v1',
  collectorObservedAt:collectorObservedAt??null,originalVendorQuoteAt:null,
  priceBasis:'unadjusted',volumeUnit:'shares',amountUnit:'CNY',
  originalRowHash:hash,verifiedExternal:false,independentPublisherAuthenticated:false,
  canTrade:false,warning:'BaoStock字段文档的成交量单位为股，成交额为人民币元；只做离线研究，停牌日拒绝合成交易K线'}};
}
module.exports={normalizeBaoStockDaily};
