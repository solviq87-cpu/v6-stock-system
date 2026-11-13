'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{createRequire}=require('node:module');
const serverPath=require.resolve('../server.js'),source=fs.readFileSync(serverPath,'utf8');
const close=Date.parse('2026-11-13T15:45:00+08:00');
function fn(name){let a=source.indexOf('function '+name+'(');const b=source.indexOf('\n}\n',a)+2;assert.ok(a>=0&&b>a,name);if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,b);}
function engine(at=close){
 const sent=[],logged=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}getHours(){return new Date(this.getTime()+28800000).getUTCHours();}getMinutes(){return new Date(this.getTime()+28800000).getUTCMinutes();}}
 const c=vm.createContext({Date:Clock,require:createRequire(serverPath),Buffer,SignalEvidence:require('../src/core/signal-evidence-chain'),console:{log(){},error(){}},S:{ztPool:[],yierList:[],lianbanList:[]},
  todayStr:()=> '20261113',isTradeDay:()=>true,inQuietHours:()=>false,sentToday:()=>false,refreshStrategyCards(){},
  yierSentDate:'',erjinSanSentDate:'',yierAuctionSentDate:'',pushAll:(...args)=>{sent.push(args);return true;},
  logSignal:(...args)=>logged.push(args),learningSignalExtra:(row,extra)=>({...extra,sourceRecord:row}),
  buildYiErMessage:rows=>'盘后研究观察 '+rows.map(row=>row.researchEvidence.tradeDate).join(','),
  buildLianbanRelayMessage:rows=>'盘后研究观察 '+rows.map(row=>row.researchEvidence.tradeDate).join(','),
  buildYiErAuctionMessage:rows=>'竞价确认 '+rows.map(row=>row.code).join(','),
  zpDb:()=>({baseZt:.1,n:100}),laDb:()=>({baseZt:.1,n:100,prog:{}}),basisLine:()=>'',ppTxt:value=>value,govFoot:()=>'',
  modDayTake:()=>true,signTxt:value=>value,winLabel:key=>key,winShort:()=>'',_tsProg:{scanned:100,total:10},
  _ztSentPushed:new Set(),_fmtSealY:value=>value,pushIntensityOf:()=>1,sectorOfStock:()=> '板块',sectorHeat:()=>({hot:true}),sentLogPush(){},
  _arLastPush:{date:'',sig:'',ts:0,n:0},AR_PUSH_GAP:3600000,AR_PUSH_DAY_MAX:5});
 require('./helpers/news-known-empty-fixture').install(c);
 for(const name of ['reviewRecommendation','reviewedRows','reviewSnapshotFields','freezeRecommendationRows','recommendationSendOptions','prepareRecommendationDelivery','signalCondition','annotateSignalConditions',
  'pushYiEr','pushLianbanRelay','pushZtPre','pushSteadyUp','pushTrendScan','ztSealPush','pushAuctionResonanceTop3','pushYiErAuction'])vm.runInContext(fn(name),c);
 return {c,sent,logged};
}
const dated=patch=>({code:'000001',name:'正常股票',price:10,pct:2,prob:70,fused:72,level:2,
 researchEvidence:{tradeDate:'2026-11-12',source:'daily-provider',receivedAt:Date.parse('2026-11-12T15:30:00+08:00')},
 feat:['真实历史形态'],ztP:20,base:10,lift:10,run:4,cum:8,volTrend:1.2,ma20:9,maBull:1,ma20slope:1,dd60:3,runUp:4,zt60:1,upP:40,...patch});
