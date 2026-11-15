'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMarketResponseSnapshot}=require('../src/core/market-response-snapshot');
const friday=Date.parse('2026-11-13T07:00:00Z'),sunday=Date.parse('2026-11-15T04:00:00Z');
const sample=()=>({asOf:friday,board:'all',count:3,totalScanned:5000,
 items:[{code:'600519',name:'a',price:10,quoteAt:friday,quoteSource:'tencent',canTrade:true,hit:[{id:2,text:'recorded'}]},
 {code:'300750',name:'b',price:20},{code:'000001',name:'c',price:30}],
 sectorView:[{name:'sector',picks:[{code:'600519'},{code:'300750'}]}],note:'original',token:'secret',
 sentinel:[{message:'private detail'}]});
test('completed Friday responses survive Sunday process restart with original clocks and no execution use',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-response-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'snap.json');
 const first=createMarketResponseSnapshot({file,clock:()=>friday});
 assert.equal(first.remember('quant','all',sample(),{day:'20261113'}),true);
 const second=createMarketResponseSnapshot({file,clock:()=>sunday});
 const result=second.read('quant','all',{max:2});
 assert.equal(result.items.length,2);assert.equal(result.asOf,friday);assert.equal(result.items[0].quoteAt,friday);
 assert.equal(result.snapshotDay,'20261113');assert.equal(result.isSnapshot,true);assert.equal(result.snapshotRetained,true);
 assert.equal(result.canTrade,false);assert.equal(result.items[0].canTrade,false);assert.equal(result.items[0].canNotify,false);
 assert.equal(result.token,undefined);assert.equal(result.sentinel,undefined);assert.equal(result.items[0].hit[0].text,'recorded');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
});
test('empty, revoked, future, malformed and Sunday recomputed results cannot overwrite Friday evidence',()=>{
 const store=createMarketResponseSnapshot({clock:()=>sunday});
 assert.equal(store.remember('quant','all',sample(),{day:'20261113'}),true);
 for(const response of [{...sample(),items:[]},{...sample(),locked:true},{...sample(),needAuth:true},
   {...sample(),asOf:sunday},{...sample(),asOf:sunday+1000},{...sample(),error:'failed'}]){
  assert.equal(store.remember('quant','all',response,{day:'20261113'}),false);
 }
 assert.equal(store.read('quant','all').asOf,friday);assert.equal(store.read('quant','all').items.length,3);
 assert.equal(store.remember('bad','all',sample(),{day:'20261113'}),false);
 assert.equal(store.remember('quant','bad',sample(),{day:'20261113'}),false);
 assert.equal(store.remember('quant','all',sample(),{day:'20260230'}),false);
});
test('all-board snapshot supports frozen main and GEM views without including the other board',()=>{
 const store=createMarketResponseSnapshot({clock:()=>sunday});
 store.remember('quant','all',sample(),{day:'20261113'});
 const main=store.read('quant','main'),gem=store.read('quant','gem');
 assert.deepEqual(main.items.map(x=>x.code),['600519','000001']);assert.deepEqual(gem.items.map(x=>x.code),['300750']);
 assert.deepEqual(gem.sectorView[0].picks.map(x=>x.code),['300750']);
 assert.equal(gem.count,1);assert.equal(gem.boardFallback,true);assert.equal(gem.completeForBoard,false);
 assert.equal(store.read('quant','all',{max:1}).items.length,1);assert.equal(store.read('quant','all',{max:NaN}).items.length,3);
 assert.equal(store.read('auction','all'),null);
});
test('returned response mutation cannot corrupt stored completed conditions',()=>{
 const store=createMarketResponseSnapshot({clock:()=>sunday});store.remember('auction','all',sample(),{day:'20261113'});
 const first=store.read('auction','all');first.items[0].hit[0].text='corrupt';first.items=[];
 const second=store.read('auction','all');assert.equal(second.items.length,3);assert.equal(second.items[0].hit[0].text,'recorded');
});
test('older captured generation and a clock moving behind Friday cannot expose or overwrite newer history',()=>{
 const store=createMarketResponseSnapshot({clock:()=>sunday});store.remember('quant','all',sample(),{day:'20261113'});
 assert.equal(store.remember('quant','all',{...sample(),asOf:friday-1000},{day:'20261113'}),false);
 assert.equal(store.read('quant','all',{now:friday-86400000}),null);
 assert.equal(store.read('quant','all',{now:friday-1000}),null);
});
