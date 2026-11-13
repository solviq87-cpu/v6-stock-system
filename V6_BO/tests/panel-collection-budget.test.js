'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createPanelRefreshPolicy,INTERVALS}=require('../src/core/panel-refresh-policy');
const {createFixture}=require('./helpers/v6-studio-fixture');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'server.js'),'utf8');

test('panel recollection reserves one process-wide start per module and retains a conservative rollback interval',()=>{
 let at=Date.parse('2026-11-13T10:00:00+08:00');
 const policy=createPanelRefreshPolicy({now:()=>at});
 assert.equal(policy.admit('global').allowed,true);
 for(let i=0;i<200;i++)assert.equal(policy.admit('global').allowed,false);
 assert.equal(policy.admit('news').allowed,true,'separate permitted module retains its own interval');
 at+=INTERVALS.global-1;assert.equal(policy.admit('global').retryAfterMs,1);
 at++;assert.equal(policy.admit('global').allowed,true);
 at-=1000;assert.equal(policy.admit('global').retryAfterMs,INTERVALS.global);
 assert.equal(policy.admit('paper').allowed,true,'explicit account actions keep the prior authorization path');
});

test('two real desktop startup blocks read cloud state without triggering supplier recollection',()=>{
 const app=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
 const start=app.indexOf('initHdrTools();\ninitPanelCollapse();'),end=app.indexOf('\nfunction renderPaper(',start);
 assert.ok(start>0&&end>start);
 let reads=0,posts=0;
 for(let device=0;device<2;device++)vm.runInNewContext(app.slice(start,end),{
  initHdrTools(){},initPanelCollapse(){},connectStream(){},refresh(){reads++;},loadReleaseBoard(){},
  setInterval(){return 1;},fetch(_url,opts){if(opts?.method==='POST')posts++;return Promise.resolve({});}
 });
 assert.equal(reads,2);assert.equal(posts,0);
});

test('display-only external linkage suppresses an otherwise eligible notification without consuming its send marker',async()=>{
 const start=source.indexOf('async function refreshExtLink('),end=source.indexOf('\nasync function refreshGlobalForDisplay(',start);
 assert.ok(start>0&&end>start);
 let sends=0;
 const c=vm.createContext({Date,Map,Set,console,EXT_PUSH_GAP:7200000,
  EXT_MAP:[{name:'fixture',exts:['usIXIC'],keys:['fixture-sector']}],
  S:{global:[{code:'usIXIC',name:'fixture-index',pct:2}],extCache:{at:Date.now(),
   sectors:[{name:'fixture-sector',node:'fixture-node',pct:2}],stocks:new Map([['fixture-node',[{code:'600000',name:'fixture',pct:2,price:10,turnover:3}]]])}},
  em:{fetchExtQuotes:async()=>[]},A:{isJunkName:()=>false},capTooSmall:()=>false,
  reviewSnapshotFields:row=>row,reviewedRows:rows=>rows,isTradingTime:()=>true,
  sign:value=>value>0?'+':'',recommendationSendOptions:()=>({}),pushAll:()=>{sends++;}});
 vm.runInContext(source.slice(start,end),c);
 await c.refreshExtLink({notify:false});assert.equal(sends,0);assert.equal(c.S.extPushed,undefined);
 await c.refreshExtLink();assert.equal(sends,1);assert.ok(c.S.extPushed.has('fixture'));
});

test('real HTTP refresh aliases and two clients share cached recollection without invoking the trading hook',async t=>{
 const anchor='let _quantPicksCache = { ts: 0, data: null, busy: false };';
 assert.ok(source.includes(anchor));
 const inject=`
 let panelFixtureCalls=0;
 em.fetchGlobal=async()=>{panelFixtureCalls++;fs.writeFileSync(path.join(__dirname,'panel-fixture-call-count.txt'),String(panelFixtureCalls));await new Promise(r=>setTimeout(r,30));return [{code:'fixture-global',name:'calls-'+panelFixtureCalls,pct:0}];};
 em.fetchExtQuotes=async()=>[];
 S.extCache={at:Date.now(),sectors:[],stocks:new Map()};
 computePreselect=()=>({items:[]});
 globalThis.__refreshGlobal=async()=>{throw Error('panel must not invoke the scheduled trading path');};
 `;
 const fixture=await createFixture({count:1,serverSource:source.replace(anchor,inject+'\n'+anchor)});
 t.after(()=>fixture.close());
 const [one,two]=await Promise.all([
  fixture.request('/api/refresh','POST',{module:'global'}),
  fixture.request('/api/refresh','POST',{module:'ext'})]);
 assert.equal(one.body.ok,true);assert.equal(two.body.ok,true);
 assert.equal(one.body.errors.length,0);assert.equal(two.body.errors.length,0);
 assert.equal(one.body.skipped.length+two.body.skipped.length,1,'concurrent aliases share the global task lock');
 const third=await fixture.request('/api/refresh','POST',{module:'ext'});
 assert.equal(third.body.ok,true);assert.equal(third.body.cached[0].module,'global');
 assert.ok(third.body.cached[0].retryAfterMs>0);assert.match(third.body.note,/复用云端缓存/);
 assert.equal(fs.readFileSync(path.join(fixture.tmp,'panel-fixture-call-count.txt'),'utf8'),'1');
 assert.ok(!fixture.logs().includes('panel must not invoke'),'scheduled trading hook was not called');
});
