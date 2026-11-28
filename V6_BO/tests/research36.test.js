'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../src/strategy/research36');
const now=Date.parse('2026-11-12T15:00:00+08:00'),code='600000';
const proof=(value,unit,extra={})=>({value,unit,code,source:'declared-test-source',evidenceId:'fixture-evidence',observedAt:now-1000,availableAt:now-500,recordedAt:now, ...extra});
const analyze=(features,extra={})=>engine.evaluateResearch36({stock:{code,features},asOf:now,...extra});
const by=(r,id)=>r.evaluations.find(s=>s.id===id);
test('catalog has exactly 7/6/8/6/9 independent experimental definitions and cannot be mutated through results',()=>{
 const c=engine.getCatalog();assert.equal(c.strategies.length,36);
 assert.deepEqual(['trend','flow','hot','quality','event'].map(f=>c.strategies.filter(s=>s.family===f).length),[7,6,8,6,9]);
 const result=analyze({});assert.equal(result.matched,0);assert.ok(result.evaluations.every(s=>s.score===null&&s.status==='insufficient_data'&&!s.canTrade));
 by(result,'pullback').checks.find(r=>r.field==='closeOver10').threshold[0]=-999;
 assert.equal(by(analyze({}),'pullback').checks.find(r=>r.field==='closeOver10').threshold[0],1);
});
for(const strategy of engine.getCatalog().strategies)test('研究条件的缺失与匹配：'+strategy.name,()=>{
 const features={};
 for(const r of strategy.rules){const value=r.op==='between'?(r.value[0]+r.value[1])/2:r.op==='gt'?r.value+1:r.op==='lt'?r.value-1:r.value;features[r.field]=proof(value,r.unit);}
 const result=by(analyze(features),strategy.id);assert.equal(result.status,'research_candidate');assert.equal(result.score,100);assert.equal(result.predictionProbability,null);assert.equal(result.productionEnabled,false);
 for(const rule of strategy.rules){const input=structuredClone(features);delete input[rule.field];assert.equal(by(analyze(input),strategy.id).status,'insufficient_data');}
});
test('real zero MACD previous value is retained while null/string/boolean values never pass numeric conditions',()=>{
 const features={macdHist:proof(.1,'CNY'),priorMacdHist:proof(0,'CNY'),closeOver20:proof(1.1,'ratio')};
 assert.equal(by(analyze(features),'macd').status,'research_candidate');
 for(const bad of [null,'0',false,NaN,Infinity])assert.equal(by(analyze({...features,priorMacdHist:proof(bad,'CNY')}),'macd').status,'insufficient_data');
 assert.equal(by(analyze({...features,macdHist:proof(-.1,'CNY')}),'macd').status,'not_matched');
});
test('same-code original timestamps, explicit units, retractions and point-in-time availability are mandatory',()=>{
 const f={dailyReturnPct:proof(2,'percent'),volumeRatio:proof(2,'ratio')};
 for(const extra of [{code:'000001'},{source:''},{evidenceId:''},{observedAt:null},{recordedAt:now+1},{availableAt:now+1},{observedAt:now-4*86400000},{simulated:true},{retracted:true},{unit:'unknown'}]){
  assert.equal(by(analyze({...f,volumeRatio:proof(2,'ratio',extra)}),'price_volume').status,'insufficient_data');
 }
 assert.equal(by(analyze({...f,volumeRatio:proof(2,'ratio',{observedAt:now-3*86400000})}),'price_volume').status,'research_candidate');
});
test('configuration disables only its own strategy; invalid or negative weights and production switches are rejected',()=>{
 const features={dailyReturnPct:proof(2,'percent'),volumeRatio:proof(2,'ratio')};
 const base=analyze(features),off=analyze(features,{config:{price_volume:{enabled:false}}});
 assert.equal(by(off,'price_volume').status,'disabled');assert.notEqual(base.configHash,off.configHash);
 assert.equal(by(analyze(features,{config:{price_volume:{weight:0}}}),'price_volume').status,'disabled');
 for(const config of [{unknown:{}},{price_volume:{weight:-1}},{price_volume:{weight:'1'}},{price_volume:{productionEnabled:true}},{price_volume:{thresholds:{volumeRatio:null}}},{turnover:{thresholds:{turnoverPct:[10,2]}}}])assert.throws(()=>analyze(features,{config}));
});
test('same-family repeated signals cannot create multiple family votes',()=>{
 const f={volumeRatio:proof(2,'ratio'),closeOverPrior20High:proof(1.1,'ratio'),closeOverPrior60High:proof(1.1,'ratio')};
 const r=analyze(f),family=r.families.find(f=>f.family==='trend');assert.equal(r.matched,2);assert.ok(family.selected);assert.equal(family.redundant.length,1);assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);
});
function dailyBars(n=40){return Array.from({length:n},(_,i)=>{
 const date=new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),at=Date.parse(date+'T15:00:00+08:00'),close=10+i*.02;
 return {date,open:close,high:close+.1,low:close-.1,close,volume:1000000,source:'fixture',priceBasis:'unadjusted',final:true,observedAt:at,availableAt:at,recordedAt:at,isST:false,suspended:false,tradable:true};
});}
test('daily technical feature derivation cannot consume later bars, invalid calendar dates or unsigned history',()=>{
 const bars=dailyBars(),asOf=bars[30].availableAt,stock={code,bars};
 const baseline=engine.technicalFeatures(stock,asOf);assert.ok(baseline.ma5Over10.value>1);
 bars[39].close=999;assert.deepEqual(engine.technicalFeatures(stock,asOf),baseline);
 const bad=structuredClone(bars);bad[2].date='2026-02-30';assert.deepEqual(engine.technicalFeatures({code,bars:bad},asOf),{});
 const missing=structuredClone(bars);delete missing[2].recordedAt;
 // Missing an intermediate observed bar cannot silently create a complete 20-day window.
 assert.deepEqual(engine.technicalFeatures({code,bars:missing},asOf),{});
});
test('research backtest uses existing position ledger with next-session execution and T+1, not current full-history scores',()=>{
 const bars=dailyBars(),stocks=[{symbol:code,market:'main',bars}],evidenceByDate={};
 for(const b of bars)evidenceByDate[b.date]={[code]:{
  dailyReturnPct:proof(2,'percent',{observedAt:b.availableAt,availableAt:b.availableAt,recordedAt:b.availableAt}),
  volumeRatio:proof(2,'ratio',{observedAt:b.availableAt,availableAt:b.availableAt,recordedAt:b.availableAt})}};
 const input={strategyId:'price_volume',stocks,evidenceByDate,options:{start:27,end:35,topN:1,tradingDates:bars.map(b=>b.date)}};
 const r=engine.backtestResearch36(input);assert.ok(r.trades.length>0);assert.ok(r.trades.every(t=>t.sellDay>t.buyDay));assert.equal(r.canTrade,false);assert.equal(r.outOfSampleValidated,false);
 const changed=structuredClone(input);changed.evidenceByDate[bars[39].date][code].dailyReturnPct.value=-90;
 assert.deepEqual(engine.backtestResearch36(changed).equity,r.equity);
 const late=structuredClone(input);for(const day of Object.values(late.evidenceByDate))for(const p of Object.values(day[code]))p.recordedAt=now;
 assert.equal(engine.backtestResearch36(late).trades.length,0);
 const status=structuredClone(input);delete status.stocks[0].bars[0].tradable;assert.throws(()=>engine.backtestResearch36(status),/逐日/);
 assert.throws(()=>engine.backtestResearch36({...input,options:{...input.options,selectCandidates:()=>[code]}}),/覆盖/);
});
test('insufficient or zero-variance returns never fabricate a Sharpe or profit factor',()=>{
 const m=engine.researchMetrics({equity:[{value:100},{value:100}],trades:[],orders:[]});assert.equal(m.sharpeZeroRiskFree252,null);assert.equal(m.profitFactor,null);assert.equal(m.averageWinLossRatio,null);assert.equal(m.grossTurnoverRatio,0);
});
test('opt-in strategy research preserves legacy ranking, and missing opt-in never adds processing',()=>{
 const {evaluateCandidate}=require('../src/strategy/strategy-service');
 const stock={code},a=evaluateCandidate({stock}),b=evaluateCandidate({stock,factorOptions:{includeResearch36:true,asOf:now}});
 assert.equal(a.research36,undefined);assert.equal(b.research36.evaluations.length,36);assert.equal(a.finalScore,b.finalScore);assert.equal(a.pass,b.pass);
});
test('fixed configuration windows require purge and all three roles; label is not independent OOS evidence',()=>{
 const bars=dailyBars(70),input={strategyId:'price_volume',stocks:[{symbol:code,market:'main',bars}],evidenceByDate:{},
  windows:[{label:'train1',role:'train',start:27,end:35},{label:'validation1',role:'validation',start:39,end:48},{label:'test1',role:'test',start:52,end:62}]};
 const r=engine.experimentResearch36(input);assert.equal(r.windows.length,3);assert.equal(r.outOfSampleValidated,false);
 assert.equal(new Set(r.windows.map(w=>w.result.research36.configHash)).size,1);
 const overlap=structuredClone(input);overlap.windows[1].start=36;assert.throws(()=>engine.experimentResearch36(overlap),/隔离期/);
 const wrong=structuredClone(input);wrong.windows[2].role='train';assert.throws(()=>engine.experimentResearch36(wrong),/窗口/);
});
test('CLI export is private and never overwrites a previous research run',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-research36-'));
 try{
  const input=path.join(dir,'input.json'),output=path.join(dir,'run.json');fs.writeFileSync(input,JSON.stringify({stock:{code},asOf:now}));
  const args=[require.resolve('../scripts/research36.js'),'evaluate',input,output];
  assert.equal(spawnSync(process.execPath,args).status,0);const first=fs.readFileSync(output);
  assert.equal(fs.statSync(output).mode&0o777,0o600);assert.equal(JSON.parse(first).result.canTrade,false);
  assert.notEqual(spawnSync(process.execPath,args).status,0);assert.deepEqual(fs.readFileSync(output),first);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('impossible bounded evidence remains unknown rather than producing support or opposition',()=>{
 const fields={qualityPercentile:[-1,101],rsi14:[-1,101],ensembleScore:[-1,101],sectorBreadthPct:[-1,101],
  sectorStrengthChange:[-101,101],newsPolarity:[-1.01,1.01],closeLocation:[-.01,1.01],leaderRank:[0,1.5],positiveFlowDays:[-1,1.5],minutesToClose:[-1]};
 for(const [field,values] of Object.entries(fields)){
  const strategy=engine.getCatalog().strategies.find(s=>s.rules.some(r=>r.field===field)),rule=strategy.rules.find(r=>r.field===field);
  for(const value of values){const row=by(analyze({[field]:proof(value,rule.unit)}),strategy.id),check=row.checks.find(c=>c.field===field);
   assert.equal(check.missing,'数值超出字段定义范围',field);assert.equal(check.pass,null);assert.equal(check.value,null);assert.equal(row.score,null);}
 }
});
test('bounded evidence keeps endpoints and signed financial values without universal percent clamping',()=>{
 const fields={qualityPercentile:[0,100],rsi14:[0,100],ensembleScore:[0,100],sectorBreadthPct:[0,100],sectorStrengthChange:[-100,100],
  newsPolarity:[-1,1],closeLocation:[0,1],leaderRank:[1,100],positiveFlowDays:[0,100],minutesToClose:[0,240],roePct:[-150,150],operatingCashToProfit:[-2,2]};
 for(const [field,values] of Object.entries(fields)){
  const strategy=engine.getCatalog().strategies.find(s=>s.rules.some(r=>r.field===field)),rule=strategy.rules.find(r=>r.field===field);
  for(const value of values){const check=by(analyze({[field]:proof(value,rule.unit)}),strategy.id).checks.find(c=>c.field===field);assert.equal(check.missing,null,field);assert.equal(check.value,value);}
 }
});

function routeFixture(){
 const bars=dailyBars(76),stocks=[{symbol:code,market:'main',bars}],evidenceByDate={},marketByDate={};
 const ids=['ma_trend','news','oversold'],rules=engine.getCatalog().strategies.filter(s=>ids.includes(s.id)).flatMap(s=>s.rules);
 for(const [i,b] of bars.entries()){
  const times={observedAt:b.availableAt,availableAt:b.availableAt,recordedAt:b.availableAt};
  evidenceByDate[b.date]={[code]:Object.fromEntries(rules.map(r=>[r.field,proof(r.op==='between'?(r.value[0]+r.value[1])/2:r.op==='gt'?r.value+.01:r.op==='lt'?r.value-.01:r.value,r.unit,times)]))};
  marketByDate[b.date]={date:b.date,source:'declared-test-market',evidenceId:'market-'+b.date,...times,
   scores:i%2?{breadthScore:75,indexTrendScore:80,marketVolumeScore:65,riskScore:20,volatilityScore:30,sentimentScore:75}:
    {breadthScore:50,indexTrendScore:30,marketVolumeScore:40,riskScore:30,volatilityScore:70,sentimentScore:40}};
 }
 return {compareRoutes:true,stocks,evidenceByDate,marketByDate,options:{topN:1,holdDays:1,tradingDates:bars.map(b=>b.date)},
  windows:[{label:'train',role:'train',start:27,end:39},{label:'validation',role:'validation',start:43,end:55},{label:'test',role:'test',start:59,end:71}]};
}
test('F21 original route experiment uses identical input and ledger costs; repeated scans reuse evaluations and switches are bounded',()=>{
 const input=routeFixture(),before=JSON.stringify(input),r=engine.experimentResearch36(input);
 assert.equal(r.mode,'fixed-representative-route-research');assert.equal(r.windows.length,3);assert.equal(r.evaluationCalls,36);assert.equal(r.cacheReuses,144);
 for(const w of r.windows){
  assert.deepEqual(Object.keys(w.arms),['trend','event','reversal','fixed','dynamic']);assert.equal(w.expectedSymbols,12);assert.equal(w.commonEvaluated,12);assert.equal(w.comparableSymbols,12);
  assert.ok(w.arms.fixed.buyFills>0);assert.ok(w.arms.dynamic.buyFills>0);
  for(const a of Object.values(w.arms)){assert.equal(a.report.executionModel,'position-ledger');assert.ok(a.report.trades.every(t=>t.sellDay>t.buyDay));assert.ok(a.additionalMetrics.grossTurnoverRatio>0);}
  // One security with all representatives passing: changing the route priority
  // alone cannot manufacture an apparent advantage.
  assert.deepEqual(w.arms.fixed.report.equity,w.arms.dynamic.report.equity);
  const switches=w.trace.filter(t=>t.switched);assert.ok(switches.length>0);assert.ok(switches.every((s,i)=>i===0?s.dayIndex-w.trace[0].dayIndex>=5:s.dayIndex-switches[i-1].dayIndex>=5));
 }
 assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);assert.equal(r.outOfSampleValidated,false);assert.equal(JSON.stringify(input),before);
});
test('F21 incomplete or late market receipts cause both arms to abstain, not a neutral substitute or zero-return winner',()=>{
 const input=routeFixture();
 for(const row of Object.values(input.marketByDate))row.recordedAt++;
 const r=engine.experimentResearch36(input);
 for(const w of r.windows){assert.equal(w.marketUnknownSessions,12);assert.equal(w.commonEvaluated,12);assert.equal(w.comparableSymbols,0);
  assert.ok(w.trace.every(t=>t.market===null&&t.skipReason==='MARKET_EVIDENCE_UNKNOWN'));
  for(const a of Object.values(w.arms)){assert.equal(a.buyFills,0);assert.equal(a.markedReturnPct,null);assert.equal(a.closedAccountReturnPct,null);}
 }
});
test('F21 common coverage retains missing evidence, fixed protocol rejects overrides and malformed switches',()=>{
 const input=routeFixture();const date=input.stocks[0].bars[27].date;delete input.evidenceByDate[date][code].newsOriginalVerified;
 const r=engine.experimentResearch36(input),day=r.windows[0].trace[0];
 assert.equal(day.counts.event.unknown,1);assert.equal(day.commonEvaluated,0);assert.ok(Object.values(day.pickCounts).every(n=>n===0));
 assert.throws(()=>engine.experimentResearch36({...input,options:{...input.options,selectCandidates:()=>[code]}}),/覆盖/);
 assert.throws(()=>engine.experimentResearch36({...input,compareRoutes:'true'}),/布尔/);
 assert.throws(()=>engine.experimentResearch36({...input,marketByDate:{...input.marketByDate,'2099-01-01':{}}}),/非输入交易日/);
 assert.equal(r.trialBudgetVerified,false);assert.equal(r.eligibleForPromotion,false);
});
