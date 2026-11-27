'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateResearchSuite}=require('../src/core/research-validation-suite');
const make=(n=110)=>({source:'simulated',asOf:'2026-11-05',stocks:['600001','000001'].map((symbol,j)=>({symbol,bars:Array.from({length:n},(_,i)=>{const close=10+j+i*.02;return {date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:close,high:close*1.01,low:close*.99,close,volume:100000};})}))});
test('多窗口样本外回测输出可复现，交易门禁关闭',()=>{const d=make();const a=evaluateResearchSuite(d,{windows:3,testDays:15});const b=evaluateResearchSuite(d,{windows:3,testDays:15});assert.deepEqual(a,b);assert.equal(a.folds.length,3);assert.equal(a.canTrade,false);assert.equal(a.folds[0].trainingEndIndex+1,a.folds[0].testStartIndex-1);assert.equal(a.dataset.sha256.length,64);});
test('历史数据不足拒绝滚动窗口',()=>assert.throws(()=>evaluateResearchSuite(make(40),{windows:3,testDays:20}),/样本不足/));
test('禁止未对账公司行为与复权成交价',()=>{const d=make();d.stocks[0].bars[10].corporateAction='split';assert.throws(()=>evaluateResearchSuite(d),/公司行为/);delete d.stocks[0].bars[10].corporateAction;d.stocks[0].bars[10].priceBasis='adjusted';assert.throws(()=>evaluateResearchSuite(d),/未复权/);});
test('缺失或错误来源与 OHLCV 必须拒绝',()=>{const d=make();delete d.asOf;assert.throws(()=>evaluateResearchSuite(d),/来源/);d.asOf='2026-11-05';d.stocks[0].bars[5].volume=-1;assert.throws(()=>evaluateResearchSuite(d),/OHLCV/);});
test('禁止无效滚动配置',()=>assert.throws(()=>evaluateResearchSuite(make(),{gapDays:0}),/配置无效/));


