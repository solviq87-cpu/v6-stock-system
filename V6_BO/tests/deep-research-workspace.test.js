'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const M=require('../src/core/deep-research-workspace'),Store=require('../src/core/research-workspace-store');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-deep-workspace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function input(){return {type:'events',requestId:'stable-import-01',revision:0,records:[{id:'event-01',firstKnownAt:100,publishedAt:90,source:'public-report'}]};}
test('same declaration keeps its original receipt on network retry and duplicate revision',t=>{
 const root=fixture(t),now=Date.now()-10000,first=M.importDeepEvidence(root,input(),{now,authorize:()=>true});
 const retry=M.importDeepEvidence(root,input(),{now:now+5000,authorize:()=>true});
 assert.equal(retry.reused,true);assert.equal(retry.hash,first.hash);assert.equal(retry.recordedAt,now);
 assert.equal(retry.data.records[0].firstKnownAt,now);assert.equal(retry.data.records[0].declaredFirstKnownAt,100);
 assert.equal(Store.readEvents(root).length,1);
});
test('same request with different source material is rejected without writing a revision',t=>{
 const root=fixture(t),now=Date.now()-10000;M.importDeepEvidence(root,input(),{now,authorize:()=>true});
 const changed=input();changed.records[0].source='other-source';
 assert.throws(()=>M.importDeepEvidence(root,changed,{now:now+1,authorize:()=>true}),/同请求ID内容冲突/);assert.equal(Store.readEvents(root).length,1);
});
test('retry and first write recheck current authorization under the original research lock',t=>{
 const root=fixture(t),now=Date.now()-10000;M.importDeepEvidence(root,input(),{now,authorize:()=>true});
 assert.throws(()=>M.importDeepEvidence(root,input(),{now:now+1,authorize:()=>false}),/授权/);
 let checks=0;assert.throws(()=>M.importDeepEvidence(root,input(),{now:now+1,authorize:()=>++checks<2}),/授权/);
 const second={...input(),requestId:'second-import-02',revision:1};checks=0;
 assert.throws(()=>M.importDeepEvidence(root,second,{now:now+1,authorize:()=>++checks<3}),/授权/);assert.equal(Store.readEvents(root).length,1);
});
test('a concurrent same-content winner is reused with its original server time',t=>{
 const root=fixture(t),now=Date.now()-10000,append=Store.appendEvent;let inserted=false;
 Store.appendEvent=(dir,kind,data,options)=>{
  if(!inserted){inserted=true;const competing=structuredClone(data);competing.asOf=now+1;for(const row of competing.records){row.firstKnownAt=now+1;row.recordedAt=now+1;}
   append(dir,kind,competing,{...options,now:now+1});}
  return append(dir,kind,data,options);
 };
 try{const result=M.importDeepEvidence(root,input(),{now,authorize:()=>true});assert.equal(result.reused,true);assert.equal(result.recordedAt,now+1);assert.equal(Store.readEvents(root).length,1);}
 finally{Store.appendEvent=append;}
});
test('authority quote projection may value holdings without granting an execution permission',()=>{
 const now=Date.now(),book={revision:1,account:{cash:1000,positions:{'600001':{quantity:100,lots:[{buyDate:'2026-11-20',quantity:100}]}}}};
 const quote={price:10,quoteSource:'eastmoney',quoteAt:now-15000,receivedAt:now};
 const current=M.deepAccountProjection(book,{'600001':quote},{now,day:'2026-11-26'});assert.equal(current.equity,2000);assert.equal(current.positions[0].quote.canTrade,undefined);
 for(const bad of [{...quote,quoteAt:now-15001},{...quote,receivedAt:null},{...quote,simulated:true},{...quote,canTrade:false}])
  assert.equal(M.deepAccountProjection(book,{'600001':bad},{now,day:'2026-11-26'}).equity,null);
});
test('authority projection subtracts open sell remainders and preserves T+1 and lot reservations',()=>{
 const book={revision:2,account:{cash:1000,positions:{'600001':{quantity:1000,lots:[
  {buyDate:'2026-11-25',quantity:600,reserved:100},{buyDate:'2026-11-26',quantity:400}]}}},orders:{
  open:{order:{side:'sell',symbol:'600001'},state:{terminal:false,remainingQuantity:200}},
  partial:{order:{side:'sell',symbol:'600001'},state:{terminal:false,remainingQuantity:100}},
  cancelled:{order:{side:'sell',symbol:'600001'},state:{terminal:true,remainingQuantity:900}},
  other:{order:{side:'sell',symbol:'600002'},state:{terminal:false,remainingQuantity:900}},
  buy:{order:{side:'buy',symbol:'600001'},state:{terminal:false,remainingQuantity:900}}}};
 const position=()=>M.deepAccountProjection(book,{}, {day:'2026-11-26'}).positions[0];
 assert.equal(position().pendingSellQuantity,300);assert.equal(position().availableQuantity,200);
 book.orders.open.state.remainingQuantity=800;assert.equal(position().availableQuantity,0);
 book.orders.open.state.remainingQuantity=null;assert.equal(position().availableQuantity,null);
 assert.equal(position().pendingSellQuantity,null);
});
test('open buy orders keep total cash but leave free cash unknown without duplicating authority fee calculations',()=>{
 const book={revision:2,account:{cash:1000,positions:{}},orders:{
  buy:{order:{side:'buy',symbol:'600001'},state:{terminal:false,remainingQuantity:100}},
  sell:{order:{side:'sell',symbol:'600001'},state:{terminal:false,remainingQuantity:100}},
  closed:{order:{side:'buy',symbol:'600002'},state:{terminal:true,remainingQuantity:0}}}};
 let value=M.deepAccountProjection(book,{});assert.equal(value.cash,1000);assert.equal(value.equity,1000);
 assert.equal(value.availableCash,null);assert.equal(value.pendingOrders,2);assert.equal(value.pendingBuyOrders,1);assert.equal(value.pendingSellOrders,1);
 book.orders.buy.state.terminal=true;value=M.deepAccountProjection(book,{});assert.equal(value.availableCash,1000);assert.equal(value.pendingOrders,1);
});
test('secret-shaped fields, Basic headers and private webhook URLs cannot enter research evidence',()=>{
 for(const value of [{apiKey:'SYNTHETIC_TEST'},{privateKey:'SYNTHETIC_TEST'},{Authorization:'Basic SYNTHETIC_TEST_CREDENTIAL'},
   {url:'https://open.feishu.cn/open-apis/bot/v2/hook/SYNTHETIC_TEST_HOOK'},
   {url:'https://hooks.slack.com/services/TEST/TEST/SYNTHETIC_TEST_HOOK'},
   {url:'https://example.invalid/report?access_token=SYNTHETIC_TEST'}])assert.throws(()=>M.safeMaterial(value),/凭据|敏感/);
 assert.deepEqual(M.safeMaterial({authorization:{source:'licensed-provider',reference:'public-agreement'}}),{authorization:{source:'licensed-provider',reference:'public-agreement'}});
});
test('research participation never widens the original service configuration or equates it with execution capacity',t=>{
 const root=fixture(t),service=require('../src/core/paper-application-service').createPaperApplicationService({file:path.join(root,'account.json'),maxParticipationPct:.5});
 const limits=service.executionLimits();assert.deepEqual(limits,{maxParticipationPct:.5});assert.ok(Object.isFrozen(limits));
 assert.throws(()=>{limits.maxParticipationPct=100;},TypeError);assert.equal(service.executionLimits().maxParticipationPct,.5);
 const snapshot={constraints:{maxParticipation:limits.maxParticipationPct/100,maxPositions:5},quotes:{}};
 const project=amount=>M.deepPortfolioInput({portfolio:[{constraints:{maxParticipation:amount}}]},snapshot).constraints.maxParticipation;
 assert.equal(project(.1),.005);assert.equal(project(.001),.001);
 for(const amount of [undefined,null,0,-1,2,NaN])assert.equal(project(amount),null);
 assert.equal(M.deepPortfolioInput({portfolio:[{constraints:{maxParticipation:.01}}]},{constraints:{},quotes:{}}).constraints.maxParticipation,null);
 assert.equal(fs.existsSync(path.join(root,'account.json')),false,'reading limits does not initialize or mutate an account');
});

