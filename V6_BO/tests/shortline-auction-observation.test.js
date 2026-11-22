'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {attachAuctionObservation}=require('../src/research/shortline-auction-observation');
const {createShortlineV6Reader}=require('../src/research/shortline-v6-data');
const day='2026-11-20',code='600001';
const at=s=>Date.parse(s.replace(' ','T')+':00+08:00');
const close=at(day+' 15:00'),quote=at(day+' 09:25'),weekend=at('2026-11-21 14:00');
function fixture(){
  const daily={date:day,code,name:'甲',role:'stock',period:'日K',priceBasis:'unadjusted',open:10.26,high:11,low:10,close:10.8,volume:30000,knownAt:close,availableAt:day+' 15:00'};
  const snapshot={code,day,stock:{},latestClosed:true,bars:[daily],observedAtMs:weekend,evidence:[]};
  const ticks={tradeDate:day,quoteSource:'eastmoney-auction',preClose:10,receivedAt:quote+30100,
    bars:[{t:'09:24',quoteAt:quote-60000,price:10.1,vol:10},{t:'09:25',quoteAt:quote,price:10.26,vol:120}]};
  return {snapshot,ticks,daily};
}
test('竞价终值核对未复权开盘、字段来源和冻结时点，仅识别竞价幅度',()=>{
  const {snapshot,ticks,daily}=fixture();
  assert.equal(attachAuctionObservation(snapshot,ticks,weekend),true);
  assert.equal(snapshot.stock.auctionGap,2.6);
  assert.equal(snapshot.stock.auctionEvidence.quoteAt,quote);
  assert.equal(snapshot.stock.auctionEvidence.knownAt,close);
  assert.equal(daily.auctionGap,2.6);
  for(const k of ['auctionAmount','auctionRatio','auctionNetBuy','first15mChange','last30mChange'])assert.equal(daily[k],undefined);
  assert.equal(snapshot.bars.length,1);
});
test('历史补取仅进实际收悉的观测；缺终值、错日错票、重复分钟和错开盘不进入信号',()=>{
  const late=fixture();late.ticks.receivedAt=weekend;
  assert.equal(attachAuctionObservation(late.snapshot,late.ticks,weekend),true);
  assert.equal(late.daily.auctionGap,undefined);
  assert.equal(late.snapshot.stock.auctionEvidence.knownAt,weekend);
  for(const mutate of [
    x=>{x.snapshot.latestClosed=false;x.ticks.receivedAt=weekend;},
    x=>{x.ticks.receivedAt=weekend+1;},x=>{x.ticks.tradeDate='2026-11-19';},
    x=>{x.ticks.symbol='000001';},x=>{x.ticks.preClose=null;},x=>{x.daily.open=10.27;},
    x=>{x.ticks.bars.pop();},x=>{x.ticks.bars[1].vol=0;},x=>{x.ticks.bars[1].quoteAt=quote+86400000;},
    x=>{x.ticks.bars.push({...x.ticks.bars[0]});},x=>{x.ticks.quoteSource='';}
  ]){
    const x=fixture();mutate(x);
    assert.equal(attachAuctionObservation(x.snapshot,x.ticks,weekend),false);
    assert.equal(x.snapshot.stock.auctionGap,undefined);assert.equal(x.daily.auctionGap,undefined);
  }
});
test('日终同步复用当前代码的真实竞价缓存或按日共用读取，历史请求不补抓当日行情',async()=>{
  const {ticks}=fixture(),state={auctionTicks:{[code]:{date:'20261120',ok:true,data:ticks}}};
  let calls=0;
  const read=createShortlineV6Reader({
    clock:()=>weekend,getState:()=>state,getLatestClosedDay:()=>day,previousTradeDay:()=>null,
    fetchHistory:async()=>({stock:{symbol:code,name:'甲',priceBasis:'unadjusted',bars:[{date:day,open:10.26,close:10.8,high:11,low:10,volume:30000,knownAt:weekend}]},
      provider:'eastmoney',priceBasis:'unadjusted',units:{volume:'shares'},retrievedAt:weekend}),
    fetchAuctionTicks:async(c,d)=>{assert.equal(c,code);assert.equal(d,day);calls++;return ticks;}
  });
  const first=await read({code});assert.equal(first.stock.auctionGap,2.6);assert.equal(calls,0);
  delete state.auctionTicks[code];
  const [next,concurrent]=await Promise.all([read({code}),read({code})]);
  assert.equal(calls,1);assert.equal(next.stock.auctionGap,2.6);assert.deepEqual(next,concurrent);
  const old=await read({code,day:'2026-11-19'});assert.equal(calls,1);assert.equal(old.stock.auctionGap,undefined);
  assert.ok(old.missing.includes('可核实的09:25竞价价格与昨收'));
});