const {ledgerBacktest}=require('../src/strategy/research-v2-position-ledger-backtest');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const opts={windows:2,testDays:12};
function declared(){
 const d=make();
 d.stocks.forEach(s=>{s.market='main';s.volumeUnit='shares';});
 const dates=d.stocks[0].bars.map(b=>b.date);
 d.tradingDates=dates;
 d.universeHistory=d.stocks.map(s=>({symbol:s.symbol,from:dates[0],through:dates.at(-1),knownAt:'2024-12-01T00:00:00Z',source:'isolated-research-fixture',eligible:false}));
 d.feeSchedules=[{version:'original-fee',effectiveFrom:dates[0],knownAt:'2024-12-01T00:00:00Z',source:'isolated-research-fixture',feeBps:8,minFee:5,sellTaxBps:5,transferBps:1}];
 d.riskPolicy={version:'original-risk',maxPositionPct:20};
 d.maxParticipationPct=1;d.minPriorTurnover=100;d.stopLossPct=4;d.drawdownAlertPct=8;
 d.maxDrawdownPausePct=10;d.maxDailyLossPausePct=5;
 return d;
}
test('rolling validation passes the declared historical calendar to the real ledger',()=>{
 const d=declared();d.tradingDates[100]=d.tradingDates[99];
 assert.throws(()=>evaluateResearchSuite(d,opts),/交易日历/);
});
test('each actual fold keeps original historical membership and risk configuration',()=>{
 const d=declared(),before=JSON.stringify(d),r=evaluateResearchSuite(d,opts);
 for(const f of r.folds){
  const direct=ledgerBacktest({stocks:d.stocks,source:d.source,start:f.testStartIndex,end:f.testEndIndex,
   feeBps:8,slippageBps:10,sellTaxBps:5,topN:3,initialCash:100000,maxPositionPct:30,holdDays:2,
   tradingDates:d.tradingDates,universeHistory:d.universeHistory,feeSchedules:d.feeSchedules,riskPolicy:d.riskPolicy,
   maxParticipationPct:1,minPriorTurnover:100,stopLossPct:4,drawdownAlertPct:8,maxDrawdownPausePct:10,maxDailyLossPausePct:5});
  assert.deepEqual(f.baseline,direct.metrics);assert.equal(f.baseline.closedTrades,0);assert.equal(f.openPositions,0);
  assert.equal(f.optimizedOnTraining,false);assert.equal(f.embargoScope,'declared-evaluation-gap-no-model-training');
 }
 assert.equal(r.configuration.calendarMode,'supplied-unverified');assert.equal(r.configuration.universeMode,'supplied-point-in-time-unverified');
 assert.deepEqual(r.configuration.riskPolicy,d.riskPolicy);assert.equal(JSON.stringify(d),before);
});
test('account-specific settlement evidence must reach the original fold ledger, not disappear',()=>{
 const d=declared(),date=d.tradingDates.at(-3);
 d.settlements=[{kind:'cash-dividend',eventId:'fixture-dividend',actionId:'fixture-action',sourceRecordId:'fixture-source',symbol:'600001',source:'imported',
  provider:'isolated-research-fixture',effectiveDate:date,publishedAt:date+'T08:00:00+08:00',
  cashDelta:10,basisDelta:0,shareDelta:0,expectedQuantity:100,expectedCostBasis:1000}];
 assert.throws(()=>evaluateResearchSuite(d,opts),/期初持仓\/成本/);
});
test('invalid declared fee or risk inputs do not silently fall back to suite defaults',()=>{
 const d=declared();d.feeSchedules[0].minFee=-1;
 assert.throws(()=>evaluateResearchSuite(d,opts),/费率/);
 const e=declared();e.riskPolicy.maxPositionPct=-1;
 assert.throws(()=>evaluateResearchSuite(e,opts),/风险|风控|仓位|阈值/);
 const v=declared();v.maxParticipationPct=101;
 assert.throws(()=>evaluateResearchSuite(v,opts),/参与率/);
});
test('dated fees are actually forwarded and commission stress is a separate derived scenario',()=>{
 // Inspect the exact suite-to-ledger boundary independently of the scanner:
 // run the actual suite module with an instrumented original ledger function.
 const filename=path.resolve(__dirname,'../src/core/research-validation-suite.js');
 const code=readFileSync(filename,'utf8'),calls=[],m={exports:{}};
 const req=id=>id==='../strategy/research-v2-position-ledger-backtest'?{ledgerBacktest(args){
  calls.push(args);return ledgerBacktest(args);
 }}:require(id.startsWith('.')?path.resolve(path.dirname(filename),id):id);
 new Function('require','module','exports',code)(req,m,m.exports);
 const d=declared(),before=JSON.stringify(d),report=m.exports.evaluateResearchSuite(d,opts);
 assert.equal(calls.length,4);
 for(let i=0;i<calls.length;i+=2){
  const base=calls[i],stress=calls[i+1];
  for(const item of [base,stress]){
   assert.deepEqual(item.tradingDates,d.tradingDates);assert.deepEqual(item.universeHistory,d.universeHistory);
   assert.deepEqual(item.riskPolicy,d.riskPolicy);assert.equal(item.maxParticipationPct,1);
   assert.equal(item.minPriorTurnover,100);assert.equal(item.stopLossPct,4);
  }
  assert.deepEqual(base.feeSchedules,d.feeSchedules);assert.equal(stress.feeSchedules[0].feeBps,16);
  assert.equal(stress.feeSchedules[0].minFee,10);assert.equal(stress.feeSchedules[0].sellTaxBps,5);
  assert.equal(stress.feeSchedules[0].transferBps,1);assert.equal(stress.feeSchedules[0].knownAt,d.feeSchedules[0].knownAt);
  assert.equal(stress.feeSchedules[0].version,'original-fee:research-commission-x2');
 }
 assert.deepEqual(report.configuration.feeScheduleVersions,['original-fee']);
 assert.deepEqual(report.configuration.stress.feeScheduleVersions,['original-fee:research-commission-x2']);
 assert.equal(JSON.stringify(d),before);
});
test('unrepresentable commission stress is rejected rather than clipped or mislabeled',()=>{
 const d=declared();d.feeSchedules[0].feeBps=60;
 assert.throws(()=>evaluateResearchSuite(d,opts),/压力情景超出/);
});
