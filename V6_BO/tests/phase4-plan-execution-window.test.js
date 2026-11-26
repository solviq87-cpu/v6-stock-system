'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {executeDecisionPlan,decisionPlanPayload,bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {inspectPaperPlanEntry}=require('../src/core/paper-plan-entry-check');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const day='2026-11-26',time=s=>Date.parse(day+'T'+s+'+08:00'),now=time('10:00:00');
const code='600000';
function quote(at=now,patch={}){
 return {symbol:code,price:10,tradeDate:day,quoteAt:at-1000,timestamp:at-1000,receivedAt:at-500,
  quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',volume:100000,volumeUnit:'shares',
  lowerLimit:9,upperLimit:11,tradable:true,suspended:false,canTrade:true,...patch};
}
function input(at=now,q=quote(at)){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day,strategyAt:time('09:20:00'),quoteBasis:{source:'tencent'},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:25}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(time('09:29:50')).toISOString(),...decisionPlanPayload(card)},card);
 const book={account:{cash:10000,positions:{},events:[]},orders:{}};
 return {input:{action:'executePlan',account:'pool',planId:plan.id},plan,now:at,day,continuous:true,candidate:{code},
  eligiblePick:()=>true,systemPickDay:()=>day,poolDay:day,account:{enabled:true,cash:10000,positions:{}},
  policy:{maxPos:5},equity:10000,quote:q,authoritative:card,book,readBook:()=>book,buy(){throw Error('isolated original callback reached');}};
}
test('direct confirmation independently checks the existing continuous-auction clock',()=>{
 for(const s of ['09:29:59','11:30:00','12:30:00','14:57:00','15:00:00']){
  const at=time(s);assert.throws(()=>executeDecisionPlan(input(at)),/连续竞价时段/,s);
 }
 for(const s of ['09:30:00','13:00:00','14:56:59']){
  const at=time(s);assert.throws(()=>executeDecisionPlan(input(at,quote(at,{quoteAt:at,timestamp:at,receivedAt:at}))),/isolated original callback reached/,s);
 }
 assert.throws(()=>executeDecisionPlan({...input(),continuous:'true'}),/连续竞价时段/);
});
test('fresh quotes from a preceding or non-auction window and pre-freeze quotes cannot enter the buy callback',()=>{
 const at=time('13:00:01'),qAt=time('12:59:59');
 assert.throws(()=>executeDecisionPlan(input(at,quote(at,{quoteAt:qAt,timestamp:qAt,receivedAt:at}))),/连续竞价时段/);
 const first=time('09:30:01'),early=time('09:29:59');
 assert.throws(()=>executeDecisionPlan(input(first,quote(first,{quoteAt:early,timestamp:early,receivedAt:first}))),/连续竞价时段/);
 const x=input();x.plan.frozenAt=new Date(now-500).toISOString();
 assert.throws(()=>executeDecisionPlan(x),/早于冻结计划/);
});
test('direct plan entry rejects explicit read-only and conflicting original quote evidence',()=>{
 for(const patch of [{canTrade:false},{readOnlyBackup:true},{sourceConflict:true},{quoteStatus:'conflict'},{mode:'historical-replay'},{provider:'other'},{timestamp:now-2000}]){
  assert.throws(()=>executeDecisionPlan(input(now,quote(now,patch))),/只读、来源冲突或时点不一致/);
 }
 const x=input(time('15:10:00'));x.book.account.events.push({eventId:'old-fill',side:'buy',symbol:code,price:10,quantity:100,reason:'作战台计划['+x.plan.id+']'});
 assert.equal(executeDecisionPlan(x).status,'already-executed');
});
test('plan preview uses exact integer share volume and counts numeric prior symbol fills',()=>{
 const options={sealedUp:false,heldCount:0,monitorCapacity:220,lot:100,feeFor:()=>5};
 const x=input(now,quote(now,{volume:10000}));
 assert.equal(inspectPaperPlanEntry(x,options).allowed,true);
 x.book.account.events=[{symbol:600000,tradeDate:day,quantity:100}];
 assert.equal(inspectPaperPlanEntry(x,options).allowed,false);
 const bad=input(now,quote(now,{volume:100000.5}));
 assert.equal(inspectPaperPlanEntry(bad,options).allowed,false);
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-preview-window-')),file=path.join(root,'account.json');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let at=now;
 const app=createPaperApplicationService({file,clock:()=>at,calendar:{isOpen:d=>d===day}});
 app.adoptLegacy({enabled:true,initial:100000,cash:100000,realized:0,positions:{},trades:[]});
 const request=(q=quote(at),symbol=code)=>{
  const b=app.read();return {expectedRevision:b.revision,expectedFingerprint:b.fingerprint,symbol,quantity:100,price:10,tradeDate:day,fee:5,quote:q,valuationQuotes:{}};
 };
 return {app,file,request,setAt:value=>{at=value}};
}
test('original account preview shares current automatic quote and integer volume gates without writing',t=>{
 const x=fixture(t),before=fs.readFileSync(x.file,'utf8');
 assert.equal(x.app.previewAutomaticEntry(x.request()).allowed,true);
 for(const patch of [{canTrade:false},{readOnlyBackup:true},{volume:100000.5},{volume:Number.MAX_SAFE_INTEGER+1}]){
  const r=x.app.previewAutomaticEntry(x.request(quote(now,patch)));
  assert.equal(r.allowed,null);assert.equal(r.canTrade,false);assert.equal(r.writesAccount,false);
 }
 assert.equal(fs.readFileSync(x.file,'utf8'),before);
});
test('original account preview does not certify a quote expiring during its final reread',t=>{
 const x=fixture(t),q=quote(now,{quoteAt:now-14500,timestamp:now-14500}),request=x.request(q),before=fs.readFileSync(x.file,'utf8');
 const read=fs.readFileSync;let reads=0;
 t.mock.method(fs,'readFileSync',(file,...args)=>{const value=read(file,...args);if(file===x.file&&++reads===2)x.setAt(now+501);return value;});
 const r=x.app.previewAutomaticEntry(request);
 assert.equal(r.allowed,null);assert.ok(r.reasonCodes.includes('AUTOMATIC_QUOTE_NOT_CURRENT'));
 assert.equal(fs.readFileSync(x.file,'utf8'),before);
});
test('original account preview rejects same-day rollback even when the candidate quote and held mark are fresh',t=>{
 const x=fixture(t),order={orderId:'first',symbol:code,side:'buy',quantity:100,limitPrice:10,tradeDate:day};
 x.app.submit(order);x.app.fill(order.orderId,'first-fill',quote(now,{source:'simulated',mode:'simulated'}));
 x.setAt(now-1);
 const q=quote(now-1,{symbol:'600001',riskContext:{observedAt:now-1001,marks:{[code]:10}}});
 const req={...x.request(q,'600001'),valuationQuotes:{[code]:quote(now-1)}},before=fs.readFileSync(x.file,'utf8');
 const r=x.app.previewAutomaticEntry(req);
 assert.equal(r.allowed,null);assert.ok(r.reasonCodes.includes('ACCOUNT_EXECUTION_CLOCK_ROLLBACK'));
 assert.equal(fs.readFileSync(x.file,'utf8'),before);
});
