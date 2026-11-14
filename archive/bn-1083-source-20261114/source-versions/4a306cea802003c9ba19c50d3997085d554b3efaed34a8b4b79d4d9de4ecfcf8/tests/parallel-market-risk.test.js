'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const {walkForward,atLockedLimit}=require('../src/strategy/walk-forward-backtest');
const {holdoutBacktest}=require('../src/strategy/holdout-backtest');
const {adaptCachedKline}=require('../src/strategy/cached-kline-adapter');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const {evaluatePlaybooks}=require('../src/strategy/research-playbook-engine');
const row=()=>({open:10,low:9.9,high:10.1,close:10,volume:1e6});
const stock=()=>({symbol:'000001',market:'main',bars:Array.from({length:50},row)});
const opts=s=>({stocks:[s],start:27,end:40,selectCandidates:()=>[s.symbol]});

test('历史信号只读取信号日及以前的数据',()=>{
 const s=stock();s.auctionQualityScore=99;s.bars[27].factors={sectorHeatScore:70};
 ledgerBacktest({...opts(s),selectCandidates:([snapshot],day)=>{
  assert.equal(snapshot.auctionQualityScore,undefined);assert.equal(snapshot.bars.length,day+1);
  assert.equal(snapshot.sectorHeatScore,day===27?70:undefined);return [];
 }});
});
test('当日开板不能倒推开盘成交，精确到分',()=>{
 for(const [side,open] of [['buy',11],['sell',9]]){
  assert.ok(atLockedLimit({...row(),open},row(),stock(),side).blocked);
  assert.ok(!atLockedLimit({...row(),open:side==='buy'?10.99:9.01},row(),stock(),side).blocked);
 }
});
test('旧回测保留卖出受阻头寸，收盘盯市',()=>{
 const s=stock();
 for(const b of s.bars)b.factors={trendScore:95,relativeStrength:99,volumeScore:99,capitalScore:98,amount:1e9,positionScore:95,breakoutScore:95,momentumScore:95};
 s.bars[29]={...s.bars[29],open:9,low:9,high:9,close:9};
 const r=walkForward({stocks:[s],start:27,end:27});
 assert.equal(r.openPositions.length,1);assert.equal(r.skipped[0].side,'sell');assert.ok(r.metrics.returnPct<0);
});
test('限仓、收盘止损、T+1及回撤预警',()=>{
 const s=stock();s.bars[28]={...row(),close:9,low:9};
 const r=ledgerBacktest({...opts(s),maxPositionPct:20,stopLossPct:5,drawdownAlertPct:1,holdDays:8});
 assert.ok(r.equity[1].cash>=80000);assert.equal(r.trades[0].sellDay,29);assert.ok(r.warnings.some(w=>w.includes('回撤')));
});
test('独立样本外区间默认空仓，训练结果不随样本外变化',()=>{
 const s=stock(),config={...opts(s),splitDay:34},r=holdoutBacktest(config);
 assert.equal(r.outOfSample.equity[0].cash,100000);assert.equal(r.outOfSample.equity[0].openPositions,0);
 assert.ok(r.outOfSample.trades.length);s.bars[37].close=9;assert.deepEqual(r.inSample,holdoutBacktest(config).inSample);
});
test('不同日期不能作为同一次横截面扫描',()=>{
 const a=stock(),b=stock();b.symbol='000002';b.bars[29].date='2026-01-01';
 assert.throws(()=>ledgerBacktest({...opts(a),stocks:[a,b]}),/未对齐/);
});
test('缓存拒绝空成交量、非法日期',()=>{
 const now=Date.UTC(2026,6,1),rows=stock().bars.map((b,i)=>({...b,date:new Date(now-(50-i)*86400000).toISOString().slice(0,10)}));
 const run=()=>adaptCachedKline('000001',{rows},{now,cachedAt:now});
 assert.ok(run().stock);rows[0].date='2026-02-31';assert.ok(run().error);rows.shift();rows[2].volume='';assert.ok(run().error);
});
test('行情提供者失败后重试，保持未核验来源标记',async()=>{
 let n=0;const r=await refreshHistorical({codes:['000001'],retries:1,fetchKline:async()=>{if(!n++)throw Error('offline');return {rows:[row()]};},adapt:()=>({stock:stock()})});
 assert.equal(n,2);assert.equal(r.success,1);assert.equal(r.verifiedLive,false);
});
const cases=[
 ['first_board_quality',1,{sealQualityScore:70}],['first_to_second',1,{auctionQualityScore:65,sectorHeatScore:65}],
 ['second_to_third',2,{auctionQualityScore:70,promotionScore:70}],['leader_sector',0,{leaderStrengthScore:75,sectorHeatScore:70}],
 ['trend_pullback',0,{}],['platform_breakout',0,{}]
];
for(const [id,streak,factors] of cases)test(id+' 自身条件及风险否决',()=>{
 const s=stock();Object.assign(s,factors);
 if(id==='trend_pullback'||id==='platform_breakout'){
  s.bars.forEach((b,i)=>{b.open=b.low=b.close=b.high=10+i*.02;});
  s.bars.at(-1).volume=id==='trend_pullback'?500000:2e6;
 }
 for(let i=0;i<streak;i++){const price=+(s.bars.at(-1).close*1.1).toFixed(2);s.bars.push({...row(),open:price,low:price,high:price,close:price});}
 const match=()=>evaluatePlaybooks(s).playbooks.find(p=>p.id===id);
 assert.equal(match().status,'candidate');s.isST=true;assert.equal(match().status,'risk_blocked');
});
test('回退源需显式授权，主源成功时无需回退',async()=>{
 let fallback=0;const back={name:'licensed-fixture',authorized:true,fetchKline:async()=>{fallback++;return {rows:[row()]};}};
 const args={codes:['000001'],adapt:()=>({stock:stock()}),authorizedFallbacks:[back],fetchKline:async()=>({rows:[row()]})};
 assert.equal((await refreshHistorical(args)).items[0].provider,'primary');assert.equal(fallback,0);
 args.fetchKline=async()=>null;
 assert.equal((await refreshHistorical(args)).items[0].provider,back.name);assert.equal(fallback,1);
 back.authorized=false;await assert.rejects(()=>refreshHistorical(args),/授权/);assert.equal(fallback,1);
});
test('输入交易日历要求覆盖并逐日匹配',()=>{
 const s=stock();s.bars.forEach((b,i)=>{b.date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);});
 const config={...opts(s),tradingDates:s.bars.map(b=>b.date)};
 assert.ok(ledgerBacktest(config).equity.length);config.tradingDates.splice(29,1);
 assert.throws(()=>ledgerBacktest(config),/交易日历/);
});
test('接近涨停但相差一档不计首板',()=>{
 const s=stock();Object.assign(s.bars.at(-1),{close:10.99,high:10.99});
 assert.equal(require('../src/strategy/limit-ladder-engine').classifyLimitLadder(s).streak,0);
});
