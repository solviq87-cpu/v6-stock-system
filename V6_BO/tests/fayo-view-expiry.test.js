'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../public/nova/ui.js');
function fixture(){
 let now=1000,id=0;const tasks=new Map(),page=new EventTarget();page.visibilityState='visible';
 return {page,tasks,now:()=>now,setNow:t=>now=t,later(fn,ms){const key=++id;tasks.set(key,{fn,at:now+ms});return key;},cancel:key=>tasks.delete(key),
  advance(ms){const end=now+ms;while(true){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;},
  visible:v=>{page.visibilityState=v?'visible':'hidden';page.dispatchEvent(new Event('visibilitychange'));}};
}
async function create(t,repaint){const {createExpiryRepaint}=await load(),f=fixture(),controller=new AbortController();t.after(()=>controller.abort());return {f,controller,clock:createExpiryRepaint({repaint,signal:controller.signal,page:f.page,now:f.now,setTimeout:f.later,clearTimeout:f.cancel})};}
test('local expiry keeps the inclusive 15-second boundary and uses one deadline without a read',async t=>{
 let paints=0;const {f,clock}=await create(t,()=>paints++);
 clock.watch([1000+15001,1000+17001]);assert.equal(f.tasks.size,1);
 f.advance(15000);assert.equal(paints,0);f.advance(1);assert.equal(paints,1);assert.equal(f.tasks.size,0);
 f.advance(60000);assert.equal(paints,1,'no perpetual refresh loop');
});
test('a hidden view pauses timers and repaints overdue evidence on resume, including offline',async t=>{
 let paints=0;const {f,clock}=await create(t,()=>paints++);clock.watch([16001]);f.visible(false);assert.equal(f.tasks.size,0);
 f.advance(30000);assert.equal(paints,0);f.page.navigator={onLine:false};f.visible(true);assert.equal(paints,1);assert.equal(f.tasks.size,0);
});
test('resuming before expiry preserves the original deadline instead of renewing quote time',async t=>{
 let paints=0;const {f,clock}=await create(t,()=>paints++);clock.watch([16001]);f.visible(false);f.advance(10000);f.visible(true);
 assert.equal([...f.tasks.values()][0].at,16001);f.advance(5001);assert.equal(paints,1);
});
test('a newer observation replaces the pending deadline; closing or aborting cannot resurrect it',async t=>{
 let paints=0;const {f,clock,controller}=await create(t,()=>paints++);clock.watch([16001]);f.advance(3000);clock.watch([19001]);assert.equal(f.tasks.size,1);
 f.advance(12001);assert.equal(paints,0);clock.watch([]);assert.equal(f.tasks.size,0);f.advance(3000);assert.equal(paints,0);
 clock.watch([40000]);controller.abort();clock.watch([50000]);f.visible(false);f.visible(true);f.advance(100000);assert.equal(paints,0);assert.equal(f.tasks.size,0);
});
test('missing, invalid and already historical evidence creates no timer',async t=>{
 let paints=0;const {f,clock}=await create(t,()=>paints++);clock.watch([null,undefined,NaN,Infinity,'2000',1000.1,0,-1,999,1000]);assert.equal(f.tasks.size,0);assert.equal(paints,0);
 clock.stop();clock.stop();clock.watch([3000]);assert.equal(f.tasks.size,0);
});
