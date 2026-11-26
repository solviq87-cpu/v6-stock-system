'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {saveMinuteBars,readMinuteBars,minuteEnd}=require('../src/research/shortline-minute-archive');
const {createDrawerMinutes}=require('../src/research/drawer-minutes');
const day='2026-11-19',code='600001',now=Date.parse(day+'T16:00:00+08:00');
const bar=(patch={})=>({date:day+' 09:35',code,role:'stock',period:'5m',source:'V6/eastmoney',priceBasis:'unadjusted',volumeUnit:'shares',secid:'1.'+code,
 open:10,high:11,low:9,close:10,volume:100,amount:1000,knownAt:now,availableAt:day+' 16:00',...patch});
const scope={day,code,observedAtMs:now};
test('minute end boundaries preserve actual A-share 1m and 5m sessions',()=>{
 for(const time of ['09:30','09:31','11:31','12:30','13:00','13:61','15:01'])assert.equal(Number.isFinite(minuteEnd(day+' '+time,day,'5m')),false,time);
 for(const time of ['09:35','11:30','13:05','15:00'])assert.ok(Number.isFinite(minuteEnd(day+' '+time,day,'5m')),time);
 assert.ok(Number.isFinite(minuteEnd(day+' 09:31',day,'1m')));
 assert.equal(Number.isFinite(minuteEnd('2026-02-30 09:35','2026-02-30','5m')),false);
});
test('archive rejects wrong interval, identity, unit, adjustment and conflicting duplicate before any write',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-minute-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const patch of [{date:day+' 09:31'},{date:day+' 12:30'},{priceBasis:'qfq'},{volumeUnit:'lots'},{secid:'0.'+code},{volume:0.5}])assert.throws(()=>saveMinuteBars(root,scope,[bar(patch)]));
 assert.throws(()=>saveMinuteBars(root,scope,[bar(),bar({close:10.5})]));
 assert.equal(fs.existsSync(path.join(root,'minutes-v1')),false);
 assert.equal(saveMinuteBars(root,scope,[bar(),bar({period:'1m',date:day+' 09:31'})]).added,2);
 assert.equal(readMinuteBars(root,scope).length,2);
 assert.equal(saveMinuteBars(root,scope,[bar({close:10.5})]).conflicts,1);
 assert.equal(readMinuteBars(root,scope).find(b=>b.period==='5m').close,10);
});
test('drawer refuses wrong period and duplicates with conflicting values, preserving authentic separate series',async()=>{
 const read=createDrawerMinutes({clock:()=>now,reader:{readIntraday:async()=>({bars:[bar(),bar({close:10.5}),bar({date:day+' 12:30'}),bar({date:day+' 09:31'}),bar({date:day+' 09:40',priceBasis:'qfq'}),bar({period:'1m',date:day+' 09:31'})]})}});
 const result=await read(code,day);assert.equal(result.status,'observed');assert.deepEqual(result.minuteBars,[bar({period:'1m',date:day+' 09:31'})]);
});
test('drawer receipt clock rollback fences pending jobs and clears cached observations',async()=>{
 let at=now,calls=0;const resolvers=[];const read=createDrawerMinutes({clock:()=>at,reader:{readIntraday:()=>{calls++;return new Promise(r=>resolvers.push(r));}}});
 const pending=read(code,day);await Promise.resolve();at=now-1000;const other=read(code,day);await Promise.resolve();assert.equal(calls,2);
 resolvers[0]({bars:[bar()]});resolvers[1]({bars:[bar({knownAt:at,availableAt:day+' 15:59'})]});
 assert.equal((await pending).status,'unavailable');assert.equal((await other).status,'observed');
 at-=1000;const third=read(code,day);await Promise.resolve();assert.equal(calls,3);
 resolvers[2]({bars:[bar({knownAt:at,availableAt:day+' 15:59'})]});assert.equal((await third).status,'observed');
});
test('historical chart never overlays wrong interval or conflicting duplicate on a valid series',async()=>{
 const {archivePoints}=await import('../public/nova/stock-timeline.js');
 const points=archivePoints([bar(),bar({close:10.5}),bar({date:day+' 09:31'}),bar({date:day+' 12:30'}),bar({date:day+' 09:40',volumeUnit:'lots'}),bar({date:day+' 09:45'})],code,day,now);
 assert.deepEqual([...points.keys()],['09:45']);
});