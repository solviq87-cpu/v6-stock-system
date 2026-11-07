'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replayStrategyPortfolios}=require('../src/core/strategy-portfolio-lab');
const {auditMarketData}=require('../src/core/market-data-quality');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const dates=Array.from({length:44},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
function stock(code,price=10){return {code,bars:dates.map((date,i)=>({date,open:price+i*.03,close:price+i*.03,high:price+i*.03+.2,low:price+i*.03-.2,volume:100000}))};}
const history=()=>({source:'fixture',asOf:dates.at(-1),splitDay:36,stocks:[stock('000001'),stock('000002')]});
const sig=(system,symbol,day,verdict='pass')=>({system,symbol,date:dates[day],observedThrough:dates[day],verdict,provenance:'test/native',evaluatorVersion:'test-1'});
test('四套策略信号独立计账，t 日收盘信号只能在 t+1 开盘成交，并执行 T+1',()=>{
 const h=history(),p=replayStrategyPortfolios(h,[sig('fourteen','000001',31),sig('bazi','000002',33),sig('gpt','000001',34,'unknown')]);
 const f=p.systems.fourteen.fills;
 assert.equal(f[0].date,dates[32]);assert.equal(f[0].signalDate,dates[31]);
 assert.equal(f[1].side,'sell');assert.equal(f[1].date,dates[33]);
 assert.equal(f[0].qty%100,0);assert.equal(p.systems.fourteen.metrics.closedTrades,1);
 assert.equal(p.systems.bazi.metrics.closedTrades,1);assert.equal(p.systems.gpt.fills.length,0);
 assert.equal(p.systems.python.metrics.closedTrades,0);assert.equal(p.canTrade,false);
});
test('停牌、零成交、一字涨停、ST 全部阻止新仓且保留可审核拒绝记录',()=>{
 const h=history();h.stocks[0].bars[32].volume=0;
 const blocked=replayStrategyPortfolios(h,[sig('fourteen','000001',31)]).systems.fourteen;
 assert.equal(blocked.fills.length,0);assert.match(blocked.orders[0].reason,/停牌|无成交量/);
 const h2=history();h2.stocks[0].bars[32]={date:dates[32],open:12.2,high:12.2,low:12.2,close:12.2,volume:9999};
 assert.equal(replayStrategyPortfolios(h2,[sig('fourteen','000001',31)]).systems.fourteen.metrics.blockedOrders,1);
 const h3=history();h3.stocks[0].isST=true;
 assert.match(replayStrategyPortfolios(h3,[sig('fourteen','000001',31)]).systems.fourteen.orders[0].reason,/ST/);
});
test('无法卖出的停牌股票保留持仓，现金与持仓账本不造假',()=>{
 const h=history();h.stocks[0].bars[33].volume=0;
 const p=replayStrategyPortfolios(h,[sig('fourteen','000001',31)]).systems.fourteen;
 assert.equal(p.orders.filter(x=>x.side==='sell'&&x.status==='blocked').length,1);
 assert.equal(p.metrics.closedTrades,1);assert.equal(p.fills.find(x=>x.side==='sell').date,dates[34]);
});
test('重复、未来观察、未知策略、非法成本及越界配置全部拒绝',()=>{
 const h=history();const good=sig('fourteen','000001',31);
 assert.throws(()=>replayStrategyPortfolios(h,[good,good]),/重复/);
 assert.throws(()=>replayStrategyPortfolios(h,[{...good,observedThrough:dates[32]}]),/来源|日期/);
 assert.throws(()=>replayStrategyPortfolios(h,[{...good,system:'invented'}]),/无效/);
 assert.throws(()=>replayStrategyPortfolios(h,[],{config:{slippageBps:-1}}),/参数/);
});
test('真实行情审核不把模拟行情或没有复权来源的历史标记成外部已验证',()=>{
 const h=history();const r=auditMarketData(h);
 assert.equal(r.reviewReady,false);assert.equal(r.verifiedExternal,false);
 assert.ok(r.issues.some(i=>i.code==='NON_EXTERNAL_SOURCE'));
 assert.ok(r.issues.some(i=>i.code==='ADJUSTMENT_UNVERIFIED'));
});
test('行情质量报告指出零成交和潜在公司行为大跳空，不自动修改历史价格',()=>{
 const h=history();h.stocks[0].bars[39].volume=0;h.stocks[0].bars[40].open=18;h.stocks[0].bars[40].close=18;h.stocks[0].bars[40].high=18.2;h.stocks[0].bars[40].low=17.8;
 const before=JSON.stringify(h);const r=auditMarketData(h);assert.equal(JSON.stringify(h),before);
 assert.equal(r.summary.zeroVolumeBars,1);assert.equal(r.summary.largeOpenGaps,2);
});
test('统一工程使用原生真实信号证据驱动四个隔离账户，而非伪造 pass',()=>{
 const r=runUnifiedStrategyProject(history());
 assert.equal(r.independentPortfolios.canTrade,false);
 assert.ok(r.native.signals.every(x=>x.provenance&&x.evaluatorVersion));
 assert.equal(r.strategyDiagnostics.systems.python.status,'not-evaluated');
 assert.equal(r.independentPortfolios.systems.python.fills.length,0);
 assert.equal(r.marketQuality.verifiedExternal,false);
});
test('修改未来K线不能改变更早交易日生成的原生策略信号',()=>{
 const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
 const a=history(),b=history();
 for(const stock of b.stocks){for(let i=40;i<stock.bars.length;i++){
  const p=stock.bars[i];p.open*=1.4;p.close*=1.4;p.low*=1.4;p.high*=1.4;
 }}
 const x=runNativeDaily(a),y=runNativeDaily(b);
 assert.deepEqual(x.signals.filter(s=>s.date<dates[40]),y.signals.filter(s=>s.date<dates[40]));
});
test('最低佣金计入可买数量，独立账户不产生负现金或无效订单',()=>{
 const h=history(),p=replayStrategyPortfolios(h,[sig('gpt','000001',31)],{config:{initialCash:1100,allocationPct:1,minCommission:5}}).systems.gpt;
 assert.ok(p.equity.every(x=>x.cash>=-1e-7));
 assert.ok(p.fills.every(x=>x.qty>0&&x.qty%100===0));
});
