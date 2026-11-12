'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const {walkForward}=require('../src/strategy/walk-forward-backtest');

function stock(symbol='600000',market='main'){
 return {symbol,market,bars:Array.from({length:45},(_,i)=>({
  date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.1,low:9.9,close:10,volume:100000,amount:1000000,
  factors:{trendScore:95,relativeStrength:99,volumeScore:99,capitalScore:98,
   amount:1e9,positionScore:95,breakoutScore:95,momentumScore:95}
 }))};
}
function run(s,extra={}){
 return ledgerBacktest({stocks:[s],start:27,end:31,feeBps:0,slippageBps:0,sellTaxBps:0,
  selectCandidates:(_rows,day)=>day===27?[s.symbol]:[],...extra});
}

for(const [market,upper,lower] of [['main',11,9],['chinext',12,8],['star',12,8],['bse',13,7]]){
 test(`old ledger keeps buy and sell slippage inside ${market} price limits`,()=>{
  const buy=stock('600000',market);
  Object.assign(buy.bars[28],{open:upper-.01,high:upper,low:10,close:10});
  const bought=run(buy,{slippageBps:100}).orders.find(o=>o.day===28&&o.side==='buy'&&o.status==='filled');
  assert.ok(bought);assert.equal(bought.price,upper);
  const sell=stock('600000',market);
  Object.assign(sell.bars[29],{open:lower+.01,low:lower,high:10,close:10});
  const sold=run(sell,{slippageBps:100}).orders.find(o=>o.day===29&&o.side==='sell'&&o.status==='filled');
  assert.ok(sold);assert.equal(sold.price,lower);
 });
}

test('old ledger rejects cross-stock date offsets and explicit calendar gaps',()=>{
 const a=stock(),b=stock('000001');
 b.bars=b.bars.map(row=>({...row,date:new Date(Date.parse(row.date)+86400000).toISOString().slice(0,10)}));
 assert.throws(()=>ledgerBacktest({stocks:[a,b],start:27,end:30,selectCandidates:()=>[]}),/未对齐/);
 const dates=a.bars.map(row=>row.date);dates.splice(29,1);
 assert.throws(()=>run(a,{tradingDates:dates}),/交易日历/);
});

test('old scanner snapshots expose only historical bar factors and no latest stock-level evidence',()=>{
 const s=stock();Object.assign(s,{capitalScore:100,auctionQualityScore:99,announcements:[{id:'future'}]});
 s.bars[27].factors.capitalScore=12;
 run(s,{selectCandidates:([snapshot],day)=>{
  assert.equal(snapshot.capitalScore,day===27?12:98);
  assert.equal(snapshot.auctionQualityScore,undefined);
  assert.equal(snapshot.announcements,undefined);
  assert.equal(snapshot.bars.length,day+1);
  assert.equal(snapshot.feed.timestamp,Date.parse(s.bars[day].date+'T15:00:00+08:00'));
  return [];
 }});
});

test('late factors and future changes cannot affect earlier old-ledger decisions',()=>{
 const s=stock();s.bars[27].factorsPublishedAt=s.bars[27].date+'T16:00:00+08:00';
 let seen;
 run(s,{selectCandidates:([snapshot],day)=>{if(day===27)seen=snapshot.capitalScore;return [];}});
 assert.equal(seen,undefined);
 const a=stock(),b=structuredClone(a);
 b.capitalScore=999;b.bars[40].factors.capitalScore=-999;b.bars[40].close=500;b.bars[40].high=500;
 const pick=rows=>rows.filter(row=>row.capitalScore>90).map(row=>row.symbol);
 assert.deepEqual(run(a,{selectCandidates:pick}),run(b,{selectCandidates:pick}));
});

test('historical status controls selection and is rechecked at the next open',()=>{
 const s=stock();s.isST=true;
 s.bars.forEach(row=>{row.isST=false;row.suspended=false;row.tradable=true;});
 assert.ok(run(s).orders.some(o=>o.side==='buy'&&o.status==='filled'));
 s.bars[28].isST=true;
 const denied=run(s);
 assert.ok(denied.orders.some(o=>o.day===28&&o.side==='buy'&&o.status==='blocked'));
 assert.equal(denied.orders.filter(o=>o.side==='buy'&&o.status==='filled').length,0);
});

test('old ledger selection cannot bypass historical membership by returning a filtered symbol',()=>{
 const a=stock(),b=stock('000001');
 const history=[{symbol:a.symbol,from:a.bars[0].date,through:a.bars.at(-1).date,
  eligible:false,source:'fixture',knownAt:'2024-12-01T00:00:00Z'}];
 const r=ledgerBacktest({stocks:[a,b],start:27,end:31,universeHistory:history,selectCandidates:()=>[b.symbol]});
 assert.equal(r.orders.filter(o=>o.side==='buy'&&o.status==='filled').length,0);
});
test('strict historical runs reject absent daily status and ignore later stock-level status',()=>{
 const s=stock();
 assert.throws(()=>run(s,{strictHistoricalStatus:true}),/逐日ST/);
 assert.throws(()=>run(s,{strictHistoricalStatus:'true'}),/布尔/);
 for(const b of s.bars)Object.assign(b,{isST:false,suspended:false,tradable:true});
 const before=run(s,{strictHistoricalStatus:true});
 assert.ok(before.orders.some(o=>o.status==='filled'));
 Object.assign(s,{isST:true,suspended:true,tradable:false});
 assert.deepEqual(run(s,{strictHistoricalStatus:true}),before);
 delete s.bars[28].suspended;
 assert.throws(()=>run(s,{strictHistoricalStatus:true}),/逐日ST/);
});

