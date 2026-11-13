'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const serverPath=require.resolve('../server.js'),source=fs.readFileSync(serverPath,'utf8'),realRequire=createRequire(serverPath);
const Evidence=require('../src/core/signal-evidence-chain'),Journal=require('../src/core/production-signal-journal');
const at=Date.parse('2026-11-13T10:00:00+08:00');
const plain=value=>JSON.parse(JSON.stringify(value));
function section(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a,start);return src.slice(a,b);}
function fn(src,name){const a=src.indexOf('function '+name+'('),b=src.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);return src.slice(a,b);}
const live=(overrides={})=>({code:'000001',name:'正常股票',price:10,pct:1,prob:80,quoteAt:at-1000,receivedAt:at,
 quoteSource:'eastmoney',mode:'public-live-unverified',canNotify:true,amount:2e8,...overrides});
function context(t,options={},src=source){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'governance-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=at;
 const calls={fused:0,ev:0,quota:0,effectiveFloor:0,baseFloor:0,preFloor:0,saves:0,resets:0};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const c=vm.createContext({Date:Clock,Buffer,require:realRequire,SignalEvidence:Evidence,SignalJournal:Journal,path,fs,
  __dirname:path.dirname(serverPath),process:{env:{V6_SIGNAL_EVIDENCE_DIR:dir}},console:{log(){},error(){}},
  SIGNAL_RULE_SOURCE_HASH:'fixture-source',SIGNAL_RULE_SOURCE_MANIFEST:{status:'partial',files:[],fingerprint:null},
  S:{learn:{signals:[],buckets:{}},klines:new Map()},PUSH_GOV:{total:options.total||0,codes:new Map(),lowProb:0,negEv:0,dropped:0,noScore:0},
  PUSH_GOV_RESERVE:options.reserve??.2,NO_SCORE_TYPES:new Set(['zt']),missingOf:()=>-1,
  _govCfg:key=>({pushCooldownMin:options.cooldown??90,pushMaxPerCode:options.maxPerCode??3})[key],
  pushMinProb:()=>{calls.baseFloor++;return options.baseFloor??55;},
  pushMinProbEff:()=>{calls.effectiveFloor++;return options.floor??55;},
  pushMinProbPre:()=>{calls.preFloor++;return options.preFloor??45;},
  fusedProb:(_code,_name,_rows,_type,prob)=>{calls.fused++;return {model:prob,prob:options.fused??prob,modelKind:options.modelKind??'model-estimate',valueKind:options.valueKind??'ranking-score',
   target:options.target??'ztToday',emp:options.emp??null,empN:options.empN??0,empDays:3,delta:0};},
  evGateOf:()=>{calls.ev++;return options.ev||{blocked:false,evaluated:'stats-unavailable'};},
  pushQuota:()=>{calls.quota++;return options.quota??10;},ztFollowOf:()=>options.follow||null,
  govResetIfNewDay(){calls.resets++;clock+=options.advanceOnReset||0;},savePushGov(){calls.saves++;clock+=options.advanceOnSave||0;},
  krowsOf:()=>[],ppTxt:String,todayStr:()=> '20261113',probKindOf:()=> 'prob',isTradeDay:()=>true,pruneSignals(){},saveLearn(){},tick(){}});
 require('./helpers/news-known-empty-fixture').install(c);
 vm.runInContext(section(src,'let signalRuleVersion;','// 存量迁移'),c);
 for(const name of ['reviewRecommendation','reviewSnapshotFields','govTake','govFilter','govRelease','govReleaseAll','govTrim','logSignal'])vm.runInContext(fn(src,name),c);
 if(options.record)c.PUSH_GOV.codes.set('000001',{...options.record,types:new Set(options.record.types||[])});
 return {c,dir,calls,setNow:value=>{clock=value;}};
}
function behavior(c,result,calls){
 const projected={...result};delete projected.governanceEvidence;
 return plain({result:projected,state:{...c.PUSH_GOV,codes:[...c.PUSH_GOV.codes].map(([code,row])=>[code,{...row,types:[...row.types]}])},calls});
}

