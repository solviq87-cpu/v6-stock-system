'use strict';
// Deterministic fixtures for the original internal read boundary, never market
// observations, production calendars, or a substitute for account-service tests.
const test=require('node:test'),assert=require('node:assert/strict');
const {accountExitDiagnostics}=require('../src/core/advanced-account-risk');
const {portfolioHistory}=require('../src/core/advanced-portfolio-runtime');
const api=require('../src/core/advanced-portfolio-evidence');
const {fixtures,withEquityEvidence,historyFixture,current,day,now,priorDay,close,hash}=require('./helpers/advanced-portfolio-fixture');

test('original risk-center consumer exposes capacity, previews, exit costs and paired historical evidence without writes',()=>{
 const {book,input}=fixtures(),before=JSON.stringify({book,input}),report=accountExitDiagnostics(book,input),p=report.portfolioEvidence;
 assert.equal(report.status,'observed-unverified');assert.equal(p.mode,'original-account-portfolio-evidence');
 assert.equal(p.coverage.verifiedPlanReceipts,1);assert.equal(p.coverage.alignedSamples,220);assert.equal(p.coverage.returnBasis,'adjusted-price');
 assert.equal(p.capacity.length,2);assert.equal(p.capacity[0].feeVersion,'original-fees-v1');assert.equal(p.capacity[0].rows.length,3);
 assert.equal(p.previews[0].quantity,900);assert.equal(p.previews[0].cashAfter,995);assert.equal(p.previews[0].previewBlocked,false);
 assert.equal(p.previews[0].riskBudgetAfter.policyScope,'original-plan-effective-position-cap');assert.equal(p.previews[0].riskBudgetAfter.budgets[0].limitPct,50);assert.equal(p.previews[0].riskBudgetAfter.budgets[0].remainingAfterEstimatedFee,997.5);
 assert.equal(p.previews[0].incrementalPortfolioRisk.sampleCount,220);assert.ok(Number.isFinite(p.previews[0].incrementalPortfolioRisk.metrics.dailyVolatility.change));
 assert.equal(p.tail.sampleCount,220);assert.equal(p.tail.tailCount,11);assert.equal(p.tail.returnBasis,'adjusted-price');assert.ok(Number.isFinite(p.tail.historicalES));
 for(const [contribution,total] of [['volatilityContribution','dailyVolatility'],['downsideContribution','dailyDownsideDeviation'],['varScenarioContribution','historicalVaR'],['tailLossContribution','historicalES']])assert.ok(Math.abs(p.tail.contributions.reduce((sum,row)=>sum+row[contribution],0)-p.tail[total])<1e-7);
 assert.ok(report.positions[0].estimatedMarketImpact>0);assert.ok(report.positions[0].estimatedExitCost>report.positions[0].estimatedFee);assert.equal(report.positions[0].conditionalSessions,1);
 assert.equal(p.opportunityComparisons.length,1);assert.equal(p.opportunityComparisons[0].sampleCount,44);assert.equal(p.opportunityComparisons[0].automaticSwitch,false);assert.equal(p.opportunityComparisons[0].candidate.historicalES,null);
 assert.equal(p.performance.reason,'MISSING_AUTHORITATIVE_EQUITY_BOUNDARIES');assert.equal(p.performance.timeWeightedReturn,null);assert.equal(p.canTrade,false);assert.equal(p.writesAccount,false);
 assert.equal(JSON.stringify({book,input}),before);assert.equal(report.completeReconciliation,false);assert.equal(report.reconciliation.completeExternalReconciliation,false);assert.equal(report.defensive.state,'open');
});

