'use strict';
// Isolated synthetic inputs test calculations and fail-closed behaviour; none
// of these fixtures are real market observations or production acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../src/core/deep-decision-research'),S=require('../src/core/research-workspace-store');
const now=Date.now()-10000,copy=x=>structuredClone(x);
function portfolio(at=now){return {
  account:{authorityRef:'authority-test-only',revision:7,observedAt:at,equity:100000,cash:60000,availableCash:60000,pendingOrders:0,pendingBuyOrders:0,pendingSellOrders:0,positions:[{symbol:'600000',quantity:4000,availableQuantity:3000}]},
  candidates:[
    {symbol:'600000',sector:'金融',strategyId:'fourteen',quote:{price:10,quoteAt:at-1000,receivedAt:at-900,quoteSource:'recorded-source'},estimate:{expectedReturn:.06,standardError:.01,volatility:.08,horizonDays:5,sampleCount:60,source:'frozen-research-model',knownAt:at-2000},liquidity:{averageDailyAmount:10000000,source:'dated-volume',knownAt:at-2000}},
    {symbol:'600001',sector:'制造',strategyId:'bazi',quote:{price:20,quoteAt:at-1000,receivedAt:at-900,quoteSource:'recorded-source'},estimate:{expectedReturn:.045,standardError:.005,volatility:.06,horizonDays:5,sampleCount:60,source:'frozen-research-model',knownAt:at-2000},liquidity:{averageDailyAmount:10000000,source:'dated-volume',knownAt:at-2000}}
  ],
  correlation:{symbols:['600000','600001'],matrix:[[1,.2],[.2,1]],horizonDays:5,sampleCount:60,source:'aligned-historical-returns',knownAt:at-2000},
  constraints:{version:'original-risk-test',maxPositions:3,maxGrossWeight:.8,maxSingleWeight:.5,maxSectorWeight:.5,maxVolatility:.12,maxParticipation:.01,minimumCashWeight:.2,riskAversion:2},
  costs:{feePolicy:{version:'dated-fees',feeBps:3,minFee:5,sellTaxBps:5},slippageBps:10,impactBps:5,uncertaintyBps:3,source:'dated-cost-assumptions',knownAt:at-2000},horizonDays:5
};}
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-deep-decision-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private');}
function freezeInput(at=now){return {decisionRef:'decision-001',informationCutoff:at,snapshotAt:at-1000,horizonDays:5,accountRef:'authority-test-only',accountRevision:7,capital:100000,
  evidenceHash:'a'.repeat(64),constraintsHash:'b'.repeat(64),costPolicyHash:'c'.repeat(64),selectedId:'hold',dataMode:'real-observation',
  alternatives:[{id:'hold',action:'hold',label:'继续持有',weights:[{symbol:'600000',weight:.4}]},{id:'cash',action:'cash',label:'保持现金',weights:[]}]};}
function outcome(f,a,at=now+1000){return {alternativeId:a.id,alternativeHash:a.alternativeHash,freezeId:f.id,informationCutoff:f.informationCutoff,constraintsHash:f.constraintsHash,costPolicyHash:f.costPolicyHash,
  capital:f.capital,horizonDays:f.horizonDays,periodStartAt:now+100,periodEndAt:at-100,knownAt:at,source:'original-backtest-engine',mode:'constrained-paper-replay',constraintsVerified:true,mature:true,grossPnl:a.id==='hold'?500:-100,totalCosts:50,netPnl:a.id==='hold'?450:-150};}