test('actual gate preserves baseline decisions, counters, writes and evaluator call counts across boundaries',t=>{
 const baseline=process.env.V6_TEST_GOVERNANCE_BASELINE_PATH&&fs.readFileSync(process.env.V6_TEST_GOVERNANCE_BASELINE_PATH,'utf8');
 const cases=[
  ['allow',{},'similar',80,'RESERVATION_ALLOWED'],['floor-below',{},'similar',54,'PROBABILITY_FLOOR_REJECTED'],
  ['floor-equal',{},'similar',55,'RESERVATION_ALLOWED'],['cold-effective',{floor:63},'similar',62,'PROBABILITY_FLOOR_REJECTED'],
  ['score-kind',{modelKind:'score',valueKind:'score'},'pool',55,'RESERVATION_ALLOWED'],
  ['pre-cap',{floor:63,preFloor:45},'pre',45,'RESERVATION_ALLOWED'],
  ['d5-below',{target:'up3Next',emp:34,empN:20},'trendsig',80,'D5_ACCURACY_REJECTED'],
  ['d5-equal',{target:'up3Next',emp:35,empN:20},'trendsig',80,'RESERVATION_ALLOWED'],
  ['d5-thin',{target:'up3Next',emp:0,empN:19},'trendsig',80,'RESERVATION_ALLOWED'],
  ['d5-other-event',{target:'ztNext',emp:0,empN:30},'similar',80,'RESERVATION_ALLOWED'],
  ...['fastin','bigmoney','bigmoney-B'].map(type=>['force-'+type,{target:'up3Next',emp:0,empN:30},type,5,'RESERVATION_ALLOWED']),
  ['force-still-ev',{ev:{blocked:true,why:'fixture EV rejection'}},'fastin',5,'EV_REJECTED'],
  ['same-type',{record:{n:1,ts:at-60000,types:['similar']}},'similar',80,'SAME_TYPE_RESERVED'],
  ['code-limit',{record:{n:3,ts:at-60000,types:[]}},'similar',80,'CODE_LIMIT_REJECTED'],
  ['cooldown',{record:{n:1,ts:at-60000,types:[]}},'similar',80,'COOLDOWN_REJECTED'],
  ['cooldown-equal',{record:{n:1,ts:at-90*60000,types:[]}},'similar',80,'RESERVATION_ALLOWED'],
  ['ordinary-quota',{quota:2,reserve:.5,total:1},'similar',80,'DAILY_QUOTA_REJECTED'],
  ['strong-quota',{quota:2,reserve:.5,total:1,strong:true},'similar',80,'RESERVATION_ALLOWED'],
  ['unlimited',{quota:Infinity,maxPerCode:0,cooldown:0},'similar',80,'RESERVATION_ALLOWED'],
  ['follow',{follow:'follow'},'similar',80,'FOLLOW_ROLE_REJECTED'],
  ['source-denied',{row:{canNotify:false}},'fastin',80,'RECOMMENDATION_EVIDENCE_REJECTED']
 ];
 const report=[];
 for(const [name,options,type,prob,reason]of cases){
  const actual=context(t,options),row=live({prob,...options.row});
  const result=actual.c.govTake(row.code,type,!!options.strong,prob,row),trace=result.governanceEvidence;
  assert.equal(trace.decision.reason,reason,name);assert.equal(trace.decision.allow,result.ok,name);
  assert.equal(trace.scope,'central-governance-reservation');assert.equal(trace.status,'partial');
  assert.ok(Object.isFrozen(trace));assert.ok(Object.isFrozen(trace.decision));
  if(baseline){const before=context(t,options,baseline),old=before.c.govTake(row.code,type,!!options.strong,prob,live({prob,...options.row}));
   assert.deepEqual(behavior(actual.c,result,actual.calls),behavior(before.c,old,before.calls),name);}
  if(name==='cold-effective')assert.equal(trace.probabilityFloor.effective,63);
  if(name==='pre-cap')assert.equal(trace.probabilityFloor.effective,45);
  if(name==='score-kind'){assert.equal(trace.model.rawKind,'score');assert.equal(trace.model.fusedKind,'score');}
  if(name==='d5-below')assert.deepEqual(plain(trace.d5),{eventTarget:'up3Next',minimumHit:35,minimumN:20,forceExempt:false,applicable:true});
  if(name.startsWith('force-'))assert.equal(trace.probabilityFloor.forceExempt,true);
  if(name==='unlimited'){assert.equal(trace.reservationBefore.quota,null);assert.equal(trace.reservationBefore.quotaUnlimited,true);}
  if(name==='floor-below'){assert.equal(trace.d5,null);assert.equal(trace.ev,null);assert.equal(trace.reservationBefore,null);}
  report.push({name,decision:trace.decision,calls:actual.calls,baselineCompared:!!baseline});
 }
 if(process.env.V6_GOVERNANCE_REPORT_PATH)fs.writeFileSync(process.env.V6_GOVERNANCE_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
});

test('actual EV evaluator records the exact fee threshold and retains unknown/not-significant behavior',t=>{
 for(const [env,cell,blocked,status]of [
  ['普涨',{n:30,sig:'sig',evCloseFee:.15},true,'significant'],
  ['普跌',{n:30,sig:'sig',evCloseFee:.15},true,'significant'],
  ['普涨',{n:30,sig:'sig',evCloseFee:.16},false,'significant'],
  ['普跌',{n:30,sig:'sig',evCloseFee:.16},true,'significant'],
  ['普涨',{n:30,sig:'sig',evClose:.26},false,'significant'],
  ['普跌',{n:30,sig:'point',evCloseFee:-10},false,'not-significant'],
  ['普跌',{n:0,unknown:true},false,'cell-unknown']]){
  const {c}=context(t);let statsCalls=0,cellCalls=0;
  Object.assign(c,{evStatsCached:()=>{statsCalls++;return {fee:.1};},evEnvNow:()=>env,
   EV:{EV_COLD_FEE:.3,EV_GATE_FEE:.15,evCell:()=>{cellCalls++;return cell;}}});
  vm.runInContext(fn(source,'evGateOf'),c);
  const result=c.govTake('000001','similar',false,80,live());
  assert.equal(result.ok,!blocked);assert.equal(result.governanceEvidence.ev.evaluated,status);
  assert.equal(statsCalls,1);assert.equal(cellCalls,1);
  assert.equal(result.governanceEvidence.ev.threshold,status==='significant'?(env==='普跌'?.3:.15):null);
  if(status==='significant')assert.equal(result.governanceEvidence.ev.evFee,cell.evCloseFee??(cell.evClose-.1));
 }
});

test('actual filter preserves ranking and clears stale reservations on missing-score reused candidates',t=>{
 const {c,calls}=context(t),a=live({code:'000001',prob:70}),b=live({code:'000002',prob:90});
 const result=c.govFilter('similar',[a,b]);assert.deepEqual(Array.from(result,x=>x.code),['000002','000001']);
 assert.equal(calls.ev,2);assert.equal(calls.saves,2);assert.equal(result[0].governanceEvidence.reservationBefore.total,0);
 const original=result[0].governanceEvidence;
 c.govTrim(result,1);assert.equal(c.PUSH_GOV.total,1);assert.equal(original.decision.allow,true,'trim/release never rewrites the decision');
 const before=plain(calls);delete b.prob;
 assert.equal(c.govFilter('similar',[b]).length,0);assert.equal(b.governanceEvidence,undefined);
 assert.equal(c.signalGovernanceEvidence(b),undefined);assert.equal(calls.fused,before.fused);assert.equal(calls.ev,before.ev);
});

test('sealed candidates retain identity-bound metadata and mismatched or future decisions never attach',t=>{
 const {c,dir}=context(t),row=Object.preventExtensions(live());
 const gate=c.govTake('000001','similar',false,80,row);assert.equal(gate.ok,true);assert.equal(row.governanceEvidence,undefined);
 assert.equal(c.learningSignalExtra(row).governanceEvidence,gate.governanceEvidence);
 const result=c.logSignal('similar',row.code,row.name,row.price,row.prob,c.learningSignalExtra(row));
 const archived=Journal.readEvidence(dir,{date:'2026-11-13',code:row.code,id:result.signalId}).records[0].evidence;
 assert.equal(archived.governanceEvidence.decision.allow,true);
 const copied={...row,governanceEvidence:gate.governanceEvidence,ts:at,type:'bigmoney_repeat'};
 assert.equal(c.captureProductionSignal(copied,row,[]).governanceEvidence,undefined,'repeat has independent governance');
 assert.equal(c.captureProductionSignal({...copied,type:'similar',code:'000002'},row,[]).governanceEvidence,undefined);
 assert.equal(c.captureProductionSignal({...copied,type:'similar',governanceEvidence:{...gate.governanceEvidence,evaluatedAt:at+1}},row,[]).governanceEvidence,undefined);
 assert.equal(c.learningSignalExtra({...row,governanceEvidence:gate.governanceEvidence}).governanceEvidence,undefined,'a copied candidate cannot claim another object reservation');
 delete row.prob;c.govFilter('similar',[row]);
 assert.equal(c.learningSignalExtra(row).governanceEvidence,undefined,'sealed candidates also lose stale allowed metadata on missing score');
});

test('real tick archives its later reservation before enqueue while keeping the original trigger time',async t=>{
 const {c,dir}=context(t,{advanceOnReset:5,advanceOnSave:5});
 const news=require('../src/core/news-evidence-journal'),newsRoot=path.join(dir,'news-evidence');
 c.process.env.V6_NEWS_EVIDENCE_DIR=newsRoot;
 const original={schemaVersion:1,source:'clock-fixture',eventId:'during-review',sourceRevisionId:'one',kind:'original',supersedes:null,
  url:'https://example.test/source',title:'触发前已知',body:'原始正文',bodyScope:'declared-body',securities:['000001'],
  publishedAt:at-60000,receivedAt:at-2,revisedAt:null};
 const before=news.appendBatch(newsRoot,[original],{now:at-1}).results[0];
 let later;
 const save=c.savePushGov;
 c.savePushGov=()=>{
  save();
  later=news.appendBatch(newsRoot,[{...original,sourceRevisionId:'two',kind:'revised',supersedes:before.eventHash,
   title:'审核期间收到修订',body:'较晚正文',receivedAt:at+6,revisedAt:at+6}],{now:at+7}).results[0];
 };
 const stock=live({mainPct:2,mainInflow:12e7,floatCap:1e10,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsRetrievedAt:at,fundsSourceTimestamp:null});
 Object.assign(c,{PAPER:{pool:{positions:{}},pre:{positions:{}}},monitorCodes:[],em:{fetchBatchSnapshot:async()=>[stock]},ingestPx(){},
  numNeutral:(_,value)=>value,sectorZTCountFor:()=>0,numGapRaw:()=>2,calibratedProb:value=>value,probThreshold:()=>.9,
  riseProbOf:()=>70,riskNoteOf:()=> 'fixture risk',stopRefOf:()=> '9',isStrongAlert:()=>false,modDayTake:()=>true,
  auctionPhase:()=>0,dataCapOf:()=>200,sseSend(){},enqueueIntraday:rows=>{c.enqueued=rows;},A:{limitUpProbability:()=>.5,isNearLimitUp:()=>false}});
 Object.assign(c.S,{loop:{running:false,tickCount:0},candidatePool:[{code:stock.code}],sectors:[],stocks:[],inflowHistory:new Map(),
  news:{goodCodes:new Set(),badCodes:new Set(),goodAll:[],riskSnapshot:{status:'available',checkedAt:at,source:'eastmoney-fast-news',columnsComplete:true}},fastinRepeat:new Map(),lastPush:new Map(),pushCount:new Map(),signals:[]});
 vm.runInContext(section(source,'const NEWS_EVIDENCE_ROOT=','const HOLIDAY_BUF_CAP'),c);
 vm.runInContext(section(source,'function fundsNumber(','const { analyzeShortline }'),c);
 vm.runInContext(section(source,'function countStreak(h)','function sectorZTCountFor('),c);
 c.S.inflowHistory.set(stock.code,Array.from({length:11},(_,i)=>c.fundsHistoryObservation({...stock,mainInflow:(i+1)*1e7,fundsRetrievedAt:at-(11-i)*5000},at-(11-i)*5000)));
 vm.runInContext(section(source,'async function tick()','\nfunction countStreak(h)'),c);
 await c.tick();assert.equal(c.S.loop.lastError,null);assert.equal(c.enqueued.length,1);
 const signal=c.enqueued[0],archive=Journal.readEvidence(dir,{date:'2026-11-13',code:stock.code,id:signal.signalId}).records[0].evidence;
 assert.equal(archive.triggerAt,at);assert.equal(archive.governanceEvidence.evaluatedAt,at+10);assert.equal(archive.capturedAt,at+10);
 assert.ok(archive.governanceEvidence.evaluatedAt>archive.triggerAt);assert.equal(archive.governanceEvidence.stateAt,at+5);
 assert.equal(archive.governanceEvidence.type,'fastin');assert.equal(archive.governanceEvidence.probabilityFloor.forceExempt,true);
 assert.equal(archive.governanceEvidence.decision.allow,true);assert.equal(archive.status,'partial');
 assert.ok(archive.missingReasons.includes('INCOMPLETE_TRIGGER_CONDITIONS'));
 assert.equal(archive.governanceEvidence.model.rawValue,50);assert.equal(archive.governanceEvidence.model.fusedValue,50);
 assert.equal(archive.inputs.news.originalEvidence[0].eventHash,before.eventHash,'later governance cannot lend its newer news to the earlier trigger');
 assert.equal(archive.inputs.news.binding.asOf,archive.triggerAt);assert.equal(archive.inputs.news.binding.asOfHeadHash,before.eventHash);
 assert.equal(archive.inputs.news.binding.versions.length,1);
 assert.ok(Object.isFrozen(signal.governanceEvidence));
 const observation=Journal.readEvidence(dir,{date:'2026-11-13',code:stock.code}).records.find(item=>item.evidence.recordKind==='observation').evidence;
 assert.equal(observation.governanceEvidence.evaluatedAt,archive.governanceEvidence.evaluatedAt);
 assert.equal(observation.inputs.news.originalEvidence[0].eventHash,later.eventHash,'the distinct later observation may reference the revision already recorded then');
});

test('governance archives are immutable across release, restart and later observations; old schema stays readable',t=>{
 const {c,dir,setNow}=context(t),row=live(),gate=c.govTake(row.code,'similar',false,row.prob,row);
 const first=c.logSignal('similar',row.code,row.name,row.price,row.prob,c.learningSignalExtra(row));
 const file=path.join(dir,'2026-11-13',row.code,first.signalId+'.json'),bytes=fs.readFileSync(file);
 c.govRelease(row.code,'similar');setNow(at+1000);row.prob=90;
 c.govTake(row.code,'similar',false,row.prob,row);c.logSignal('similar',row.code,row.name,row.price,row.prob,c.learningSignalExtra(row));
 assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(gate.governanceEvidence.model.rawValue,80);
 delete require.cache[require.resolve('../src/core/production-signal-journal')];
 const reloaded=require('../src/core/production-signal-journal').readEvidence(dir,{date:'2026-11-13',code:row.code,id:first.signalId}).records[0].evidence;
 assert.equal(reloaded.governanceEvidence.model.rawValue,80);assert.equal(reloaded.governanceEvidence.reservationBefore.total,0);
 const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','legacy-production-without-governance.json'),'utf8'));
 assert.equal(legacy.governanceEvidence,undefined);assert.equal(legacy.capturedAt,undefined);assert.equal(Evidence.validateProductionSignalEvidence(legacy).ok,true);
 Journal.appendEvidence(dir,legacy,{clock:()=>at});assert.equal(Journal.readEvidence(dir,{date:'2026-11-13',code:legacy.code,id:legacy.signalId}).records[0].evidence.governanceEvidence,undefined);
 const bounded=Evidence.createProductionSignalEvidence({code:'000003',type:'pool',triggerAt:at,governanceEvidence:{schemaVersion:1,text:'x'.repeat(17*1024)}});
 assert.equal(bounded.governanceEvidence.status,'unavailable');assert.ok(bounded.missingReasons.includes('GOVERNANCE_METADATA_UNAVAILABLE'));
});