test('stale, future, revised-price, revised-source and changed-account receipts cannot produce a position preview',()=>{
 for(const mutate of [x=>{x.receipt.checkedAt=now-5001;},x=>{x.receipt.checkedAt=now+1;},x=>{x.receipt.accountRevision++;},x=>{x.receipt.accountFingerprint=hash('different-account');},x=>{x.receipt.planId+='0';},x=>{x.receipt.decisionId=hash('other-decision');},x=>{x.receipt.maxPositionPct=51;},x=>{x.input.quotes['600001'].quote.price=10.01;},x=>{x.input.quotes['600001'].quote.quoteSource='different-provider';},x=>{x.input.quotes['600001'].quote.quoteAt=now-16000;},x=>{x.plan.entryMax=12;}]){
  const x=fixtures();mutate(x);const report=accountExitDiagnostics(x.book,x.input).portfolioEvidence;
  assert.equal(report.coverage.verifiedPlanReceipts,0);assert.equal(report.previews[0].status,'unknown');assert.equal(report.previews[0].previewBlocked,true);assert.equal(report.opportunityComparisons.length,0);
 }
});

test('account and exit evidence survives absent or over-budget optional context; paused sessions keep cost unknown',()=>{
 const {book,input}=fixtures();
 const missing=accountExitDiagnostics(book,{...input,portfolioContext:undefined,portfolioContextStatus:'invalid-or-over-budget'});
 assert.equal(missing.cash,10000);assert.equal(missing.positions[0].estimatedFee,10);assert.equal(missing.positions[0].estimatedMarketImpact,null);assert.equal(missing.portfolioEvidence.tail.status,'unknown');assert.ok(missing.portfolioEvidence.coverage.missing.includes('PORTFOLIO_CONTEXT_OVER_BUDGET'));
 const closed=accountExitDiagnostics(book,{...input,marketOpen:false,continuous:false});assert.equal(closed.positions[0].sellable,null);assert.equal(closed.positions[0].conditionalSessions,null);assert.equal(closed.positions[0].estimatedExitCost,null);
 input.quotes['600000'].limitDown=true;
 const down=accountExitDiagnostics(book,input);assert.equal(down.positions[0].conditionalSessions,null);assert.equal(down.positions[0].estimatedExitCost,null);assert.equal(down.portfolioEvidence.opportunityComparisons[0].status,'unknown');
 input.quotes['600000'].limitDown=false;input.quotes['600000'].quote.quoteAt=now-10000;
 assert.equal(accountExitDiagnostics(book,input).portfolioEvidence.opportunityComparisons[0].reason,'QUOTE_AS_OF_NOT_COMPARABLE');
});

test('original corporate lot with explicit same-day release remains sellable while ordinary new lots remain T+1',()=>{
 const {book,input}=fixtures();book.account.positions['600000'].lots=[{quantity:1000,buyDate:day,sellableDate:day,price:0,fee:0,cost:0,sourceActionId:'corporate-1'}];book.corporateEvents=[{eventId:'corporate-1',symbol:'600000',shareDelta:1000,cashDelta:0,effectiveDate:day}];
 const released=accountExitDiagnostics(book,input);assert.equal(released.status,'observed-unverified');assert.equal(released.positions[0].sellable,1000);
 delete book.account.positions['600000'].lots[0].sellableDate;
 assert.equal(accountExitDiagnostics(book,input).positions[0].sellable,0);
});

test('history requires original independent source admission, explicit calendar edges and available versions',()=>{
 const base=historyFixture(),params={codes:['600000','600001'],now,day};
 assert.equal(portfolioHistory(base,params).observations(params.codes).length,220);
 const one={...base,bars:base.bars.filter(r=>r.source==='baostock')};assert.equal(portfolioHistory(one,params).observations(params.codes).length,0);
 const future={...base,bars:base.bars.map(r=>({...r,availableAt:now+1}))};assert.equal(portfolioHistory(future,params).observations(params.codes).length,0);
 const unversioned={...base,bars:base.bars.map(r=>({...r,archiveHash:null}))};assert.equal(portfolioHistory(unversioned,params).coverage.reason,'ORIGINAL_HISTORY_VERSION_UNAVAILABLE');
 const noEdge=structuredClone(base);delete noEdge.marketCalendars.CN.nextEvidenceByDay[priorDay];assert.equal(portfolioHistory(noEdge,params).prior('600000'),null);
 const gap=structuredClone(base);const gapDay=gap.marketCalendars.CN.days[100];delete gap.marketCalendars.CN.nextEvidenceByDay[gapDay];assert.equal(portfolioHistory(gap,params).observations(params.codes).length,219);
 const bad=structuredClone(base);for(const row of bad.bars)if(row.source==='baostock')row.close*=1.5;assert.equal(portfolioHistory(bad,params).observations(params.codes).length,0);
});

