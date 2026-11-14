'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/assets/app.js'),'utf8');
function harness(){
 const connections=[],timers=new Map(),events=new Map();let nextId=1,refreshes=0;
 const status={textContent:'',className:''};
 class EventSource{
  constructor(url){this.url=url;this.handlers=new Map();connections.push(this);}
  addEventListener(name,fn){this.handlers.set(name,fn);}
  close(){this.closed=true;}
 }
 const c={EventSource,GATE:{token:'fixture'},LOCK:{},MY_DID:'test-device',deviceName:()=> 'fixture',encodeURIComponent,
  localStorage:{getItem:()=>null},document:{hidden:false,getElementById:()=>status},
  window:{addEventListener:(name,fn)=>events.set(name,fn)},refresh:()=>{refreshes++;},
  setTimeout:fn=>{const id=nextId++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 const start=source.indexOf('let _es = null'),end=source.indexOf('// ── 各票池',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),c);
 return {c,connections,timers,status,events,refreshes:()=>refreshes};
}
test('successful stream reconnection refreshes the shared state missed while disconnected',()=>{
 const h=harness();h.c.connectStream();h.connections[0].onopen();
 assert.equal(h.refreshes(),1);h.connections[0].onerror();
 const retry=[...h.timers.values()][0];retry();h.connections[1].onopen();
 assert.equal(h.refreshes(),2);assert.match(h.status.textContent,/正常/);
});
test('obsolete stream errors and opens cannot disturb a replacement connection',()=>{
 const h=harness();h.c.connectStream();const old=h.connections[0];h.c.connectStream();
 const current=h.connections[1];current.onopen();old.onerror();old.onopen();
 assert.equal(h.timers.size,0);assert.equal(h.refreshes(),1);assert.match(h.status.textContent,/正常/);
 assert.equal(current.closed,undefined);
});
test('explicit reconnect cancels retry and a queued obsolete timer cannot replace the new stream',()=>{
 const h=harness();h.c.connectStream();h.connections[0].onerror();
 const obsolete=[...h.timers.values()][0];h.c.connectStream();
 assert.equal(h.timers.size,0);obsolete();assert.equal(h.connections.length,2);
});
test('repeated errors schedule exactly one retry and online resumes once',()=>{
 const h=harness();h.c.connectStream();h.connections[0].onerror();h.connections[0].onerror();
 assert.equal(h.timers.size,1);assert.equal(typeof h.events.get('online'),'function');
 h.events.get('online')();h.events.get('online')();
 assert.equal(h.connections.length,2);assert.equal(h.timers.size,0);
});
test('hidden page defers refresh until its existing foreground lifecycle resumes',()=>{
 const h=harness();h.c.document.hidden=true;h.c.connectStream();h.connections[0].onopen();
 assert.equal(h.refreshes(),0);
});