test('actual post-close relay producers retain dated observations rather than requiring a fifteen-second daily quote',()=>{
 for(const [name,key] of [['pushYiEr','yierList'],['pushLianbanRelay','lianbanList']]){
  const e=engine();e.c.S[key]=[dated(),dated({code:'000002',researchEvidence:null})];e.c[name]();
  assert.equal(e.sent.length,1,name);assert.match(e.sent[0][0],/盘后研究观察 2026-11-12/);
  assert.equal(e.logged.length,1,'unattributed historical candidate is not registered as a qualified recommendation');
  assert.equal(e.c.S[key].length,2,'observation display is preserved');
 }
});
test('actual daily-bar research broadcasts label the originating close and date, never a current quote',()=>{
 for(const [name,key] of [['pushZtPre','ztPre'],['pushSteadyUp','steadyUp'],['pushTrendScan','trendScan']]){
  const e=engine();e.c.S[key]=[dated()];e.c[name]();assert.equal(e.sent.length,1,name);
  assert.match(e.sent[0][0],/研究收盘价10（2026-11-12）/);assert.doesNotMatch(e.sent[0][0],/现价10/);
  const unknown=engine();unknown.c.S[key]=[dated({researchEvidence:null})];unknown.c[name]();assert.equal(unknown.sent.length,0);
 }
});
test('the actual seal broadcaster preserves sourced facts without claiming a stale price is current',()=>{
 const e=engine(),fact={...dated(),sealAmount:1e8,factEvidence:{kind:'provider-limit-up-pool-record',tradeDate:'2026-11-12',source:'pool-provider',observedAt:close-86400000}};
 e.c.ztSealPush([fact],1);assert.equal(e.sent.length,1);assert.match(e.sent[0][0],/来源记录观察|池中记录价 10/);
 assert.match(e.sent[0][0],/2026-11-12/);assert.doesNotMatch(e.sent[0][0],/盘中实时|现价 10/);
 const missing=engine();missing.c.ztSealPush([dated({sealAmount:1e8})],1);assert.equal(missing.sent.length,0);assert.equal(missing.c._ztSentPushed.size,0);
});
test('actual auction resonance and morning relay outputs require each candidate own price evidence before dedup writes',()=>{
 const at=Date.parse('2026-11-13T09:25:20+08:00'),live={...dated(),quoteAt:at-1000,receivedAt:at,quoteSource:'vendor-original',mode:'public-live-unverified',canNotify:true,amount:1e8,auctionPct:2,score:70};
 for(const bad of [{quoteAt:null},{quoteAt:at-60000},{canNotify:false},{amount:0}]){
  const e=engine(at);e.c.pushAuctionResonanceTop3([{...live,...bad}]);assert.equal(e.sent.length,0);assert.equal(e.c._arLastPush.n,0);assert.equal(e.c._arLastPush.sig,'');
  e.c.scanYiErAuction=()=>[{...live,...bad}];e.c.pushYiErAuction();assert.equal(e.sent.length,0);assert.equal(e.c.yierAuctionSentDate,'');
 }
 const good=engine(at);good.c.pushAuctionResonanceTop3([live]);assert.equal(good.sent.length,1);assert.equal(good.c._arLastPush.n,1);
 good.c.scanYiErAuction=()=>[live];good.c.pushYiErAuction();assert.equal(good.sent.length,2);assert.equal(good.c.yierAuctionSentDate,'20261113');
});
test('actual sector scan shares its normalized key with message construction and does not consume cooldown for missing evidence',async()=>{
 const at=Date.parse('2026-11-13T10:00:00+08:00');
 for(const valid of [true,false]){
  const e=engine(at),c=e.c,errors=[],inputs=[],selected=[];
  Object.assign(c,{fundsNumber:value=>typeof value==='number'?value:null,_prevSectorFlow:new Map([['板块',0]]),_sectorAlertMap:new Map(),
   prevSnapUsable:()=>true,prevSnapMark(){},isTradingTime:()=>true,themeOfSec:()=> '归并板块',calibratedProb:value=>value,
   em:{fetchSinaSectorStocks:async()=>[{code:'000001',name:'正常股票'}],fetchBatchSnapshot:async()=>[{...dated(),pct:4,quoteAt:valid?at-1000:null,receivedAt:at,quoteSource:'vendor-original',mode:'public-live-unverified',canNotify:true,volume:1e6,amount:4e8}]},
   govFilter:(_type,list)=>{selected.push(...list);return list;},govTrim:list=>list,modDayKeepOrDrop:(_type,list)=>list,
   A:{nextDayLimitProb:input=>{inputs.push(input);return 80;}},probTag:()=>'',pickLogic:()=>'',fuseLine:()=>'',signTxt:value=>value,
   console:{error:(...args)=>errors.push(args.join(' ')),log(){}}});
  c.S.sectors=[{name:'板块',mainInflow:4e7,pct:1}];c.S.extCache={sectors:[{name:'板块',node:'node'}]};c.S.ztBySector={'归并板块':[{},{}]};
  for(const name of ['pickNotableSectors','sectorSurgeScan'])vm.runInContext(fn(name),c);
  await c.sectorSurgeScan();await new Promise(setImmediate);
  assert.deepEqual(errors,[]);assert.equal(e.sent.length,valid?1:0);assert.equal(e.logged.length,valid?1:0);
  assert.equal(c._sectorAlertMap.has('板块'),valid);
  if(valid){assert.equal(inputs[0].sectorZT,2);assert.equal(selected[0].quoteAt,at-1000);assert.match(e.sent[0][0],/板块异动/);}
 }
});