test('future receipt mutations never alter earlier as-of historical metrics or source version',()=>{
 const {book,input}=fixtures(),before=accountExitDiagnostics(book,input).portfolioEvidence;
 input.portfolioContext.history.bars.push(...input.portfolioContext.history.bars.slice(0,3).map(r=>({...r,knownAt:now+1000,observedAt:now+1000,availableAt:now+1000,close:r.close*2})));
 const after=accountExitDiagnostics(book,input).portfolioEvidence;
 assert.deepEqual(after.tail,before.tail);assert.equal(after.coverage.dataVersion,before.coverage.dataVersion);assert.deepEqual(after.previews,before.previews);
});

test('capacity fees use the original estimator, and exit amount and volume constraints both bind',()=>{
 const prior={date:priorDay,source:'original',dataVersion:'v1',availableAt:close(priorDay),priceBasis:'hfq',turnoverBasis:'original-turnover',amountUnit:'CNY',evidenceKind:'historical',volume:1000000,volumeUnit:'shares',amount:100000};
 const value=api.capacityScenarios({prior,asOf:now,price:10,lotSize:100,capitalLevels:[1000,10000],targetWeight:1,maxParticipationPct:1,feeBps:0,impactBpsAtLimit:50,feeEstimator:()=>5});
 assert.equal(value.rows[0].estimatedShares,0);assert.equal(value.rows[1].estimatedShares,100);assert.equal(value.rows[1].estimatedFee,5);
 const exit=api.exitRisk({position:{symbol:'600000',quantity:300,sellable:300},quote:current('600000').quote,now,limitDown:false,suspended:false,prior,maxParticipationPct:1});
 assert.equal(exit.historicalDailyShares,100);assert.equal(exit.conditionalSessions,3);assert.ok(exit.alerts.some(x=>x.code==='LIQUIDITY_EXIT'));
 assert.equal(api.capacityScenarios({prior:{...prior,turnoverBasis:null},asOf:now,price:10,lotSize:100,capitalLevels:[1000],targetWeight:1,maxParticipationPct:1,feeBps:0,impactBpsAtLimit:50}).reason,'PRIOR_LIQUIDITY_UNAVAILABLE');
});

test('position risk budgets reuse original policy and pending exposure without replacing original gate',()=>{
 const snapshot={evidenceRef:'original-book',cash:6000,availableCash:4000,equity:10000,positions:[{symbol:'600000',marketValue:4000,industry:'bank',strategy:'s1'}]},plan={evidenceRef:'frozen-plan',symbol:'600001',quantity:100,price:10,fee:5,industry:'bank',strategy:'s1'};
 const riskContext={evidenceRef:'original-risk-policy',policy:{version:'risk-v1',maxPositionPct:25,maxGrossExposurePct:60,maxSectorPct:70,maxStrategyPct:70},pending:[{symbol:'600000',quantity:200,price:10,strategyId:'s1'}]};
 const value=api.previewPosition({snapshot,plan,gate:{status:'unknown',evidenceRef:'original-gate'},riskContext});
 assert.equal(value.previewBlocked,true);assert.equal(value.riskBudgetAfter.policyVersion,'risk-v1');assert.equal(value.riskBudgetAfter.estimatedConstraintsSatisfied,false);assert.ok(value.riskBudgetAfter.reasonCodes.includes('GROSS_EXPOSURE_LIMIT'));
 const gross=value.riskBudgetAfter.budgets.find(x=>x.kind==='gross');assert.equal(gross.exposureAfter,7000);assert.equal(gross.remainingAtOriginalEquity,-1000);assert.equal(gross.remainingAfterEstimatedFee,-1003);assert.equal(value.canTrade,false);
});

