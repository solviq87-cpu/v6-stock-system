'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=import('../public/nova/risk-workbench-read-scope.mjs');
const at=Date.parse('2026-11-27T10:00:00+08:00');
const report=(extra={})=>({protocol:'fayo-risk-workbench-v1',account:{id:'pool'},generatedAt:at,risks:[],summary:{},...extra});
const input=(report,startedAt,receivedAt)=>({report,accountId:report.account.id,selectedCode:report.selectedCode??null,startedAt,receivedAt});
async function worker(){
 const listeners={},installed=new Set(),reads=[],writes=[];
 let install,offline=true;
 const origin='https://fayo.invalid',absolute=url=>new URL(url,origin).href;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8'),{
  URL,Response,self:{location:{origin},addEventListener:(name,fn)=>{listeners[name]=fn;},skipWaiting:async()=>{}},
  caches:{open:async()=>({addAll:async urls=>urls.forEach(url=>installed.add(absolute(url))),
   match:async request=>{reads.push(request.url);return installed.has(request.url)?new Response('public shell',{status:200}):null;},
   put:async request=>{writes.push(request.url);}}),keys:async()=>[]},
  fetch:async()=>{if(offline)throw Error('offline');return new Response('network',{status:200});}
 });
 listeners.install({waitUntil:promise=>{install=promise;}});await install;
 const get=async (url,headers)=>{let result;listeners.fetch({request:new Request(absolute(url),{headers}),respondWith:value=>{result=value;}});return await result;};
 return {installed,reads,writes,get,absolute,online:()=>{offline=false;}};
}
test('C16.1 original worker installation includes the new public eager risk dependency',async()=>{
 const w=await worker(),url='/nova/risk-workbench-read-scope.mjs';
 assert.ok(w.installed.has(w.absolute(url)));assert.ok(w.installed.has(w.absolute('/nova/risk-workbench-view.mjs')));
 assert.equal((await w.get(url)).status,200);
 assert.equal([...w.installed].some(u=>new URL(u).pathname.startsWith('/api/')),false);
});
test('C16.1 new public shell dependency never makes private API or authenticated resource cacheable',async()=>{
 const w=await worker();
 for(const [url,headers] of [['/api/risk-workbench?account=pool',{}],['/nova/risk-workbench-read-scope.mjs',{'Authorization':'Bearer isolated-fixture'}],['/nova/risk-workbench-read-scope.mjs?token=fixture',{}]]){
  const response=await w.get(url,headers);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal(w.reads.length,0);assert.equal(w.writes.length,0);
 w.online();assert.equal((await w.get('/api/risk-workbench')).status,200);assert.equal(w.writes.length,0);
});
test('C16.2 a partial document adapter cannot crash the original parent page or enable private risk reads',async()=>{
 const a=await api;
 for(const doc of [null,{}, {createElement(){}}, {visibilityState:'visible',addEventListener(){}}, {visibilityState:'visible',addEventListener(){throw Error('unsupported')},removeEventListener(){}}]){
  let count=0;const watch=a.watchRiskVisibility(doc,{onHidden:()=>count++,onVisible:()=>count++});
  assert.equal(watch.visible(),false);watch.dispose();watch.dispose();assert.equal(count,0);
 }
});
test('C16.2 unknown document visibility remains unavailable, real visibility transitions recover',async()=>{
 const a=await api,doc=new EventTarget(),seen=[];doc.visibilityState=undefined;
 const watch=a.watchRiskVisibility(doc,{onVisible:()=>seen.push('visible'),onHidden:()=>seen.push('hidden')});
 assert.equal(watch.visible(),false);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(watch.visible(),true);assert.deepEqual(seen,['visible']);
 doc.visibilityState='prerender';doc.dispatchEvent(new Event('visibilitychange'));
 assert.equal(watch.visible(),false);assert.deepEqual(seen,['visible','hidden']);watch.dispose();
});
test('C16.3 disposed visibility listener cannot revive a route even with a retained callback',async()=>{
 const a=await api,doc={visibilityState:'visible',addEventListener(_name,fn){this.saved=fn;},removeEventListener(){}},seen=[];
 const w=a.watchRiskVisibility(doc,{onVisible:()=>seen.push('visible'),onHidden:()=>seen.push('hidden')});
 assert.equal(w.visible(),true);w.dispose();assert.equal(w.visible(),false);
 doc.visibilityState='hidden';doc.saved();doc.visibilityState='visible';doc.saved();assert.deepEqual(seen,[]);
});
test('C16.4 switching to a narrower same-generation report cannot expand the shortest already-observed quote budget',async()=>{
 const a=await api,t=a.createRiskReceiptTracker(),short=report({risks:[{priceDependent:true,dataState:'valid',riskContract:{dataAt:at-14000}}]});
 assert.equal(t.accept(input(short,100,200)).expiresAt,1100);
 const narrow=report({selectedCode:'600000'});
 assert.equal(t.accept(input(narrow,900,1000)).expiresAt,1100);
 assert.equal(t.accept(input(narrow,1100,1200)),null);
 assert.equal(t.accept(input(report({generatedAt:at+1}),1300,1400)).expiresAt,16300);
});
test('C16.4 a same-generation missing clock cannot be restored by dropping that row',async()=>{
 const a=await api,t=a.createRiskReceiptTracker(),unknown=report({risks:[{priceDependent:true,dataState:'valid',riskContract:{dataAt:null}}]});
 assert.equal(t.accept(input(unknown,100,200)),null);
 assert.equal(t.accept(input(report(),300,400)),null);
 const next=report({generatedAt:at+1});assert.ok(t.accept(input(next,500,600)));
});
