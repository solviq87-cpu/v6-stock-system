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
 assert.equal(r.dataset.volumeUnit,'shares');
 assert.equal(r.dataset.amountUnit,'CNY');
 assert.equal(r.dataset.amountBasis,'actual-unadjusted-turnover');
 assert.equal(r.dataset.stocks[0].bars[0].volume,1000000,'f56 hands must become shares');
 assert.equal(r.dataset.stocks[0].bars[0].amount,100000,'f57 amount stays CNY, not multiplied');
 assert.match(r.dataset.datasetId,/^em-qfq-v2-/);
 assert.equal(r.metadata.volumeUnit,'shares');
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


test('Eastmoney f56 hands and f57 yuan are captured without synthetic prices or turnover',()=>{
 const fixture=payload('600000');
 fixture.data.klines[0]=`${dates[0]},10,10.5,11,9,123,128500`;
 const parsed=parseKlines(fixture,'600000');
 assert.equal(parsed.bars[0].volume,12300);
 assert.equal(parsed.bars[0].amount,128500);
 assert.equal(parsed.bars[0].open,10);
 assert.equal(parsed.bars[0].close,10.5);
 assert.equal(parsed.bars[0].date,dates[0]);
});
test('missing, nonnumeric, contradictory or overflow turnover/volume fails closed',()=>{
 const changes=[
  `${dates[0]},10,10,11,9,123`,                 // f57 never returned
  `${dates[0]},10,10,11,9,123,`,                // missing f57
  `${dates[0]},10,10,11,9,123,bad`,
  `${dates[0]},10,10,11,9,123,-1`,
  `${dates[0]},10,10,11,9,0,10000`,
  `${dates[0]},10,10,11,9,123,0`,
  `${dates[0]},10,10,11,9,900719925474100,100000`
 ];
 for(const row of changes){
  const p=payload('000001');
  p.data.klines[0]=row;
  assert.throws(()=>parseKlines(p,'000001'),/OHLCV|成交额/,row);
 }
 const p=payload('000001');
 p.data.klines[0]=`${dates[0]},10,10,11,9,0,0`;
 const parsed=parseKlines(p,'000001');
 assert.equal(parsed.bars[0].volume,0,'zero-volume day stays zero; never invent shares');
 assert.equal(parsed.bars[0].amount,0);
});
test('daily date checks use Beijing market date, never previous UTC date',async()=>{
 const now=Date.parse('2025-02-10T00:30:00+08:00');
 const result=await fetchEastmoneyHistory({
  symbols:['000001'],start:dates[0],end:'2025-02-10',now,
  fetchImpl:async(url)=>{
   const params=new URL(url).searchParams;
   assert.equal(params.get('fields2'),'f51,f52,f53,f54,f55,f56,f57');
   return response(payload('000001'));
  }
 });
 assert.equal(result.dataset.stocks[0].bars.length,40);
 assert.equal(result.metadata.canTrade,false);
});


test('明确请求东方财富 fqt=0 不复权，BaoStock 同口径可研究对账且不改旧 qfq 标识',async()=>{
 const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
 let requestFqt=null;
 const result=await fetchEastmoneyHistory({symbols:['000001'],start:dates[0],
  end:dates.at(-1),adjustmentMode:'unadjusted',fetchImpl:async(url)=>{
   requestFqt=new URL(url).searchParams.get('fqt');
   return response(payload('000001'));
  }});
 assert.equal(requestFqt,'0');
 assert.equal(result.dataset.priceAdjustment.mode,'unadjusted');
 assert.equal(result.dataset.priceAdjustment.provider,'eastmoney-public-history-fqt-0');
 assert.match(result.dataset.datasetId,/^em-unadjusted-v1-/);
 assert.equal(result.dataset.upstream,'eastmoney');
 assert.equal(result.metadata.observedAtMeaning,'local-request-completion-not-exchange-quote-time');
 const comparison=structuredClone(result.dataset);
 comparison.provider='baostock';comparison.upstream='baostock';
 comparison.datasetId='baostock-synthetic-fixture';
 comparison.priceAdjustment={mode:'unadjusted',provider:'baostock-adjustflag-3'};
 const r=compareMarketFeeds(result.dataset,comparison,{requireKnownIndependentUpstreams:true});
 assert.equal(r.consensus,true);
 assert.equal(r.sourceLineage.knownDistinctUpstreamFamilies,true);
 assert.equal(r.releaseReady,false);
 assert.equal(r.canTrade,false);
 assert.ok(result.dataset.observedAt>0);
 assert.equal(result.dataset.stocks[0].bars[0].volume,1000000);
});
test('不允许静默选择不存在的复权模式，也不进行任何网络请求',async()=>{
 let count=0;
 await assert.rejects(()=>fetchEastmoneyHistory({symbols:['000001'],start:dates[0],
  end:dates.at(-1),adjustmentMode:'hfq',fetchImpl:async()=>{count++;return response(payload('000001'));}}),/复权/);
 assert.equal(count,0);
});