test('historical VaR attribution averages boundary ties and all risk contributions reconcile by stock and group',()=>{
 const start=close('2025-01-01'),observations=Array.from({length:220},(_,i)=>({date:new Date(start+i*86400000).toISOString().slice(0,10),availableAt:start+(i+1)*86400000,source:'isolated-original-history',dataVersion:'v1',evidenceKind:'historical',returnBasis:'total-return',returns:{'600000':i%2?-.04:0,'600001':i%2?.02:-.02}}));
 const value=api.tailRisk({assets:[{symbol:'600000',weight:.5,industry:'a'},{symbol:'600001',weight:.5,industry:'b'}],observations,asOf:start+221*86400000});
 assert.equal(value.varBoundaryScenarioCount,220);assert.equal(value.varAttributionBasis,'kth-worst-loss-boundary-equal-loss-scenarios-averaged');
 assert.equal(value.contributions[0].varScenarioContribution,.01);assert.equal(value.contributions[1].varScenarioContribution,0);
 for(const rows of [value.contributions,value.industryContributions,value.themeContributions])for(const [field,total] of [['downsideContribution','dailyDownsideDeviation'],['varScenarioContribution','historicalVaR'],['tailLossContribution','historicalES']])assert.ok(Math.abs(rows.reduce((sum,x)=>sum+x[field],0)-value[total])<1e-7);
});

test('a missing held asset is never reweighted away and unknown classifications retain their group',()=>{
 const {book,input}=fixtures();book.account.positions['600002']={quantity:100,lots:[{quantity:100,buyDate:priorDay,price:10,fee:0,cost:1000,sourceEventId:'opening-600002'}]};input.quotes['600002']=current('600002');
 const value=accountExitDiagnostics(book,input).portfolioEvidence;assert.equal(value.tail.status,'unknown');assert.equal(value.previews[0].incrementalPortfolioRisk.status,'unknown');assert.ok(value.previews[0].industry.some(x=>x.group==='未分类'));
});

test('flow-adjusted performance separates deposits and requires exact flow equation and same benchmark period',()=>{
 const initialAt=close('2025-01-01'),at=initialAt+365*86400000;
 const rows=[{at,equityBeforeFlow:11000,externalFlow:9000,equityAfterFlow:20000,evidenceRef:'original-deposit'}];
 const result=api.cashFlowPerformance({initialAt,initialEquity:10000,rows,asOf:at,benchmark:{source:'same-period-benchmark',dataVersion:'b1',knownAt:at,initialAt,finalAt:at,initialValue:100,finalValue:105}});
 assert.equal(result.investmentPnl,1000);assert.equal(result.externalNetFlow,9000);assert.equal(result.timeWeightedReturn,.1);assert.equal(result.moneyWeightedAnnualReturn,.1);assert.equal(result.benchmarkExcess,.05);assert.equal(result.riskAdjustedReturn,null);
 assert.equal(api.cashFlowPerformance({initialAt,initialEquity:10000,rows,asOf:at-1}).status,'unknown');
 assert.equal(api.cashFlowPerformance({initialAt,initialEquity:10000,rows:[{...rows[0],equityAfterFlow:20001}],asOf:at}).status,'unknown');
 const mismatched=api.cashFlowPerformance({initialAt,initialEquity:10000,rows,asOf:at,benchmark:{source:'b',dataVersion:'v',initialAt:initialAt+1,finalAt:at,initialValue:100,finalValue:105}});assert.equal(mismatched.benchmarkReturn,null);
});

