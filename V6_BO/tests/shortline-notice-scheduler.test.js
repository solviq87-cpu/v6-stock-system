const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createShortlineNoticeScheduler,revokeNoticeAuthority,noticeBooks}=require('../src/research/shortline-notice-scheduler');
const {syncNoticeSchedule,tickWebNotices,noticeView}=require('../src/research/shortline/web-notices.mjs');
const {settingsAt}=require('../public/nova/shortline/settings.mjs');
const day='2026-11-20',time=Date.parse(day+'T16:10:00+08:00');
const session=at=>{const t=new Date(at+8*36e5);return {day:t.toISOString().slice(0,10).replaceAll('-',''),minute:t.getUTCHours()*60+t.getUTCMinutes(),openDay:true};};
const folder=(t)=>{const r=fs.mkdtempSync(path.join(os.tmpdir(),'notice-cron-'));t.after(()=>fs.rmSync(r,{force:true,recursive:true}));return r;};
const id=n=>'book-'+n.toString(16).padStart(16,'0');
test('session date/minute, exchange calendar, live role and scheduled receipt govern launch',async t=>{
 const root=folder(t),state={scope:'live',settingsHistory:[{version:1,effectiveAt:'2025-01-01T00:00:00Z',config:{...settingsAt({}),dailyReviewTime:'16:10'}}]};
 const sessionArgs={root,getMarketSession:session,isPrimary:()=>true,clock:()=>time,runJob:()=>assert.fail('unexpected')};
 assert.equal((await createShortlineNoticeScheduler(sessionArgs)()).scheduled,0);
 syncNoticeSchedule({dir:root,state,book:'main'});
 for(const override of [{isPrimary:()=>false},{clock:()=>time-11*60000},{getMarketSession:t=>({...session(t),openDay:false})},
    {getMarketSession:t=>({...session(t),day:'20261119'})},{getMarketSession:t=>({...session(t),minute:980})}]){
   assert.equal((await createShortlineNoticeScheduler({...sessionArgs,...override})()).scheduled,0);
 }
 const jobs=[];const tick=createShortlineNoticeScheduler({...sessionArgs,runJob:async p=>{
  jobs.push(p.book);assert.equal(p.day,day);assert.equal(p.action,'shortline-web-notices');
  const ok=()=>Atomics.load(new Int32Array(p.primaryFlag),0)===1;assert.ok(ok());
  await tickWebNotices({state,root,dir:root,book:p.book,day,now:p.now,tradingDay:true,primary:true,isPrimary:ok});
  return {ok:true};
 }});
 assert.equal((await tick()).scheduled,1);assert.deepEqual(jobs,['main']);
 assert.equal(noticeView({dir:root,state,book:'main'}).notices[0].day,day);
});
test('bounded directory inventory excludes demo, links and unrelated private directories',t=>{
 const root=folder(t),dir=path.join(root,'books');fs.mkdirSync(dir,{mode:0o700});
 for(const name of [id(1),id(2),'demo','secrets','book-not-valid'])fs.mkdirSync(path.join(dir,name),{mode:0o700});
 fs.symlinkSync(path.join(dir,id(2)),path.join(dir,id(3)));
 assert.deepEqual(noticeBooks(root).map(r=>r.book).sort(),['main',id(1),id(2)].sort());
});
test('one job at a time, immediate demotion permanently revokes the in-flight lease and can be re-promoted',async()=>{
 let now=time,primary=true,released,start;
 const entered=new Promise(r=>start=r),wait=new Promise(r=>released=r);let first,seen=0;
 const tick=createShortlineNoticeScheduler({root:'/unused',getMarketSession:session,clock:()=>now,isPrimary:()=>primary,
  listBooks:()=>[{book:'main',dir:'/unused'},{book:id(1),dir:'/unused'}],hasDue:()=>true,
  runJob:async p=>{seen++;if(!first){first=new Int32Array(p.primaryFlag);start();await wait;}return {ok:true};}});
 const initial=tick();await entered;assert.equal((await tick()).scheduled,0);assert.equal(Atomics.load(first,0),1);
 primary=false;revokeNoticeAuthority();assert.equal(Atomics.load(first,0),0);primary=true;
 released();assert.equal((await initial).scheduled,1);assert.equal(seen,1);
 now+=30000;assert.equal((await tick()).scheduled,2);assert.equal(Atomics.load(first,0),0);
});
test('worker busy defers that book and other eligible books get a turn with bounded concurrency',async()=>{
 let now=time;const books=Array.from({length:14},(_,i)=>({book:id(i),dir:'/unused'})),seen=[];
 const tick=createShortlineNoticeScheduler({root:'/unused',getMarketSession:session,isPrimary:()=>true,clock:()=>now,listBooks:()=>books,
  hasDue:()=>true,runJob:async p=>{seen.push(p.book);return seen.length===1?{ok:false,httpStatus:503}:{ok:true};}});
 assert.equal((await tick()).scheduled,1);now+=30000;assert.equal((await tick()).scheduled,8);
 assert.equal((await tick()).scheduled,0);assert.equal(seen.slice(1).includes(id(0)),false);
 now+=30000;assert.equal((await tick()).scheduled,8);assert.ok(seen.includes(id(13)));
});