test('F39/F43 declarations use original immutable authorized workspace import; client cannot forge actual receipt',t=>{const root=fixture(t),now=Date.now()-10000;
 const value={type:'macroEvidence',requestId:'macro_actual_receipt_01',revision:0,records:[{id:'macro-1',revision:1,source:'public-report',kind:'actual',newsRef:'a'.repeat(64),metric:'margin-balance',series:'balance',scope:'CN',periodStart:'2026-01-01',periodEnd:'2026-01-01',methodVersion:'v1',unit:'CNY',value:100}]};
 const first=M.importDeepEvidence(root,value,{now,authorize:()=>true});const material=M.readDeepEvidence(root,{asOf:now}).materials.macroEvidence[0];
 assert.equal(material.recordedAt,now);assert.equal(material.archiveHash,first.hash);assert.equal(material.independentlyVerified,false);assert.equal(M.readDeepEvidence(root,{asOf:now-1}).materials.macroEvidence.length,0);
 assert.equal(M.importDeepEvidence(root,value,{now:now+1,authorize:()=>true}).hash,first.hash);
 assert.throws(()=>M.importDeepEvidence(root,value,{now:now+2,authorize:()=>false}),/授权/);
 assert.throws(()=>M.importDeepEvidence(root,{...value,revision:1,requestId:'invalid_macro_receipt_02',records:[{...value.records[0],recordedAt:1}]},{now:now+3,authorize:()=>true}));
 assert.equal(Store.readEvents(root).length,1);
});
