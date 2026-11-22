'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validDate,recentCloseDays,archivedDays,selectedClose}=require('../src/core/close-review-history');
const fri='2026-11-20',thu='2026-11-19',wed='2026-11-18';
const days=[fri,thu,wed,'2026-11-17','2026-11-16','2026-11-13'];
const previousDay=day=>days[days.indexOf(day)+1];
const opts={latest:fri,recent:recentCloseDays(fri,previousDay),previousDay,seatsReady:true};

test('recent sessions come from the exchange calendar, disk enumeration ignores future and nonregular files',t=>{
 assert.deepEqual(opts.recent,days.slice(0,5));assert.equal(validDate('2026-02-30'),false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-close-list-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const d of [wed,fri,'2026-11-21','2026-11-23','2026-11-08','2026-02-30'])fs.writeFileSync(path.join(dir,d+'.json'),'{}');
 fs.symlinkSync(path.join(dir,wed+'.json'),path.join(dir,thu+'.json'));
 assert.deepEqual(archivedDays([dir,dir],fri,d=>days.includes(d)),[fri,wed]);
});
test('independent day requests keep source totals, confirmed zero, corrections and wrong-day responses separate',async()=>{
 let losses=2;const calls=[];
 const readCore=Object.assign(async (day,prior)=>{calls.push([day,prior]);return {day,down:day===fri?losses:0};},{retained:()=>null});
 const readStudy={peek:()=>null,refresh:async day=>({day,index:{day}})};
 const run=d=>selectedClose({...opts,day:d,readCore,readStudy});
 assert.deepEqual((await Promise.all([run(fri),run(thu)])).map(r=>[r.day,r.down,r.dabanke.day]),[[fri,2,fri],[thu,0,thu]]);
 losses=8;assert.equal((await run(fri)).down,8);
 assert.deepEqual(calls.slice(0,2),[[fri,thu],[thu,wed]]);
 const wrong=Object.assign(async()=>({day:fri,down:9}),{retained:()=>({day:fri,down:9})});
 assert.equal(await selectedClose({...opts,day:thu,readCore:wrong,readStudy:{peek:()=>({day:fri}),refresh:async()=>({day:fri})}}),null);
 assert.equal(await run('2026-11-23'),null);assert.equal(await run('../2026-11-20'),null);
});
test('past the backfill window, valid dated receipts survive outages and unknown dates start no requests',async()=>{
 const ancient='2026-09-01';let reads=0;
 const readCore=Object.assign(async()=>{reads++;throw Error('offline');},{retained:d=>d===ancient?{day:d,down:0}:null});
 const readStudy={peek:()=>null,refresh:async()=>{reads++;throw Error('offline');}};
 assert.equal((await selectedClose({...opts,day:ancient,readCore,readStudy})).down,0);
 assert.equal(await selectedClose({...opts,day:'2026-08-31',readCore,readStudy}),null);assert.equal(reads,0);
});
test('observed close conditions change with the actual K line and reject a future receipt',async()=>{
 const {dailyConditions}=await import('../public/nova/tactics-view.js');
 const bars=[{date:wed,close:10,open:10,high:10,low:10},{date:thu,close:10,open:10,high:10,low:10},
   {date:fri,close:11,open:10.7,high:11,low:10}];
 const close=Date.parse(fri+'T15:10:00+08:00');
 assert.equal(dailyConditions(bars,thu,close)[0].hit,false);
 assert.equal(dailyConditions(bars,fri,close)[0].hit,true);
 assert.deepEqual(dailyConditions(bars,fri,close-3600000),[]);
 assert.deepEqual(dailyConditions([...bars.slice(0,-1),{...bars.at(-1),knownAt:close+1}],fri,close),[]);
 assert.deepEqual(dailyConditions(bars,'2026-11-23',close),[]);
});
