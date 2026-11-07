'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {fetchEastmoneyHistory,parseKlines,secId}=require('../src/core/eastmoney-historical-feed');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10));
function payload(symbol,days=dates){return {data:{code:symbol,name:'样本',klines:days.map((d,i)=>`${d},${(10+i*.1).toFixed(2)},${(10+i*.1).toFixed(2)},${(10+i*.1+.2).toFixed(2)},${(10+i*.1-.2).toFixed(2)},10000,100000`)}};}
const response=p=>({ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},body:Readable.from([Buffer.from(JSON.stringify(p))])});
test('沪深证券代码必须显式映射，未知交易所不能冒充市场代码',()=>{
 assert.equal(secId('000001'),'0.000001');assert.equal(secId('600000'),'1.600000');assert.equal(secId('688001'),'1.688001');assert.throws(()=>secId('830001'),/只支持/);
});
test('公开日线获取器将供应商返回值转换为完整导入格式但保持未认证状态',async()=>{
 const r=await fetchEastmoneyHistory({symbols:['000001','600000'],start:dates[0],end:dates.at(-1),fetchImpl:async(url)=>{
  const symbol=new URL(url).searchParams.get('secid').split('.')[1];return response(payload(symbol));
 }});
 assert.equal(r.dataset.stocks.length,2);assert.equal(r.dataset.priceAdjustment.mode,'qfq');assert.equal(r.dataset.source,'imported');
 assert.equal(r.metadata.verifiedLive,false);assert.equal(r.metadata.canTrade,false);
});
test('拒绝日期错位，绝不合成停牌交易日填平缺口',async()=>{
 await assert.rejects(()=>fetchEastmoneyHistory({symbols:['000001','600000'],start:dates[0],end:dates.at(-1),fetchImpl:async(url)=>{
  const symbol=new URL(url).searchParams.get('secid').split('.')[1];return response(payload(symbol,symbol==='600000'?dates.filter((_,i)=>i!==15):dates));
 }}),/交易日不一致/);
});
test('响应代码冒用、异常高低价、请求未来日期、超长响应均拒绝',async()=>{
 assert.throws(()=>parseKlines(payload('000001'),'600000'),/代码/);
 const broken=payload('000001');broken.data.klines[2]=`${dates[2]},10,20,12,9,10000`;
 assert.throws(()=>parseKlines(broken,'000001'),/OHLCV/);
 await assert.rejects(()=>fetchEastmoneyHistory({symbols:['000001'],start:dates[0],end:'2099-01-01',fetchImpl:async()=>response(payload('000001'))}),/未来/);
 await assert.rejects(()=>fetchEastmoneyHistory({symbols:['000001'],start:dates[0],end:dates.at(-1),maxBytes:1024,fetchImpl:async()=>response(payload('000001'))}),/超过大小/);
});


test('reject impossible calendar dates instead of normalizing them',()=>{
 for(const invalidDate of ['2025-02-29','2025-02-30','2025-13-01']){
  const broken=payload('000001');
  const i=broken.data.klines.length-1;
  broken.data.klines[i]=broken.data.klines[i].replace(/^\d{4}-\d{2}-\d{2}/,invalidDate);
  assert.throws(()=>parseKlines(broken,'000001'),/日期无效/);
 }
});
