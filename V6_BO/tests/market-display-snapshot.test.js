'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMarketDisplaySnapshot,originalQuoteDay}=require('../src/core/market-display-snapshot');
const friday=Date.parse('2026-11-13T14:58:00+08:00'),sunday=Date.parse('2026-11-15T20:00:00+08:00');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-display-snapshot-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'snapshot.json');let now=friday;
 return {file,setNow:value=>{now=value;},open:()=>createMarketDisplaySnapshot({file,clock:()=>now})};
}
const market=()=>({stocksAt:friday+1000,stocks:[{code:'600001',price:10,quoteAt:friday}],
 idxRt:{at:friday+1000,items:[{code:'1.000001',price:3200,quoteAt:friday}]},
 candidatePool:[{code:'600001',price:10,quoteAt:friday,quoteSource:'provider',secret:'never-store'}],
 sectors:[{name:'行业',pct:1}],trendPool:[{code:'600001',price:10,quoteAt:friday}],
 news:{goodAll:[{title:'current-news'}]},paper:{cash:900},config:{password:'never-store'}});
test('Friday public pools and provider times survive Sunday cold restart without changing execution state',t=>{
 const h=fixture(t),state=market(),store=h.open();
 store.select(state,{trading:true,openDay:true,mood:{upN:10,downN:5}});
 h.setNow(sunday);const restarted=h.open(),current={candidatePool:[],idxRt:{items:[]},trendPool:[],stocksAt:sunday,
 stocks:[],news:{goodAll:[{title:'Sunday-news'}]},paper:{cash:850},config:{password:'current'}};
 const result=restarted.select(current,{trading:false,openDay:false});
 assert.equal(result.meta.snapshotDay,'20261113');assert.equal(result.meta.snapshotRetained,true);
 assert.equal(result.state.candidatePool[0].price,10);assert.equal(result.state.candidatePool[0].quoteAt,friday);
 assert.equal(result.state.idxRt.items[0].quoteAt,friday);assert.equal(result.state.trendPool.length,1);
 assert.equal(result.state.stocksAt,friday+1000);assert.equal(result.state.news,current.news);
 assert.equal(result.state.paper,current.paper);assert.equal(result.state.config,current.config);
 assert.equal(current.candidatePool.length,0);assert.equal(current.stocksAt,sunday);
 assert.equal(result.meta.canTrade,false);assert.equal(result.meta.trading,false);
 const disk=fs.readFileSync(h.file,'utf8');assert.doesNotMatch(disk,/never-store|current-news|password|cash|paper/);
});
test('weekend empty or recomputed results cannot overwrite Friday durable pools',t=>{
 const h=fixture(t),store=h.open();store.select(market(),{trading:true,openDay:true});const disk=fs.readFileSync(h.file,'utf8');
 h.setNow(sunday);const late={...market(),candidatePool:[],trendPool:[],sectors:[],stocksAt:sunday};
 const result=store.select(late,{trading:false,openDay:false});
 assert.equal(result.state.candidatePool.length,1);assert.equal(result.state.sectors.length,1);
 assert.equal(fs.readFileSync(h.file,'utf8'),disk);assert.equal(result.meta.snapshotDay,'20261113');
});
test('failed weekend capture is retried without replacing its frozen original rows',t=>{
 const h=fixture(t);h.setNow(sunday);fs.mkdirSync(h.file);const errors=[];
 const store=createMarketDisplaySnapshot({file:h.file,clock:()=>sunday,onError:code=>errors.push(code)});
 store.select(market(),{openDay:false});assert.ok(errors.includes('market-display-snapshot-write'));
 fs.rmdirSync(h.file);
 const recomputed={...market(),candidatePool:[{code:'600002',price:99,quoteAt:friday}]};
 store.select(recomputed,{openDay:false});
 const restarted=h.open().select({},{openDay:false});
 assert.equal(restarted.state.candidatePool[0].code,'600001');
 assert.equal(restarted.meta.snapshotDay,'20261113');
});
test('last throttled capture is flushed after the market closes and survives restart',t=>{
 const h=fixture(t),store=h.open();store.select(market(),{openDay:true});h.setNow(friday+10000);
 const latest={...market(),candidatePool:[{code:'600002',price:11,quoteAt:friday+10000}]};
 store.select(latest,{openDay:true});h.setNow(sunday);
 store.select({},{openDay:false});
 const restored=h.open().select({},{openDay:false});
 assert.equal(restored.state.candidatePool[0].code,'600002');
 assert.equal(restored.state.candidatePool[0].quoteAt,friday+10000);
});
test('same-session transient empty pool retains last valid rows',t=>{
 const h=fixture(t),store=h.open();store.select(market(),{trading:true,openDay:true});h.setNow(friday+60000);
 const result=store.select({...market(),candidatePool:[],trendPool:[]},{trading:true,openDay:true});
 assert.equal(result.state.candidatePool.length,1);assert.equal(result.state.trendPool.length,1);
 assert.equal(result.meta.trading,true);assert.equal(result.meta.isSnapshot,false);
});
test('unknown, received-only, future and weekend quote clocks never manufacture Friday data',t=>{
 const h=fixture(t);h.setNow(sunday);
 for(const quoteAt of [undefined,sunday+1,Date.parse('2026-11-15T10:00:00+08:00')]) {
  const store=h.open(),state={stocksAt:sunday,stocks:[{price:10,receivedAt:sunday,quoteAt}]};
  const result=store.select(state,{trading:false,openDay:false});
  assert.equal(result.meta.snapshotRetained,false);assert.equal(result.meta.snapshotDay,'');
 }
 assert.equal(fs.existsSync(h.file),false);
});
test('later valid provider session replaces Friday and older pools retain their own source day',t=>{
 const h=fixture(t),store=h.open();store.select(market(),{trading:true,openDay:true});
 const monday=Date.parse('2026-11-16T10:00:00+08:00');h.setNow(monday);
 const live={...market(),stocks:[{code:'600001',price:11,quoteAt:monday}],idxRt:{items:[{price:3201,quoteAt:monday}]},stocksAt:monday};
 const result=store.select(live,{trading:true,openDay:true});
 assert.equal(result.meta.snapshotDay,'20261116');assert.equal(result.meta.snapshotFieldDays.candidatePool,'20261113');
 assert.equal(result.state.candidatePool[0].quoteAt,friday);
});
test('corrupt disk snapshot fails closed without leaking contents',t=>{
 const h=fixture(t);fs.writeFileSync(h.file,'{"password":"private", BROKEN');const errors=[];
 const store=createMarketDisplaySnapshot({file:h.file,clock:()=>sunday,onError:code=>errors.push(code)});
 assert.equal(store.select({},{}).meta.snapshotRetained,false);assert.deepEqual(errors,['market-display-snapshot-read']);
});
test('month/year and long-holiday recovery use actual dates rather than numeric YYYYMMDD subtraction',t=>{
 const h=fixture(t);const at=Date.parse('2026-09-30T15:01:00+08:00');h.setNow(at);
 h.open().select({stocks:[{quoteAt:at}],candidatePool:[{code:'600001',price:10,quoteAt:at}]},{openDay:true});
 h.setNow(Date.parse('2026-10-07T12:00:00+08:00'));const result=h.open().select({},{openDay:false});
 assert.equal(result.meta.snapshotDay,'20260930');assert.equal(result.state.candidatePool.length,1);
 assert.equal(originalQuoteDay({stocksAt:sunday},sunday),'');
});
test('Sunday cold startup can fill a missing pool later from the same Friday original quotes',t=>{
 const h=fixture(t);h.setNow(sunday);const store=h.open(),base={...market(),candidatePool:[],trendPool:[]};
 assert.equal(store.select(base,{openDay:false}).state.candidatePool.length,0);
 const filled=store.select(market(),{openDay:false});assert.equal(filled.state.candidatePool.length,1);
 const restarted=h.open().select({},{openDay:false});assert.equal(restarted.state.candidatePool.length,1);
 assert.equal(restarted.meta.snapshotDay,'20261113');
 const changed=store.select({...market(),candidatePool:[{code:'600002',price:99,quoteAt:friday}]},{openDay:false});
 assert.equal(changed.state.candidatePool[0].code,'600001','same-day weekend recompute cannot replace frozen valid pool');
});
test('malformed typed snapshot fields cannot break state response collection methods',t=>{
 const h=fixture(t);h.setNow(sunday);fs.writeFileSync(h.file,JSON.stringify({schemaVersion:1,day:'20261113',fields:{candidatePool:'broken',sectors:{bad:true},idxRt:{items:'broken'},stocksAt:'now'}}));
 const current={candidatePool:[],sectors:[],idxRt:null,stocksAt:0};const result=h.open().select(current,{openDay:false});
 assert.deepEqual(result.state,current);
});
test('display session follows Shanghai market hours on UTC, Shanghai and US hosts',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
 const start=source.indexOf('function marketDisplaySession() {'),end=source.indexOf('function marketDisplayState()',start);
 const previous=process.env.TZ;
 try {
  for(const zone of ['UTC','Asia/Shanghai','America/Los_Angeles']) {
   process.env.TZ=zone;
   for(const [iso,day,trading] of [['2026-11-13T16:00:00+08:00','20261113',false],['2026-11-13T10:00:00+08:00','20261113',true],['2026-11-15T20:00:00+08:00','20261115',false],['2026-11-16T09:00:00+08:00','20261116',false]]) {
    const stamp=Date.parse(iso);class Clock extends Date {constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}}
    const get=new Function('Date','isTradeDay',source.slice(start,end)+';return marketDisplaySession;')(Clock,d=>![0,6].includes(d.getDay()));
    assert.equal(get().day,day,zone+' day');assert.equal(get().trading,trading,zone+' '+iso);
   }
  }
 } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('Monday open with only Friday quotes stays explicitly historical and preserves public plan cards',t=>{
 const h=fixture(t),store=h.open();const state={...market(),nextplan:{date:'20261113',plan:{picked:[{code:'600001',price:10}]}},idxDisc:{day:'20261113',signal:'review'},ztNameClanScans:{fixture:{total:1,hits:[{code:'600001'}]}}};
 store.select(state,{openDay:true,trading:true});h.setNow(Date.parse('2026-11-16T10:00:00+08:00'));
 const result=store.select({...market(),candidatePool:[],nextplan:null,idxDisc:null},{openDay:true,trading:true});
 assert.equal(result.meta.trading,true);assert.equal(result.meta.isSnapshot,true);assert.equal(result.meta.snapshotRetained,true);
 assert.equal(result.meta.snapshotDay,'20261113');assert.equal(result.state.nextplan.plan.picked[0].code,'600001');
 assert.equal(result.state.idxDisc.day,'20261113');assert.equal(result.state.candidatePool[0].quoteAt,friday);
});
