'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {createIndexWindowResearch}=require('../src/core/index-window-research'),J=require('../src/core/research-workspace-store');
const dates=[];for(let t=Date.parse('2026-09-01T10:00:00+08:00');dates.length<21;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(t);
const day=at=>new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');
const records=root=>fs.existsSync(root)?fs.readdirSync(root).sort().flatMap(d=>J.readEvents(path.join(root,d))):[];
function fixture(t,extra={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'index-history-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'history');let now=dates[0];
 const options={historyRoot:root,clock:()=>now,canPersist:()=>true,...extra};
 const radar=createIndexWindowResearch(options);
 function tick(r,d,m,price,{trading=true,override}={}){now=dates[d]+m*60000;const k=day(now),row={code:'1.000001',quoteSource:'sina-index',price,quoteAt:now,receivedAt:now};r.observe({day:k,indices:price===null?[]:[override?override(row):row]},{day:k,trading},now);return r.view(now);}
 function seed(){for(let d=0;d<20;d++){for(let m=0;m<6;m++)tick(radar,d,m,100+m/10);tick(radar,d,301,null,{trading:false});}}
 return {base,root,options,radar,tick,seed,setNow:v=>{now=v;},now:()=>now};
}
test('closed-day baseline survives a new process and actually supports fresh same-window research',t=>{
 const f=fixture(t);f.seed();f.setNow(dates[20]);
 const script=`const {createIndexWindowResearch}=require(process.argv[1]);const start=Number(process.argv[3]);let now=start;const r=createIndexWindowResearch({historyRoot:process.argv[2],clock:()=>now});const before=r.view(now);for(let m=0;m<6;m++){now=start+m*60000;const day=new Date(now+28800000).toISOString().slice(0,10).replaceAll('-','');r.observe({day,indices:[{code:'1.000001',price:m===5?110:100+m/10,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}]},{day,trading:true},now);}console.log(JSON.stringify({before,after:r.view(now)}));`;
 const result=JSON.parse(execFileSync(process.execPath,['-e',script,require.resolve('../src/core/index-window-research'),f.root,String(dates[20])],{encoding:'utf8'}));
 assert.equal(result.before.priorDaysObserved,20);assert.deepEqual(result.before.events,[]);assert.deepEqual(result.before.continuity,[]);
 assert.deepEqual(result.after.events.map(e=>e.windowMinutes),[1,5]);assert.ok(result.after.events.every(e=>!e.canTrade&&!e.canNotify&&e.attribution==='unknown'));
 assert.equal(records(f.root).length,20);assert.equal(result.after.history.daysLoaded,20);
 const hashes=new Map(records(f.root).map(e=>[e.data.day,e.hash]));assert.ok(result.after.events.every(e=>e.references.every(ref=>ref.archiveHash===hashes.get(ref.date))));
});
test('only ended days are journaled once; input refresh and lunch do not create repeated writes',t=>{
 const f=fixture(t);for(let m=0;m<6;m++)f.tick(f.radar,0,m,100+m/10);
 f.tick(f.radar,0,120,null,{trading:false});assert.equal(records(f.root).length,0);
 f.tick(f.radar,0,299,null);assert.equal(records(f.root).length,0);
 f.tick(f.radar,0,301,null,{trading:false});f.tick(f.radar,0,302,null,{trading:false});assert.equal(records(f.root).length,1);
 assert.equal(fs.statSync(f.root).mode&0o777,0o700);assert.equal(fs.statSync(path.join(f.root,day(dates[0]),'000001.json')).mode&0o777,0o600);
});
test('a process restart restores prior days but never restores current quotes or live episodes',t=>{
 const f=fixture(t);f.seed();for(let m=0;m<6;m++)f.tick(f.radar,20,m,m===5?110:100+m/10);
 assert.equal(f.radar.view(f.now()).events.length,2);
 const cold=createIndexWindowResearch(f.options),view=cold.view(f.now());assert.equal(view.priorDaysObserved,20);assert.deepEqual(view.events,[]);assert.deepEqual(view.continuity,[]);
 assert.equal(records(f.root).length,20);assert.equal(view.history.currentSession,'fresh-observation-required');
});
test('role withdrawal inside the original journal lock prevents a sealed-day write',t=>{
 let checks=0;const f=fixture(t,{canPersist:()=>++checks<3});f.tick(f.radar,0,0,100);f.tick(f.radar,0,301,null,{trading:false});
 assert.equal(records(f.root).length,0);assert.equal(f.radar.view(f.now()).history.status,'unavailable');
});
test('corrupt historical journal is preserved and cannot provide restored references',t=>{
 const f=fixture(t);f.seed();const file=path.join(f.root,day(dates[0]),'000001.json'),bad=JSON.parse(fs.readFileSync(file));bad.data.day='20261126';fs.writeFileSync(file,JSON.stringify(bad),{mode:0o600});const bytes=fs.readFileSync(file);
 f.setNow(dates[20]);const r=createIndexWindowResearch(f.options);assert.equal(r.view(f.now()).priorDaysObserved,0);assert.equal(r.view(f.now()).history.status,'unavailable');assert.deepEqual(fs.readFileSync(file),bytes);
 const names=fs.readdirSync(f.root);f.tick(r,20,0,100);f.tick(r,20,301,null,{trading:false});assert.deepEqual(fs.readdirSync(f.root),names);assert.equal(r.view(f.now()).history.status,'unavailable');
});
test('hash-valid unsupported algorithms, future points, duplicate identities and permissions fail closed',t=>{
 const f=fixture(t);f.setNow(dates[20]);const good={mode:'index-window-day-v1',algorithm:'same-minute-absolute-range-v1',day:day(dates[0]),points:[{code:'1.000001',minute:600,observation:{price:100,quoteAt:dates[0],receivedAt:dates[0],quoteSource:'sina-index'}}]};
 const cases=[{...good,algorithm:'unapproved'},{...good,day:day(dates[20])},{...good,points:[...good.points,...good.points]},
 {...good,points:[{...good.points[0],observation:{...good.points[0].observation,canTrade:true}}]}];
 for(const [i,data] of cases.entries()){
  const root=path.join(f.base,'case'+i);fs.mkdirSync(root,{mode:0o700});J.appendEvent(path.join(root,data.day),'diagnostic',data,{requestId:'index_window_day_'+data.day,now:dates[19]+301*60000});
  const r=createIndexWindowResearch({...f.options,historyRoot:root});assert.equal(r.view(f.now()).priorDaysObserved,0);assert.equal(r.view(f.now()).history.status,'unavailable');
 }
});
test('clock rollback cannot expose restored historical references to an earlier decision',t=>{
 const f=fixture(t);f.seed();f.setNow(dates[20]);const r=createIndexWindowResearch(f.options);
 f.tick(r,0,0,100);assert.equal(r.view(f.now()).priorDaysObserved,0);assert.deepEqual(r.view(f.now()).events,[]);
 assert.equal(r.view(f.now()).history.status,'clock-reset');const hashes=records(f.root).map(e=>e.hash);f.tick(r,0,1,999);f.tick(r,0,301,null,{trading:false});assert.deepEqual(records(f.root).map(e=>e.hash),hashes);
});

test('explicit negative provenance is not washed into durable reference samples',t=>{
 for(const flag of ['sourceConflict','synthetic','simulated','imported']){
  const f=fixture(t);for(let m=0;m<6;m++)f.tick(f.radar,0,m,100+m/10,{override:r=>({...r,[flag]:true})});
  f.tick(f.radar,0,301,null,{trading:false});assert.equal(records(f.root).length,0);
 }
});
test('symlinked journal root is not followed or rewritten',t=>{
 const f=fixture(t);f.seed();const link=path.join(f.base,'link');fs.symlinkSync(f.root,link);f.setNow(dates[20]);
 const r=createIndexWindowResearch({...f.options,historyRoot:link});assert.equal(r.view(f.now()).history.status,'unavailable');assert.equal(records(f.root).length,20);
});
test('history disclosure keeps a fresh-session requirement and rejects forged authority',async()=>{
 const {indexHistoryDisclosure}=await import('../public/nova/index-continuity-view.mjs');
 const h={mode:'sealed-index-minute-history-v1',status:'restored',daysLoaded:20,archivedDays:20,currentSession:'fresh-observation-required',sourceVerified:false,canTrain:false,canTrade:false,canNotify:false};
 assert.match(indexHistoryDisclosure(h),/20 日.*本交易日重新采样/);
 assert.equal(indexHistoryDisclosure({...h,canTrade:true}),'');assert.equal(indexHistoryDisclosure({...h,daysLoaded:22}),'');
 assert.equal(indexHistoryDisclosure({...h,status:'unverified-model-claim'}),'');
});

test('a disputed minute remains a gap after restoration instead of becoming a comparable window',t=>{
 const f=fixture(t);
 for(let d=0;d<20;d++){for(let m=0;m<6;m++){f.tick(f.radar,d,m,100+m/10);if(d===5&&m===4)f.tick(f.radar,d,m,999);}f.tick(f.radar,d,301,null,{trading:false});}
 assert.equal(records(f.root)[5].data.points.find(p=>p.minute===604).observation,null);
 f.setNow(dates[20]);const r=createIndexWindowResearch(f.options);assert.equal(r.view(f.now()).priorDaysObserved,20);
 for(let m=0;m<6;m++)f.tick(r,20,m,m===5?110:100+m/10);
 assert.deepEqual(r.view(f.now()).events,[]);
});

test('a dangling day-file symlink is quarantined instead of treated as an absent observation',t=>{
 const f=fixture(t);f.seed();const file=path.join(f.root,day(dates[0]),'000001.json');fs.unlinkSync(file);fs.symlinkSync(path.join(f.base,'missing'),file);f.setNow(dates[20]);
 const r=createIndexWindowResearch(f.options);assert.equal(r.view(f.now()).history.status,'unavailable');assert.equal(r.view(f.now()).priorDaysObserved,0);assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
});
