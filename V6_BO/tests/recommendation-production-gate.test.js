'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const serverPath=require.resolve('../server.js'),source=fs.readFileSync(serverPath,'utf8'),realRequire=createRequire(serverPath);
const now=Date.parse('2026-11-13T10:00:00+08:00');
const live=overrides=>({code:'000001',name:'正常股票',price:10,pct:5,prob:80,quoteAt:now-1000,receivedAt:now,
 quoteSource:'vendor-original',mode:'public-live-unverified',canNotify:true,volume:1e6,amount:2e8,mainInflow:1e7,mainPct:2,speed:1,...overrides});
function fn(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}\n',start)+2;assert.ok(start>=0&&end>start,'missing actual '+name);return source.slice(start,end);}
function context({quota=10,reserve=.2,cooldown=90,maxPerCode=3}={}){
 let clock=now,saves=0,resets=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const c=vm.createContext({Date:Clock,require:realRequire,console:{log(){},error(){}},path,fs,KLINE_CACHE:'/nonexistent-v6-review-fixture',
  S:{stocks:[],klines:new Map()},PUSH_GOV:{total:0,codes:new Map(),lowProb:0,negEv:0,dropped:0,noScore:0},PUSH_GOV_RESERVE:reserve,
  _govCfg:key=>({pushCooldownMin:cooldown,pushMaxPerCode:maxPerCode})[key],pushMinProb:()=>55,pushMinProbEff:()=>55,pushMinProbPre:()=>45,
  fusedProb:(_code,_name,_rows,_type,prob)=>({model:prob,prob,emp:null,delta:0,valueKind:'model-estimate',target:'ztToday'}),krowsOf:()=>[],
  ztFollowOf:()=>null,evGateOf:()=>({blocked:false}),pushQuota:()=>quota,NO_SCORE_TYPES:new Set(['zt']),missingOf:()=>-1,
  govResetIfNewDay(){resets++;},savePushGov(){saves++;},ppTxt:value=>String(value),
  _ztRushPushed:new Set(),_surgePushed:new Set(),_rushCool:new Map(),_rushMomentumCache:new Map(),pushIntensityOf:()=>1,capTooSmall:()=>false,
  A:{limitPctOf:()=>10,isLimitUp:()=>false,hasMomentumConditions:()=>true},sentinelLog:[],outbound:[],
  sentLogPush:(type,record)=>c.sentinelLog.push({type,...record}),pushAll:(...args)=>c.outbound.push(args)});
 for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','freezeRecommendationRows','recommendationSendOptions','prepareRecommendationDelivery','govTake','govFilter','ztRushScan','surgeScan'])vm.runInContext(fn(name),c,{filename:'actual-server-'+name+'.js'});
 return {c,saves:()=>saves,resets:()=>resets,setNow:value=>{clock=value;}};
}
const identityState=c=>({total:c.PUSH_GOV.total,codes:[...c.PUSH_GOV.codes].map(([code,row])=>({code,n:row.n,ts:row.ts,types:[...row.types]}))});

