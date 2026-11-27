'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {fixture}=require('./helpers/account-equity-fixture');
test('C8 original risk workbench read binds adverse paths to the same real isolated authority and pending remainder',async t=>{
 const f=fixture(t);f.buy('600000',100,10);
 const day=aShareCalendarDate(f.now);
 f.service.submit({orderId:'pending-gap',symbol:'600000',side:'buy',quantity:200,limitPrice:10,tradeDate:day});
 const before=fs.readFileSync(path.join(f.root,'authority.json'),'utf8');
 let sends=0,reads=0;
 const runtime=createRiskWorkbenchRuntime({root:path.join(f.root,'risk'),clock:()=>f.now,isPrimary:()=>true,readBook:()=>{reads++;return f.service.read();},
  readQuotes:()=>({'600000':f.quote()}),readResearch:()=>({}),readPlans:async()=>({ok:true,state:{plans:[]}}),
  readObservations:()=>({records:[],alerts:[]}),readAutomaticPolicy:()=>null,readOriginalExitChecks:()=>({}),
  readMarket:()=>({classificationSnapshot:{day,knownAt:f.now-1,facts:{'600000':{themes:['AI']}}}}),readSystem:()=>({}),readStrategy:()=>null,
  calendar:{isOpen:()=>true},session:()=>({continuous:true,day}),privateReady:()=>false,sendPrivate:()=>{sends++;throw Error('no delivery');},planEnabled:()=>false});
 const r=await runtime.read({accountId:'pool'}),a=r.stress.adversePaths;
 assert.equal(reads,1);assert.equal(a.authoritySnapshotFingerprint,r.equity.source.snapshotFingerprint);assert.equal(a.accountEpoch,r.equity.accountEpoch);
 assert.equal(a.paths[0].heldMarkLoss,100);assert.equal(a.paths[0].currentlyRestrictedLotLoss,100);
 assert.equal(a.pendingBudget.remainingBuyNotional,2000);assert.equal(a.paths[0].allPendingFillLoss,300+a.pendingBudget.estimatedRemainingFees);
 assert.equal(a.canTrade,false);assert.equal(r.stress.planOdds.status,'no-applicable-plan');assert.equal(sends,0);
 assert.equal(fs.readFileSync(path.join(f.root,'authority.json'),'utf8'),before);
});
test('C8 workbench extension is wired into existing shared risk panel, without a second page or endpoint',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/nova/risk-workbench-view.mjs'),'utf8');
 assert.match(source,/adversePathPanel\(stress\)/);assert.match(source,/risk-adverse-paths/);assert.match(source,/allPendingFillLoss/);assert.match(source,/grossRewardRiskRatio/);
});