test('Sharpe, Sortino and drawdown require linked consecutive equity boundaries; intraday or skipped sessions stay unknown',()=>{
 const initialAt=close('2025-01-01'),rows=[],edges={};let equity=10000,previous='2025-01-01';
 for(let i=1;i<=70;i++){
  const at=initialAt+i*86400000,date=new Date(at+28800000).toISOString().slice(0,10),before=equity*(i%2?1.01:.995),externalFlow=i===30?5000:0;
  rows.push({at,equityBeforeFlow:before,externalFlow,equityAfterFlow:before+externalFlow,evidenceRef:'equity-'+i});equity=before+externalFlow;edges[previous]={nextTradingDay:date,source:'explicit-calendar',knownAt:at};previous=date;
 }
 const asOf=rows.at(-1).at,dailyEvidence={source:'original-equity-journal',dataVersion:'e1',knownAt:asOf,riskFreeAnnual:0,riskFreeBasis:'explicit-zero-assumption',calendar:{source:'explicit-calendar',knownAt:asOf,nextEvidenceByDay:edges}};
 const result=api.cashFlowPerformance({initialAt,initialEquity:10000,rows,asOf,dailyEvidence});assert.ok(Number.isFinite(result.riskAdjustedReturn.sharpe));assert.ok(Number.isFinite(result.riskAdjustedReturn.sortino));assert.ok(result.riskAdjustedReturn.maximumFlowAdjustedDrawdown>0);assert.equal(result.externalNetFlow,5000);
 const missing=structuredClone(dailyEvidence);delete missing.calendar.nextEvidenceByDay['2025-01-20'];assert.equal(api.cashFlowPerformance({initialAt,initialEquity:10000,rows,asOf,dailyEvidence:missing}).riskAdjustedReturn,null);
 assert.equal(api.cashFlowPerformance({initialAt:initialAt-1000,initialEquity:10000,rows,asOf,dailyEvidence}).riskAdjustedReason,'INTRADAY_FLOW_BOUNDARIES_NOT_DAILY_RETURNS');
});

test('paired opportunity comparison rejects incomparable capital and future observations; costs change both net legs',()=>{
 const h=portfolioHistory(historyFixture(),{codes:['600000','600001'],now,day}),observations=h.observations(['600000','600001']);
 const input={hold:{symbol:'600000',notional:10000,exitCost:10,evidenceRef:'hold'},candidate:{symbol:'600001',notional:9900,entryCost:20,exitCost:10,cashRemainder:80,evidenceRef:'candidate'},observations,asOf:now,horizon:5,returnBasis:'adjusted-price'};
 const r=api.compareOpportunity(input);assert.equal(r.sampleCount,44);assert.equal(r.incrementalTransactionCost,20);assert.equal(r.recommendation,null);
 const expensive=api.compareOpportunity({...input,candidate:{...input.candidate,exitCost:110}});assert.ok(Math.abs(expensive.meanNetDifference-r.meanNetDifference+.01)<1e-8);
 assert.equal(api.compareOpportunity({...input,candidate:{...input.candidate,cashRemainder:90}}).status,'unknown');
 assert.equal(api.compareOpportunity({...input,observations:[...observations.slice(0,-1),{...observations.at(-1),availableAt:now+1}]}).status,'unknown');
});

test('runtime performance accepts linked original equity evidence and rejects another account, reset period, future receipt or mismatched final equity',()=>{
 const good=withEquityEvidence(),p=accountExitDiagnostics(good.book,good.input).portfolioEvidence.performance;
 assert.equal(p.status,'estimated-unverified');assert.equal(p.externalNetFlow,2000);assert.ok(Number.isFinite(p.riskAdjustedReturn.sharpe));assert.ok(Number.isFinite(p.moneyWeightedAnnualReturn));
 for(const mutate of [e=>{e.account='pre';},e=>{e.periodId='original-period-1';},e=>{e.accountRevision++;},e=>{e.bookFingerprint=hash('other-book');},e=>{e.knownAt=now+1;},e=>{e.rows.at(-1).equityAfterFlow++;},e=>{e.rows[0].knownAt=e.rows[0].at-1;}]){
  const f=withEquityEvidence();mutate(f.input.portfolioContext.equityEvidence.pool);
  const value=accountExitDiagnostics(f.book,f.input).portfolioEvidence.performance;assert.equal(value.status,'unknown');assert.equal(value.timeWeightedReturn,null);assert.equal(value.reason,'UNBOUND_OR_FUTURE_EQUITY_EVIDENCE');
 }
});

