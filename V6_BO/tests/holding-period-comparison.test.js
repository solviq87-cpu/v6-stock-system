'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {runHoldingPeriodStudy,summarizeSettledNetReturns,summarizeSettledExcursions}=require('../src/core/holding-period-comparison');
const {runValidatedBacktest}=require('../src/core/historical-validation');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
const fixture=()=>({source:'fixture',asOf:'2026-03-01',stocks:[{symbol:'600000',market:'main',bars:Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:10+i*.04,high:10.1+i*.04,low:9.9+i*.04,close:10+i*.04,volume:1000000}))}]});
const child=code=>JSON.parse(execFileSync(process.execPath,['-e',code],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'}));
test('fixed periods reuse original complete reports and leave input and default workbench unchanged',()=>{
 const h=fixture(),before=JSON.stringify(h),old=runCompleteWorkbench({history:h}),next=runCompleteWorkbench({history:h,includeHoldingPeriodComparison:true}),v=next.holdingPeriodComparison;
 assert.equal(old.holdingPeriodComparison,undefined);assert.equal(JSON.stringify(h),before);
 const {holdingPeriodComparison,...unchanged}=next;assert.deepEqual(unchanged,old);
 assert.deepEqual(v.periods.map(x=>x.holdDays),[1,3,5,10,20]);
 for(const p of v.periods)assert.deepEqual(p.report,runValidatedBacktest({...h,holdDays:p.holdDays}));
 assert.equal(v.trialBudgetVerified,false);assert.equal(v.independentHoldoutCertified,false);
 assert.equal(v.eligibleForPromotion,false);assert.equal(v.canTrade,false);assert.equal(v.backtestEvaluations,5);
});
test('zero buys never become zero-return winners, and fixed protocol changes with data and costs',()=>{
 const h=fixture(),v=runHoldingPeriodStudy(h).comparison;
 assert.ok(v.periods.every(p=>p.status==='no-buy-fills'&&p.closedAccountReturnPct===null&&p.markedAccountReturnPct===null));
 assert.ok(v.periods.every(p=>p.report.metrics.returnPct===0&&p.report.orders.length===0));
 assert.notEqual(v.protocolFingerprint,runHoldingPeriodStudy({...h,feeBps:9.5}).comparison.protocolFingerprint);
 h.stocks[0].bars[0].volume++;assert.notEqual(v.datasetFingerprint,runHoldingPeriodStudy(h).comparison.datasetFingerprint);
 assert.equal(v.protocol.snapshotStage,'in-process-before-evaluation; not externally preregistered');
});
test('shared capital, fees, sell tax, limits and raw execution evidence remain original in every period',()=>{
 // Only selection is a test stub. The actual original ledger, fees, T+1,
 // holdings and close/open execution code execute in an isolated child.
 const result=child(`const H=require('./src/core/historical-validation'),scanner=require.resolve('./src/strategy/research-v2-universe-scanner');
 require.cache[scanner].exports.scanUniverse=({stocks})=>({items:stocks.map(s=>({symbol:s.symbol,tradable:true}))});
 delete require.cache[require.resolve('./src/strategy/research-v2-position-ledger-backtest')];delete require.cache[require.resolve('./src/strategy/holdout-backtest')];delete require.cache[require.resolve('./src/core/historical-validation')];
 const {runValidatedBacktest}=require('./src/core/historical-validation'),{runHoldingPeriodStudy}=require('./src/core/holding-period-comparison');
 const h=${JSON.stringify(fixture())};h.end=48;h.feeBps=9.5;h.slippageBps=13;h.sellTaxBps=6;h.initialCash=123456.78;h.maxPositionPct=50;
 const {comparison:v}=runHoldingPeriodStudy(h),assert=require('node:assert/strict');
 for(const p of v.periods){assert.deepEqual(p.report,runValidatedBacktest({...h,holdDays:p.holdDays}));assert.ok(p.buyFills>0);assert.ok(p.report.trades.every(t=>t.sellDay>t.buyDay));}
 console.log(JSON.stringify(v));`);
 assert.equal(result.protocol.configuration.initialCash,123456.78);assert.equal(result.protocol.configuration.feeBps,9.5);
 assert.equal(result.protocol.configuration.maxPositionPct,50);
 assert.ok(result.periods.some(p=>p.status==='unsettled-paper-estimate'&&p.closedAccountReturnPct===null));
 assert.ok(result.periods.some(p=>p.status==='closed-paper-estimate'&&typeof p.closedAccountReturnPct==='number'));
 assert.ok(result.periods.every(p=>p.evidenceFingerprint.length===64));
});
test('baseline period is not recomputed and custom baseline does not replace fixed research periods',()=>{
 const result=child(`const H=require('./src/core/historical-validation'),run=H.runValidatedBacktest,calls=[];H.runValidatedBacktest=h=>{calls.push(h.holdDays??1);return run(h);};
 const {runHoldingPeriodStudy}=require('./src/core/holding-period-comparison'),h=${JSON.stringify(fixture())};h.holdDays=5;const a=runHoldingPeriodStudy(h);const first=calls.splice(0);h.holdDays=7;const b=runHoldingPeriodStudy(h);console.log(JSON.stringify({first,second:calls,a:a.comparison.backtestEvaluations,b:b.comparison.backtestEvaluations}));`);
 assert.deepEqual(result.first,[5,1,3,10,20]);assert.deepEqual(result.second,[7,1,3,5,10,20]);assert.equal(result.a,5);assert.equal(result.b,6);
});
test('work and evidence budgets return unavailable without substituting or truncating original baseline',()=>{
 const result=child(`const H=require('./src/core/historical-validation'),calls=[];let big=false;H.runValidatedBacktest=h=>{calls.push(h.holdDays??1);return {dataset:{stocks:big?1:500,barsPerStock:big?60:32},metrics:{closedTrades:0},orders:[],trades:[],equity:big?Array(40001).fill({value:100000}):[],openPositions:[]};};
 const {runHoldingPeriodStudy}=require('./src/core/holding-period-comparison'),h=${JSON.stringify(fixture())};const a=runHoldingPeriodStudy(h);const first=calls.splice(0);big=true;const b=runHoldingPeriodStudy(h);console.log(JSON.stringify({a:a.comparison,first,b:b.comparison,second:calls,baselineRows:b.baseline.equity.length}));`);
 assert.equal(result.a.status,'unavailable');assert.deepEqual(result.first,[1]);assert.deepEqual(result.a.periods,[]);
 assert.equal(result.b.status,'unavailable');assert.deepEqual(result.second,[1]);assert.deepEqual(result.b.periods,[]);assert.equal(result.baselineRows,40001);
});
test('failed period keeps failure receipt and never publishes a favorable partial list',()=>{
 const r=child(`const H=require('./src/core/historical-validation'),run=H.runValidatedBacktest;H.runValidatedBacktest=h=>{if(h.holdDays===3)throw Error('isolated failed period');return run(h);};const {runHoldingPeriodStudy}=require('./src/core/holding-period-comparison');console.log(JSON.stringify(runHoldingPeriodStudy(${JSON.stringify(fixture())})));`);
 assert.equal(r.comparison.status,'unavailable');assert.deepEqual(r.comparison.periods,[]);
 assert.deepEqual(r.comparison.attempts.map(x=>[x.holdDays,x.status]),[[1,'completed'],[3,'failed']]);
 assert.match(r.comparison.attempts[1].reason,/isolated failed/);assert.ok(r.baseline.equity.length>0);
});
test('original historical gates and malformed opt-in still reject instead of weakening risk or price basis',()=>{
 const h=fixture();for(const flag of ['true',1,null,{},[]])assert.throws(()=>runCompleteWorkbench({history:h,includeHoldingPeriodComparison:flag}),/布尔/);
 for(const mutate of [h=>h.feeBps=-1,h=>h.priceBasis='qfq',h=>h.stocks[0].bars[1].date=h.stocks[0].bars[0].date]){
  const bad=fixture();mutate(bad);assert.throws(()=>runHoldingPeriodStudy(bad));
 }
});
test('original holdout is retained separately by period without certifying untouched validation',()=>{
 const h=fixture();h.splitDay=40;const v=runHoldingPeriodStudy(h).comparison;
 assert.ok(v.periods.every(p=>p.report.holdout.status==='evaluated'));
 for(const p of v.periods)assert.deepEqual(p.report.holdout,runValidatedBacktest({...h,holdDays:p.holdDays}).holdout);
 assert.equal(v.independentHoldoutCertified,false);assert.equal(v.workUnits,900);
});

test('F20.2 original settled portions retain negative, zero and positive net return and disclose exclusions',()=>{
 const trade=(symbol,pnl,extra={})=>({symbol,buyDay:1,sellDay:2,shares:100,costBasis:1000,netPnl:pnl,...extra});
 const report={trades:[trade('600000',-100),trade('600000',0),trade('600000',200),trade('000001',1000),trade('600001',10,{costBasis:0})],
  metrics:{closedTrades:5},orders:[{symbol:'000001',status:'corporate-action'}],cashFlows:[]};
 const before=JSON.stringify(report),d=summarizeSettledNetReturns(report);
 assert.equal(d.status,'descriptive-only');assert.equal(d.totalSettledRecords,5);assert.equal(d.usableRecords,3);assert.equal(d.excludedRecords,2);
 assert.equal(d.coveragePct,60);assert.deepEqual([d.p10Pct,d.p50Pct,d.p90Pct,d.empiricalWidthPct],[-10,0,20,30]);
 assert.equal(d.predictiveCoverage,null);assert.equal(d.independentSamplesCertified,false);assert.equal(d.canTrade,false);
 assert.equal(JSON.stringify(report),before);
});
test('F20.2 missing, no settlement, and malformed ledger never produce a zero return distribution',()=>{
 const base={trades:[],metrics:{closedTrades:0},orders:[],cashFlows:[]};
 const empty=summarizeSettledNetReturns(base);assert.equal(empty.status,'no-usable-settled-records');assert.equal(empty.coveragePct,null);assert.equal(empty.p50Pct,null);
 assert.equal(summarizeSettledNetReturns({...base,metrics:{closedTrades:1}}).status,'unavailable');
 assert.equal(summarizeSettledNetReturns({...base,cashFlows:[{kind:'unclassified'}]}).status,'unavailable');
 const v=runHoldingPeriodStudy(fixture()).comparison;
 assert.ok(v.periods.every(p=>p.settledNetDistribution.usableRecords===0&&p.settledNetDistribution.p50Pct===null));
});
test('F20.2 multi-period output consumes the original ledger distribution without modifying original trade rows',()=>{
 const r=child(`const scanner=require.resolve('./src/strategy/research-v2-universe-scanner');
 require(scanner).scanUniverse=({stocks})=>({items:stocks.map(s=>({symbol:s.symbol,tradable:true}))});
 const {runHoldingPeriodStudy}=require('./src/core/holding-period-comparison');const h=${JSON.stringify(fixture())};h.end=48;
 console.log(JSON.stringify(runHoldingPeriodStudy(h).comparison));`);
 assert.ok(r.periods.some(p=>p.settledNetDistribution.usableRecords>0));
 for(const p of r.periods)assert.deepEqual(p.settledNetDistribution,summarizeSettledNetReturns(p.report));
});

test('F20.3 modeled opening paths exclude exit-session later extrema and keep net return separate',()=>{
 const h=fixture(),bars=h.stocks[0].bars;
 Object.assign(bars[28],{open:10,high:12,low:9,close:11,volume:100});
 Object.assign(bars[29],{open:11,high:99,low:1,close:11,volume:100});
 const trade={symbol:'600000',buyDay:28,sellDay:29,shares:100,entry:10,exit:11,costBasis:1005,netPnl:85};
 const report={trades:[trade],metrics:{closedTrades:1},orders:[
  {symbol:'600000',day:28,side:'buy',status:'filled',shares:200,price:10},
  {symbol:'600000',day:29,side:'sell',status:'filled',shares:100,price:11}],cashFlows:[]};
 const d=summarizeSettledExcursions(h,report),r=d.rows[0];
 assert.equal(d.usableRecords,1);assert.equal(r.mfePct,20);assert.equal(r.maePct,-10);
 assert.equal(r.netReturnPct,Number((8500/1005).toFixed(6)));assert.equal(r.extremaOrder,'unknown');
 assert.equal(d.intradayOrderKnown,false);assert.equal(d.canTrain,false);assert.equal(d.executionCertified,false);
});
test('F20.3 incomplete or corporate-action path and mismatched fills remain unknown rather than zero',()=>{
 const h=fixture(),trade={symbol:'600000',buyDay:28,sellDay:30,shares:100,entry:11.12,exit:11.2,costBasis:1120,netPnl:-5};
 const report={trades:[trade],metrics:{closedTrades:1},orders:[
  {symbol:'600000',day:28,side:'buy',status:'filled',shares:100,price:trade.entry},
  {symbol:'600000',day:30,side:'sell',status:'filled',shares:100,price:trade.exit}],cashFlows:[]};
 for(const mutate of [(h,r)=>{h.stocks[0].bars[29].volume=0;},(h,r)=>{h.stocks[0].bars[29].suspended=true;},
  (h,r)=>{r.orders[1].price+=1;},(h,r)=>{r.cashFlows.push({symbol:'600000',kind:'corporate-action'});},
  (h,r)=>{delete h.stocks[0].bars[29].date;}]){
  const x=structuredClone(h),y=structuredClone(report);mutate(x,y);
  const d=summarizeSettledExcursions(x,y);assert.equal(d.usableRecords,0);assert.equal(d.rows[0].mfePct,null);assert.equal(d.rows[0].maePct,null);
 }
 const empty=summarizeSettledExcursions(h,{trades:[],metrics:{closedTrades:0},orders:[],cashFlows:[]});
 assert.equal(empty.coveragePct,null);assert.equal(empty.meanMfePct,null);
});
test('F20.3 original multi-period report links each path to an original settled row without rewriting the ledger',()=>{
 const result=child(`const scanner=require.resolve('./src/strategy/research-v2-universe-scanner');require(scanner).scanUniverse=({stocks})=>({items:stocks.map(s=>({symbol:s.symbol,tradable:true}))});const {runHoldingPeriodStudy}=require('./src/core/holding-period-comparison');const h=${JSON.stringify(fixture())};h.end=48;console.log(JSON.stringify(runHoldingPeriodStudy(h).comparison));`);
 assert.ok(result.periods.some(p=>p.settledExcursions.usableRecords>0));
 for(const p of result.periods){
  assert.equal(p.settledExcursions.rows.length,p.report.trades.length);
  for(const row of p.settledExcursions.rows)assert.equal(row.symbol,p.report.trades[row.tradeIndex].symbol);
 }
});