test('73 does not invent missing estimates, accounts, or correlations',()=>{
  const r=D.researchPortfolioWeights({}, {asOf:now});assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);assert.equal(r.canTrade,false);assert.ok(r.missing.some(x=>x.includes('相关性')));
  for(const mutate of [p=>p.candidates[0].estimate.expectedReturn=null,p=>p.candidates[0].estimate.sampleCount=19,p=>p.correlation=null,p=>p.account.cash=null,p=>p.costs.impactBps=null]){
    const p=portfolio();mutate(p);assert.equal(D.researchPortfolioWeights(p,{asOf:now}).status,'no-adjust');
  }
});
test('73 compares current, equal-weight and constrained lot-sized candidates without changing input',()=>{
  const p=portfolio(),before=copy(p),r=D.researchPortfolioWeights(p,{asOf:now});assert.deepEqual(p,before);assert.equal(r.status,'research-candidate');
  assert.ok(r.candidate.constraintsSatisfied);assert.ok(r.candidate.cashWeightAfterCost>=.2-1e-8);assert.ok(r.candidate.weights.every(w=>w.weight<=.5&&w.weight>=w.minimumWeight));
  assert.ok(r.candidate.objective>r.current.objective);assert.ok(r.equalWeight);assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
  for(const change of r.candidate.changes.filter(c=>c.side==='buy'))assert.ok(Math.abs(change.quantity/100-Math.round(change.quantity/100))<1e-7);
});
test('73 preserves exact quote time: 15s boundary, stale, unknown, future and read-only',()=>{
  const boundary=portfolio();boundary.candidates[0].quote.quoteAt=now-15000;assert.equal(D.researchPortfolioWeights(boundary,{asOf:now}).missing.length,0);
  for(const mutate of [q=>q.quoteAt=now-15001,q=>q.quoteAt=null,q=>q.quoteAt=now+1,q=>q.receivedAt=now+1,q=>q.quoteMode='historical',q=>q.canTrade=false]){
    const p=portfolio();mutate(p.candidates[0].quote);const r=D.researchPortfolioWeights(p,{asOf:now});assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);
  }
});
test('73 rejects late estimates, uncovered holdings, malformed and non-PSD correlations',()=>{
  for(const mutate of [p=>p.candidates[0].estimate.knownAt=now+1,p=>p.correlation.knownAt=now+1,p=>p.correlation.horizonDays=20,p=>p.correlation.matrix=[[1,.4],[.2,1]],p=>p.account.positions.push({symbol:'600002',quantity:1,availableQuantity:1})]){
    const p=portfolio();mutate(p);assert.equal(D.researchPortfolioWeights(p,{asOf:now}).status,'no-adjust');
  }
  const p=portfolio();p.candidates.push({...copy(p.candidates[1]),symbol:'600002'});p.correlation.symbols.push('600002');p.correlation.matrix=[[1,.9,.9],[.9,1,-.9],[.9,-.9,1]];
  assert.ok(D.researchPortfolioWeights(p,{asOf:now}).missing.some(x=>x.includes('半正定')));
});
test('73 respects T+1 locked holdings, original risk policy and impossible constraints',()=>{
  const p=portfolio();p.account.positions[0].availableQuantity=0;p.constraints.maxSingleWeight=.3;
  const r=D.researchPortfolioWeights(p,{asOf:now});assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);assert.ok(r.current.violations.includes('single-name:600000'));
  const paused=portfolio();paused.constraints.riskPolicy={version:'original-pause',maxConsecutiveLosses:3};paused.account.lossStreak=3;
  const blocked=D.researchPortfolioWeights(paused,{asOf:now});assert.ok(blocked.candidate.weights.every(w=>w.weight<=w.currentWeight));
});
test('74 counts every cost component, refuses missing cost and does not treat ranking change as evidence',()=>{
  const input={baselineRef:'old',candidateRef:'new',horizonDays:5,improvement:{expectedAmount:100,uncertainty:20,horizonDays:5,source:'paired-research',knownAt:now-1},
    costs:{fees:10,slippage:10,impact:10,executionUncertainty:15,incrementalRisk:20,source:'recorded-assumptions',knownAt:now-1}};
  const r=D.evaluateRebalanceThreshold(input,{asOf:now});assert.equal(r.status,'no-adjust');assert.equal(r.estimatedTotalCost,65);assert.ok(r.margin<0);
  input.improvement.expectedAmount=200;assert.equal(D.evaluateRebalanceThreshold(input,{asOf:now}).status,'research-candidate');
  input.costs.impact=null;assert.equal(D.evaluateRebalanceThreshold(input,{asOf:now}).status,'no-adjust');
  assert.equal(D.evaluateRebalanceThreshold({rankingImprovement:10},{asOf:now}).status,'no-adjust');
});
test('74 cannot veto compulsory risk handling, even when reward evidence is absent',()=>{
  const r=D.evaluateRebalanceThreshold({forcedRisk:{triggered:true,reference:'risk-center-original-17'}},{asOf:now});assert.equal(r.status,'risk-action-priority');assert.equal(r.filterMayBlock,false);assert.equal(r.canTrade,false);
});
test('75 reruns the original optimizer, preserves input and expects stale/missing gates',()=>{
  const input={portfolio:portfolio()},before=copy(input),r=D.checkDecisionRobustness(input,{asOf:now});assert.deepEqual(input,before);
  assert.ok(r.scenarios.some(s=>s.id==='latency-pressure'&&s.result.status==='no-adjust'&&s.expectedGate));assert.ok(r.expectedGateChanges>=1);assert.equal(r.canTrade,false);
  assert.equal(D.checkDecisionRobustness({portfolio:{}},{asOf:now}).status,'not-evaluated');
});
test('75 uses a supplied server evaluator and reports factor-sensitive rank reversals',()=>{
  let calls=0;const r=D.checkDecisionRobustness({decisionInput:{factors:{momentum:.01}},factors:[{id:'momentum',path:['factors','momentum'],delta:.02}]},{asOf:now,evaluate:input=>{
    calls++;if(input.factors.momentum===null)return {status:'unknown',missing:['factor']};
    return {status:'candidate',ranking:input.factors.momentum>0?['600000','600001']:['600001','600000']};
  }});
  assert.ok(calls>=4);assert.equal(r.status,'sensitive');assert.ok(r.sensitiveFactors.some(x=>x.includes('momentum')));assert.equal(r.productionWeightsChanged,false);
});
test('75 missing inputs that still reverse an active conclusion are not mislabeled as expected gate closure',()=>{
  const r=D.checkDecisionRobustness({decisionInput:{factor:1},factors:[{id:'source',path:['factor'],delta:.01}]},{asOf:now,evaluate:input=>({status:'candidate',riskLevel:input.factor===null?3:1,ranking:input.factor===null?['600001','600000']:['600000','600001']})});
  const missing=r.scenarios.find(s=>s.id==='factor-source-null');assert.equal(missing.gateExpected,true);assert.equal(missing.expectedGate,false);assert.equal(missing.changed,true);
  assert.equal(r.status,'sensitive');assert.equal(missing.result.riskLevel,3);
});
test('76 freezes server-time alternatives immutably, retries idempotently and preserves CAS',t=>{
  const root=setup(t),input=freezeInput(),f=D.freezeDecisionAlternatives(root,input,{requestId:'freeze_request_001',expectedRevision:0,now});
  assert.equal(f.classification,'prospective');assert.equal(f.recordedAt,now);assert.equal(f.canTrade,false);
  const retry=D.freezeDecisionAlternatives(root,input,{requestId:'freeze_request_001',expectedRevision:0,now:now+1});assert.equal(retry.id,f.id);assert.equal(retry.reused,true);
  assert.throws(()=>D.freezeDecisionAlternatives(root,{...input,selectedId:'cash'},{requestId:'freeze_request_001',expectedRevision:0,now:now+2}),/冲突/);
  assert.throws(()=>D.freezeDecisionAlternatives(root,input,{requestId:'freeze_request_002',expectedRevision:1,now:now+2}),/不可变/);
  const view=D.listDecisionAlternatives(root);assert.equal(view.records.length,1);assert.equal(view.revision,1);
  assert.equal(fs.statSync(path.join(root,'000001.json')).mode&0o777,0o600);
});
test('76 marks backdated decisions and old cutoffs post hoc, rejects future declarations',t=>{
  const root=setup(t),input=freezeInput();input.declaredDecisionAt=now-1;
  const f=D.freezeDecisionAlternatives(root,input,{requestId:'freeze_request_001',expectedRevision:0,now});assert.equal(f.classification,'post-hoc-exploration');
  const next={...freezeInput(),decisionRef:'new',declaredDecisionAt:now+100};assert.throws(()=>D.freezeDecisionAlternatives(root,next,{requestId:'freeze_request_002',expectedRevision:1,now}),/时点/);
  assert.throws(()=>D.freezeDecisionAlternatives(root,{...freezeInput(),decisionRef:'third'},{requestId:'freeze_request_003',expectedRevision:9,now}),/版本冲突/);
});
test('76 compares only frozen alternatives with identical cutoff, constraints, costs, capital and horizon',t=>{
  const root=setup(t),f=D.freezeDecisionAlternatives(root,freezeInput(),{requestId:'freeze_request_001',expectedRevision:0,now});
  const outcomes=f.alternatives.map(a=>outcome(f,a)),report=D.reviewDecisionAlternatives(f,outcomes,{asOf:now+2000});assert.equal(report.status,'compared');assert.equal(report.rows[1].differenceFromSelected,-600);assert.equal(report.actualExecutionClaim,false);
  for(const mutate of [o=>o.informationCutoff++,o=>o.costPolicyHash='d'.repeat(64),o=>o.constraintsHash='d'.repeat(64),o=>o.capital++,o=>o.horizonDays++,o=>o.alternativeHash='e'.repeat(64),o=>o.mature=false,o=>o.mode='real-fill',o=>o.totalCosts=null,o=>o.grossPnl++]){
    const altered=copy(outcomes);mutate(altered[1]);const r=D.reviewDecisionAlternatives(f,altered,{asOf:now+2000});assert.equal(r.status,'pending');assert.equal(r.rows[1].netPnl,null);assert.equal(r.rows[0].differenceFromSelected,null);
  }
});
test('76 rejects different outcome windows and excludes future or immature evidence',t=>{
  const root=setup(t),f=D.freezeDecisionAlternatives(root,freezeInput(),{requestId:'freeze_request_001',expectedRevision:0,now}),outcomes=f.alternatives.map(a=>outcome(f,a));
  outcomes[1].periodEndAt--;assert.equal(D.reviewDecisionAlternatives(f,outcomes,{asOf:now+2000}).status,'pending');
  assert.equal(D.reviewDecisionAlternatives(f,[],{asOf:now+2000}).status,'pending');
  const fresh=f.alternatives.map(a=>outcome(f,a));fresh[0].knownAt=now+3000;assert.equal(D.reviewDecisionAlternatives(f,fresh,{asOf:now+2000}).rows[0].netPnl,null);
});
test('76 persists reviews in original append-only research history, never creates account writes',t=>{
  const root=setup(t),f=D.freezeDecisionAlternatives(root,freezeInput(),{requestId:'freeze_request_001',expectedRevision:0,now}),outcomes=f.alternatives.map(a=>outcome(f,a));
  const r=D.recordDecisionAlternativeReview(root,f.id,outcomes,{requestId:'review_request_001',expectedRevision:1,now:now+2000});assert.equal(r.status,'compared');assert.equal(r.revision,2);
  const events=S.readEvents(root);assert.deepEqual(events.map(e=>e.kind),['diagnostic','diagnostic']);assert.equal(D.listDecisionAlternatives(root).reviews.length,1);
  assert.equal(D.listDecisionAlternatives(root,{asOf:now-1}).records.length,0);
});
test('76 can run a server-supplied replay for every frozen option and rejects a duplicate result',t=>{
  const root=setup(t),f=D.freezeDecisionAlternatives(root,freezeInput(),{requestId:'freeze_request_001',expectedRevision:0,now});let calls=0;
  const r=D.evaluateDecisionAlternatives(f,{asOf:now+2000,evaluateAlternative:(a,context)=>{calls++;assert.equal(context.capital,100000);return outcome(f,a);}});
  assert.equal(calls,2);assert.equal(r.status,'compared');const o=outcome(f,f.alternatives[0]);assert.throws(()=>D.reviewDecisionAlternatives(f,[o,o],{asOf:now+2000}),/重复/);
});

