'use strict';
// Disposable original accounts and provider-shaped fixture quotes. No real
// market observations, production accounts, or execution approvals are created.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperApplicationService,isAutomaticEntryPreview}=require('../src/core/paper-application-service');
const {inspectPaperPlanEntry,boundedAutomaticEntryPreview}=require('../src/core/paper-plan-entry-check');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {accountExitDiagnostics,selectAdvancedRiskQuotes}=require('../src/core/advanced-account-risk');
const {tradingFees}=require('../src/core/trading-fees');
const {fixtures,now,day,priorDay}=require('./helpers/advanced-portfolio-fixture');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function setup(t,{policy={version:'original-policy',maxPositionPct:50,maxGrossExposurePct:100},sector=false,priorClose=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-readonly-entry-')),file=path.join(root,'pool.json');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const create=(options={})=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:date=>[priorDay,day].includes(date)},...options});
 const app=create();app.adoptLegacy({enabled:true,initial:20000,cash:10000,realized:0,positions:{'600000':{code:'600000',name:'隔离持仓',shares:1000,buyPrice:10,basis:10000,buyTs:Date.parse(priorDay+'T10:00:00+08:00')}},trades:[]});
 app.configure({expectedRevision:app.read().revision,riskPolicy:policy});
 const common={schemaVersion:1,source:'imported',provider:'isolated-original-import',tradeDate:day,publishedAt:new Date(now-20000).toISOString(),knownAt:new Date(now-10000).toISOString()};
 const evidence=[];
 if(sector)evidence.push({...common,kind:'sector',version:'sector-1',sourceRecordId:'sector-original-1',classificationAsOf:priorDay,sectors:{'600000':'bank','600001':'industry'}});
 if(priorClose)evidence.push({...common,kind:'previous-close',version:'prior-1',sourceRecordId:'close-original-1',observedThrough:priorDay,...priorClose});
 if(evidence.length)app.importRiskEvidenceBatch(evidence,app.read().revision);
 const original=fixtures(),plan=original.plan;
 const card={authority:'fayo-decision-center',decisionId:plan.decisionId,code:plan.code,day,strategyAt:now-15000,quoteBasis:{source:'tencent'},plan:{buyLow:9,buyHigh:11,stop:8,target:12,positionPct:50}};bindAuthoritativePlan(plan,card);
 const stocks=['600000','600001'].map(code=>({code,name:'隔离报价 '+code,price:10,preClose:10,quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,suspended:false,tradable:true,volume:100000}));
 const quotes=Object.fromEntries(stocks.map(row=>[row.code,{symbol:row.code,price:row.price,quoteAt:row.quoteAt,timestamp:row.quoteAt,receivedAt:row.receivedAt,quoteSource:row.quoteSource,provider:row.quoteSource,mode:'public-live-unverified',tradeDate:day,volumeUnit:'shares',volume:row.volume*100,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
  riskContext:{observedAt:row.quoteAt,marks:{'600000':10,'600001':10},requireImportedEvidence:true},inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})}]));
 const makeInput=()=>({input:{action:'executePlan',account:'pool',planId:plan.id},plan,now,day,replica:false,continuous:true,candidate:stocks[1],eligiblePick:()=>true,systemPickDay:()=>day,poolDay:day,newsBlocked:false,account:app.legacy(),policy:{maxPos:2},equity:20000,quote:quotes[plan.code],book:app.read(),authoritative:card});
 const options={sealedUp:false,heldCount:1,monitorCapacity:220,lot:100,feeFor:(side,amount)=>tradingFees({side,quantity:1,price:amount,tradeDate:day,policy:app.read().feePolicy}).total,previewAccount:input=>app.previewAutomaticEntry({...input,valuationQuotes:quotes})};
 const request=()=>({expectedRevision:app.read().revision,expectedFingerprint:app.read().fingerprint,symbol:plan.code,quantity:900,price:10,tradeDate:day,fee:5,quote:quotes[plan.code],valuationQuotes:quotes});
 const report=receipt=>{const context=structuredClone(original.input.portfolioContext);context.plans.pool=[plan];context.planChecks={pool:{[plan.id]:receipt}};return accountExitDiagnostics(app.read(),{...original.input,quotes:selectAdvancedRiskQuotes({codes:stocks.map(row=>row.code),stocks,lastPx:new Map(),now,limitFor:()=>.1}),portfolioContext:context}).portfolioEvidence;};
 const proposal=()=>{const legacy=app.legacy();return {...legacy,cash:995,positions:{...legacy.positions,'600001':{code:'600001',shares:900,buyPrice:10,buyTs:now,basis:9005}},trades:[{t:now,side:'买入',code:'600001',name:'隔离计划预检',price:10,shares:900,amount:9000,fee:5,pnl:null,reason:'isolated preview equivalence'},...legacy.trades]};};
 const files=()=>Object.fromEntries(fs.readdirSync(root).sort().map(name=>[name,fs.readFileSync(path.join(root,name)).toString('base64')]));
 return {app,create,file,root,plan,stocks,quotes,makeInput,options,request,report,proposal,files};
}

