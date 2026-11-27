'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../config/research-calendar-2026.json');
const {fetchEastmoneyHistory,parseKlines}=require('../src/core/eastmoney-historical-feed');
const {normalizeBaoStockDaily}=require('../src/core/baostock-historical-normalizer');
const {partitionBaoStockRows,auditDailySessionCoverage}=require('../src/core/a-share-session-coverage');
const CODE='600000';
const dates=calendar.sessions.filter(s=>s.open&&s.date<='2026-11-13').map(s=>s.date).slice(-38);
const LAST=dates.at(-1);
const at=(d,t)=>Date.parse(d+'T'+t+'+08:00');
const BEFORE=at(LAST,'15:09:59'),AFTER=at(LAST,'15:10:00'),REVIEW=at('2026-11-15','12:00:00');
const em=(ds=dates)=>({data:{code:CODE,name:'test',klines:ds.map(d=>[d,'10','10','11','9','100','100000'].join(','))}});
const rsp=(payload,extra={})=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(payload),...extra});
const bs=(ds=dates)=>ds.map(date=>({date,code:'sh.'+CODE,open:'10',high:'11',low:'9',close:'10',volume:'10000',amount:'100000',adjustflag:'3',tradestatus:'1'}));
const halted=date=>({...bs([date])[0],tradestatus:'0',open:'',close:'',high:'',low:'',volume:'0',amount:'0'});
const opts=(now,fetchImpl,extra={})=>({symbols:[CODE],start:dates[0],end:LAST,now,fetchImpl,...extra});
const normalize=(rows=bs(),extra={})=>normalizeBaoStockDaily({code:CODE,rows,collectorObservedAt:REVIEW,now:REVIEW,...extra});
const partition=(rows,extra={})=>partitionBaoStockRows({code:CODE,rows,collectorObservedAt:REVIEW,now:REVIEW,...extra});

