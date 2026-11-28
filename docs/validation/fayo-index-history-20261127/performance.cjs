'use strict';
// One paired synthetic probe on this host. No forecast value or production latency claim.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {createIndexWindowResearch}=require(path.resolve('src/core/index-window-research'));
const base=fs.mkdtempSync(path.join(os.tmpdir(),'index-history-cost-')),today=Date.parse('2026-11-27T09:30:00+08:00'),dates=[];
for(let t=today-86400000;dates.length<20;t-=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.unshift(t);
const codes=['1.000001','0.399001','0.399006','1.000688'],slots=[...Array.from({length:120},(_,i)=>570+i),...Array.from({length:117},(_,i)=>780+i)];
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');
const q=(a,p)=>[...a].sort((x,y)=>x-y)[Math.ceil(p*a.length)-1];
try{
 function run(enabled){let now=dates[0],sealMs=[];const root=path.join(base,'archive'),r=createIndexWindowResearch({...(enabled?{historyRoot:root,canPersist:()=>true}:{}),clock:()=>now}),hash=crypto.createHash('sha256');
  const rssBefore=process.memoryUsage().rss,cpu=process.cpuUsage(),start=performance.now();let observeMs=0;
  for(const start of dates){for(const slot of slots){now=start+(slot-570)*60000;const day=chinaDay(now),indices=codes.map((code,i)=>({code,price:100+i+(slot-570)/1000,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}));hash.update(JSON.stringify([now,indices]));const t=performance.now();r.observe({day,indices},{day,trading:true},now);observeMs+=performance.now()-t;}
   now=start+331*60000;const day=chinaDay(now),t=performance.now();r.observe({day,indices:[]},{day,trading:false},now);sealMs.push(performance.now()-t);
  }
  const elapsed=performance.now()-start,cost=process.cpuUsage(cpu);return {enabled,inputSha256:hash.digest('hex'),observations:20*237*4,observeMs,sealMs,sealP50Ms:q(sealMs,.5),sealP95Ms:q(sealMs,.95),wallMs:elapsed,cpuUserMs:cost.user/1000,cpuSystemMs:cost.system/1000,rssBefore,rssAfter:process.memoryUsage().rss,root};
 }
 const baseline=run(false),archive=run(true);assert.equal(baseline.inputSha256,archive.inputSha256);
 const files=fs.readdirSync(archive.root).sort().map(d=>path.join(archive.root,d,'000001.json'));assert.equal(files.length,20);
 const bytes=files.reduce((n,f)=>n+fs.statSync(f).size,0);let now=today;
 const t=performance.now(),r=createIndexWindowResearch({historyRoot:archive.root,clock:()=>now}),restoreMs=performance.now()-t;assert.equal(r.view(now).priorDaysObserved,20);assert.equal(r.view(now).events.length,0);
 for(let m=0;m<6;m++){now=today+m*60000;const day=chinaDay(now);r.observe({day,indices:codes.map((code,i)=>({code,price:m===5?110+i:100+i+m/1000,quoteAt:now,receivedAt:now,quoteSource:'sina-index'}))},{day,trading:true},now);}
 assert.equal(r.view(now).events.length,8);
 const clean=x=>{const {root,...rest}=x;return rest;};
 console.log(JSON.stringify({scope:'one paired controlled probe; archive restore uses warm filesystem cache; not production performance',host:{node:process.version,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,platform:process.platform,arch:process.arch},sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve('src/core/index-window-research.js'))).digest('hex'),baseline:clean(baseline),archive:clean(archive),endedDayRecords:20,archiveBytes:bytes,restoredDays:20,warmFilesystemRestoreMs:restoreMs,freshEvents:8,financialInputsSynthetic:true,canTrade:false,canNotify:false},null,2));
}finally{fs.rmSync(base,{recursive:true,force:true});}