test('actual govTake cannot borrow a current same-code stock for a missing, old or unattributed candidate',()=>{
 for(const candidate of [undefined,live({quoteAt:now-60000}),live({quoteAt:undefined,timestamp:now}),live({quoteSource:undefined}),live({receivedAt:undefined}),live({code:'000002'})]){
  const {c,saves,resets}=context();c.S.stocks=[live()];const before=identityState(c);
  const result=c.govTake('000001','similar',false,99,candidate);assert.equal(result.ok,false);assert.match(result.why,/证据审查/);
  assert.deepEqual(identityState(c),before);assert.equal(saves(),0);assert.equal(resets(),0);
 }
});
test('actual govTake rejects source denial, ST, halt and explicit zero activity before quota or cooldown writes',()=>{
 for(const overrides of [{canNotify:false},{canTrade:false},{name:'*ST测试'},{riskWarning:true},{halt:true},{suspended:true},{tradable:false},
  {volume:0},{amount:0},{volume:undefined,amount:undefined},{mode:'simulated'},{quoteAt:now+1,receivedAt:now+1},{receivedAt:now-2000}]){
  const {c,saves}=context(),before=identityState(c),result=c.govTake('000001','similar',true,99,live(overrides));
  assert.equal(result.ok,false,JSON.stringify(overrides));assert.deepEqual(identityState(c),before);assert.equal(saves(),0);
 }
});
test('actual govTake preserves the existing model floor and force-push distinction after evidence passes',()=>{
 const {c,saves}=context();
 const low=c.govTake('000001','similar',false,54,live({prob:54}));assert.equal(low.ok,false);assert.match(low.why,/低于门槛/);assert.equal(c.PUSH_GOV.lowProb,1);assert.equal(c.PUSH_GOV.total,0);assert.equal(saves(),0);
 const normal=c.govTake('000001','similar',false,55,live({prob:55}));assert.equal(normal.ok,true);assert.equal(normal.fused.prob,55);assert.equal(c.PUSH_GOV.total,1);assert.equal(saves(),1);
 const forced=c.govTake('000002','fastin',false,5,live({code:'000002',prob:5}));assert.equal(forced.ok,true);assert.equal(c.PUSH_GOV.total,2);
 const stillInvalid=c.govTake('000003','fastin',true,99,live({code:'000003',canNotify:false}));assert.equal(stillInvalid.ok,false);assert.equal(c.PUSH_GOV.total,2);
});
test('actual govTake preserves configured ordinary reserves, strong quota, module dedup and cooldown',()=>{
 const {c}=context({quota:2,reserve:.5});
 assert.equal(c.govTake('000001','similar',false,80,live()).ok,true);
 assert.equal(c.govTake('000002','similar',false,80,live({code:'000002'})).ok,false,'ordinary reserve remains in force');
 assert.equal(c.govTake('000002','similar',true,80,live({code:'000002'})).ok,true);
 assert.equal(c.govTake('000003','similar',true,80,live({code:'000003'})).ok,false,'strong quota remains bounded');
 assert.equal(c.PUSH_GOV.total,2);
 const isolated=context().c;
 assert.equal(isolated.govTake('000001','similar',false,80,live()).ok,true);
 const record=identityState(isolated);
 assert.match(isolated.govTake('000001','similar',false,80,live()).why,/同一模块/);
 assert.match(isolated.govTake('000001','sector',false,80,live()).why,/冷却/);
 assert.deepEqual(identityState(isolated),record);
});
test('actual govFilter supplies the precise candidate row and leaves unrelated fresh snapshots unused',()=>{
 const {c}=context();c.S.stocks=[live()];
 const old=live({quoteAt:now-60000,prob:99}),unknown=live({code:'000003',quoteAt:undefined,prob:98}),good=live({code:'000002',prob:70});
 const selected=c.govFilter('similar',[old,unknown,good]);
 assert.equal(selected.length,1);assert.equal(selected[0],good);assert.equal(selected[0]._fz.prob,70);
 assert.equal(c.PUSH_GOV.total,1);assert.equal(c.PUSH_GOV.codes.has('000001'),false);assert.equal(c.PUSH_GOV.codes.has('000003'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(selected.$undo)),[{code:'000002',type:'similar'}]);
});
test('actual sentinel scanners reject old, unknown and simulated quotes without consuming pushed or cooldown state',()=>{
 for(const name of ['ztRushScan','surgeScan'])for(const overrides of [{quoteAt:now-60000},{quoteAt:undefined,timestamp:now},{mode:'simulated'},{canNotify:false},{name:'*ST测试'},{halt:true},{amount:0}]){
  const {c}=context();c.S.stocks=[live({pct:name==='ztRushScan'?8:5,...overrides})];c[name]();
  assert.equal(c.outbound.length,0,name+' '+JSON.stringify(overrides));assert.equal(c.sentinelLog.length,0);assert.equal(c._ztRushPushed.size,0);assert.equal(c._surgePushed.size,0);assert.equal(c._rushCool.size,0);
 }
});
test('actual sentinel scanners preserve valid source-row sends and existing cooldown',()=>{
 for(const name of ['ztRushScan','surgeScan']){
  const {c}=context();const row=live({pct:name==='ztRushScan'?8:5});c.S.stocks=[row];c[name]();
  assert.equal(c.outbound.length,1,name);assert.equal(c.sentinelLog.length,1);assert.equal(c._rushCool.get(row.code),now);
  assert.match(c.outbound[0][0],/冲板预警|起涨哨兵/);assert.equal(c.outbound[0][2].private,true);
  c[name]();assert.equal(c.outbound.length,1,name+' must retain its existing no-repeat behavior');
 }
});