test('the real bounded worker consumes original persisted history and the original account read without changing either file',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),H=require('../src/core/center-history');
 const {createPaperApplicationService}=require('../src/core/paper-application-service'),{aShareCalendarDate}=require('../src/core/a-share-calendar');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-portfolio-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const accounts=path.join(root,'accounts'),historyRoot=path.join(root,'history');fs.mkdirSync(accounts);
 const liveDay=aShareCalendarDate(Date.now()),end=new Date(Date.parse(liveDay)-86400000).toISOString().slice(0,10),receivedAt=close(end)+3600000,code='600000';
 const dates=Array.from({length:61},(_,i)=>new Date(Date.parse(end)-(60-i)*86400000).toISOString().slice(0,10)),calendarDates=[...dates,liveDay],price=i=>10+(i%2?.03:-.02)+i*.001;
 const east=Buffer.from(JSON.stringify({rc:0,data:{code,market:1,name:'isolated test security',klines:dates.map((d,i)=>[d,price(i),price(i),price(i)+.1,price(i)-.1,10000,10000000,2,0,0,1].join(','))}}));
 const bao=Buffer.from(JSON.stringify({schemaVersion:1,source:'baostock',code,captureKind:'sdk-field-snapshot',startedAt:receivedAt,receivedAt:receivedAt+100,completedAt:receivedAt+150,request:{frequency:'d',adjustflag:'1',start:dates[0],end},rows:dates.map((date,i)=>({date,code:'sh.'+code,open:String(price(i)),high:String(price(i)+.1),low:String(price(i)-.1),close:String(price(i)),volume:'1000000',amount:'10000000',adjustflag:'1',tradestatus:'1',turn:'1'})),calendar:{source:'baostock:query_trade_dates',receivedAt:receivedAt+150,start:dates[0],end:liveDay,rows:calendarDates.map(date=>({calendar_date:date,is_trading_day:'1'}))},canTrade:false,canNotify:false}));
 const capture=await H.collectCenterHistory({root:historyRoot,code,day:end,historyDays:61},{clock:()=>receivedAt+200,fetchEastmoney:async()=>H.normalizeEastmoney(east,{code,day:end,historyDays:61,receivedAt}),fetchBaoStock:async()=>H.normalizeBaoStock(bao,{code,day:end,historyDays:61,receivedAt:receivedAt+200})});
 assert.equal(capture.admittedGroups,61);
 const pool=path.join(accounts,'pool.json'),pre=path.join(accounts,'pre.json');
 createPaperApplicationService({file:pool}).adoptLegacy({initial:20000,cash:10000,realized:0,enabled:true,positions:{[code]:{shares:1000,buyTs:close(end)-3600000,buyPrice:10,basis:10000}},trades:[]});
 createPaperApplicationService({file:pre}).initialize(10000);
 const bytes=directory=>fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?bytes(path.join(directory,entry.name)):[[path.relative(root,path.join(directory,entry.name)),hash(fs.readFileSync(path.join(directory,entry.name)))]]);
 const before=bytes(root),requestAt=Date.now();
 const report=await require('../src/server/advanced-account-risk-job').runAdvancedAccountRiskJob({root:accounts,historyRoot,day:liveDay,requestAt,replica:false,marketOpen:true,continuous:true,quotes:{[code]:{quote:{code,price:10,quoteAt:requestAt-1000,receivedAt:requestAt,quoteSource:'provider',canTrade:true},suspended:false,limitDown:false}},portfolioContext:{plans:{pool:[],pre:[]},planChecks:{pool:{},pre:{}}}});
 assert.equal(report.status,'observed');const p=report.accounts[0].portfolioEvidence;
 assert.equal(p.mode,'original-account-portfolio-evidence');assert.equal(p.coverage.alignedSamples,60);assert.equal(p.tail.sampleCount,60);assert.equal(p.tail.historicalES,null);assert.equal(p.capacity[0].rows.length,3);assert.equal(p.exits[0].conditionalSessions,1);assert.equal(p.canTrade,false);
 assert.deepEqual(bytes(root),before);
});