function replayFixture(t,extraAlternatives=[]){
  const root=setup(t),at=Date.parse('2026-11-10T09:00:00+08:00'),p=portfolio(at),input=freezeInput(at);input.horizonDays=2;
  input.sourceSnapshot={account:p.account,quotes:p.candidates.map(c=>({symbol:c.symbol,sector:c.sector,strategyId:c.strategyId,...c.quote})),constraints:{...p.constraints,riskPolicy:{version:'risk-1',maxPositionPct:50,maxGrossExposurePct:80,maxSectorPct:50}},costs:p.costs};
  input.alternatives.push({id:'rotate',action:'candidate',weights:[{symbol:'600001',weight:.4}]},...extraAlternatives);
  const frozen=D.freezeDecisionAlternatives(root,input,{requestId:'replay_freeze_001',expectedRevision:0,now:at}),dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'],knownAt=Date.parse('2026-11-12T16:00:00+08:00');
  const history={source:'dated-unadjusted-bars',knownAt,priceBasis:'unadjusted',corporateActionsComplete:true,calendar:{source:'dated-exchange-calendar',knownAt:at-86400000,dates},
    universeHistory:p.candidates.map(c=>({symbol:c.symbol,from:dates[0],through:dates.at(-1),eligible:true,sector:c.sector,source:'dated-security-status',knownAt:new Date(at-86400000).toISOString()})),
    stocks:p.candidates.map((c,j)=>({symbol:c.symbol,market:'main',volumeUnit:'shares',bars:dates.map((date,i)=>({date,open:c.quote.price,close:c.quote.price+(i>=2?j===0?-.5:1:0),high:c.quote.price+2,low:c.quote.price-2,
      volume:1000000,amount:10000000,priceBasis:'unadjusted',isST:false,suspended:false,tradable:true,upperLimit:c.quote.price*1.1,lowerLimit:c.quote.price*.9,statusKnownAt:Date.parse(date+'T09:00:00+08:00'),limitKnownAt:Date.parse(date+'T09:00:00+08:00')}))}))};
  return {root,frozen,history,at,knownAt};
}
test('76 replays actual frozen choices with original limits, fees and T+1 instead of accepting invented fills',t=>{
  const {frozen,history,knownAt}=replayFixture(t),before=copy(history),r=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt});
  assert.equal(r.status,'compared');assert.equal(r.rows.length,3);assert.equal(r.actualExecutionClaim,false);assert.deepEqual(history,before);
  assert.equal(r.rows.find(x=>x.id==='hold').netPnl,-2000);assert.ok(r.rows.find(x=>x.id==='rotate').totalCosts>0);
  const cash=r.replayDetails.find(x=>x.alternativeId==='cash');assert.equal(cash.orders.find(o=>o.side==='sell'&&o.status==='hypothetical-filled').quantity,4000);
  assert.equal(cash.orders[0].date,'2026-11-11');assert.equal(cash.finalHoldings.find(p=>p.symbol==='600000').quantity,0);
  assert.ok(r.replayDetails.every(d=>d.orders.every(o=>o.status.startsWith('hypothetical-'))));
});
test('76 locked limit remains held and later prices cannot change first-open decisions',t=>{
  const {frozen,history,knownAt}=replayFixture(t);history.stocks[0].bars[2].lowerLimit=history.stocks[0].bars[2].open;
  const blocked=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt});assert.equal(blocked.status,'compared');assert.equal(blocked.replayDetails.find(x=>x.alternativeId==='cash').finalHoldings[0].quantity,4000);
  assert.ok(blocked.replayDetails.find(x=>x.alternativeId==='cash').orders.some(o=>o.status==='hypothetical-blocked'&&o.reason.includes('涨跌停')));
  const future=copy(history);for(const s of future.stocks)s.bars[4].open=999999;assert.deepEqual(D.replayDecisionAlternatives(frozen,future,{asOf:knownAt}),blocked);
});
test('76 replay refuses absent costs, adjusted price, missing calendar/state and immature windows',t=>{
  const {frozen,history,knownAt}=replayFixture(t);
  for(const mutate of [h=>h.priceBasis='hfq',h=>h.corporateActionsComplete=false,h=>h.calendar.knownAt=knownAt,h=>h.universeHistory=null,h=>delete h.stocks[0].bars[1].upperLimit]){
    const h=copy(history);mutate(h);assert.equal(D.replayDecisionAlternatives(frozen,h,{asOf:knownAt}).status,'pending');
  }
  assert.equal(D.replayDecisionAlternatives(frozen,history,{asOf:knownAt-86400000}).status,'pending');
  const changed=copy(frozen);changed.sourceSnapshot.costs.impactBps=null;changed.sourceSnapshotHash=S.digest(changed.sourceSnapshot);assert.equal(D.replayDecisionAlternatives(changed,history,{asOf:knownAt}).status,'pending');
});
test('76 snapshot excludes secrets and authorization is checked inside store lock including retries',t=>{
  const root=setup(t),p=portfolio(),input=freezeInput();input.sourceSnapshot={account:{...p.account,token:'do-not-keep'},quotes:p.candidates.map(c=>({symbol:c.symbol,...c.quote,webhook:'do-not-keep'})),constraints:p.constraints,costs:{...p.costs,password:'do-not-keep'}};
  assert.throws(()=>D.freezeDecisionAlternatives(root,input,{requestId:'auth_freeze_001',expectedRevision:0,now,authorize:()=>false}),/授权/);assert.equal(S.readEvents(root).length,0);
  const f=D.freezeDecisionAlternatives(root,input,{requestId:'auth_freeze_001',expectedRevision:0,now,authorize:()=>true});assert.equal(JSON.stringify(f).includes('do-not-keep'),false);
  assert.throws(()=>D.freezeDecisionAlternatives(root,input,{requestId:'auth_freeze_001',expectedRevision:0,now,authorize:()=>false}),/授权/);assert.equal(S.readEvents(root).length,1);
});

