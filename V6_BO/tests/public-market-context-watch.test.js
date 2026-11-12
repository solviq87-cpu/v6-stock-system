'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createPublicContextWatcher,parseArgs}=require('../scripts/watch-public-market-context');
async function temp(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-context-watch-'));try{return await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
const complete=()=>({file:'/private/context.json',hash:'a'.repeat(64),report:{requestedDate:'2026-11-13',tradeDate:'2026-11-12',marketFlow:{status:'observed-unverified'},stockFlow:{status:'observed-unverified'},sectorFlow:{status:'observed-unverified'},limitPools:{complete:true},errors:[],canTrade:false}});
function scheduler(){let timer=null,cleared=0;return {setTimer:(fn,ms)=>{timer={fn,ms};return timer;},clearTimer:()=>{cleared++;timer=null;},current:()=>timer,cleared:()=>cleared,fire:async()=>{const t=timer;timer=null;t.fn();await new Promise(resolve=>setImmediate(resolve));}};}
test('once archives through the same bounded capture API and writes private JSON status without a timer',async()=>temp(async root=>{
 const calls=[],statuses=[],s=scheduler(),watch=createPublicContextWatcher({outputDir:root,symbol:'920001',sectorCode:'BK1034',capture:async(...args)=>{calls.push(args);return complete();},onStatus:x=>statuses.push(x),now:()=>123456789,...s});
 const result=await watch.runOnce();assert.equal(result.status,'complete');assert.equal(calls.length,1);assert.deepEqual(calls[0][1],{historyDays:120,symbol:'920001',sectorCode:'BK1034'});assert.equal(s.current(),null);assert.equal(result.tradeDate,'2026-11-12');assert.equal(result.modelsChanged,false);assert.equal(result.ordersChanged,false);assert.equal(result.sourceTimestamp,null);
 const log=path.join(root,'public-context-watch.jsonl');assert.equal(fs.statSync(log).mode&0o777,0o600);assert.deepEqual(JSON.parse(fs.readFileSync(log,'utf8').trim()),statuses[0]);
}));
test('watch uses serial timeouts, waits for active capture on stop and never overlaps calls',async()=>temp(async root=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),s=scheduler(),watch=createPublicContextWatcher({outputDir:root,intervalMs:60000,capture:async()=>{calls++;await gate;return complete();},onStatus:()=>{},...s});
 const start=watch.start();assert.equal(calls,1);assert.equal(s.current(),null);await assert.rejects(()=>watch.runOnce(),/禁止重叠/);
 let stopped=false;const stop=watch.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);release();await Promise.all([start,stop]);assert.equal(s.current(),null);assert.equal(watch.status().running,false);assert.equal(calls,1);
}));
test('complete runs schedule default fifteen minutes and stop clears the pending timer',async()=>temp(async root=>{
 const s=scheduler(),watch=createPublicContextWatcher({outputDir:root,capture:async()=>complete(),onStatus:()=>{},...s});await watch.start();assert.equal(s.current().ms,900000);await s.fire();assert.equal(watch.status().attempts,2);assert.equal(s.current().ms,900000);await watch.stop();assert.equal(s.current(),null);assert.equal(s.cleared(),1);
}));
test('failed and incomplete captures log explicit backoff then halt at the finite failure bound',async()=>temp(async root=>{
 const s=scheduler(),records=[];let calls=0;const watch=createPublicContextWatcher({outputDir:root,intervalMs:60000,maxConsecutiveFailures:3,capture:async()=>{calls++;if(calls===1)throw Error('HTTP 503');const result=complete();result.report.limitPools.complete=false;result.report.errors=[{source:'sealed',message:'incomplete page'}];return result;},onStatus:r=>records.push(r),...s});
 await watch.start();assert.equal(records[0].status,'failed');assert.match(records[0].error,/503/);assert.equal(s.current().ms,120000);await s.fire();assert.equal(records[1].status,'partial');assert.deepEqual(records[1].missing,['limitPools']);assert.equal(s.current().ms,240000);await s.fire();assert.equal(watch.status().halted,true);assert.equal(watch.status().running,false);assert.equal(s.current(),null);assert.equal(calls,3);await assert.rejects(()=>watch.runOnce(),/已达上限/);
 const lines=fs.readFileSync(path.join(root,'public-context-watch.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(lines.length,3);assert.equal(lines.at(-1).halted,true);
}));
test('recovery resets backoff; backoff never exceeds one day',async()=>temp(async root=>{
 const s=scheduler();let calls=0;const watch=createPublicContextWatcher({outputDir:root,intervalMs:86400000,capture:async()=>{if(calls++===0)throw Error('503');return complete();},onStatus:()=>{},...s});await watch.start();assert.equal(s.current().ms,86400000);await s.fire();assert.equal(watch.status().consecutiveFailures,0);assert.equal(s.current().ms,86400000);await watch.stop();
}));
test('explicit private output, bounded intervals and source identities are enforced before capture',async()=>temp(async root=>{
 for(const config of [{},{outputDir:root,intervalMs:59999},{outputDir:root,intervalMs:86400001},{outputDir:root,symbol:'900001'},{outputDir:root,sectorCode:'https://evil'},{outputDir:root,maxConsecutiveFailures:100},{outputDir:path.join(root,'public')}])assert.throws(()=>createPublicContextWatcher({...config,onStatus:()=>{}}));
 const alias=path.join(root,'alias');fs.symlinkSync(root,alias);assert.throws(()=>createPublicContextWatcher({outputDir:alias}),/符号/);
 assert.deepEqual(parseArgs(['watch','--output-dir',root,'--interval-seconds','60','--max-failures','3']).config,{outputDir:root,intervalMs:60000,maxConsecutiveFailures:3});assert.throws(()=>parseArgs(['watch','--url','https://evil']));
 const badLog=path.join(root,'public-context-watch.jsonl'),other=path.join(root,'other');fs.writeFileSync(other,'');fs.symlinkSync(other,badLog);const watch=createPublicContextWatcher({outputDir:root,capture:async()=>complete(),onStatus:()=>{}});await assert.rejects(()=>watch.runOnce());assert.equal(watch.status().halted,true);
}));
