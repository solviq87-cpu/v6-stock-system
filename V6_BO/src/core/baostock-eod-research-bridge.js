'use strict';
/**
 * Offline BaoStock *research* bundle normalizer.
 *
 * This consumes the exact documented BaoStock daily K-line, trade-calendar
 * and adjustment-factor fields exported by an operator-authorized collector.
 * It never logs in, fetches web data, derives missing company actions or
 * certifies the operator's licensing and original market timestamps.
 */
const {adaptAuthorizedHistory}=require('./factor-authorized-market-bridge');
const {aShareCalendarDate}=require('./a-share-calendar');
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const time=x=>Number.isSafeInteger(x)&&x>0;
const closeAt=d=>Date.parse(d+'T16:00:00+08:00');
const number=(x,name,{nonzero=false,integer=false}={})=>{
 const s=typeof x==='number'?String(x):x;
 if(typeof s!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)||
    (integer&&!Number.isSafeInteger(Number(s)))||!Number.isFinite(Number(s))||
    (nonzero&&Number(s)<=0))throw Error('BaoStock原始字段无效：'+name);
 return Number(s);
};
function validateQuery(q,source,dates,observedAt){
 if(!q||q.errorCode!=='0'||q.complete!==true||
    !date(q.startDate)||!date(q.endDate)||
    q.startDate>dates[0]||q.endDate<dates.at(-1)||
    !time(q.observedAt)||q.observedAt>observedAt||
    !Array.isArray(q.rows)||q.rows.length>10000||
    q.source!==source)
  throw Error('BaoStock查询失败、来源不一致或采集覆盖范围不完整');
}
function normalizeBaoStockBundle(bundle,{now=Date.now()}={}){
 if(!time(now)||bundle?.schemaVersion!==1||
    bundle.mode!=='baostock-eod-research-export-v1'||
    bundle.source!=='baostock'||bundle.completed!==true||
    typeof bundle.datasetId!=='string'||!/^[A-Za-z0-9_.:-]{3,120}$/.test(bundle.datasetId)||
    !date(bundle.asOf)||!time(bundle.observedAt)||
    bundle.observedAt>now||
    aShareCalendarDate(bundle.observedAt)!==bundle.asOf||
    bundle.observedAt<closeAt(bundle.asOf)||
    bundle.claimedProviderCertified===true||bundle.canTrade===true||
    !Array.isArray(bundle.stocks)||bundle.stocks.length<1||bundle.stocks.length>500)
  throw Error('BaoStock导出包必须具备真实本地收盘后采集时点与研究限制');
 const c=bundle.calendar;
 if(!c||c.source!=='baostock:query_trade_dates'||c.errorCode!=='0'||
    c.complete!==true||!time(c.observedAt)||c.observedAt>bundle.observedAt||
    !date(c.startDate)||!date(c.endDate)||c.endDate<bundle.asOf||
    !Array.isArray(c.tradeDates)||c.tradeDates.length<32||
    c.tradeDates.length>10000||c.tradeDates.at(-1)!==bundle.asOf||
    c.startDate>c.tradeDates[0])
  throw Error('需要独立BaoStock交易日查询结果，禁止根据工作日计算交易日');
 const dates=c.tradeDates;
 if(dates.some((d,i)=>!date(d)||(i&&d<=dates[i-1])))
  throw Error('BaoStock交易日排序、日期或唯一性无效');
 const stocks=[],symbols=new Set();
 for(const item of bundle.stocks){
  const code=item?.code;
  if(typeof code!=='string'||!/^(?:sh|sz)\.\d{6}$/.test(code)||
     symbols.has(code)||!item.kline||!item.adjust)
   throw Error('BaoStock股票代码、查询结果缺失或重复');
  symbols.add(code);
  const q=item.kline,a=item.adjust;
  validateQuery(q,'baostock:query_history_k_data_plus',dates,bundle.observedAt);
  validateQuery(a,'baostock:query_adjust_factor',dates,bundle.observedAt);
  if(q.frequency!=='d'||q.adjustflag!=='3'||q.rows.length!==dates.length)
   throw Error('BaoStock仅接受完整日线、不复权3及所有已声明交易日');
  const actions=[],actionSet=new Set();
  for(const e of a.rows){
   const d=e?.dividOperateDate;
   if(e?.code!==code||!date(d)||d>bundle.asOf||
      !dates.includes(d)||actionSet.has(d))
    throw Error('BaoStock公司行为事件来源、日期或重复记录无效');
   actionSet.add(d);actions.push(d);
  }
  actions.sort();
  const bars=q.rows.map((row,i)=>{
   if(row?.code!==code||row.date!==dates[i]||
      row.adjustflag!=='3'||!['0','1'].includes(row.tradestatus))
    throw Error('BaoStock行情代码、交易日、停牌字段或复权标志无效');
   const open=number(row.open,'open',{nonzero:true}),
    high=number(row.high,'high',{nonzero:true}),
    low=number(row.low,'low',{nonzero:true}),
    close=number(row.close,'close',{nonzero:true}),
    volume=number(row.volume,'volume',{integer:true}),
    amount=number(row.amount,'amount');
   if(high<Math.max(open,close,low)||low>Math.min(open,close)||volume>10000000000000||
      (row.tradestatus==='0'&&(volume!==0||amount!==0))||
      (row.tradestatus==='1'&&volume<=0))
    throw Error('BaoStock原始OHLCV/停牌成交量不一致');
   return {date:row.date,open,high,low,close,volume,amount,
    suspended:row.tradestatus==='0',priceBasis:'unadjusted'};
  });
  stocks.push({symbol:code.slice(3),corporateActions:actions,bars});
 }
 const history={schemaVersion:1,source:'imported',provider:'baostock',
  datasetId:bundle.datasetId,priceBasis:'unadjusted',
  asOf:bundle.asOf,observedAt:bundle.observedAt,stocks,
  evidenceProtocol:'baostock-eod-research-export-v1',
  upstreamUsageScope:'operator-review-required',
  publisherVerified:false,commercialLicenseVerified:false,
  exchangeOriginalQuoteTimeVerified:false};
 // Pass the exact same fail-closed historic and EOD gates already used by V6.
 const market=adaptAuthorizedHistory(history,{now});
 return {history,market,status:'local-research-adapted-not-certified',
  observedTimeMeaning:'operator-collection-completed-at',
  canTrade:false,productionWeightsChanged:false,
  commercialLicenseVerified:false};
}
module.exports={normalizeBaoStockBundle};
