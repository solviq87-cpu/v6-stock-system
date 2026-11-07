'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {costStress}=require('../src/strategy/cost-stress');
const {preopenWatch}=require('../src/strategy/preopen-watch');
function fixture(){
 const dates=[],factors={trendScore:95,relativeStrength:99,volumeScore:99,capitalScore:98,amount:1e9,positionScore:95,breakoutScore:95,momentumScore:95};
 for(let i=0;dates.length<40;i++){const d=new Date(Date.UTC(2025,2,3+i));if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10));}
 const bars=dates.map((date,i)=>({date,open:10+i*.01,close:10+i*.01,low:9.8+i*.01,high:10.2+i*.01,volume:1e6,factors}));
 bars[29].volume=2e6;
 return {stocks:[{symbol:'000001',market:'main',bars}],tradingDates:dates,targetDate:dates[30],splitDay:29,end:39,source:'simulated'};
}
test('盘前名单命中且仅用上个交易日收盘资料',()=>{
 const cfg=fixture(),r=preopenWatch(cfg);assert.equal(r.candidates[0]?.symbol,'000001');
 cfg.stocks[0].bars.length=30;assert.deepEqual(preopenWatch(cfg),r);
 cfg.stocks[0].bars[29].isST=true;assert.equal(preopenWatch(cfg).candidates.length,0);
});
test('已封首板不混入下一日首板发掘，日历缺席拒绝',()=>{
 const cfg=fixture(),b=cfg.stocks[0].bars[29];b.close=b.high=b.upperLimit=11.31;
 assert.equal(preopenWatch(cfg).candidates.length,0);cfg.targetDate='2025-03-01';assert.throws(()=>preopenWatch(cfg));
});
test('固定持仓交易的成本冲击及胜负统计可核对',()=>{
 const r=costStress(fixture());assert.equal(r.scenarios.length,4);
 const base=r.scenarios[0];assert.ok(base.metrics.closedTrades>0);
 for(const s of r.scenarios){assert.equal(s.winners+s.flat+s.losers,s.metrics.closedTrades);assert.equal(s.metrics.winRatePct,+(100*s.winners/s.metrics.closedTrades).toFixed(2));}
 assert.ok(r.scenarios[3].metrics.finalEquity<base.metrics.finalEquity);
});
test('连续两日跌停、再停牌，未平仓损失计入净值而非胜率',()=>{
 const cfg=fixture();cfg.end=33;cfg.feeBps=cfg.slippageBps=0;
 const bars=cfg.stocks[0].bars;
 for(const [i,price] of [[31,9.27],[32,8.34],[33,8.34]])Object.assign(bars[i],{open:price,close:price,low:price,high:price,lowerLimit:price});
 bars[33].suspended=true;bars[33].volume=0;
 const s=costStress(cfg).scenarios[0];
 assert.equal(s.blockedSells,3);assert.equal(s.openPositions,1);assert.equal(s.metrics.winRatePct,null);
 assert.equal(s.realizedNetPnl,0);assert.ok(s.metrics.maxDrawdownPct>15);
});
test('损坏行情和跨股票错位日期拒绝生成报告',()=>{
 const cfg=fixture();cfg.stocks[0].bars[35].low=0;assert.throws(()=>costStress(cfg),/OHLCV/);
 const second=fixture().stocks[0];second.symbol='000002';second.bars[32].date=second.bars[31].date;
 const aligned=fixture();aligned.stocks.push(second);assert.throws(()=>costStress(aligned),/日期|对齐/);
});
test('盘后披露的资金流因子不能用于当天策略排序',()=>{
 const {historicalStock}=require('../src/strategy/historical-session');
 const s=fixture().stocks[0],b=s.bars[29];b.factors.fundFlowScore=98;
 for(const [time,expected] of [['14:59:59+08:00',98],['15:00:01+08:00',undefined],['14:00:00',undefined]]){
  b.factorsPublishedAt=b.date+'T'+time;assert.equal(historicalStock(s,29,'simulated',0).fundFlowScore,expected);
 }
});
test('单策略压力测试只接收该战法的候选',()=>{
 const cfg=fixture();assert.ok(costStress({...cfg,strategyId:'platform_breakout'}).scenarios[0].metrics.closedTrades>0);
 assert.equal(costStress({...cfg,strategyId:'money_flow_continuation'}).scenarios[0].metrics.closedTrades,0);
 assert.throws(()=>costStress({...cfg,strategyId:'missing'}),/未知/);
});
test('已标注复权价和公司行为不生成失真的成交报告',()=>{
 const cfg=fixture();assert.throws(()=>costStress({...cfg,priceBasis:'adjusted'}),/未复权/);
 cfg.stocks[0].bars[30].corporateAction='split';assert.throws(()=>costStress(cfg),/公司行为/);
});
