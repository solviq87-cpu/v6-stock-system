'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMarketResponseSnapshot}=require('../src/core/market-response-snapshot');
const now=Date.parse('2026-11-26T10:00:00+08:00'),day='20261126';
const sample=()=>({asOf:now,board:'all',items:[{code:'600519',price:10,quoteAt:now,receivedAt:now,quoteSource:'tencent',quoteStatus:'recent-unverified',verifiedLive:true,canTrade:true,canNotify:true,canTrain:true}],sectorView:[{name:'test',picks:[{code:'600519',canTrade:true,canNotify:true,verifiedLive:true}]}]});
test('retained results cannot be recirculated and permissions expire even inside nested picks',()=>{
 const store=createMarketResponseSnapshot({clock:()=>now+60000});assert.equal(store.remember('quant','all',sample(),{day}),true);
 const read=store.read('quant','all');assert.equal(read.items[0].quoteStatus,'stale');assert.equal(read.items[0].verifiedLive,false);
 assert.equal(read.items[0].canTrain,false);assert.equal(read.sectorView[0].picks[0].verifiedLive,false);
 assert.equal(read.snapshotFreshness,'historical-display-only');assert.equal(store.remember('quant','all',read,{day}),false);
});
test('wrong board, malformed row/group and duplicate code cannot replace valid saved data',()=>{
 const store=createMarketResponseSnapshot({clock:()=>now+60000});assert.equal(store.remember('quant','all',sample(),{day}),true);
 for(const patch of [{items:[null]},{items:[{code:'not-code'}]},{items:[sample().items[0],sample().items[0]]},{sectorView:{}},{sectorView:[null]},{sectorView:[{picks:{}}]}]){
  assert.equal(store.remember('quant','all',{...sample(),...patch,asOf:now+1},{day}),false);
 }
 assert.equal(store.remember('quant','gem',{...sample(),board:'gem'},{day}),false);
 assert.equal(store.read('quant','all').asOf,now);
});
test('same timestamp revisions do not silently overwrite completed evidence',()=>{
 const store=createMarketResponseSnapshot({clock:()=>now});assert.equal(store.remember('quant','all',sample(),{day}),true);
 const changed=sample();changed.items[0].price=11;assert.equal(store.remember('quant','all',changed,{day}),false);
 assert.equal(store.read('quant','all').items[0].price,10);
});
test('disk schema2 rejects valid JSON tampering and legacy malformed entries stay isolated',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-snapshot-integrity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'cache.json'),errors=[];
 const first=createMarketResponseSnapshot({file,clock:()=>now});
 assert.equal(first.remember('quant','all',sample(),{day}),true);
 assert.equal(createMarketResponseSnapshot({file,clock:()=>now}).read('quant','all').items[0].price,10);
 const record=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(record.schemaVersion,2);
 record.entries['quant:all'].response.items[0].price=999;fs.writeFileSync(file,JSON.stringify(record));
 assert.equal(createMarketResponseSnapshot({file,clock:()=>now,onError:e=>errors.push(e)}).read('quant','all'),null);
 assert.ok(errors.includes('market-response-snapshot-read'));
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,entries:{'quant:all':{day,response:sample()},'auction:gem':{day,response:{...sample(),board:'all'}}}}));
 const legacy=createMarketResponseSnapshot({file,clock:()=>now});
 assert.equal(legacy.read('quant','all').items[0].price,10);assert.equal(legacy.read('auction','gem'),null);
});
