'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectSectors}=require('../src/core/decision-sector-context');
const {quoteObservationView}=require('../src/core/quote-observation-view');
const {createSessionIndexFeed}=require('../src/core/session-index-feed');
const now=Date.parse('2026-11-26T10:00:00+08:00'),day='2026-11-26';
const sector={code:'BK0001',name:'行业',mainInflow:0,source:'eastmoney',upstream:'eastmoney',fundsUnit:'CNY',unit:'CNY',fundsMethod:'vendor-order-size-estimate',retrievedAt:now-60000,sourceTimestamp:null};
test('sector projection rejects contradictory aliases but preserves a dated genuine zero',()=>{
 const valid=projectSectors({day,rows:[sector]},{day,now});
 assert.equal(valid.rows[0].mainInflow,0);
 for(const bad of [{upstream:'sina'},{fundsSource:'ths'},{unit:'USD'},{mainInflowYuan:1},{fundsConflict:true},{fundsRetrievedAt:now}]){
  assert.equal(projectSectors({day,rows:[{...sector,...bad}]},{day,now}).rows.length,0);
 }
});
test('malformed explicit quote provider and source fail closed without throwing',()=>{
 assert.equal(quoteObservationView({price:10,quoteAt:now-1000,receivedAt:now,quoteProvider:'eastmoney',quoteSource:{}},now).quoteStatus,'unknown');
});
test('clock rollback clears the externally published index cache',async()=>{
 let clock=now,external=null;
 const feed=createSessionIndexFeed({clock:()=>clock,primary:async()=>[{code:'1.000001',price:3000,quoteSource:'tencent-index',quoteAt:clock,receivedAt:clock}],backup:async()=>[],onUpdate:value=>{external=value;}});
 const session={day:'20261126',trading:true,openDay:true,minute:600};
 feed.read(session);for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(external.items.length,1);
 clock-=1000;assert.equal(feed.read(session).indices.length,0);assert.equal(external.items.length,0);
});
test('actual command ranking only consumes fresh and internally consistent same-day flow',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../public/nova/command-selection.mjs'),'utf8');
 const part=src.slice(src.indexOf('function ownFunds('),src.indexOf('function historyFunds('));
 const own=new Function('finite','dayOf',part+';return ownFunds;')(Number.isFinite,s=>s);
 const row={mainInflow:0,fundsSource:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',fundsSourceTimestamp:now-1000,fundsRetrievedAt:now};
 assert.equal(own(row,day,now).value,0);
 for(const patch of [{unit:'USD'},{upstream:'sina'},{fundsConflict:true},{fundsSource:'mock'},{fundsSourceTimestamp:now-15001}]){
  assert.equal(own({...row,...patch},day,now),null);
 }
});
