'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const Evidence=require('../src/core/signal-evidence-chain'),Journal=require('../src/core/production-signal-journal');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const at=Date.parse('2026-11-12T10:00:00+08:00');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'signal-proof-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private');}
const input=()=>({code:'000001',type:'大单快速流入',triggerAt:at,strategyVersion:'rules-v1',recordKind:'trigger',
 quote:{price:10,pct:1,quoteAt:at-1000,receivedAt:at,quoteSource:'eastmoney',canTrade:true},
 conditions:[{id:'flow',label:'资金增量',value:5e7,threshold:3e6,operator:'>',source:'rule-v1',updatedAt:at}],
 inputs:{bars:[{date:'2026-11-11',close:10}],news:{originalEvidence:[{id:'announcement-1'}]},qualityEvidence:{canNotify:true}},
 model:{value:60,kind:'model-estimate',target:'ztToday',rankingValue:70,rankingKind:'ranking-score'},supportingReasons:['同一有效资金窗口增加'],opposingReasons:['非收益认证'],risk:{text:'风险',stopLoss:'9',invalidWhen:'触发条件失效'}});

test('schema1 evidence and paper intent detach and recursively freeze nested input',()=>{
 const signal={nested:{values:[1,2]}};
 const e=Evidence.createSignalEvidence({system:'fourteen-stock-pick',symbol:'600000.SH',signalDate:'2026-11-12',observedThrough:'2026-11-12',generatedAt:new Date(at).toISOString(),evaluatorVersion:'v1',source:'fixture',feedGate:{mode:'strict',status:'pass'},riskCheck:{status:'pass'},signal});
 signal.nested.values[0]=99;
 assert.equal(e.signal.nested.values[0],1);assert.ok(Object.isFrozen(e.signal.nested.values));
 assert.throws(()=>{e.signal.nested.values.push(3);},TypeError);
 const p=Evidence.bindPaperIntent(e,{symbol:e.symbol,signalDate:e.signalDate,side:'buy',quantity:100,limitPrice:10});
 assert.ok(Object.isFrozen(p.intent));assert.equal(Evidence.validateSignalEvidence(e).ok,true);
});
test('production evidence freezes exact rule, quote and model kinds without claiming calibrated probability',()=>{
 const raw=input(),e=Evidence.createProductionSignalEvidence(raw);
 raw.conditions[0].threshold=1;raw.inputs.bars[0].close=99;
 assert.equal(e.conditions[0].threshold,3e6);assert.equal(e.inputs.bars[0].close,10);
 assert.equal(e.model.kind,'model-estimate');assert.equal(e.model.value,60);assert.equal(e.model.rankingKind,'ranking-score');assert.equal(e.model.rankingValue,70);assert.equal(e.model.calibrationCertified,false);assert.equal(e.model.target,'ztToday');assert.equal(e.canTrade,false);
 assert.equal(e.status,'recorded');assert.equal(Evidence.validateProductionSignalEvidence(e).ok,true);
 assert.ok(Object.isFrozen(e.inputs.bars[0]));
});
test('unknown or future evidence is recorded as partial rather than filled from trigger time',()=>{
 const raw=input();raw.quote={price:10};raw.conditions=[];raw.strategyVersion='';raw.inputs={};raw.risk={};
 const e=Evidence.createProductionSignalEvidence(raw);
 assert.equal(e.quote.quoteAt,null);assert.equal(e.quote.receivedAt,null);assert.equal(e.quote.quoteSource,'');
 assert.equal(e.status,'partial');assert.ok(e.missingReasons.includes('UNKNOWN_STRATEGY_VERSION'));
 assert.ok(e.missingReasons.includes('INCOMPLETE_TRIGGER_CONDITIONS'));assert.equal(e.canTrade,false);
 const future=Evidence.createProductionSignalEvidence({...input(),quote:{...input().quote,quoteAt:at+1}});
 assert.ok(future.missingReasons.includes('UNKNOWN_OR_INVALID_ORIGINAL_QUOTE'));
});
test('strategy changes and later triggers create distinct immutable identities',()=>{
 const first=Evidence.createProductionSignalEvidence(input());
 assert.equal(Evidence.createProductionSignalEvidence(input()).signalId,first.signalId);
 assert.notEqual(Evidence.createProductionSignalEvidence({...input(),strategyVersion:'v2'}).signalId,first.signalId);
 assert.notEqual(Evidence.createProductionSignalEvidence({...input(),triggerAt:at+1}).signalId,first.signalId);
 assert.equal(Evidence.validateProductionSignalEvidence({...first,model:{...first.model,value:99}}).ok,false);
});
test('private journal is durable, append-only and idempotent after a fresh module load',t=>{
 const dir=root(t),e=Evidence.createProductionSignalEvidence(input());
 assert.equal(Journal.appendEvidence(dir,e,{clock:()=>at}).reused,false);
 const file=path.join(dir,'2026-11-12','000001',e.signalId+'.json'),bytes=fs.readFileSync(file);
 assert.equal(Journal.appendEvidence(dir,e,{clock:()=>at+1000}).reused,true);
 assert.deepEqual(fs.readFileSync(file),bytes);
 assert.equal(fs.statSync(dir).mode&0o077,0);assert.equal(fs.statSync(file).mode&0o077,0);
 delete require.cache[require.resolve('../src/core/production-signal-journal')];
 const reopened=require('../src/core/production-signal-journal').readEvidence(dir,{date:'2026-11-12',code:'000001',id:e.signalId});
 assert.equal(reopened.records[0].evidence.conditions[0].threshold,3e6);
 const later=Evidence.createProductionSignalEvidence({...input(),triggerAt:at+5000,supersedes:e.signalId});
 Journal.appendEvidence(dir,later,{clock:()=>at+5000});
 const history=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001'});
 assert.equal(history.total,2);assert.equal(history.records[0].evidence.supersedes,e.signalId);
 assert.deepEqual(fs.readFileSync(file),bytes);
});
test('journal rejects tampering and missing identities without rebuilding old evidence',t=>{
 const dir=root(t),e=Evidence.createProductionSignalEvidence(input());Journal.appendEvidence(dir,e,{clock:()=>at});
 const file=path.join(dir,'2026-11-12','000001',e.signalId+'.json'),saved=JSON.parse(fs.readFileSync(file));
 saved.evidence.quote.price=999;fs.writeFileSync(file,JSON.stringify(saved));
 assert.throws(()=>Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:e.signalId}),/完整性/);
 assert.throws(()=>Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:'a'.repeat(64)}));
});
test('journal refuses public, symlink and invalid query paths',t=>{
 const dir=root(t),e=Evidence.createProductionSignalEvidence(input());
 assert.throws(()=>Journal.appendEvidence(path.join(path.dirname(dir),'public'),e,{clock:()=>at}),/公开/);
 fs.mkdirSync(dir,{mode:0o700});const link=dir+'-link';fs.symlinkSync(dir,link);
 assert.throws(()=>Journal.appendEvidence(link,e,{clock:()=>at}),/符号链接/);
 assert.throws(()=>Journal.readEvidence(dir,{date:'2026-02-30',code:'000001'}));
 assert.throws(()=>Journal.readEvidence(dir,{date:'2026-11-12',code:'../x'}));
 assert.throws(()=>Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:'../../private'}));
});
function serverContext(dir){
 let now=at,saves=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context=vm.createContext({Date:Clock,SignalEvidence:Evidence,SignalJournal:Journal,path,__dirname:path.resolve(__dirname,'..'),
   SIGNAL_RULE_SOURCE_HASH:'fixture-loaded-source',process:{env:{V6_SIGNAL_EVIDENCE_DIR:dir}},require:module=>module.startsWith('./')?require(path.resolve(__dirname,'..',module)):require(module),
   console:{error(){},log(){}},S:{learn:{signals:[],buckets:{}}},
   fusedProb:()=>({prob:74,model:60,emp:100,la:null,delta:0,valueKind:'ranking-score',target:'ztToday'}),
   todayStr:()=> '20261112',krowsOf:()=>[],probKindOf:()=> 'score',isTradeDay:()=>true,pruneSignals(){},
   saveLearn(){saves++;},tick(){}});
 vm.runInContext(section('let signalRuleVersion;','// 存量迁移'),context);
 vm.runInContext(section('function logSignal(','// 样本库剪枝'),context);
 return {c:context,set:value=>{now=value;},saves:()=>saves};
}
test('real logSignal retains the first daily sample and appends later observations with explicit lineage',t=>{
 const dir=root(t),{c,set,saves}=serverContext(dir);
 const first=c.logSignal('pool','000001','测试',10,50,{paths:['first'],strategyVersion:'v1'});
 const original=JSON.parse(JSON.stringify(c.S.learn.signals[0]));
 set(at+5000);const second=c.logSignal('pool','000001','测试',12,80,{paths:['later'],strategyVersion:'v2'});
 assert.equal(c.S.learn.signals.length,1);assert.deepEqual(JSON.parse(JSON.stringify(c.S.learn.signals[0])),original);
 assert.equal(saves(),1);assert.notEqual(first.signalId,second.signalId);
 const history=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001'});
 assert.equal(history.total,2);assert.equal(history.records[0].evidence.supersedes,first.signalId);
 assert.equal(history.records[1].evidence.quote.price,10);assert.equal(history.records[0].evidence.quote.price,12);
 assert.equal(history.records[0].evidence.strategyVersion,'v2');
});
test('legacy daily samples keep unknown version/time instead of acquiring today evaluator metadata',t=>{
 const dir=root(t),{c}=serverContext(dir),legacy={date:'20261112',type:'pool',code:'000001',ts:at-1000,price:9,prob:40,paths:['legacy']};
 c.S.learn.signals=[legacy];const before=JSON.stringify(legacy);
 c.logSignal('pool','000001','测试',12,80,{paths:['new']});
 assert.equal(JSON.stringify(legacy),before);assert.equal(legacy.strategyVersion,undefined);assert.equal(legacy.signalId,undefined);
 const observation=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001'}).records[0].evidence;
 assert.equal(observation.supersedes,null);assert.equal(observation.inputs.metrics.legacyParent.price,undefined);
 assert.equal(observation.inputs.metrics.legacyParent.ts,at-1000);
});
test('a later auction calibration marker belongs to its new observation and cannot rewrite the original sample',t=>{
 const dir=root(t),{c,set}=serverContext(dir);c.logSignal('auczt','000001','测试',10,9);
 const before=JSON.stringify(c.S.learn.signals[0]);set(at+5000);const later=c.logSignal('auczt','000001','测试',12,18,{cal:'h2'});
 assert.equal(JSON.stringify(c.S.learn.signals[0]),before);assert.equal(c.S.learn.signals[0].cal,undefined);
 const observation=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:later.signalId}).records[0].evidence;
 assert.equal(observation.inputs.metrics.cal,'h2');assert.equal(observation.quote.price,12);
});
test('actual tick freezes a causal funds condition, raw provenance and archive before enqueue',async t=>{
 const dir=root(t),{c}=serverContext(dir);
 const stock={code:'000001',name:'测试',price:10,pct:1,mainPct:2,mainInflow:12e7,floatCap:1e10,
   quoteSource:'eastmoney',quoteAt:at-1000,receivedAt:at,canTrade:true,
   fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsRetrievedAt:at,fundsSourceTimestamp:null};
 Object.assign(c,{PAPER:{pool:{positions:{}},pre:{positions:{}}},monitorCodes:[],
   em:{fetchBatchSnapshot:async()=>[stock]},ingestPx(){},numNeutral:(_,v)=>v,sectorZTCountFor:()=>0,numGapRaw:()=>2,
   calibratedProb:v=>v,probThreshold:()=>.9,riseProbOf:()=>70,riskNoteOf:()=> '风险需复核',stopRefOf:()=> '9',
   isStrongAlert:()=>false,modDayTake:()=>true,govTake:()=>({ok:true}),auctionPhase:()=>0,dataCapOf:()=>200,sseSend(){},
   enqueueIntraday:rows=>{c.enqueued=rows;},A:{limitUpProbability:()=>.5,isNearLimitUp:()=>false}});
 Object.assign(c.S,{loop:{running:false,tickCount:0},candidatePool:[{code:'000001'}],sectors:[],stocks:[],inflowHistory:new Map(),klines:new Map(),
   news:{goodCodes:new Set(),badCodes:new Set()},fastinRepeat:new Map(),lastPush:new Map(),pushCount:new Map(),signals:[]});
 vm.runInContext(section('function fundsNumber(','const { analyzeShortline }'),c);
 vm.runInContext(section('function countStreak(h)','function sectorZTCountFor('),c);
 c.S.inflowHistory.set('000001',Array.from({length:11},(_,i)=>c.fundsHistoryObservation({...stock,mainInflow:(i+1)*1e7,fundsRetrievedAt:at-(11-i)*5000},at-(11-i)*5000)));
 vm.runInContext(section('async function tick()','\nfunction countStreak(h)'),c);
 await c.tick();assert.equal(c.S.loop.lastError,null);
 assert.equal(c.enqueued.length,1);const signal=c.enqueued[0];
 assert.equal(signal.type,'大单快速流入');assert.equal(signal.quoteAt,stock.quoteAt);assert.equal(signal.quoteSource,'eastmoney');
 assert.equal(signal.conditionEvidence.find(x=>x.id==='fast-flow').threshold,3e6);
 assert.equal(signal.evidenceArchiveStatus,'archived');assert.ok(Object.isFrozen(signal.conditionEvidence));
 const frozen=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:signal.signalId}).records[0].evidence;
 assert.equal(frozen.recordKind,'trigger');assert.equal(frozen.inputs.funds.length,12);assert.equal(frozen.inputs.metrics.delta,11e7);
 assert.equal(frozen.model.value,50);assert.equal(frozen.model.target,'ztToday');assert.equal(frozen.model.kind,'model-estimate');
 assert.equal(frozen.riseModel.value,70);assert.equal(frozen.riseModel.target,'up3Next');assert.equal(frozen.riseModel.source,'riseProbOf');
 assert.equal(frozen.model.rankingValue,74);assert.equal(frozen.model.rankingKind,'ranking-score');assert.ok(frozen.risk.invalidWhen);
 stock.quoteAt=0;stock.price=99;assert.equal(frozen.quote.price,10);assert.equal(signal.price,10);
});
test('new immutable identities are required for a matching delivery; legacy references remain legacy only',()=>{
 const {dashboardView}=require('../src/core/dashboard-view'),signal={code:'000001',type:'趋势票',ts:at,signalId:'a'.repeat(64)};
 const project=ref=>dashboardView({signals:[signal]},null,at+1000,{pushLog:[{ts:at+100,status:'✅ 已送达',extra:{codes:['000001'],signalRefs:[ref]}}]}).pushes.items[0];
 const legacy={code:signal.code,type:signal.type,ts:at};
 assert.notEqual(project(legacy).stage,'sent');assert.notEqual(project({...legacy,signalId:'b'.repeat(64)}).stage,'sent');
 assert.equal(project({...legacy,signalId:signal.signalId}).stage,'sent');
});
test('real recommendation wrapper freezes its own original row and leaves unavailable rule thresholds unknown',t=>{
 const dir=root(t),{c}=serverContext(dir),row={code:'000001',price:12,score:88,paths:['first'],quoteSource:'fixture',quoteAt:at-1000,receivedAt:at,canNotify:false};
 const observed=c.logSignal('pool',row.code,'测试',row.price,row.score,c.learningSignalExtra(row,{paths:row.paths}));
 row.score=0;row.paths.push('changed');
 const frozen=Journal.readEvidence(dir,{date:'2026-11-12',code:'000001',id:observed.signalId}).records[0].evidence;
 assert.equal(frozen.inputs.metrics.originalRecord.score,88);assert.deepEqual(frozen.inputs.metrics.originalRecord.paths,['first']);
 assert.deepEqual(JSON.parse(JSON.stringify(c.S.learn.signals[0].paths)),['first']);
 assert.equal(frozen.conditions.length,0);assert.ok(frozen.missingReasons.includes('INCOMPLETE_TRIGGER_CONDITIONS'));
 assert.equal(frozen.inputs.qualityEvidence.canNotify,false);
});
test('actual archive failure is explicit and never overwrites the first sample',t=>{
 const dir=root(t),{c}=serverContext(dir);fs.mkdirSync(dir,{mode:0o755});fs.chmodSync(dir,0o755);
 const first=c.logSignal('pool','000001','测试',10,50);
 assert.equal(first.evidenceArchiveStatus,'unavailable');assert.equal(fs.readdirSync(dir).length,0);
 const original=JSON.stringify(c.S.learn.signals[0]);c.logSignal('pool','000001','测试',12,80);
 assert.equal(JSON.stringify(c.S.learn.signals[0]),original);
 const failed=c.captureProductionSignal({ts:at,code:'000001',type:'pool',prob:50,ruleInputs:{text:'x'.repeat(600*1024)}},{},[],{metrics:{text:'x'.repeat(600*1024)}});
 assert.equal(failed.signalId,null);assert.equal(failed.evidenceStatus,'unavailable');
});
test('actual batch sender carries immutable IDs only for selected signals without any external dispatch',()=>{
 const first={code:'000001',type:'趋势票',ts:at,signalId:'a'.repeat(64)},omitted={code:'000002',type:'大单快速流入',ts:at,signalId:'b'.repeat(64)},logs=[];
 const context=vm.createContext({INTRADAY:{buf:new Map([['first',first],['omitted',omitted]]),parts:[],firstAt:at},
  INTRADAY_MAX_ITEMS:1,ALERT_RANK:{},alertScore:()=>0,buildAlertsReport:()=> '000001',
  redactSecrets:x=>x,extractStockCodes:()=>['000001'],inManualPush:()=>false,isReplica:()=>true,
  pushLog:(status,title,data)=>logs.push({status,title,...data}),console:{log(){}},sseSendEdit(){},_pushLast:null});
 for(const name of ['pushAll','flushIntraday']){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}\n',start)+2;
  assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
 }
 context.flushIntraday();assert.equal(logs.length,1);assert.deepEqual(JSON.parse(JSON.stringify(logs[0].extra.signalRefs)),[first]);
});
