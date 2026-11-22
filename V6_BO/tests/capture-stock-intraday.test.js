'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {captureIntraday}=require('../scripts/capture-stock-intraday');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');

const day='2026-11-20',nextDay='2026-11-23';
const afterClose=Date.parse(day+'T16:30:00+08:00');
const minutes=[...Array.from({length:120},(_,i)=>571+i),...Array.from({length:120},(_,i)=>781+i)]
 .map(n=>String(Math.floor(n/60)).padStart(2,'0')+String(n%60).padStart(2,'0'));
const json=value=>({status:200,raw:Buffer.from(JSON.stringify(value))});
function minutesResponse(code,rows=minutes.map(m=>m+' 10.00 100 1000'),tradeDate=day){
 const symbol=code.startsWith('6')?'sh'+code:'sz'+code;
 const marketDate=tradeDate.replaceAll('-',''),quote=[];
 quote[2]=code;quote[4]='9.90';quote[30]=marketDate+'161500';
 return json({code:0,data:{[symbol]:{data:{date:marketDate,data:rows},qt:{[symbol]:quote}}}});
}
function sinaResponse(changed={},tradeDate=day){
 const bars=minutes.filter(minute=>Number(minute.slice(2))%5===0).map(minute=>({
  day:tradeDate+' '+minute.slice(0,2)+':'+minute.slice(2)+':00',close:changed[minute]||'10.000'
 }));
 return {status:200,raw:Buffer.from('var series=('+JSON.stringify(bars)+');')};
}
function collect(request,{tradeDate=day,codes=['600519'],now=afterClose}={}){
 return captureIntraday({tradeDate,codes},{request,clock:()=>now,
  requestGovernor:createMarketRequestGovernor({minIntervalMs:0,maxActive:2})});
}

test('采集保留 240 个交易分钟，核对 48 个同分钟价格并忽略盘后记录',async()=>{
 const requests=[];
 const report=await collect(async url=>{
  requests.push(url);
  if(url.includes('10jqka.com.cn'))return {status:200,raw:Buffer.from('quotebridge_v6_realhead_hs_600519_last('+JSON.stringify({items:{updateTime:day+' 15:30','10':'10.00'}})+')')};
  return url.includes('gtimg.cn')?minutesResponse('600519',['0930 9.90',...minutes.map(m=>m+' 10.00'),'1530 11.00']):sinaResponse();
 });
 assert.equal(requests.length,3);
 assert.ok(requests.every(url=>new URL(url).protocol==='https:'));
 assert.equal(report.canTrade,false);
 assert.equal(report.membershipVerified,false);
 const {tencent,sina,comparison}=report.stocks[0];
 assert.equal(tencent.captured,240);
 assert.equal(tencent.priorClose,9.9);
 assert.equal(tencent.rows[0].minute,'09:31');
 assert.equal(tencent.rows.at(-1).at,Date.parse(day+'T15:00:00+08:00'));
 assert.equal(sina.captured,48);
 assert.equal(sina.identity,'requested-symbol');
 assert.equal(comparison.matches,48);
 assert.equal(comparison.closeAgrees,true);
 assert.equal(report.stocks[0].thsCloseReference.matchesBoth,true);
 assert.equal(report.stocks[0].thsCloseReference.providerUpdatedAt,Date.parse(day+'T15:30:00+08:00'));
 assert.match(tencent.sha256,/^[a-f0-9]{64}$/);
});

test('同分钟冲突原样保留，15:00 一致也不能表示整日一致',async()=>{
 const report=await collect(async url=>url.includes('gtimg.cn')?minutesResponse('600519'):sinaResponse({'0935':'10.01'}));
 const {comparison}=report.stocks[0];
 assert.equal(comparison.status,'price-disagreement');
 assert.equal(comparison.matches,47);
 assert.equal(comparison.closeAgrees,true);
 assert.deepEqual(comparison.disagreements,[{minute:'09:35',tencent:10,sina:10.01}]);
});

test('跨日、股票身份错误、重复或未来记录不能生成双源一致',async()=>{
 const wrongDay=await collect(async url=>url.includes('gtimg.cn')?minutesResponse('600519'):sinaResponse({},nextDay));
 assert.equal(wrongDay.stocks[0].sina.status,'date-mismatch');
 assert.equal(wrongDay.stocks[0].comparison.coverage,0);
 const wrongCode=await collect(async url=>url.includes('gtimg.cn')?minutesResponse('000858'):sinaResponse());
 assert.equal(wrongCode.stocks[0].tencent.status,'invalid');
 const duplicate=await collect(async url=>url.includes('gtimg.cn')?minutesResponse('600519',['0931 10.00','0931 10.01']):sinaResponse());
 assert.equal(duplicate.stocks[0].tencent.status,'invalid');
 const future=await collect(async url=>url.includes('gtimg.cn')?minutesResponse('600519'):sinaResponse(),{now:Date.parse(day+'T12:00:00+08:00')});
 assert.equal(future.stocks[0].comparison.status,'no-common-observations');
 assert.equal(future.stocks[0].sina.status,'invalid');
});

test('限制取数规模并在供应商 429 后暂停其后续请求',async()=>{
 let tencentRequests=0;
 const report=await collect(async url=>{
  if(url.includes('gtimg.cn')){tencentRequests++;return {status:429,raw:Buffer.from('')};}
  return sinaResponse();
 },{codes:['600519','000858']});
 assert.equal(tencentRequests,1);
 assert.ok(report.stocks.every(stock=>stock.tencent.status==='restricted'&&stock.sina.status==='complete'));
 await assert.rejects(collect(async()=>assert.fail('无效范围不能请求'),{codes:['600519','600519']}),/不重复/);
});