test('Eastmoney daily response identity must be the exact string security code',()=>{
 for(const wrong of [600000,[CODE],{toString:()=>CODE},CODE+' ']){
  const x=em();x.data.code=wrong;assert.throws(()=>parseKlines(x,CODE),/代码/);
 }
 assert.equal(parseKlines(em(),CODE).code,CODE);
});
test('Eastmoney decimal fields reject coercible hex, exponent, sign and whitespace',()=>{
 for(const [index,value] of [[1,'0xA'],[2,'1e1'],[3,'+11'],[4,' 9 '],[5,'0x64'],[6,'1e5']]){
  const x=em(),r=x.data.klines[0].split(',');r[index]=value;x.data.klines[0]=r.join(',');
  assert.throws(()=>parseKlines(x,CODE),/OHLCV|成交额/);
 }
 const x=em();x.data.klines[0]=[dates[0],'10.00','10.00','11.00','9.00','0','0.00'].join(',');
 const r=parseKlines(x,CODE).bars[0];assert.equal(r.volume,0);assert.equal(r.amount,0);
});
test('fractional lots convert exactly to integer shares, not binary float or rounded sub-shares',()=>{
 for(const [lots,shares] of [['0.29',29],['1.2300',123],['0.01',1]]){
  const x=em(),r=x.data.klines[0].split(',');r[5]=lots;r[6]=String(shares*10);x.data.klines[0]=r.join(',');
  assert.equal(parseKlines(x,CODE).bars[0].volume,shares);
 }
 for(const lots of ['0.001','1.23001','90071992547410']){
  const x=em(),r=x.data.klines[0].split(',');r[5]=lots;x.data.klines[0]=r.join(',');
  assert.throws(()=>parseKlines(x,CODE),/OHLCV|成交额/);
 }
});
test('Eastmoney history rejects hidden redirects and non-200 success before reading bytes',async()=>{
 for(const extra of [{status:206},{status:201},{status:undefined},{redirected:true},{type:'opaqueredirect'},{url:'https://other.example.invalid/history'}]){
  let reads=0,calls=0;
  await assert.rejects(()=>fetchEastmoneyHistory(opts(REVIEW,async()=>{calls++;return rsp(em(),{...extra,text:async()=>{reads++;return JSON.stringify(em());}});})),/HTTP|重定向/);
  assert.equal(calls,1);assert.equal(reads,0);
 }
 const r=await fetchEastmoneyHistory(opts(REVIEW,async()=>rsp(em())));
 assert.equal(r.dataset.stocks[0].bars.length,dates.length);assert.equal(r.metadata.canTrade,false);
});
test('declared oversized daily response is refused before body read',async()=>{
 let reads=0;
 await assert.rejects(()=>fetchEastmoneyHistory(opts(REVIEW,async()=>rsp(em(),{headers:{get:k=>k==='content-length'?'2048':null},text:async()=>{reads++;return '{}';}}),{maxBytes:1024})),/超过大小限制/);
 assert.equal(reads,0);
});
test('Eastmoney history start clock is integer milliseconds, not an implicit Date conversion',async()=>{
 let calls=0;
 for(const clock of [String(REVIEW),new Date(REVIEW),REVIEW+.5,NaN,null,0,-1]){
  await assert.rejects(()=>fetchEastmoneyHistory(opts(clock,async()=>{calls++;return rsp(em());})),/时钟/);
 }
 assert.equal(calls,0);
});
test('a request begun before 15:10 cannot admit its same-day daily bar during later processing',async()=>{
 await assert.rejects(()=>fetchEastmoneyHistory(opts(BEFORE,async()=>rsp(em()))),/15:10/);
 const good=await fetchEastmoneyHistory(opts(AFTER,async()=>rsp(em())));
 assert.equal(good.dataset.asOf,LAST);assert.equal(good.metadata.verifiedLive,false);
});
test('prior-day history can still be used before close without inventing a same-day bar',async()=>{
 const prior=dates.slice(0,-1),r=await fetchEastmoneyHistory(opts(BEFORE,async()=>rsp(em(prior))));
 assert.equal(r.dataset.asOf,prior.at(-1));assert.equal(r.dataset.stocks[0].bars.length,prior.length);
 assert.equal(r.dataset.volumeUnit,'shares');assert.equal(r.dataset.amountUnit,'CNY');
});
test('BaoStock original intraday daily capture cannot be promoted by a later audit',()=>{
 assert.throws(()=>normalize(bs(),{collectorObservedAt:BEFORE}),/15:10/);
 const r=normalize(bs(),{collectorObservedAt:AFTER});
 assert.equal(r.dataset.asOf,LAST);assert.equal(r.provenance.collectorObservedAt,AFTER);
 assert.equal(r.provenance.originalVendorQuoteAt,null);assert.equal(r.provenance.canTrade,false);
});
test('BaoStock missing collector time stays unknown and never admits same-day or future data',()=>{
 const prior=bs(dates.slice(0,-1));
 const r=normalize(prior,{collectorObservedAt:undefined,now:BEFORE});
 assert.equal(r.provenance.collectorObservedAt,null);
 assert.throws(()=>normalize(bs(),{collectorObservedAt:undefined,now:BEFORE}),/采集时间|完成度/);
 assert.throws(()=>normalize(bs(),{collectorObservedAt:undefined,now:at(dates.at(-2),'16:00:00')}),/未来|完成度/);
});
test('BaoStock rejects an invalid audit clock and collector observations after the audit',()=>{
 for(const now of [NaN,0,REVIEW+.5,String(REVIEW)]){
  assert.throws(()=>normalize(bs(),{now}),/时钟/);
 }
 assert.throws(()=>normalize(bs(),{collectorObservedAt:REVIEW+1}),/时钟/);
 assert.equal(normalize().dataset.stocks[0].bars.length,dates.length);
});
test('BaoStock partition refuses out-of-order status rows and future trading rows without receipt time',()=>{
 const early=dates[0],late=dates[1];
 assert.throws(()=>partition([bs([late])[0],halted(early)]),/顺序|日期/);
 assert.throws(()=>partition([bs(['2026-11-16'])[0]],{collectorObservedAt:undefined}),/日期/);
 assert.equal(partition([bs([early])[0]],{collectorObservedAt:undefined}).tradingRows.length,1);
});
test('daily trading and suspension rows require original same-day closing evidence',()=>{
 for(const r of [bs([LAST])[0],halted(LAST)]){
  assert.throws(()=>partition([r],{collectorObservedAt:BEFORE}),/15:10/);
 }
 const traded=partition([bs([LAST])[0]],{collectorObservedAt:AFTER});
 assert.equal(traded.tradingRows.length,1);assert.equal(traded.suspensions.length,0);
 const suspension=partition([halted(LAST)],{collectorObservedAt:AFTER});
 assert.equal(suspension.tradingRows.length,0);assert.equal(suspension.suspensions[0].observedAt,AFTER);
 assert.equal(suspension.suspensions[0].exchangeVerified,false);assert.equal(suspension.canTrade,false);
});
test('a caller cannot bypass partition and explain a missing open day using an intraday halt claim',()=>{
 const missing=dates[15],d=normalize(bs(dates.filter(x=>x!==missing))).dataset;
 const evidence={symbol:CODE,date:missing,source:'baostock',providerStatus:'suspended',observedAt:at(missing,'10:00:00')};
 assert.throws(()=>auditDailySessionCoverage(d,{now:REVIEW,suspensions:[evidence]}),/15:10/);
 const r=auditDailySessionCoverage(d,{now:REVIEW,suspensions:[{...evidence,observedAt:at(missing,'15:10:00')}]});
 assert.equal(r.status,'provider-declared-halts-unverified');assert.equal(r.providerDeclaredSuspensionDays,1);
 assert.equal(r.completeByProviderEvidence,true);assert.equal(r.canTrade,false);
 assert.equal(d.stocks[0].bars.some(x=>x.date===missing),false);
});
