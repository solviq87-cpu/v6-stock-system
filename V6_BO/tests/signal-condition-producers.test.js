'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),serverPath=require.resolve('../server.js'),load=createRequire(serverPath);
const source=fs.readFileSync(serverPath,'utf8'),Evidence=require('../src/core/signal-evidence-chain');
const now=Date.parse('2026-11-13T10:00:00+08:00');
const withoutMetadata=process.env.V6_TEST_SIGNAL_BASELINE_PATH?fs.readFileSync(process.env.V6_TEST_SIGNAL_BASELINE_PATH,'utf8'):
 source.replace(/^[ \t]*\/\/ CONDITION_EVIDENCE_BEGIN\r?\n[\s\S]*?^[ \t]*\/\/ CONDITION_EVIDENCE_END\r?\n/gm,'');
function fn(name,src=source){let start=src.indexOf('function '+name+'(');assert.ok(start>=0,name);if(src.slice(start-6,start)==='async ')start-=6;const end=src.indexOf('\n}\n',start)+2;assert.ok(end>start,name);return src.slice(start,end);}
function section(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a,start);return src.slice(a,b);}
const plain=value=>JSON.parse(JSON.stringify(value,(key,item)=>['conditionEvidence','conditionCoverage','conditionInputs'].includes(key)?undefined:item));
const bars=()=>Array.from({length:30},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),open:10,high:12,low:9,close:10+i*.01,pct:1,volume:100+i,amount:1e7,turnover:5}));
const stock=overrides=>({code:'000001',name:'测试',price:11,pct:2,mainPct:6.04,mainInflow:1e7,amount:4e8,turnover:5,speed:1,high:11.1,floatCap:5e9,
 quoteSource:'vendor-original',quoteAt:now-1000,receivedAt:now,mode:'public-live-unverified',canNotify:true,volume:1e6,...overrides});
function sandbox(src=source){
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}getHours(){return new Date(this.getTime()+28800000).getUTCHours();}}
 const rows=bars(),logs=[],messages=[];
 const c=vm.createContext({Buffer,Date:Clock,require:load,SignalEvidence:Evidence,console:{log(){},error(){}},path,fs,
  S:{stocks:[],klines:new Map(),candidatePool:[],fundDays:new Map(),flow5d:new Map(),ztPool:[],ztBySector:{},sectors:[],news:{goodCodes:new Set(),badCodes:new Set()},learn:{paths:{}},secStocks:new Map(),prePushed:new Map(),bigMoneyPushed:new Map(),
   bkOfSector:()=> 'BK0001',auction:{strong:[],phase:3},stocksAt:now},
  A:{isJunkName:name=>name==='ST排除',nextDayLimitProb:()=>60,reviewFlags:()=>({aboveMa5:true,rangePos:50,volRatio:1.2,cci:100}),
   limitUpProbability:()=>.5,chipPeakOf:()=>null,volTenOf:()=>null,candlePatternOf:()=>null},
  todayBeta:()=>0,todayStr:()=> '20261113',quoteDayOf:()=> '20261113',newsSupportsCode:()=>false,
  classifySectorRoles:arr=>({leader:arr[0],map:new Map(arr.map((z,i)=>[z.code,i===0?'leader':'deputy']))}),themeStrengthOf:()=>({score:60,inflowSum:1e8,theme:'板块',grade:'强'}),
  isMainlineStock:z=>({ok:z.code!=='000009',reason:'fixture-mainline'}),krowsOf:()=>rows,klineRows:async()=>rows,
  fusedProb:(_code,_name,_rows,_type,prob)=>({model:prob,prob,delta:0,src:'fixture',valueKind:'ranking-score',modelKind:'model-estimate',target:'ztNext'}),
  ZT_INFER_PUSH_PROB:55,AUCZT_PROB_CEIL:45,auctionMktGate:()=>1,marketMood:()=>({advice:'中性'}),themePersistOf:()=>({grade:null}),numNeutral:(_name,v)=>v,
  _govCfg:key=>({simGate:80,bigMoneyPct:6.03,activePctThreshold:6})[key],calibratedProb:value=>value,marketReady:()=>true,staleMark(){},capTooSmall:()=>false,sentLogPush(){},
  sectorOfStock:()=> '板块',sectorHeat:()=>({hot:true}),sectorZTCountFor:()=>2,numGapRaw:()=>5,missingOf:()=>.7,
  ensureStockBoards:async()=>{},enrichHigh20:async list=>{for(const x of list)x.ctx={weight:1,flowKind:'趋势中加仓'};},
  em:{fetchBatchFlowEM:async()=>[],fetchThsActiveBatch:async()=>new Map(),flowBalance:()=>null,fetchBoardStocks:async()=>[],fetchSinaSectorStocks:async()=>[],fetchBatchSnapshot:async()=>[]},
  _simRows:async()=>rows,_retSeries:r=>r.map(x=>x.close),_simScore:()=>85,_mapLimit:async(items,_n,work)=>Promise.all(items.map(work)),
  laProb:()=>({p:.3,base:.1,rules:[]}),newsTitlesFor:()=>({good:[],bad:[]}),LOGIC:{attribute:()=>({kind:'不明'})},
  _ztSentPushed:new Set(),_fmtSealY:value=>String(value),ztReasonOf:()=>'',pushIntensityOf:()=>1,
  isTradingTime:()=>false,inQuietHours:()=>false,modDayTake:()=>true,govFilter:(_type,list)=>list,govTrim:(list,n)=>list.slice(0,n),modDayKeepOrDrop:(_type,list)=>list,
  govFoot:()=>'',govUndoOf:()=>[],pushLog(){},sseSend(){},productionSignalVersion:()=> 'fixture-version',
  logSignal:(...args)=>{logs.push(args);return {prob:args[4]};},pushAll:(...args)=>{messages.push(args);return true;},
  loadSectorHistory:()=>({}),buildZTRoleMap:()=>new Map(),maxDrawdown:()=>0,scoreSmoothOf:(_code,score)=>({score,rawScore:score}),empNdProb:()=>null,
  _auctionResonanceCache:new Map(),AUCTION_RESONANCE_CACHE_MS:30000});
 for(const name of ['annotateSignalConditions','learningSignalExtra','fundsNumber','fundsRounded','fundsWindowSum'])vm.runInContext(fn(name,name==='annotateSignalConditions'?source:src),c);
 // Keep the actual purpose gates active in both sides of the metadata comparison.
 // createRequire(serverPath) resolves their real module instead of a permissive VM stub.
 require('./helpers/news-known-empty-fixture').install(c);
 for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','researchSnapshotFields','researchQuoteFields',
  'freezeRecommendationRows','recommendationSendOptions','prepareRecommendationDelivery','auctionSendOptions'])vm.runInContext(fn(name),c);
 return {c,logs,messages,rows,run:name=>vm.runInContext(fn(name,src),c),src};
}
async function pair(names,setup,execute){
 const baseline=sandbox(withoutMetadata),after=sandbox(source);
 for(const fixture of [baseline,after]){setup(fixture);for(const name of names)fixture.run(name);}
 const before=await execute(baseline),result=await execute(after);
 assert.deepEqual(plain(result),plain(before),'metadata must preserve original candidates and values');
 return {before,result,after,baseline};
}