test('old ledger declares absent historical evidence instead of reporting verification',()=>{
 const s=stock();const r=run(s);
 assert.equal(r.researchOnly,true);assert.equal(r.canTrade,false);
 assert.equal(r.dataProvenance.verifiedExternal,false);
 assert.equal(r.dataProvenance.historicalEvidence.universe,'legacy-unverified');
 assert.equal(r.dataProvenance.historicalEvidence.calendar,'unverified');
 assert.equal(r.dataProvenance.historicalEvidence.securityStatus,'unverified-stock-fallback');
 assert.equal(r.dataProvenance.historicalEvidence.corporateActions,'unknown');
 assert.equal(r.dataProvenance.historicalEvidence.priceBasis,'unknown');
 const undated=stock();undated.bars.forEach(row=>{delete row.date;});
 assert.equal(run(undated).dataProvenance.historicalEvidence.dates,'undated-legacy');
});

test('optional liquidity capacity uses prior observed shares and preserves partial exit balances',()=>{
 const s=stock();s.volumeUnit='shares';s.bars[27].volume=1000;s.bars[28].volume=500;
 const r=run(s,{maxParticipationPct:10,holdDays:1});
 const bought=r.orders.find(o=>o.side==='buy'&&o.status==='filled');
 assert.equal(bought.shares,100);
 // The next day permits fewer than one lot, so the position remains carried.
 assert.ok(r.orders.some(o=>o.day===29&&o.side==='sell'&&o.status==='blocked'));
 assert.equal(r.equity.find(e=>e.day===29).openPositions,1);
 delete s.volumeUnit;
 assert.equal(run(s,{maxParticipationPct:10}).orders.filter(o=>o.status==='filled').length,0);
});

test('explicit company entitlements change cash and holdings without a fabricated sale',()=>{
 const s=stock();
 s.bars[29].corporateAction={type:'cash-and-shares',source:'fixture',netCashPerShare:1,
  shareMultiplier:2,referenceClose:4.5,publishedAt:s.bars[28].date+'T16:00:00+08:00',
  cashDate:s.bars[29].date,sharesAvailableDate:s.bars[29].date};
 for(let i=29;i<s.bars.length;i++)Object.assign(s.bars[i],{open:4.5,high:4.6,low:4.4,close:4.5});
 const r=run(s,{holdDays:10});
 assert.equal(r.openPositions[0].shares,20000);
 assert.equal(r.cash,10000);
 assert.equal(r.equity.at(-1).value,100000);
 assert.ok(r.orders.some(o=>o.status==='corporate-action'));
});

test('partial capacity exits retain proportional basis and the remaining marked holding',()=>{
 const s=stock();s.volumeUnit='shares';s.bars[27].volume=10000;s.bars[28].volume=5000;
 const r=run(s,{maxParticipationPct:10});
 const sells=r.trades;
 assert.deepEqual(sells.map(t=>[t.sellDay,t.shares,t.costBasis]),[[29,500,5000],[30,500,5000]]);
 const partial=r.equity.find(e=>e.day===29);
 assert.equal(partial.cash,95000);assert.equal(partial.marketValue,5000);assert.equal(partial.openPositions,1);
 assert.equal(r.metrics.finalEquity,100000);assert.equal(r.openPositions.length,0);
});

test('both commissions and sell tax reconcile against cash and net realized profit',()=>{
 const r=run(stock(),{feeBps:100,sellTaxBps:100});
 const buy=r.orders.find(o=>o.side==='buy'&&o.status==='filled');
 assert.equal(buy.shares,9900);
 assert.equal(r.trades[0].costBasis,99990);
 assert.equal(r.trades[0].netPnl,-2970);
 assert.equal(r.cash,97030);assert.equal(r.metrics.finalEquity,97030);
 assert.equal(r.metrics.returnPct,-2.97);assert.ok(r.equity.every(e=>e.cash>=0));
});

test('default old walk-forward retains a blocked sale and its unrealized loss',()=>{
 const s=stock();
 Object.assign(s.bars[29],{open:9,low:9,high:9,close:9});
 const r=walkForward({stocks:[s],start:27,end:27,feeBps:0,slippageBps:0});
 assert.ok(Array.isArray(r.openPositions));
 assert.equal(r.openPositions.length,1);
 assert.equal(r.trades.length,0);
 assert.ok(r.skipped.some(o=>o.side==='sell'));
 assert.ok(r.metrics.returnPct<0);
 assert.equal(r.executionModel,'daily-position-ledger');
});
