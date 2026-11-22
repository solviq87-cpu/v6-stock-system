'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createShortlineV6Reader,applyShortlineV6Source}=require('../src/research/shortline-v6-data');

const day='2026-11-20', prior='2026-11-19', code='600001';
const at=text=>Date.parse(text+'+08:00');
const now=at('2026-11-21T10:12:05'), quote=at(day+'T15:00:00');
const bar=(date,extra={})=>({date,open:11,high:12,low:10,close:11.5,volume:34500,amount:389000,knownAt:now,...extra});
const pooled=(date,rows)=>({tradeDate:date,complete:true,totalCount:rows.length,records:rows});
function fixture() {
  const days=Array.from({length:20},(_,i)=>'2026-11-'+String(i+1).padStart(2,'0'));
  const hist={provider:'eastmoney',retrievedAt:now,priceBasis:'unadjusted',units:{volume:'shares'},
    stock:{symbol:code,name:'甲',priceBasis:'unadjusted',bars:[bar(prior),bar(day)]}};
  const raw=Buffer.from(JSON.stringify({data:{code,klines:[day+',11,11.5,12,10,345,389000,1,1,1,6.5']}}));
  hist.rawEvidence={encoding:'base64',data:raw.toString('base64')};hist.rawHash=createHash('sha256').update(raw).digest('hex');
  const sealed=pooled(day,[{symbol:code,consecutiveLimits:3},{symbol:'600002',consecutiveLimits:1}]);
  const report={day,sealed,broken:pooled(day,[{symbol:'600003'}]),down:4,marketTurnover:2.3e12};
  const prev=pooled(prior,[{symbol:code,consecutiveLimits:2},{symbol:'600002',consecutiveLimits:1}]);
  const state={stocks:[code,'600002'].map((c,i)=>({code:c,name:'样本',price:11.5,pct:i===0?4:2,quoteSource:'source',quoteAt:quote,receivedAt:quote+1000})),
    breadth:{[day]:{day,at:quote,n:5000,up:3355,down:1250}},
    ztReviewPoolMeta:{sources:[{source:'cls',status:'available',providerComplete:true,tradeDate:day,receivedAt:now}]},
    ztReviewPool:[code,'600002'].map(code=>({code,tradeDate:day,sources:['cls'],clsObservation:{tradeDate:day,receivedAt:now},plates:[{name:'机器人'}]}))};
  const index=(id)=>({name:({'1.000985':'中证全指','1.000001':'上证指数','0.399006':'创业板指'})[id],src:'em',receivedAt:now,rows:days.map((date,i)=>({date,close:400+i,volume:100+i}))});
  const calls={stock:0};
  const inputs={getState:()=>state,getLatestClosedDay:()=>day,previousTradeDay:d=>d===day?prior:'2026-11-18',clock:()=>now,
    fetchHistory:async()=>{calls.stock++;return hist;},fetchPreviousPool:async()=>prev,readCloseReviewEvidence:async()=>report,fetchIndexKline:async id=>index(id)};
  return {hist,state,report,prev,inputs,calls};
}

test('V6 休市沿用已确认交易日、未复权价格及实际可知时点，热点证据接入收盘校验',async()=>{
  const f=fixture(),read=createShortlineV6Reader(f.inputs);
  const [r,same]=await Promise.all([read({code}),read({code})]);assert.deepEqual(r,same);assert.equal(f.calls.stock,1);
  assert.equal(r.day,day);assert.equal(r.latestClosed,true);assert.equal(r.observedAtMs,now);assert.equal(r.latestClosedDay,day);
  assert.equal(r.bars[0].availableAt,'2026-11-21 10:12');assert.equal(r.bars[1].turnover,6.5);
  assert.deepEqual(r.stock.themes,['机器人']);assert.ok(r.stock.selected.includes('42:0'));
  const m=r.market[0];assert.equal(m.upLimit,2);assert.equal(m.downLimit,4);assert.equal(m.breakRate,33.33);assert.equal(m.height,3);
  assert.equal(m.leader,4);assert.equal(m.premium,3);assert.equal(m.diffusion,100);assert.equal(m.trend,'多头');assert.equal(m.adv,3355);
  assert.equal(m.amount,23000);assert.equal(r.canTrade,false);
});

