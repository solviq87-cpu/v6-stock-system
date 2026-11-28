'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const lab=require('../src/core/strategy-portfolio-lab');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const {SYSTEMS}=require('../src/core/independent-strategy-attribution');
const dates=Array.from({length:44},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history=()=>({source:'fixture',asOf:dates.at(-1),stocks:['600001','600002'].map(code=>({code,bars:dates.map((date,i)=>({date,open:10+i*.01,close:10+i*.01,high:10.5+i*.01,low:9.5+i*.01,volume:100000}))}))});
const signal=(system,day=31,verdict='pass')=>({system,symbol:'600001',date:dates[day],observedThrough:dates[day],evaluatorVersion:'isolated-test-v1',provenance:'isolated-test/native',verdict});
function compare(h,signals,config){const portfolios=lab.replayStrategyPortfolios(h,signals,{config});return {portfolios,view:lab.describeStrategyComparison(h,{signals},portfolios)};}
test('comparison is opt-in and leaves original backtest, paper and native results unchanged',t=>{
 const original=lab.replayStrategyPortfolios;let calls=0;lab.replayStrategyPortfolios=(...args)=>{calls++;return original(...args);};t.after(()=>{lab.replayStrategyPortfolios=original;});
 const h=history(),before=JSON.stringify(h),plain=runCompleteWorkbench({history:h});assert.equal(calls,0);assert.equal(Object.hasOwn(plain,'strategyComparison'),false);
 const extra=runCompleteWorkbench({history:h,includeStrategyComparison:true});assert.equal(calls,1);
 for(const key of ['backtest','paper','strategies','reconciliation'])assert.deepEqual(extra[key],plain[key]);
 assert.equal(JSON.stringify(h),before);assert.equal(extra.strategyComparison.mode,'native-strategy-protocol-comparison');
 assert.equal(extra.strategyComparison.executionEvidence.mode,'four-independent-native-evidence-paper-portfolios');
});
test('unknown inputs and zero transactions are not treated as zero-return winners',()=>{
 const h=history(),{view}=compare(h,[]);assert.equal(view.commonEvaluatedSignals,0);assert.equal(view.totalCandidateSignals,26);
 assert.equal(view.status,'insufficient-common-evaluated-signals');
 for(const s of view.systems){assert.equal(s.status,'not-evaluated');assert.deepEqual(s.coverage,{total:26,evaluated:0,unknown:26,missing:26,passed:0,failed:0});assert.equal(s.paperReturnPct,null);assert.equal(s.paperDrawdownPct,null);assert.equal(s.accountMetrics.returnPct,0);}
 for(const k of ['canTrade','canTrain','canNotify','verifiedLive','eligibleForPromotion','weightsChanged','pointInTimeCertified'])assert.equal(view[k],false);
});
test('same capital, costs and next-session execution are shared without changing original ledger math',()=>{
 const h=history(),signals=SYSTEMS.map(s=>signal(s)),before=JSON.stringify(signals),{view,portfolios}=compare(h,signals,{initialCash:12345.67,feeBps:9.5,slippageBps:11.5});
 assert.equal(view.commonEvaluatedSignals,1);assert.equal(view.protocol.initialCash,12345.67);assert.equal(view.protocol.feeBps,9.5);
 assert.equal(view.protocol.signalStart,dates[30]);assert.equal(view.protocol.signalEnd,dates[42]);assert.equal(view.protocol.entryStart,dates[31]);
 for(const s of view.systems){assert.equal(s.accountMetrics.initialCash,12345.67);assert.equal(s.paperReturnPct,portfolios.systems[s.id].metrics.returnPct);assert.equal(s.status,'paper-estimate');assert.equal(s.buyFills,1);assert.equal(s.coverage.evaluated,1);assert.equal(portfolios.systems[s.id].fills[0].date,dates[32]);assert.equal(portfolios.systems[s.id].fills[1].date,dates[33]);}
 assert.equal(JSON.stringify(signals),before);assert.equal(view.eligibleForPromotion,false);
});
test('own coverage and common evaluated coverage remain separate',()=>{
 const {view}=compare(history(),[signal('fourteen'),signal('python',31,'unknown')]);assert.equal(view.commonEvaluatedSignals,0);
 assert.equal(view.systems.find(x=>x.id==='fourteen').coverage.evaluated,1);assert.equal(view.systems.find(x=>x.id==='python').coverage.unknown,26);
});
test('known signals that cannot buy retain failures rather than fabricated performance',()=>{
 const h=history();h.stocks[0].bars[32].volume=0;const {view}=compare(h,SYSTEMS.map(s=>signal(s)));
 for(const s of view.systems){assert.equal(s.status,'no-buy-fills');assert.equal(s.paperReturnPct,null);assert.ok(s.blockedOrders>0);}
});
test('duplicates, future knowledge and mismatched accounts cannot certify a comparison',()=>{
 const h=history(),s=signal('fourteen'),p=lab.replayStrategyPortfolios(h,[s]);
 assert.throws(()=>lab.describeStrategyComparison(h,{signals:[s,s]},p),/重复/);
 assert.throws(()=>lab.describeStrategyComparison(h,{signals:[{...s,observedThrough:dates[32]}]},p),/未来/);
 assert.throws(()=>lab.describeStrategyComparison(h,{signals:[{...s,observedThrough:'2025-02-31'}]},p),/无效/);
 assert.throws(()=>lab.describeStrategyComparison(h,{signals:[{...s,observedThrough:'2024-12-31'}]},p),/同日信号合同/,'the original ledger requires the same signal date, including earlier snapshots');
 p.systems.fourteen.metrics.initialCash++;assert.throws(()=>lab.describeStrategyComparison(h,{signals:[s]},p),/资金/);
});
test('malformed options fail closed without changing original completed research',()=>{
 const h=history(),plain=runCompleteWorkbench({history:h});
 assert.throws(()=>runCompleteWorkbench({history:h,includeStrategyComparison:'true'}),/布尔/);
 for(const cfg of [{feeBps:-1},{initialCash:NaN},{perSystem:{}},{apiKey:'must-not-echo-secret'}]){
  const r=runCompleteWorkbench({history:h,includeStrategyComparison:true,strategyComparisonConfig:cfg});assert.equal(r.strategyComparison.status,'unavailable');assert.equal(r.strategyComparison.canTrade,false);assert.deepEqual(r.paper,plain.paper);assert.equal(JSON.stringify(r).includes('must-not-echo-secret'),false);
 }
});
test('existing unified CLI reuses its already-computed portfolios and binds all fingerprints',()=>{
 const h=history(),r=runUnifiedStrategyProject(h),v=r.strategyComparison;assert.equal(v.datasetFingerprint,r.datasetFingerprint);assert.equal(v.systems.length,4);
 assert.match(v.protocolFingerprint,/^[a-f0-9]{64}$/);assert.match(v.signalsFingerprint,/^[a-f0-9]{64}$/);
 for(const s of v.systems)assert.deepEqual(s.accountMetrics,r.independentPortfolios.systems[s.id].metrics);
 const changed=compare(h,[],{feeBps:9}).view;assert.notEqual(changed.protocolFingerprint,v.protocolFingerprint);assert.equal(changed.datasetFingerprint,v.datasetFingerprint);
});
test('interactive evidence is retained completely or the comparison is unavailable, never truncated',t=>{
 const h=history(),plain=runCompleteWorkbench({history:h}),original=lab.replayStrategyPortfolios;t.after(()=>{lab.replayStrategyPortfolios=original;});
 lab.replayStrategyPortfolios=()=>({systems:{fourteen:{orders:new Array(40001),fills:[],equity:[],positions:[]}}});
 const r=runCompleteWorkbench({history:h,includeStrategyComparison:true});assert.equal(r.strategyComparison.status,'unavailable');assert.match(r.strategyComparison.reason,/未截断/);assert.deepEqual(r.paper,plain.paper);
});

test('F21.3 paired candidate overlap counts exact common verdicts, unknowns and missing rows',()=>{
 const h=history(),signals=[signal('fourteen',31),signal('bazi',31),signal('fourteen',33),signal('bazi',33,'fail'),
  signal('fourteen',34,'fail'),signal('bazi',34),signal('fourteen',35,'fail'),signal('bazi',35,'fail'),
  signal('fourteen',36),signal('bazi',36,'unknown'),signal('fourteen',37)];
 const before=JSON.stringify(signals),{view}=compare(h,signals),c=view.complementarity;
 const p=c.pairs.find(x=>x.a==='fourteen'&&x.b==='bazi');
 assert.equal(c.pairs.length,6);assert.equal(p.total,26);assert.equal(p.commonEvaluated,4);
 assert.deepEqual([p.bothPass,p.onlyAPass,p.onlyBPass,p.bothFail],[1,1,1,1]);
 assert.equal(p.unknownEither,22);assert.equal(p.missingEither,21);assert.equal(p.passOverlap,.333333);
 assert.equal(p.sharedExactReferences,4);assert.equal(p.sharedPassBothBought,1);assert.equal(p.sharedPassNeitherBought,0);
 assert.equal(p.fillEvidenceAvailable,true);assert.equal(c.independentEvidenceCertified,false);
 assert.equal(c.incrementalNetBenefit,null);assert.equal(c.errorCorrelation,null);assert.equal(JSON.stringify(signals),before);
});
test('F21.3 blocked duplicate candidates are not fake fills and missing pairs never report perfect independence',()=>{
 const h=history();h.stocks[0].bars[32].volume=0;
 const {view}=compare(h,[signal('fourteen'),signal('bazi')]);
 const p=view.complementarity.pairs.find(x=>x.a==='fourteen'&&x.b==='bazi');
 assert.equal(p.bothPass,1);assert.equal(p.passOverlap,1);assert.equal(p.sharedPassBothBought,0);
 assert.equal(p.sharedPassNeitherBought,1);
 const empty=view.complementarity.pairs.find(x=>x.a==='gpt'&&x.b==='python');
 assert.equal(empty.commonEvaluated,0);assert.equal(empty.passOverlap,null);assert.equal(empty.missingEither,26);
});
test('F21.3 incompatible fill lineage is unknown and mixed evaluator versions are disclosed',()=>{
 const h=history(),signals=[signal('fourteen',31),signal('bazi',31),{...signal('fourteen',35),evaluatorVersion:'v2'},signal('bazi',35)];
 const {portfolios,view}=compare(h,signals),p=view.complementarity.pairs[0];assert.equal(p.mixedVersions,true);
 assert.equal(p.sharedPassBothBought,2);
 portfolios.systems.fourteen.fills.find(f=>f.side==='buy').signalRef.provenance='wrong';
 const changed=lab.describeStrategyComparison(h,{signals},portfolios).complementarity.pairs[0];
 assert.equal(changed.fillEvidenceAvailable,false);assert.equal(changed.sharedPassBothBought,null);assert.equal(changed.bothPass,2);
});