test('73 enforces original maximum positions, and absent limits cannot become unlimited',()=>{
  const p=portfolio();p.constraints.maxPositions=1;
  const r=D.researchPortfolioWeights(p,{asOf:now});assert.ok(r.candidate.weights.filter(w=>w.weight>0).length<=1);
  delete p.constraints.maxPositions;assert.equal(D.researchPortfolioWeights(p,{asOf:now}).status,'no-adjust');
});
test('76 resolves an HTTP retry using the frozen public intent and rechecks current authorization',t=>{
  const root=setup(t),input=freezeInput(),intent={horizonDays:input.horizonDays,selectedId:input.selectedId,alternatives:input.alternatives};
  assert.equal(D.resolveFrozenRequest(root,'network_request_001',intent,{authorize:()=>true}),null);
  const f=D.freezeDecisionAlternatives(root,input,{requestId:'network_request_001',expectedRevision:0,now});
  const retry=D.resolveFrozenRequest(root,'network_request_001',intent,{authorize:()=>true});assert.equal(retry.id,f.id);assert.equal(retry.recordedAt,now);assert.equal(retry.reused,true);
  assert.throws(()=>D.resolveFrozenRequest(root,'network_request_001',{...intent,selectedId:'cash'},{authorize:()=>true}),/冲突/);
  assert.throws(()=>D.resolveFrozenRequest(root,'network_request_001',intent,{authorize:()=>false}),/授权/);
});
test('76 accepts an all-cash account without inventing quote rows',t=>{
  const root=setup(t),input=freezeInput(),p=portfolio();input.alternatives[0].weights=[];
  input.sourceSnapshot={account:{...p.account,cash:p.account.equity,availableCash:p.account.equity,positions:[]},quotes:[],constraints:p.constraints,costs:p.costs};
  const frozen=D.freezeDecisionAlternatives(root,input,{requestId:'cash_freeze_001',expectedRevision:0,now});assert.deepEqual(frozen.sourceSnapshot.quotes,[]);assert.equal(frozen.sourceSnapshot.account.cash,100000);
  assert.equal(frozen.freezeTime.earliestDayAfter,chinaDayForTest(now));assert.equal(frozen.freezeTime.executionPolicy,'after-freeze-calendar-day');
});
function chinaDayForTest(at){return new Date(at+28800000).toISOString().slice(0,10);}
function archivedReplay(f){
  const archive={scope:'live',bars:f.history.stocks.flatMap(s=>s.bars.map(b=>({...b,code:s.symbol,period:'日K',source:'V6/eastmoney',volumeUnit:'shares',sector:s.symbol==='600000'?'金融':'制造',
    knownAt:Date.parse(b.date+'T16:00:00+08:00'),corporateAction:false,corporateActionKnownAt:Date.parse(b.date+'T16:00:00+08:00')})))};
  const stamp=f.at-86400000;
  const events=[{kind:'analysis',hash:'f'.repeat(64),recordedAt:stamp,data:{asOf:stamp,symbol:'600000',calendarEvidence:{source:'original-exchange-calendar',observedAt:new Date(stamp).toISOString()},tradeDates:f.history.calendar.dates}}];
  return {archive,events};
}
test('76 adapts existing shortline OHLCV and workspace calendar evidence into a real constrained replay',t=>{
  const fixture=replayFixture(t),{archive,events}=archivedReplay(fixture);
  const history=D.deriveDecisionReplayHistory(archive,events,{asOf:fixture.knownAt,informationCutoff:fixture.at,symbols:['600000','600001']});
  assert.equal(history.status,'available');assert.equal(history.stocks.length,2);assert.equal(history.sourceAuthenticated,false);assert.equal(history.corporateActionsComplete,true);assert.ok(history.universeHistory.length>0);
  const r=D.replayDecisionAlternatives(fixture.frozen,history,{asOf:fixture.knownAt});assert.equal(r.status,'compared');assert.equal(r.rows.find(x=>x.id==='hold').netPnl,-2000);
});
test('76 adapts workspace analysis rows without manufacturing missing security fields or volume units',t=>{
  const fixture=replayFixture(t),{events}=archivedReplay(fixture),bars=fixture.history.stocks[0].bars.slice(0,4).map(b=>({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,knownAt:Date.parse(b.date+'T16:00:00+08:00')}));
  events.push({kind:'analysis',hash:'1'.repeat(64),recordedAt:fixture.knownAt,data:{asOf:fixture.knownAt,symbol:'600000',provider:'eastmoney',priceBasis:'unadjusted',bars}});
  const r=D.deriveDecisionReplayHistory({scope:'live',bars:[]},events,{asOf:fixture.knownAt,informationCutoff:fixture.at,symbols:['600000']});
  assert.equal(r.status,'partial');assert.equal(r.stocks.length,1);assert.equal(r.universeHistory,null);assert.equal(r.corporateActionsComplete,false);assert.equal(r.stocks[0].volumeUnit,'unknown');
  assert.ok(r.missing.some(x=>x.includes('证券状态')));assert.ok(r.missing.some(x=>x.includes('涨跌停')));
});
test('76 archive adapter excludes tests, adjusted prices, future receipts and conflicting same-time revisions',t=>{
  const fixture=replayFixture(t),{archive,events}=archivedReplay(fixture);
  archive.bars[0].sampleSet='test';archive.bars[1].priceBasis='hfq';archive.bars[2].knownAt=fixture.knownAt+1;
  archive.bars.push({...archive.bars[3],close:archive.bars[3].close+.1});
  const r=D.deriveDecisionReplayHistory(archive,events,{asOf:fixture.knownAt,informationCutoff:fixture.at,symbols:['600000','600001']});
  assert.equal(r.status,'partial');assert.ok(r.counts.excluded>=3);assert.equal(r.counts.conflicts,1);assert.ok(r.missing.some(x=>x.includes('冲突')));
});

