'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewRecommendationEvidence:review,reviewQuoteSnapshotFields:copy}=require('../src/core/recommendation-evidence-review');
const {quoteUseEligibility}=require('../src/core/quote-observation-view');
const now=Date.parse('2026-11-13T10:00:00+08:00');
const purpose='intraday-recommendation';
const live=overrides=>({code:'000001',name:'正常股票',price:10,quoteAt:now-1000,receivedAt:now,quoteSource:'vendor-original',mode:'public-live-unverified',canNotify:true,volume:10000,amount:100000,...overrides});
const check=(row,usage=purpose)=>review(row,{purpose:usage,now});
const codes=list=>list.map(item=>item.code);
const research=overrides=>({price:10,researchEvidence:{tradeDate:'2026-11-12',source:'public-end-of-day',receivedAt:now-3600000},...overrides});
const fact=overrides=>({factEvidence:{kind:'issuer-announcement',source:'issuer-original',observedAt:now-5000,tradeDate:'2026-11-13'},...overrides});

test('live recommendation uses the real same-row gate and reports bounded support without changing the row',()=>{
 const row=live(),before=JSON.stringify(row),result=check(row);
 assert.deepEqual(result.quote,quoteUseEligibility(row,now));assert.equal(result.decision,'support');assert.equal(result.canRecommend,true);
 assert.equal(result.canObserve,false);assert.equal(result.canBroadcast,false);assert.equal(result.quote.verifiedLive,false);
 assert.deepEqual(codes(result.support),['OBSERVED_POSITIVE_ACTIVITY','LIVE_QUOTE_USE_ELIGIBLE']);assert.equal(result.contra.length,0);assert.equal(result.missing.length,0);
 assert.equal(JSON.stringify(row),before);
});
test('true zero activity is a known rejection while absent activity remains unknown',()=>{
 for(const row of [live({volume:0}),live({amount:0}),live({volume:-1}),live({amount:-1})]){
  const result=check(row);assert.equal(result.canRecommend,false);assert.equal(result.decision,'contra');assert.ok(result.contra.some(item=>/^(ZERO|NEGATIVE)_/.test(item.code)));
 }
 for(const row of [live({volume:undefined,amount:null}),live({volume:'1000',amount:'10000'}),live({volume:NaN,amount:Infinity})]){
  const result=check(row);assert.equal(result.canRecommend,false);assert.equal(result.decision,'missing');assert.ok(codes(result.missing).includes('MISSING_POSITIVE_ACTIVITY'));assert.equal(result.contra.length,0);
 }
 for(const row of [live({volume:100,amount:undefined}),live({volume:null,amount:10000})])assert.equal(check(row).canRecommend,true);
});
test('a missing original mode is unknown and cannot inherit the display projection default',()=>{
 const result=check(live({mode:undefined}));
 assert.equal(result.canRecommend,false);assert.equal(result.decision,'missing');
 assert.ok(codes(result.missing).includes('MISSING_QUOTE_MODE'));
});
test('missing price/time/source/receipt never become valid through a local timestamp or another row',()=>{
 for(const overrides of [{price:null},{quoteAt:undefined,timestamp:now},{quoteSource:undefined,source:'different-context'},{receivedAt:undefined}]){
  const row=live(overrides);Object.defineProperty(row,'snapshotByCode',{get(){throw Error('must never borrow another snapshot');}});
  const result=check(row);assert.equal(result.canRecommend,false);assert.equal(result.decision,'missing');assert.ok(codes(result.missing).includes('MISSING_ORIGINAL_QUOTE'));
 }
 for(const price of [0,-1]){const result=check(live({price}));assert.equal(result.decision,'contra');assert.ok(codes(result.contra).includes('NONPOSITIVE_PRICE'));}
 const result=check(live({quoteAt:undefined,timestamp:now}));assert.equal(result.quote.quoteAt,null);
});
test('stale, future, cross-date and misordered original quotes cannot authorize recommendation',()=>{
 const cases=[{quoteAt:now-15001},{quoteAt:now+1,receivedAt:now+1},{receivedAt:now-2000},{receivedAt:now+1},
  {quoteAt:Date.parse('2026-11-12T23:59:59+08:00'),receivedAt:now}];
 for(const overrides of cases){const result=check(live(overrides));assert.equal(result.canRecommend,false);assert.equal(result.decision,'contra');assert.ok(codes(result.contra).includes('INVALID_QUOTE_TIMING'));}
 assert.equal(check(live({quoteAt:now-15000})).canRecommend,true);
});
test('source simulation/research/history/read-only modes and explicit denied permissions stay blocked',()=>{
 for(const overrides of [{mode:'simulated'},{mode:'research-observation'},{mode:'historical'},{mode:'cost-basis'},{mode:'carried-mark'},
  {quoteSource:'simulated-feed'},{quoteSource:'readOnlyBackup'},{simulated:true},{readOnlyBackup:true},{canNotify:false},{canTrade:false}]){
  const row=live(overrides),result=check(row);assert.equal(result.canRecommend,false);assert.equal(result.decision,'contra');assert.equal(result.quote.canNotify,false);assert.deepEqual(result.quote,quoteUseEligibility(row,now));
 }
 const unknown=check(live({canNotify:undefined}));assert.equal(unknown.canRecommend,false);assert.equal(unknown.decision,'missing');assert.ok(codes(unknown.missing).includes('MISSING_NOTIFICATION_PERMISSION'));
 assert.equal(check(live({canNotify:undefined,canTrade:true})).canRecommend,true,'existing source permission may authorize the same raw row');
});
test('ST, delisting, explicit warning, halt and untradable evidence reject an otherwise recent quote',()=>{
 for(const overrides of [{name:'ST测试'},{name:'*ST测试'},{name:'S*ST测试'},{name:'*STABC'},{name:'测试退市'},{isST:true},{riskWarning:true},{riskWarning:'存在退市风险'},
  {suspended:true},{halt:true},{tradable:false}]){
  const result=check(live(overrides));assert.equal(result.canRecommend,false);assert.equal(result.decision,'contra');assert.ok(result.contra.length>0);
 }
 assert.equal(check(live({riskWarning:false,halt:false,suspended:false,tradable:true})).canRecommend,true);
});
test('copied provenance retains false permissions, activity and simulation flags without granting trade permission',()=>{
 const row=live({canTrade:false,canNotify:false,quoteMode:'research',mode:'historical',simulated:true,readOnlyBackup:true,tradable:false,suspended:true,halt:true,riskWarning:true,isST:true,imported:true,fixture:true,mock:true,synthetic:true,volume:0,amount:0});
 const result=copy(row);
 for(const field of ['quoteAt','quoteSource','receivedAt','quoteMode','mode','canTrade','canNotify','simulated','readOnlyBackup','tradable','suspended','halt','riskWarning','isST','imported','fixture','mock','synthetic','volume','amount'])assert.equal(result[field],row[field],field);
 assert.notEqual(copy(live({canTrade:true})).canTrade,true);assert.equal(copy(live({canNotify:false})).canNotify,false);
 const unknown=copy({price:10,timestamp:now,quoteSource:'provider'});assert.equal(unknown.quoteAt,null);assert.equal(unknown.receivedAt,null);assert.equal(unknown.canNotify,undefined);
});
test('dated observations use their own date and receipt and never inherit instantaneous recommendation rights',()=>{
 const row=research({quoteAt:now-24*3600000,receivedAt:now,quoteSource:'public-history',canNotify:false,mode:'historical'}),result=check(row,'dated-observation');
 assert.equal(result.decision,'support');assert.equal(result.canObserve,true);assert.equal(result.canRecommend,false);assert.equal(result.canBroadcast,false);
 assert.ok(codes(result.missing).includes('ATTACHED_QUOTE_UNAVAILABLE'));assert.equal(result.quote.quoteAt,row.quoteAt);
 assert.equal(check(research(),'dated-observation').canObserve,true,'unknown live quote cannot erase an attributed dated observation');
 assert.equal(check(research(),'intraday-recommendation').canRecommend,false);
});
test('dated evidence rejects unknown/invalid/future dates, bad receipts, nonpositive price and simulation origins',()=>{
 const good=research().researchEvidence;
 for(const row of [research({researchEvidence:null}),research({researchEvidence:{...good,source:''}}),research({researchEvidence:{...good,tradeDate:'2026-02-30'}}),
  research({researchEvidence:{...good,tradeDate:'2026-11-14'}}),research({researchEvidence:{...good,receivedAt:now+1}}),research({researchEvidence:{...good,receivedAt:null}}),
  research({researchEvidence:{...good,receivedAt:Date.parse('2026-11-11T10:00:00+08:00')}}),research({price:0}),research({price:undefined}),
  research({researchEvidence:{...good,source:'simulation'}}),research({mode:'simulated'}),research({simulated:true}),research({mock:true})]){
  const result=check(row,'dated-observation');assert.equal(result.canObserve,false);assert.equal(result.canRecommend,false);assert.notEqual(result.decision,'support');
 }
});
test('fact broadcasts need their own source/kind/time/date and can retain unknown or stale attached prices',()=>{
 for(const row of [fact(),fact({price:10,quoteAt:now-3600000,receivedAt:now,quoteSource:'stale-vendor'}),fact({price:null,timestamp:now})]){
  const result=check(row,'fact-broadcast');assert.equal(result.decision,'support');assert.equal(result.canBroadcast,true);assert.equal(result.canRecommend,false);assert.equal(result.canObserve,false);
  assert.ok(codes(result.missing).includes('ATTACHED_QUOTE_UNAVAILABLE'));
 }
 const result=check(fact({price:10,timestamp:now}),'fact-broadcast');assert.equal(result.quote.quoteAt,null);
 assert.equal(check(fact({name:'*ST测试',halt:true}),'fact-broadcast').canBroadcast,true,'issuer facts do not authorize recommendation of the stock');
});
test('fact identity failures and synthetic observations cannot be promoted to broadcasts',()=>{
 const good=fact().factEvidence;
 for(const row of [fact({factEvidence:null}),fact({factEvidence:{...good,kind:''}}),fact({factEvidence:{...good,source:''}}),
  fact({factEvidence:{...good,tradeDate:'2026-02-30'}}),fact({factEvidence:{...good,tradeDate:'2026-11-14'}}),fact({factEvidence:{...good,observedAt:now+1}}),
  fact({factEvidence:{...good,observedAt:null}}),fact({factEvidence:{...good,observedAt:Date.parse('2026-11-12T10:00:00+08:00')}}),fact({factEvidence:{...good,source:'mock'}})]){
  const result=check(row,'fact-broadcast');assert.equal(result.canBroadcast,false);assert.notEqual(result.decision,'support');
 }
});
test('purposes remain separate and invalid clocks cannot silently use a substitute timestamp',()=>{
 for(const usage of [undefined,'unknown','intraday']){
  const result=review(live(),{purpose:usage,now});assert.equal(result.decision,'missing');assert.equal(result.canRecommend,false);assert.ok(codes(result.missing).includes('UNKNOWN_PURPOSE'));
 }
 for(const badNow of [0,-1,NaN,Infinity,now+.1])assert.throws(()=>review(live(),{purpose,now:badNow}),/时钟/);
 assert.equal(check(live(),'dated-observation').canObserve,false);assert.equal(check(live(),'fact-broadcast').canBroadcast,false);
 const result=check({researchEvidence:research().researchEvidence,factEvidence:fact().factEvidence,price:10},'dated-observation');assert.equal(result.canObserve,true);assert.equal(result.canBroadcast,false);assert.equal(result.canRecommend,false);
});
