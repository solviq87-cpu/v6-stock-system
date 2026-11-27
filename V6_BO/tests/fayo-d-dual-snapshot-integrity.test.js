'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMarketDisplaySnapshot,originalQuoteDay,marketFieldDay}=require('../src/core/market-display-snapshot');
const {createMarketResponseSnapshot}=require('../src/core/market-response-snapshot');
const at=Date.parse('2026-11-27T14:50:00+08:00'),day='20261127',iso='2026-11-27';
const row=(patch={})=>({code:'600000',price:10,quoteAt:at,quoteSource:'eastmoney',receivedAt:at,...patch});
const scan=(patch={})=>({asOf:at,board:'all',items:[row()],sectorView:[{name:'板块',picks:[row()]}],...patch});
const state=(patch={})=>({stocks:[row()],candidatePool:[row()],...patch});
test('D47 frozen scan rejects sparse security list instead of silently losing members',()=>{
 const store=createMarketResponseSnapshot({clock:()=>at});
 const items=[row(),, {...row(),code:'600001'}];
 assert.equal(store.remember('quant','all',scan({items}),{day}),false);
 assert.equal(store.read('quant','all'),null);
});
test('D47 frozen scan refuses sparse group or member lists and duplicate members within a group',()=>{
 for(const sectorView of [Array(1),[{name:'板块',picks:Array(1)}],[{name:'板块',picks:[row(),row()]}]]){
  const store=createMarketResponseSnapshot({clock:()=>at});
  assert.equal(store.remember('quant','all',scan({sectorView}),{day}),false);
 }
 const store=createMarketResponseSnapshot({clock:()=>at});
 assert.equal(store.remember('quant','all',scan({sectorView:[{name:'a',picks:[row()]},{name:'b',picks:[row()]}]}),{day}),true);
});
test('D47 invalid original receipt cannot become recent by sanitation and alias conflict is retained',()=>{
 for(const patch of [{receivedAt:Infinity},{receivedAt:NaN},{receivedAt:'invalid'},{vendorQuoteAt:at-1000},{vendorQuoteAt:at+1}]){
  const store=createMarketResponseSnapshot({clock:()=>at});
  assert.equal(store.remember('quant','all',scan({items:[row(patch)],sectorView:[]}),{day}),true);
  const r=store.read('quant','all').items[0];
  assert.equal(r.sourceConflict,true);assert.equal(r.snapshotTimeConflict,true);
  assert.equal(r.quoteStatus,'unknown');assert.equal(r.canTrade,false);
 }
});
test('D47 display origin ignores contradictory time aliases, explicit conflicts and test observations',()=>{
 for(const patch of [{vendorQuoteAt:at-1000},{vendorQuoteAt:at+1},{tradeDate:[iso]},
  {quoteProvider:'tencent'},{evidenceStatus:'conflict'},{quoteMode:'synthetic-quote'},{testSample:true},{receivedAt:Infinity}]){
  assert.equal(originalQuoteDay({stocks:[row(patch)]},at),'');
 }
 assert.equal(originalQuoteDay({stocks:[row({vendorQuoteAt:at,tradeDate:iso})]},at),day);
});
test('D47 declared field date cannot override contradictory aliases, coerced dates or source clock',()=>{
 for(const patch of [{vendorQuoteAt:at-1000},{tradeDate:'2026-11-26',quoteAt:null,receivedAt:null},
  {sourceConflict:true,quoteAt:null,receivedAt:null},{receivedAt:Infinity}]){
  assert.equal(marketFieldDay('sectors',{sectorsDay:iso,sectors:[row(patch)]},at),null);
 }
 assert.equal(marketFieldDay('sectors',{sectorsDay:[iso],sectors:[row()]},at),null);
 assert.equal(marketFieldDay('sectors',{sectorsDay:iso,sectors:[{name:'真实历史日'}]},at),day);
});
test('D47 sparse display pools are not captured, and sanitized display permissions remain false',()=>{
 const store=createMarketDisplaySnapshot({clock:()=>at,isSessionDay:()=>true});
 store.select(state({candidatePool:Array(1),trendPool:[row({canTrain:true,autoPromotion:true,certifiedLive:true})]}),{openDay:true,trading:true});
 const result=store.select({},{openDay:false});
 assert.equal(Object.hasOwn(result.state,'candidatePool'),false);
 assert.equal(result.state.trendPool[0].canTrain,false);assert.equal(result.state.trendPool[0].autoPromotion,false);assert.equal(result.state.trendPool[0].certifiedLive,false);
});
test('D47 bad clocks persist as conflicts rather than losing evidence on next snapshot read',()=>{
 const store=createMarketDisplaySnapshot({clock:()=>at,isSessionDay:()=>true});
 store.select(state({candidatePool:[row({receivedAt:Infinity})]}),{openDay:true,trading:true});
 const r=store.select({},{openDay:false});
 assert.equal(r.state.candidatePool[0].sourceConflict,true);assert.equal(r.meta.snapshotFieldDays.candidatePool,null);
});
test('D47 normal same-day display and retained scan preserve data, receipt and disabled permissions',()=>{
 const display=createMarketDisplaySnapshot({clock:()=>at,isSessionDay:()=>true});
 display.select(state(),{openDay:true,trading:true});const r=display.select({},{openDay:false});
 assert.equal(r.meta.snapshotDay,day);assert.equal(r.state.candidatePool[0].quoteAt,at);
 const scanStore=createMarketResponseSnapshot({clock:()=>at});
 assert.equal(scanStore.remember('auction','all',scan(),{day}),true);
 const saved=scanStore.read('auction','all');assert.equal(saved.items[0].receivedAt,at);assert.equal(saved.items[0].canTrade,false);
});
test('D47 snapshot reload preserves captured invalid receipt marker and rejects malformed UTF8',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-snapshot-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'snapshot.json');
 const s=createMarketResponseSnapshot({file,clock:()=>at});
 assert.equal(s.remember('quant','all',scan({items:[row({receivedAt:Infinity})],sectorView:[]}),{day}),true);
 const after=createMarketResponseSnapshot({file,clock:()=>at}).read('quant','all');
 assert.equal(after.items[0].sourceConflict,true);assert.equal(after.items[0].quoteStatus,'unknown');
 const legacy=JSON.stringify({schemaVersion:1,entries:{'quant:all':{day,response:scan({note:'xMARKERx'})}}});
 const off=legacy.indexOf('xMARKERx');const raw=Buffer.concat([Buffer.from(legacy.slice(0,off)),Buffer.from([255]),Buffer.from(legacy.slice(off+8))]);
 fs.writeFileSync(file,raw);const errors=[];
 assert.equal(createMarketResponseSnapshot({file,clock:()=>at,onError:e=>errors.push(e)}).read('quant','all'),null);
 assert.deepEqual(errors,['market-response-snapshot-read']);
});