test('73 and 76 never treat total cash or unresolved orders as free funds',t=>{
  for(const change of [a=>delete a.availableCash,a=>a.availableCash=null,a=>a.pendingBuyOrders=1,a=>delete a.pendingBuyOrders]){
    const p=portfolio();change(p.account);const r=D.researchPortfolioWeights(p,{asOf:now});assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);
  }
  const fixture=replayFixture(t);
  for(const change of [a=>a.availableCash=null,a=>a.availableCash=a.cash-100,a=>a.pendingBuyOrders=1,a=>a.pendingOrders=1,a=>a.pendingSellOrders=1]){
    const frozen=copy(fixture.frozen);change(frozen.sourceSnapshot.account);frozen.sourceSnapshotHash=S.digest(frozen.sourceSnapshot);
    assert.equal(D.replayDecisionAlternatives(frozen,fixture.history,{asOf:fixture.knownAt}).status,'pending');
  }
});
test('76 retries an empty public hold using the original frozen holdings, not current marks',t=>{
  const fixture=replayFixture(t),f=fixture.frozen,intent={horizonDays:f.horizonDays,selectedId:f.selectedId,alternatives:f.alternatives.map(a=>({id:a.id,action:a.action,label:a.label,delaySessions:a.delaySessions,weights:a.action==='hold'?[]:a.weights}))};
  const retry=D.resolveFrozenRequest(fixture.root,'replay_freeze_001',intent,{authorize:()=>true});assert.equal(retry.id,f.id);assert.deepEqual(retry.sourceSnapshot,f.sourceSnapshot);
  intent.alternatives[2].weights[0].weight=.41;assert.throws(()=>D.resolveFrozenRequest(fixture.root,'replay_freeze_001',intent,{authorize:()=>true}),/冲突/);
});

