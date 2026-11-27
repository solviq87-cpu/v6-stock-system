'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSessionIndexFeed}=require('../src/core/session-index-feed');
const {createMarketDisplaySnapshot,originalQuoteDay,marketFieldDay}=require('../src/core/market-display-snapshot');
const stamp=(d,t='10:00:00')=>Date.parse(d+'T'+t+'+08:00');
const fri=stamp('2026-11-13','14:58:00'),mon=stamp('2026-11-16'),sun=stamp('2026-11-15','20:00:00');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const session=(day='20261116')=>({day,minute:600,openDay:true,trading:true});
const quote=(at,source='tencent-index')=>({code:'1.000001',price:100,quoteSource:source,quoteAt:at,receivedAt:at});
test('stale session caller cannot erase a healthy same-day index book',async()=>{
 let calls=0;const feed=createSessionIndexFeed({clock:()=>mon,primary:async()=>{calls++;return [quote(mon)];},backup:async()=>[]});
 feed.read(session());await flush();assert.equal(feed.read(session()).indices.length,1);
 assert.equal(feed.read(session('20261113')).indices.length,0);assert.equal(feed.read(session()).indices.length,1);await flush();assert.equal(calls,1);
});
test('actual day rollover fences late index receipt and clears external old day before next valid reader',async()=>{
 let now=fri,calls=0,resolve,external;
 const feed=createSessionIndexFeed({clock:()=>now,primary:()=>{calls++;return calls===1?Promise.resolve([quote(fri)]):new Promise(r=>{resolve=r;});},backup:async()=>[],onUpdate:v=>external=v});
 feed.read(session('20261113'));await flush();assert.equal(external.items.length,1);
 now=fri+6000;feed.read(session('20261113'));await flush();now=mon;resolve([quote(fri+6000)]);await flush();
 assert.equal(external.items.length,0);
 assert.equal(feed.read(session('20261113')).indices.length,0);
});
test('queued source call is not dispatched after actual day ends',async()=>{
 let now=fri,calls=0;const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{calls++;return [];},backup:async()=>{calls++;return [];}});
 feed.read(session('20261113'));now=mon;await flush();assert.equal(calls,0);
});
test('throwing index clock clears old cache without a new network request',async()=>{
 let bad=false,calls=0,external;const feed=createSessionIndexFeed({clock:()=>{if(bad)throw Error('clock');return mon;},primary:async()=>{calls++;return [quote(mon)];},backup:async()=>[],onUpdate:v=>external=v});
 feed.read(session());await flush();bad=true;assert.equal(feed.read(session()).indices.length,0);assert.equal(external.items.length,0);assert.equal(calls,1);
});
test('explicit closed session cannot start index source even if trading flag contradicts it',async()=>{
 let calls=0;const feed=createSessionIndexFeed({clock:()=>mon,primary:async()=>{calls++;return [];},backup:async()=>{calls++;return [];}});
 feed.read({...session(),openDay:false});await flush();assert.equal(calls,0);
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d21-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'snapshot.json');let now=fri,bad=false;
 return {file,set:x=>{now=x;},throwClock:x=>{bad=x;},open:()=>createMarketDisplaySnapshot({file,clock:()=>{if(bad)throw Error('clock');return now;}})};}
const live=(at=fri)=>({stocks:[{code:'600001',quoteAt:at,receivedAt:at,price:10}],candidatePool:[{code:'600001',quoteAt:at,receivedAt:at,price:10,canTrade:true,canNotify:true,verifiedLive:true}],idxRt:{items:[quote(at)]}});
test('ordinary historical display survives weekend restart with no restored authority',t=>{
 const h=fixture(t);h.open().select(live(),{openDay:true,trading:true});h.set(sun);
 const r=h.open().select({},{openDay:false});assert.equal(r.meta.snapshotDay,'20261113');assert.equal(r.state.candidatePool[0].quoteAt,fri);
 for(const k of ['canTrade','canNotify','verifiedLive'])assert.equal(r.state.candidatePool[0][k],false);
});
test('future or missing persisted capture time cannot become a trusted restart',t=>{
 const h=fixture(t);h.set(sun);
 for(const capturedAt of [undefined,sun+1,NaN,fri-86400000]){
  fs.writeFileSync(h.file,JSON.stringify({schemaVersion:1,day:'20261113',capturedAt,fields:{candidatePool:live().candidatePool}}));
  const r=h.open().select({},{openDay:false});assert.equal(r.meta.snapshotRetained,false);
 }
});
test('disk field day uses actual original capture cutoff, not restart clock',t=>{
 const h=fixture(t);h.set(sun);fs.writeFileSync(h.file,JSON.stringify({schemaVersion:1,day:'20261113',capturedAt:fri,fields:{candidatePool:live(fri+1000).candidatePool}}));
 const r=h.open().select({},{openDay:false});assert.equal(r.meta.snapshotFieldDays.candidatePool,null);
});
test('clock rollback cannot publish or flush saved future display evidence',t=>{
 const h=fixture(t),store=h.open();store.select(live(),{openDay:true,trading:true});const before=fs.readFileSync(h.file,'utf8');
 h.set(fri-1000);const r=store.select(live(fri-1000),{openDay:true,trading:true});assert.equal(r.meta.clockInvalid,true);assert.equal(r.meta.snapshotRetained,false);assert.equal(fs.readFileSync(h.file,'utf8'),before);
 h.set(sun);assert.equal(store.select({},{openDay:false}).meta.snapshotDay,'20261113');
});
test('explicit source conflict, fake marker and impossible receipt cannot establish quote day',()=>{
 for(const patch of [{sourceConflict:true},{synthetic:true},{receivedAt:fri-1},{receivedAt:fri+1},{tradeDate:'20261112'}])
  assert.equal(originalQuoteDay({stocks:[{...live().stocks[0],...patch}]},fri),'');
});
test('declared field day cannot override contradictory raw row day',()=>{
 assert.equal(marketFieldDay('sectors',{sectorsDay:'20261116',sectors:[{quoteAt:fri,receivedAt:fri}]},mon),null);
});
test('throwing display clock does not return or replace a saved snapshot',t=>{
 const h=fixture(t),s=h.open();s.select(live(),{openDay:true,trading:true});h.throwClock(true);assert.equal(s.select({},{openDay:false}).meta.clockInvalid,true);
});
