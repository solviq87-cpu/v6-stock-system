'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {joinObservedCandidates}=require('../src/core/live-candidate-bridge');
const day='2026-11-26',now=Date.parse(day+'T10:00:00+08:00'),source='eastmoney-clist-unverified-live';
const stock=(code='600000',patch={})=>({code,pctChange:3,amount:10000000,latestPrice:10,volumeLots:1000,vendorQuoteAt:now-1000,...patch});
const snapshot=(stocks=[stock()])=>({date:day,source,stocks,retrievedAt:new Date(now).toISOString()});
const candidates=[{code:'600000',name:'原候选',finalScore:72},{code:'600001',name:'原二候选',finalScore:81}];
const breadth={usable:true,date:day,source};
const join=(s,b=breadth,asOf=now)=>joinObservedCandidates(s,b,candidates,{asOf});
test('a different source or date breadth receipt cannot authorize candidate intersection',()=>{
 for(const b of [{...breadth,date:'2026-11-25'},{...breadth,source:'tencent'}]){
  const r=join(snapshot(),b);assert.equal(r.usable,false);assert.deepEqual(r.items,[]);
 }
 assert.equal(join({...snapshot(),source:'synthetic'}).usable,false);
 assert.equal(join({...snapshot(),stocks:null}).usable,false);
});
test('contradictory duplicate observations cannot choose the more attractive candidate or newer quote',()=>{
 for(const patch of [{pctChange:9},{latestPrice:11},{amount:1},{vendorQuoteAt:now},{suspended:true},{source:'mock'},{isST:true}]){
  const rows=[stock(),stock('600000',patch),stock('600001')],before=JSON.stringify(rows),r=join(snapshot(rows));
  assert.deepEqual(r.items.map(x=>x.code),['600001']);assert.equal(r.missing,1);
  assert.equal(r.rejectedObservationCodes,1);assert.equal(r.items[0].candidateScore,81);assert.equal(JSON.stringify(rows),before);
 }
});
test('explicit invalid or unsafe observed rows cannot supply a recent quote to the original candidate gate',()=>{
 for(const patch of [{pctChange:101},{suspended:true},{tradable:false},{isST:true},{sourceConflict:true},{quoteStatus:'conflict'},{simulated:true},{symbol:'600001'}]){
  const r=join(snapshot([stock('600000',patch)]));assert.equal(r.items.length,0);assert.equal(r.quoteTimeReadyCount,0);
 }
});
test('a declared future or invalid retrieval receipt is not available to the candidate query',()=>{
 for(const retrievedAt of [new Date(now+1).toISOString(),'invalid']){
  const r=join({...snapshot(),retrievedAt});assert.equal(r.usable,false);assert.equal(r.items.length,0);
 }
});
test('exact original duplicates and legacy unspecified breadth identity preserve rank and source timestamps',()=>{
 const original=stock(),s=snapshot([original,{...original}]),before=JSON.stringify({s,candidates});
 const r=join(s,{usable:true});assert.equal(r.matched,1);assert.equal(r.items[0].candidateScore,72);
 assert.equal(r.items[0].quoteAt,original.vendorQuoteAt);assert.equal(r.items[0].quoteTimeStatus,'recent-source-unverified');
 assert.equal(r.items[0].canTrade,false);assert.equal(r.rankingModified,false);assert.equal(JSON.stringify({s,candidates}),before);
});