test('configured original policy preview resolves persisted sector and prior-close evidence and feeds the real plan consumer without writes',t=>{
 const x=setup(t,{policy:{version:'all-original',maxPositionPct:50,maxGrossExposurePct:100,maxSectorPct:50,maxDailyLossPausePct:5,maxDrawdownPausePct:10},sector:true,priorClose:{priorEquity:20000,priorPeak:20000,previousEquity:20000}}),before=x.files();
 const readOnly=x.create({readOnly:true});let mutations=0;
 for(const name of ['writeFileSync','mkdirSync','mkdtempSync','renameSync','unlinkSync','rmSync','appendFileSync'])t.mock.method(fs,name,()=>{mutations++;throw Error('read-only preview attempted '+name);});
 const proof=readOnly.previewAutomaticEntry(x.request());assert.equal(proof.allowed,true);assert.equal(isAutomaticEntryPreview(proof),true);
 assert.equal(proof.riskBudget.evidenceRefs.length,2);assert.equal(proof.riskBudget.budgets.find(row=>row.kind==='sector').exposureAfter,9000);
 assert.equal(proof.canTrade,false);assert.equal(proof.reservesCash,false);assert.equal(proof.writesAccount,false);assert.equal(proof.strategyId,null);
 const receipt=inspectPaperPlanEntry(x.makeInput(),x.options);assert.equal(receipt.allowed,true);assert.equal(receipt.quantity,900);assert.equal(receipt.fee,5);
 const p=x.report(receipt);assert.equal(p.previews[0].previewBlocked,false);assert.equal(p.previews[0].riskBudgetAfter.policyScope,'original-account-readonly-preview');
 assert.equal(p.previews[0].riskBudgetAfter.policyVersion,'all-original');assert.equal(p.previews[0].riskBudgetAfter.budgets.find(row=>row.kind==='sector').exposureAfter,9000);
 assert.equal(p.previews[0].riskBudgetAfter.evidenceRefs.length,2);assert.equal(p.previews[0].riskBudgetAfter.evidenceRef,receipt.accountPreview.fingerprint);
 assert.deepEqual(x.files(),before);assert.equal(fs.existsSync(x.file+'.audit.json'),false);
 assert.equal(mutations,0);t.mock.restoreAll();
 // The subsequent explicitly executed original transaction must agree; the
 // observation above itself did not create any order, audit, or defense event.
 const committed=x.app.saveLegacy(x.proposal(),x.app.read().revision,{quotes:x.quotes});assert.equal(committed.account.cash,995);assert.equal(committed.account.events.length,1);
});

test('real policy rejection and missing original evidence remain blocked or unknown without creating orders, audits or defense state',t=>{
 for(const scenario of [
  {policy:{version:'tight',maxPositionPct:10},allowed:false,code:'SINGLE_POSITION_LIMIT'},
  {policy:{version:'requires-sector',maxSectorPct:50},allowed:null,code:'MISSING_IMPORTED_SECTOR'},
  {policy:{version:'requires-prior',maxDailyLossPausePct:5},allowed:null,code:'MISSING_IMPORTED_PRIOR_CLOSE'},
  {policy:{version:'requires-strategy',maxStrategyPct:50},allowed:null,code:'MISSING_STRATEGY_ATTRIBUTION'}
 ]){
  const x=setup(t,scenario),before=x.files();x.plan.strategyId='must-not-be-borrowed';
  const proof=x.app.previewAutomaticEntry(x.request());assert.equal(proof.allowed,scenario.allowed);assert.ok(proof.reasonCodes.includes(scenario.code));
  const receipt=inspectPaperPlanEntry(x.makeInput(),x.options);assert.equal(receipt.allowed,scenario.allowed);assert.equal(x.report(receipt).previews[0].previewBlocked,true);
  assert.deepEqual(x.files(),before);assert.equal(x.app.read().defensiveControl,undefined);
 }
});