test('production coverage is explicitly partial even when every captured comparison is present',()=>{
 const {c}=sandbox(),row={code:'000001',score:80};c.annotateSignalConditions(row,'fixture',[['score','原门',80,65,'>=']],['EXTERNAL_MODEL_INTERNALS'],{raw:{value:80}});
 assert.equal(row.score,80);assert.equal(row.conditionCoverage.status,'partial');assert.ok(Object.isFrozen(row.conditionEvidence));
 assert.equal(row.conditionEvidence[0].threshold,65);assert.equal(row.conditionCoverage.missing[0].id,'EXTERNAL_MODEL_INTERNALS');
 const input={code:row.code,type:'fixture',triggerAt:now,strategyVersion:'v1',conditions:row.conditionEvidence,conditionCoverage:row.conditionCoverage,
  quote:{price:10,quoteAt:now-1,receivedAt:now,quoteSource:'vendor'},inputs:{bars:[{close:10}],news:{originalEvidence:[{id:'raw'}]},qualityEvidence:{canNotify:true}},risk:{invalidWhen:'条件失效'}};
 const archived=Evidence.createProductionSignalEvidence(input);assert.equal(archived.status,'partial');assert.ok(archived.missingReasons.includes('INCOMPLETE_TRIGGER_CONDITIONS'));
 const absent=Evidence.createProductionSignalEvidence({...input,conditionCoverage:undefined});assert.equal(absent.status,'partial');assert.equal(absent.conditionCoverage.status,'unknown');
 c.annotateSignalConditions(row,'fixture',[['score','新门',90,75,'>=']],[],{});assert.equal(archived.conditions[0].threshold,65);assert.equal(archived.conditions[0].value,80);
});
test('condition snapshots are bounded without changing a candidate when evidence is too large',()=>{
 const {c}=sandbox(),row={score:80};c.annotateSignalConditions(row,'large',[['score','门',80,65,'>=']],[],{text:'x'.repeat(70*1024)});
 assert.equal(row.score,80);assert.equal(row.conditionInputs[0].values,null);assert.ok(row.conditionCoverage.missing.some(gap=>gap.id==='CONDITION_INPUT_SNAPSHOT_UNAVAILABLE'));
 c.annotateSignalConditions(row,'many',Array.from({length:150},(_,i)=>[String(i),'门',i,0,'>=']),[],{});
 assert.equal(row.conditionEvidence.length,128);assert.ok(row.conditionCoverage.missing.some(gap=>gap.id==='CONDITION_COUNT_EXCEEDS_128'));
 for(let i=0;i<13;i++)c.annotateSignalConditions(row,'stage',[],[],{i});
 assert.equal(row.conditionInputs.length,12);assert.ok(row.conditionCoverage.missing.some(gap=>gap.id==='CONDITION_STAGE_COUNT_EXCEEDS_12'));
});
test('actual yier and lianban scanners retain original selection and freeze their ranking gates',async()=>{
 for(const name of ['scanYiEr','scanLianbanRelay']){
  const {result,after}=await pair([name],({c,rows})=>{
   c.S.ztPool=[stock({code:'000001',limitUpCount:name==='scanYiEr'?1:2,sealAmount:2e8,breakCount:0,sector:'板块'}),stock({code:'000009',limitUpCount:name==='scanYiEr'?1:3,sealAmount:2e8,sector:'板块'})];
   c.S.ztBySector={'板块':c.S.ztPool};c.S.stocks=c.S.ztPool;for(const z of c.S.ztPool)c.S.klines.set(z.code,{rows});
  },({c})=>c[name]());
  assert.equal(result.length,1);const gate=result[0].conditionEvidence.find(rule=>rule.id.endsWith(':ranking-floor'));
  assert.equal(gate.threshold,55);assert.equal(gate.value,result[0].fused);after.c.ZT_INFER_PUSH_PROB=99;assert.equal(gate.threshold,55);
  assert.ok(result[0].conditionInputs[0].values.rawBoard);assert.equal(result[0].conditionCoverage.status,'partial');
 }
});
test('actual auction inference preserves the original curve and freezes multipliers and phase inputs',async()=>{
 const {result}=await pair(['aucztProbClamp','inferZTProb'],({c})=>{c.S.auction.strong=[stock({price:10,score:48,factors:['factor'],why:[],risk:[]})];c.S.learn.paths.factor={adj:2};},({c})=>{c.inferZTProb();return c.S.auction.ztInfers;});
 assert.equal(result.length,1);assert.ok(Math.abs(result[0].conditionInputs[0].values.mappedValue-15.2)<1e-10);assert.equal(result[0].conditionInputs[0].values.factorAdjustment,1.6);
 assert.equal(result[0].conditionEvidence.find(rule=>rule.id.endsWith(':phase-high')).threshold,3);
});
test('actual similar scanner freezes the effective dynamic similarity gate without changing membership',async()=>{
 const {result,after}=await pair(['findSimilarStocks'],({c})=>{c.S.stocks=[stock({code:'000008',pct:8}),stock({code:'000001',pct:2}),stock({code:'000002',pct:.4})];},({c})=>c.findSimilarStocks());
 assert.equal(result.length,1);const rule=result[0].conditionEvidence.find(rule=>rule.id.endsWith(':similarity'));
 assert.equal(rule.value,85);assert.equal(rule.threshold,82);after.c._govCfg=()=>99;assert.equal(rule.threshold,82);
 assert.equal(result[0].conditionInputs[0].values.configuredGate,80);
});
test('actual pre and buzhang scanners preserve membership while recording original range and exception gates',async()=>{
 for(const name of ['preBreakoutInner','computeBuZhang']){
  const {result}=await pair([name],({c})=>{c.S.ztPool=[stock({code:'000008',limitUpCount:2})];c.S.ztBySector={'板块':c.S.ztPool};c.S.sectors=[{name:'板块',code:'BK0001',pct:1,mainInflow:1e8}];c.em.fetchBoardStocks=async()=>[stock(),stock({code:'000002',pct:10})];},async({c})=>{const result=await c[name]();return result||c.S.buzhang.items;});
  assert.equal(result.length,1);const upper=result[0].conditionEvidence.find(rule=>rule.id.endsWith(':return-high'));
  assert.equal(upper.threshold,name==='preBreakoutInner'?4:9);assert.equal(upper.value,2);assert.equal(result[0].conditionCoverage.status,'partial');
  if(name==='preBreakoutInner')assert.deepEqual(plain(result[0].conditionInputs[0].values.scoreBranchThresholds.volume),[1.2,1.5]);
 }
});
test('actual seal broadcaster keeps selected records and snapshots the pre-mutation dedup marker',async()=>{
 const {result,after}=await pair(['ztSealPush'],({c})=>{
  const factEvidence={kind:'provider-limit-up-pool-record',tradeDate:'2026-11-13',source:'vendor-original',observedAt:now};
  c.S.ztPool=[stock({sealAmount:1e8,factEvidence}),stock({code:'000002',sealAmount:2e7,factEvidence}),stock({code:'000003',sealAmount:null,factEvidence})];
 },({c,logs})=>{c.ztSealPush(c.S.ztPool,3);return logs.map(args=>({code:args[1],prob:args[4],...args[5].sourceRecord}));});
 assert.equal(result.length,2);const first=result.find(row=>row.code==='000001');assert.equal(first.conditionEvidence.find(rule=>rule.id.endsWith(':already-pushed')).value,0);
 assert.equal(first.conditionEvidence.find(rule=>rule.id.endsWith(':seal-amount')).threshold,5e7);assert.equal(after.c._ztSentPushed.has('000001'),true);
});
test('actual bigmoney scanner freezes unrounded funds and the dynamic strict threshold',async()=>{
 const {result,after}=await pair(['scanBigMoneyInner'],({c})=>{c.S.stocks=[stock(),stock({code:'000002',mainPct:6.03})];},({c})=>c.scanBigMoneyInner());
 assert.equal(result.length,1);assert.equal(result[0].mainPct,6);const rule=result[0].conditionEvidence.find(rule=>rule.id.endsWith(':main-percent'));
 assert.equal(rule.value,6.04);assert.equal(rule.threshold,6.03);assert.equal(rule.operator,'>');after.c.S.stocks[0].mainPct=99;assert.equal(rule.value,6.04);
});
test('actual resonance scanner preserves sector-only candidates and records its genuine disjunction',async()=>{
 const {result}=await pair(['auctionResonanceScan'],({c})=>{c.S.stocks=[stock(),stock({code:'000002',pct:1})];c.S.sectors=[{name:'板块',mainInflow:1e8}];c.A.isMainOrGEM=()=>true;},async({c})=>(await c.auctionResonanceScan({force:true})).items);
 assert.equal(result.length,1);assert.equal(result[0].conditionEvidence.find(rule=>rule.id.endsWith(':sector-only-return')).threshold,2);
 assert.equal(result[0].conditionInputs[0].values.auctionInput,null);assert.equal(result[0].conditionCoverage.status,'partial');
});
test('actual pool selection retains the legacy missing-funds branch and freezes the effective 58/65/70 floors',()=>{
 for(const fallback of [false,true]){
  const outputs=[];
  for(const src of [withoutMetadata,source]){
   const {c}=sandbox(src);
   c.scored=fallback?[{code:'000001',score:70,paths:['其他路径'],mainInflow:0,focused:false}]:[
    {code:'000001',score:58,paths:['筹码峰<11%'],mainInflow:0,focused:false},
    {code:'000002',score:64,paths:['其他路径'],mainInflow:1,focused:false},
    {code:'000003',score:65,paths:['其他路径'],mainInflow:1,focused:false}];
   vm.runInContext(section(src,'  const fund3dOf = c => {','  picked = picked.slice(0, POOL_BAZI_WINDOW);')+'\nglobalThis.selected=picked;',c);
   outputs.push(c.selected);
  }
  assert.deepEqual(plain(outputs[1]),plain(outputs[0]));
  if(fallback){const gate=outputs[1][0].conditionEvidence.find(rule=>rule.id.endsWith(':fallback-score'));assert.equal(gate.threshold,70);}
  else{
   assert.deepEqual(plain(outputs[1]).map(row=>row.code),['000001','000003']);
   assert.equal(outputs[1][0].conditionEvidence.find(rule=>rule.id.endsWith(':score')).threshold,58);
   assert.equal(outputs[1][1].conditionEvidence.find(rule=>rule.id.endsWith(':score')).threshold,65);
   assert.equal(outputs[1][0].conditionInputs[0].values.missingMultiDayAllowed,true);
  }
 }
});
test('actual sector scanner records its surge branch without pretending the unused strength branch was required',async()=>{
 const {result}=await pair(['pickNotableSectors','sectorSurgeScan'],({c})=>{
  Object.assign(c,{_prevSectorFlow:new Map([['板块',0]]),_sectorAlertMap:new Map(),prevSnapUsable:()=>true,prevSnapMark(){},themeOfSec:()=> '板块',
   signTxt:()=>'+',probTag:()=>'',pickLogic:()=>'',fuseLine:()=>''});
  c.isTradingTime=()=>true;c.S.sectors=[{name:'板块',mainInflow:4e7,pct:1}];c.S.extCache={sectors:[{name:'板块',node:'fixture'}]};c.S.ztBySector={'板块':[]};
  c.govFilter=(_type,candidates)=>{c.sectorCandidates=candidates;return candidates;};
  c.em.fetchSinaSectorStocks=async()=>[{code:'000001',name:'测试'}];c.em.fetchBatchSnapshot=async()=>[stock({pct:4})];
 },async({c})=>{await c.sectorSurgeScan();await new Promise(setImmediate);return c.sectorCandidates||[];});
 assert.equal(result.length,1);const gate=result[0].conditionEvidence.find(rule=>rule.id.endsWith(':sector-trigger'));
 assert.equal(gate.value,4e7);assert.equal(gate.threshold,3e7);assert.equal(result[0].conditionInputs[0].values.sectorSignal.kind,'surge');
});
test('actual A/B bigmoney selection freezes the same raw hot-factor and cutoff gates for both groups',async()=>{
 const outputs=[];
 for(const src of [withoutMetadata,source]){
  const {c}=sandbox(src);Object.assign(c,{BM_HOT_FACTOR_MIN:2,BM_PUSH_END_MIN:870,BIGMONEY_GAP_HOT:1000,BIGMONEY_GAP_NORMAL:1000,BIGMONEY_CARD_PER_ROUND:2,
   bigMoneyLastPush:{hot:0,normal:0},bmEarlyWin:()=>true,bmBucket:()=> 'cell',bmEmpBuckets:()=>({cell:{rate:60}})});
  c.scanBigMoney=async()=>[stock({code:'000001',prob:70,ctx:{flowKind:'趋势中加仓'},heat:{hot:true},startSignal:true,launchReady:true}),stock({code:'000002',prob:71,ctx:{flowKind:'趋势中加仓'},heat:{hot:true},startSignal:true,launchReady:true})];
  vm.runInContext(fn('bmHotFactors',src),c);
  const original=fn('scanBigMoneyPush',src),end=original.indexOf('  const srcTag =');assert.ok(end>0);
  vm.runInContext(original.slice(0,end)+'return fresh;\n}',c);outputs.push(await c.scanBigMoneyPush());
 }
 assert.deepEqual(plain(outputs[1]),plain(outputs[0]));assert.equal(outputs[1].length,2);assert.deepEqual(new Set(outputs[1].map(row=>row._grp)),new Set(['A','B']));
 for(const row of outputs[1]){
  assert.equal(row.conditionEvidence.find(rule=>rule.id.endsWith(':hot-factor-count')).threshold,2);
  assert.equal(row.conditionEvidence.find(rule=>rule.id.endsWith(':cutoff')).threshold,870);
  assert.equal(row.conditionCoverage.status,'partial');
 }
});
test('actual trend consumer preserves the external rule result and does not claim its hidden thresholds',()=>{
 const outputs=[];
 for(const src of [withoutMetadata,source]){
  const {c,rows}=sandbox(src);Object.assign(c,{t2:[{s:stock(),k:{rows}},{s:stock({code:'000002'}),k:{rows}}],thsTrend:null,trend:[],syRaw:[],
   winLabel:()=> '样本窗口',winShort:()=>'',signTxt:()=>'+',ztDayTag:()=>''});
  c.A.trendPoolCheck=({code})=>({ok:code==='000001',capOk:code==='000001',steadyRun:false,ma5:10,ma20:9,ma60:8,aboveMa20:true,aboveMa60:true,
   ma5up:true,dev:1,dd60:5,r20:10,fund3dSum:50,trendScore:70,zt60:0,hi60Win:30});
  vm.runInContext(section(src,'  const trendRej = { cap: 0, jumpy: 0, other: 0 };','  trend.sort((a, b) =>'),c);
  outputs.push(c.trend);
 }
 assert.deepEqual(plain(outputs[1]),plain(outputs[0]));assert.equal(outputs[1].length,1);
 const row=outputs[1][0];assert.equal(row.conditionInputs[0].values.trendResult.trendScore,70);assert.equal(row.conditionCoverage.status,'partial');
 assert.ok(row.conditionCoverage.missing.some(gap=>gap.id==='ANALYSIS_TREND_POOL_CHECK_INTERNAL_CHANNEL_OR_GATES_NOT_EXPANDED'));
});