test('F24.4 cash scenario uses original available cash, not cash including reservations or hypothetical proceeds',()=>{
 const h=portfolioHistory(historyFixture(),{codes:['600001'],now,day}),observations=h.observations(['600001']);
 const snapshot={evidenceRef:'original-book',cash:10000,availableCash:7500};
 const candidate={symbol:'600001',notional:7000,entryCost:25,exitCost:30,evidenceRef:'original-gate'};
 const input={snapshot,candidate,observations,asOf:now,horizon:5,returnBasis:'adjusted-price'};
 const r=api.compareAvailableCash(input);
 assert.equal(r.status,'estimated-unverified');assert.equal(r.capital,7500);assert.equal(r.uninvestedCash,475);
 assert.equal(r.sampleCount,44);assert.equal(r.cashBaseline.meanNetReturn,0);assert.equal(r.cashBaseline.actualYieldVerified,false);
 assert.equal(r.canTrade,false);assert.equal(r.writesAccount,false);assert.equal(r.recommendation,null);
 for(const change of [{availableCash:null},{availableCash:0},{availableCash:7000},{availableCash:10001}])
  assert.equal(api.compareAvailableCash({...input,snapshot:{...snapshot,...change}}).status,'unknown');
 const expensive=api.compareAvailableCash({...input,candidate:{...candidate,exitCost:105}});
 assert.ok(Math.abs(expensive.meanNetDifference-r.meanNetDifference+.01)<1e-7);
 assert.equal(api.compareAvailableCash({...input,observations:[...observations.slice(0,-1),{...observations.at(-1),availableAt:now+1}]}).status,'unknown');
});
test('F24.4 original account risk consumer supplies independent candidate cash comparisons and leaves authority unchanged',()=>{
 const f=fixtures(),before=JSON.stringify(f),report=accountExitDiagnostics(f.book,f.input),p=report.portfolioEvidence;
 assert.equal(p.cashBaseline.availableCash,report.availableCash);assert.equal(p.cashBaseline.availableCash,10000);
 assert.equal(p.cashBaseline.reservedCash,0);assert.equal(p.cashComparisons.length,1);
 assert.equal(p.cashComparisons[0].status,'estimated-unverified');assert.equal(p.cashComparisons[0].capital,report.availableCash);
 assert.equal(p.cashComparisons[0].quantity,900);assert.equal(p.cashComparisons[0].canTrade,false);
 assert.equal(JSON.stringify(f),before);
 f.receipt.checkedAt=now-5001;
 const stale=accountExitDiagnostics(f.book,f.input).portfolioEvidence;
 assert.equal(stale.cashBaseline.availableCash,10000);assert.equal(stale.cashComparisons[0].status,'unknown');
 assert.equal(stale.cashComparisons[0].candidate,undefined);
});

test('F24.1 original held-lot protection is distinct from new candidate and missing imported holding remains unknown',()=>{
 const {book,input}=fixtures(),d=accountExitDiagnostics(book,input).portfolioEvidence.opportunityComparisons[0];
 assert.equal(d.originalHoldingProtection.status,'unknown');assert.equal(d.originalHoldingProtection.stop,null);
 assert.equal(d.candidateDecisionId,input.portfolioContext.plans.pool[0].decisionId);
 assert.equal(d.reservedCash,0);assert.equal(d.availableCash,10000);assert.equal(d.actualSaleProceeds,null);assert.equal(d.replacementAuthorized,false);
 const {originalHoldingProtection}=require('../src/core/advanced-portfolio-runtime'),plan=structuredClone(input.portfolioContext.plans.pool[0]);
 plan.code='600000';plan.intendedDate=priorDay;plan.frozenAt=new Date(close(priorDay)-60000).toISOString();
 Object.assign(plan.decisionEvidence,{code:plan.code,day:priorDay});
 const e={eventId:'original-buy',symbol:plan.code,side:'buy',tradeDate:priorDay,timestamp:close(priorDay)-30000,quantity:1000,price:10,
  reason:'作战台计划['+plan.id+'] 原账户风控'};
 const position=book.account.positions['600000'];position.lots[0].sourceEventId=e.eventId;book.account.events=[e];
 const r=originalHoldingProtection(book,position,[plan],now);
 assert.equal(r.status,'observed-unverified');assert.equal(r.planId,plan.id);assert.equal(r.entryEventId,e.eventId);assert.equal(r.stop,8);
 assert.equal(r.logicTextVerified,false);assert.equal(r.canTrade,false);
 assert.equal(originalHoldingProtection(book,position,[plan,plan],now).status,'unknown');
 const wrong=structuredClone(plan);wrong.stop=7;assert.equal(originalHoldingProtection(book,position,[wrong],now).status,'unknown');
});