test('晚到、错日、截断、混用复权/指数身份及未完成 K 线均不提升证据',async()=>{
  const f=fixture();f.hist.priceBasis='qfq';f.state.stocks.forEach(s=>s.quoteAt=at(prior+'T15:00:00'));
  f.report.sealed.complete=false;f.report.down=null;f.report.broken.tradeDate=prior;
  f.state.breadth[day].at=at(day+'T14:30:00');f.inputs.fetchIndexKline=async()=>({name:'平安银行',rows:[],receivedAt:now});
  const r=await createShortlineV6Reader(f.inputs)({code});
  assert.deepEqual(r.bars,[]);assert.deepEqual(r.stock.selected,[]);assert.equal(r.latestClosed,false);
  assert.equal(r.stock.price,undefined);assert.equal(r.market[0].upLimit,undefined);assert.equal(r.market[0].adv,undefined);
  assert.equal(r.market[0].leader,undefined);assert.equal(r.market[0].diffusion,undefined);assert.equal(r.market[0].sh,undefined);
  await assert.rejects(()=>createShortlineV6Reader(f.inputs)({code,day:'2027-01-01'}));
  await assert.rejects(()=>createShortlineV6Reader(f.inputs)({code,previousDay:'2020-01-01'}));
  const g=fixture();
  g.hist.stock.bars=[bar(day,{knownAt:at(day+'T14:00:00')}),bar('2026-11-24')];
  assert.equal((await createShortlineV6Reader(g.inputs)({code})).bars.length,0);
});

test('不完整的昨高标反馈及题材覆盖不报告为零，历史查看不延长截止时点',async()=>{
  const f=fixture();f.state.ztReviewPool[1].plates=[];f.state.stocks[0].receivedAt=now+9999;
  f.report.broken.records=[{symbol:code}];
  const read=createShortlineV6Reader(f.inputs),s=await read({code});
  assert.equal(s.market[0].leader,undefined);assert.equal(s.market[0].diffusion,undefined);assert.equal(s.market[0].breakRate,undefined);
  const history=await read({code,day:prior});assert.equal(history.latestClosed,false);assert.ok(history.bars.every(b=>b.date<=prior));
  const archive={};applyShortlineV6Source(archive,s);applyShortlineV6Source(archive,history);
  assert.equal(archive.v6Observation.day,day);
});

test('重复同步幂等；价格冲突不会覆盖原始冻结值；环境修订保留原可用时间',async()=>{
  const s=await createShortlineV6Reader(fixture().inputs)({code}),db={};
  assert.equal(applyShortlineV6Source(db,s).barsAdded,2);assert.equal(applyShortlineV6Source(db,s).barsAdded,0);
  const revised=structuredClone(s);revised.bars[0].open+=1;revised.market[0].downLimit=9;revised.market[0].knownAt+=60000;revised.market[0].availableAt='2026-11-21 10:13';
  const result=applyShortlineV6Source(db,revised);
  assert.equal(result.conflicts.length,1);assert.equal(db.bars[0].open,11);
  assert.equal(db.marketHistory.length,1);assert.equal(db.marketHistory[0].downLimit,4);assert.equal(db.market[0].downLimit,9);
});

test('同日完整题材按封板数和成交额选主线，最高板同高必须能核实首封先后',async()=>{
  const f=fixture();f.report.sealed.records[0].consecutiveLimits=2;
  f.report.sealed.records[1].consecutiveLimits=2;
  f.report.sealed.records[0].firstSealTime='093615';f.report.sealed.records[1].firstSealTime='094329';
  f.state.sectors=[{name:'机器人',code:'BK1234',pct:99}];
  const priorFetch=f.inputs.fetchIndexKline;
  f.inputs.fetchIndexKline=async id=>id==='90.BK1234'?{name:'机器人',src:'em',receivedAt:now,rows:[{date:prior,close:200},{date:day,close:206}]}:priorFetch(id);
  let r=await createShortlineV6Reader(f.inputs)({code});
  assert.equal(r.market[0].theme,'机器人');assert.equal(r.market[0].themeLeader,code);assert.equal(r.market[0].themes[0].ladderComplete,false);
  assert.equal(r.stock.mainline,true);assert.equal(r.stock.strongSector,true);assert.equal(r.stock.sectorChange,3);
  assert.equal(r.stock.resonance,'题材指数共振');assert.equal(r.stock.sectorAssists,1);
  f.report.sealed.records[1].firstSealTime='093615';
  r=await createShortlineV6Reader(f.inputs)({code});assert.equal(r.market[0].themeLeader,undefined);
  // Partially tagged pools can use a complete industry dimension, but remain explicitly labelled.
  f.state.ztReviewPool=[];
  f.report.sealed.records.forEach(row=>{row.industry='设备制造';});
  r=await createShortlineV6Reader(f.inputs)({code});
  assert.equal(r.market[0].theme,'设备制造');assert.equal(r.market[0].themes[0].classification,'东财行业归类');assert.equal(r.market[0].diffusion,undefined);
});