test('a loss observation never latches defense, while the later original rejected transaction still does under its write lock',t=>{
 const x=setup(t,{policy:{version:'daily-loss',maxDailyLossPausePct:5},priorClose:{priorEquity:18000,priorPeak:20000,previousEquity:20000}}),before=x.files();
 const receipt=inspectPaperPlanEntry(x.makeInput(),x.options);assert.equal(receipt.allowed,false);assert.ok(receipt.accountPreview.reasonCodes.includes('PREVIOUS_CLOSE_LOSS_LIMIT'));
 assert.deepEqual(x.files(),before);assert.equal(x.app.read().defensiveControl,undefined);assert.equal(x.app.audit().total,0);
 assert.throws(()=>x.app.saveLegacy(x.proposal(),x.app.read().revision,{quotes:x.quotes}),/PREVIOUS_CLOSE_LOSS_LIMIT/);
 assert.equal(x.app.read().defensiveControl.state,'restricted');assert.equal(x.app.read().account.cash,10000);assert.equal(x.app.read().account.events.length,0);assert.equal(x.app.audit().total,1);
});

test('account revision and fingerprint changes before or during read-only preview cannot produce an allowed receipt',t=>{
 const x=setup(t),before=x.files();
 for(const patch of [{expectedRevision:1},{expectedFingerprint:'0'.repeat(64)}])assert.equal(x.app.previewAutomaticEntry({...x.request(),...patch}).allowed,null);
 const changed=x.app.read();changed.revision++;delete changed.fingerprint;changed.fingerprint=digest(changed);const changedBytes=JSON.stringify(changed);
 const request=x.request(),read=fs.readFileSync;let reads=0;
 t.mock.method(fs,'readFileSync',(file,...options)=>file===x.file&&++reads===2?changedBytes:read(file,...options));
 const proof=x.app.previewAutomaticEntry(request);assert.equal(proof.allowed,null);assert.deepEqual(proof.reasonCodes,['ACCOUNT_PREVIEW_VERSION_CHANGED']);
 t.mock.restoreAll();assert.deepEqual(x.files(),before);
});

test('the final account reread is included in the five-second preview budget and expired receipts cannot be replayed',t=>{
 const x=setup(t),request=x.request(),before=x.files(),read=fs.readFileSync;
 for(const elapsed of [5000,5001,-1]){
  let at=now,reads=0;const service=x.create({clock:()=>at});
  t.mock.method(fs,'readFileSync',(file,...options)=>{const bytes=read(file,...options);if(file===x.file&&++reads===2)at=now+elapsed;return bytes;});
  const proof=service.previewAutomaticEntry(request);assert.equal(proof.allowed,elapsed===5000?true:null);
  if(elapsed!==5000)assert.deepEqual(proof.reasonCodes,['ACCOUNT_PREVIEW_EXPIRED']);
  t.mock.restoreAll();
 }
 const old=x.app.previewAutomaticEntry(request),input=x.makeInput();input.now+=5001;
 assert.equal(inspectPaperPlanEntry(input,{...x.options,previewAccount:()=>old}).allowed,null);assert.deepEqual(x.files(),before);
});

test('a real service clock advancing after the observer starts preserves the original observer batch timestamp',t=>{
 const x=setup(t),service=x.create({clock:()=>now+1}),before=x.files(),input=x.makeInput();
 const receipt=inspectPaperPlanEntry(input,{...x.options,previewAccount:value=>service.previewAutomaticEntry({...value,valuationQuotes:x.quotes})});
 assert.equal(receipt.allowed,true);assert.equal(receipt.checkedAt,now);assert.equal(receipt.accountPreview.checkedAt,now+1);
 const observed=observePaperPlans({plans:[x.plan],book:x.app.read(),quotes:x.quotes,day,now,calendar:{isOpen:()=>true},continuous:true,entryEligibilityByPlan:{[x.plan.id]:receipt}});
 assert.deepEqual(observed.rejected,[]);assert.equal(observed.records[0].entry.allowed,true);assert.equal(observed.records[0].canTrade,false);assert.deepEqual(x.files(),before);
});

test('malformed internal preview input remains unknown without an exception or writes',t=>{
 const x=setup(t),before=x.files(),cycle=x.request();cycle.quote={...cycle.quote};cycle.quote.cycle=cycle;
 for(const input of [null,[],false,cycle,{...x.request(),strategyId:'client-supplied'},{...x.request(),quantity:1n}]){
  const proof=x.app.previewAutomaticEntry(input);assert.equal(proof.allowed,null);assert.equal(proof.canTrade,false);
 }
 assert.deepEqual(x.files(),before);
});

test('JSON copied, invented, altered and differently sized service observations cannot replace the original minted preview',t=>{
 const x=setup(t),proof=x.app.previewAutomaticEntry(x.request());assert.equal(proof.allowed,true);
 const untrusted=[structuredClone(proof),{...proof},Object.assign(structuredClone(proof),{allowed:true,quantity:100}),x.app.previewAutomaticEntry({...x.request(),quantity:100})];
 for(const value of untrusted){const receipt=inspectPaperPlanEntry(x.makeInput(),{...x.options,previewAccount:()=>value});assert.equal(receipt.allowed,null);}
 proof.riskBudget.budgets[0].limitPct=100;assert.equal(isAutomaticEntryPreview(proof),false);
 assert.equal(inspectPaperPlanEntry(x.makeInput(),{...x.options,previewAccount:()=>proof}).allowed,null);
});