test('74 derives its gate from the same 73 candidate, account and explicit cost components',()=>{
  const p=portfolio(),r=D.buildDeepDecisionResearch({portfolio:p,rebalance:{forcedRisk:{triggered:false,reference:null}}},{asOf:now});
  assert.equal(r.portfolio.status,'research-candidate');assert.deepEqual(r.rebalance.missing,[]);assert.ok(r.rebalance.estimatedTotalCost>0);
  assert.equal(r.rebalance.derivation.scoreUsedAsProbability,false);assert.equal(r.rebalance.derivation.method,'same-candidate-and-account-comparison');
  const forced=D.buildDeepDecisionResearch({portfolio:p,rebalance:{forcedRisk:{triggered:true,reference:'original-risk-trigger'}}},{asOf:now});assert.equal(forced.rebalance.filterMayBlock,false);
  delete p.candidates[0].estimate;const absent=D.buildDeepDecisionResearch({portfolio:p},{asOf:now});assert.equal(absent.rebalance.status,'no-adjust');assert.ok(absent.rebalance.missing.length);
});

function portfolioArchive(){
  const p=portfolio();p.horizonDays=1;p.correlation=null;for(const row of p.candidates){delete row.estimate;delete row.liquidity;}
  // Explicit test calendar; production never derives sessions from weekdays.
  const dates=[];for(let t=Date.parse('2026-09-01T00:00:00Z');dates.length<45;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
  const archive={scope:'live',bars:p.candidates.flatMap((r,j)=>dates.map((date,i)=>{const close=10+j*5+i*.02+Math.sin(i*(j+1))*.2;return {code:r.symbol,date,period:'日K',priceBasis:'unadjusted',source:'V6/eastmoney',volumeUnit:'shares',
    open:close,close,high:close+.5,low:close-.5,volume:1000000,amount:10000000+i*1000,knownAt:Date.parse(date+'T16:00:00+08:00'),corporateAction:false,corporateActionKnownAt:Date.parse(date+'T16:00:00+08:00')};}))};
  const recordedAt=Date.parse(dates[0]+'T09:00:00+08:00'),events=[{kind:'analysis',hash:'3'.repeat(64),recordedAt,data:{asOf:recordedAt,symbol:'600000',tradeDates:dates,calendarEvidence:{source:'explicit-test-calendar',observedAt:recordedAt}}}];
  return {p,archive,events};
}
test('73 bridges original archive amounts and complete aligned windows without inventing a forecast',()=>{
  const {p,archive,events}=portfolioArchive(),before=copy(p),r=D.derivePortfolioArchiveEvidence(archive,events,p,{asOf:now});
  assert.deepEqual(p,before);assert.equal(r.input.candidates[0].liquidity.sampleCount,20);assert.equal(r.correlation.sampleCount,44);
  assert.equal(r.correlation.samplePolicy,'all-contiguous-nonoverlapping-windows');assert.equal(r.descriptiveBaseline.length,2);
  assert.ok(r.descriptiveBaseline.every(x=>x.expectedReturn===null&&x.volatility>0));assert.equal(r.input.candidates[0].estimate,undefined);
  assert.equal(D.researchPortfolioWeights(r.input,{asOf:now}).status,'no-adjust');assert.ok(r.missing.some(x=>x.includes('未冒充')));
});
test('73 archive bridge retains missing amounts and corporate-action uncertainty instead of dropping poor samples',()=>{
  const {p,archive,events}=portfolioArchive();archive.bars[44].amount=null;delete archive.bars[43].corporateAction;
  const r=D.derivePortfolioArchiveEvidence(archive,events,p,{asOf:now});assert.equal(r.correlation,null);assert.equal(r.input.candidates[0].liquidity,undefined);
  assert.equal(r.liquidity.find(x=>x.symbol==='600000').averageDailyAmount,null);assert.ok(r.missing.some(x=>x.includes('人民币成交额')));
  const empty=D.derivePortfolioArchiveEvidence({scope:'demo',bars:archive.bars},events,p,{asOf:now});assert.equal(empty.correlation,null);assert.equal(empty.descriptiveBaseline.length,0);
});

// A weight is a target exposure, not permission to reverse a frozen sell-only intent.
test('76 frozen reduction is sell-only even when the opening price gap makes the target imply more shares',t=>{
  const {frozen,history,knownAt}=replayFixture(t,[{id:'reduce',action:'reduce',weights:[{symbol:'600000',weight:.38}]}]);
  const bar=history.stocks[0].bars[2];Object.assign(bar,{open:9.1,low:9,high:10,close:9.5});
  const before=copy({frozen,history}),r=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt});
  assert.equal(r.status,'compared');const detail=r.replayDetails.find(x=>x.alternativeId==='reduce');
  assert.equal(detail.orders.some(o=>o.side==='buy'),false);
  assert.equal(detail.finalHoldings.find(p=>p.symbol==='600000').quantity,4000);
  assert.equal(r.actualExecutionClaim,false);assert.deepEqual({frozen,history},before);
});
test('76 reduction still sells available shares and retains blocked quantities without repurchasing',t=>{
  const {frozen,history,knownAt}=replayFixture(t,[{id:'reduce',action:'reduce',weights:[{symbol:'600000',weight:.2}]}]);
  const result=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt});
  const detail=result.replayDetails.find(x=>x.alternativeId==='reduce');
  assert.equal(result.status,'compared');assert.equal(detail.finalHoldings.find(p=>p.symbol==='600000').quantity,2000);
  assert.equal(detail.orders.filter(o=>o.side==='sell'&&o.status==='hypothetical-filled').reduce((n,o)=>n+o.quantity,0),2000);
  assert.equal(detail.orders.some(o=>o.side==='buy'),false);
  history.stocks[0].bars[2].lowerLimit=history.stocks[0].bars[2].open;
  const blocked=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt}).replayDetails.find(x=>x.alternativeId==='reduce');
  assert.equal(blocked.finalHoldings.find(p=>p.symbol==='600000').quantity,4000);
  assert.ok(blocked.orders.some(o=>o.side==='sell'&&o.status==='hypothetical-blocked'));
  assert.equal(blocked.orders.some(o=>o.side==='buy'),false);
});