test('plan and quote exclusions run before a policy preview and stale quotes cannot obtain a service receipt',t=>{
 const x=setup(t);let calls=0;const options={...x.options,previewAccount:input=>{calls++;return x.options.previewAccount(input);}};
 for(const patch of [input=>input.replica=true,input=>input.continuous=false,input=>input.newsBlocked=true,input=>input.quote={...input.quote,quoteAt:now-15001}]){
  const input=x.makeInput();patch(input);assert.equal(inspectPaperPlanEntry(input,options).allowed,false);
 }
 assert.equal(calls,0);
 for(const patch of [{quoteAt:now-15001,timestamp:now-15001},{quoteAt:now+1,timestamp:now+1},{price:11},{volume:0}])assert.equal(x.app.previewAutomaticEntry({...x.request(),quote:{...x.quotes['600001'],...patch}}).allowed,null);
 const unavailable=x.create({file:path.join(x.root,'missing','pool.json'),readOnly:true});assert.equal(unavailable.previewAutomaticEntry(x.request()).allowed,null);assert.equal(fs.existsSync(path.join(x.root,'missing')),false);
});

test('the worker consumer rejects changed held-stock source, original time, price and altered policy receipts',t=>{
 for(const patch of [row=>row.price=10.01,row=>row.quoteAt--,row=>row.quoteSource='other-source',row=>row.receivedAt--]){
  const x=setup(t),receipt=inspectPaperPlanEntry(x.makeInput(),x.options);assert.equal(x.report(receipt).previews[0].previewBlocked,false);
  patch(x.stocks[0]);const preview=x.report(receipt).previews[0];assert.equal(preview.previewBlocked,true);assert.equal(preview.reason,'ORIGINAL_ACCOUNT_PREVIEW_VALUATION_CHANGED');
 }
 const x=setup(t),receipt=inspectPaperPlanEntry(x.makeInput(),x.options),copy=structuredClone(receipt);
 copy.accountPreview.riskBudget.estimatedConstraintsSatisfied=false;assert.equal(x.report(copy).previews[0].reason,'ORIGINAL_ACCOUNT_PREVIEW_UNBOUND');
 delete copy.accountPreview;assert.equal(x.report(copy).previews[0].reason,'ORIGINAL_ACCOUNT_PREVIEW_UNAVAILABLE');
});

test('each observer batch admits only bounded additional original-policy previews and preserves original plan gates',t=>{
 const x=setup(t),before=x.files();let calls=0;
 const options={...x.options,previewAccount:boundedAutomaticEntryPreview(input=>{calls++;return x.options.previewAccount(input);},{maxChecks:2,clock:()=>0})};
 const excluded=x.makeInput();excluded.newsBlocked=true;
 assert.equal(inspectPaperPlanEntry(excluded,options).allowed,false);assert.equal(calls,0);
 for(let i=0;i<2;i++)assert.equal(inspectPaperPlanEntry(x.makeInput(),options).allowed,true);
 for(let i=0;i<50;i++){
  const receipt=inspectPaperPlanEntry(x.makeInput(),options);assert.equal(receipt.allowed,null);assert.match(receipt.reason,/观察预算已用尽/);
 }
 assert.equal(calls,2);assert.deepEqual(x.files(),before);
 const next={...x.options,previewAccount:boundedAutomaticEntryPreview(x.options.previewAccount,{clock:()=>0})};
 assert.equal(inspectPaperPlanEntry(x.makeInput(),next).allowed,true);assert.deepEqual(x.files(),before);
});

test('elapsed preview budget and monotonic clock failure stop further synchronous validation without changing the account',t=>{
 for(const times of [[0,0,201],[0,10,9],[0,0,NaN]]){
  const x=setup(t),before=x.files();let calls=0,index=0;
  const options={...x.options,previewAccount:boundedAutomaticEntryPreview(input=>{calls++;return x.options.previewAccount(input);},
   {clock:()=>times[Math.min(index++,times.length-1)]})};
  assert.equal(inspectPaperPlanEntry(x.makeInput(),options).allowed,true);
  assert.equal(inspectPaperPlanEntry(x.makeInput(),options).allowed,null);assert.equal(calls,1);assert.deepEqual(x.files(),before);
 }
 for(const options of [{maxChecks:21},{maxChecks:0},{maxElapsedMs:201},{maxElapsedMs:0}])
  assert.throws(()=>boundedAutomaticEntryPreview(()=>{},options),/预算无效/);
});