test('73 requires consistent complete original order inventory before sizing',()=>{
  for(const change of [
    a=>delete a.pendingOrders,a=>delete a.pendingSellOrders,a=>a.pendingOrders=null,
    a=>a.pendingOrders=1,a=>a.pendingSellOrders=1,a=>a.pendingSellOrders=-1,
    a=>{a.pendingOrders=1;a.pendingSellOrders='1';}
  ]){
    const p=portfolio();change(p.account);
    const r=D.researchPortfolioWeights(p,{asOf:now});
    assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);
    assert.ok(r.missing.some(x=>x.includes('挂单数量')));
  }
});

test('73 original pending sell quantities must reconcile with held and unavailable shares',()=>{
  for(const q of [null,undefined,-1,1001,'1000',0]){
    const p=portfolio();p.account.pendingOrders=1;p.account.pendingSellOrders=1;
    if(q!==undefined)p.account.positions[0].pendingSellQuantity=q;
    const r=D.researchPortfolioWeights(p,{asOf:now});
    assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);
    assert.ok(r.missing.some(x=>x.includes('卖单')));
  }
  const p=portfolio();p.account.positions[0].pendingSellQuantity=100;
  assert.equal(D.researchPortfolioWeights(p,{asOf:now}).candidate,null);
});

test('73 preserves valid original reserved sell shares and research-only sizing',()=>{
  const p=portfolio();p.account.pendingOrders=1;p.account.pendingSellOrders=1;
  p.account.positions[0].pendingSellQuantity=1000;
  const before=copy(p),r=D.researchPortfolioWeights(p,{asOf:now});
  assert.deepEqual(p,before);assert.equal(r.missing.length,0);assert.ok(r.candidate);
  assert.ok(r.candidate.weights.find(x=>x.symbol==='600000').weight>=.1-1e-8);
  assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
});

test('73 malformed position entries fail closed without throwing',()=>{
  for(const row of [null,{},false,0,'600000',{symbol:'600000',quantity:1,availableQuantity:2}]){
    const p=portfolio();p.account.positions.push(row);
    const r=D.researchPortfolioWeights(p,{asOf:now});
    assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);assert.ok(r.missing.length);
  }
});

test('73 sector exposure groups never collide with ordinary object prototype names',()=>{
  for(const sector of ['__proto__','constructor','toString','hasOwnProperty','银行']){
    const p=portfolio();p.account.positions.push({symbol:'600001',quantity:1000,availableQuantity:1000});
    p.account.cash=40000;p.account.availableCash=40000;
    p.candidates.forEach(row=>row.sector=sector);
    const r=D.researchPortfolioWeights(p,{asOf:now});
    assert.ok(r.current.violations.includes('sector:'+sector),sector);
    assert.equal(r.current.constraintsSatisfied,false,sector);
    if(r.candidate)assert.ok(r.candidate.weights.reduce((sum,row)=>sum+row.weight,0)<=.5+1e-8,sector);
    assert.equal(r.canTrade,false);
  }
});
