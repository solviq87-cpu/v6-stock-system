'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/assets/linked-intelligence-workbench.js'),'utf8');
class Element{
 constructor(){this.value='';this.files=[];this.checked=false;this.disabled=false;this.children=[];this.content='';this.events={};}
 set textContent(v){this.content=String(v);this.children=[];}get textContent(){return this.content+this.children.map(x=>x.textContent).join(' ');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.content='';this.children=nodes;}
 addEventListener(k,fn){(this.events[k]||=[]).push(fn);}fire(k){return Promise.all((this.events[k]||[]).map(fn=>fn()));}click(){return this.fire('click');}
}
function fixture(){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const doc=new Element();doc.getElementById=get;doc.createElement=()=>new Element();doc.hidden=false;
 const root=new Element(),calls=[];root.document=doc;get('token').value='synthetic-context-token';
 const fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 vm.runInNewContext(source,{document:doc,fetch,AbortController,setTimeout,clearTimeout,Blob,URL,addEventListener:root.addEventListener.bind(root)});
 const reply=(i,result,status=200,extra={})=>calls[i].resolve({ok:status<400,status,json:async()=>({ok:status<400,result,...extra})});
 return{get,doc,root,calls,reply};
}
const memory=symbol=>({symbol,totalRevisions:1,revisions:[],forwardValidation:{}});
const payload={schemaVersion:1,asOf:1794480000000,tradeDates:[],stocks:[]};
const uploaded=()=>({size:100,text:async()=>JSON.stringify(payload)});
test('memory stock changes abort old reads and a late old reply cannot clear or unlock a newer read',async()=>{
 const f=fixture();f.get('linkedMemorySymbol').value='600000';const old=f.get('linkedMemoryRead').click();
 f.get('linkedMemorySymbol').value='600001';await f.get('linkedMemorySymbol').fire('input');
 assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.get('linkedMemoryRead').disabled,false);
 const latest=f.get('linkedMemoryRead').click();assert.equal(f.calls.length,2);
 f.reply(0,memory('600000'));await old;assert.equal(f.get('linkedMemorySummary').textContent,'');assert.equal(f.get('linkedMemoryRead').disabled,true);
 f.reply(1,memory('600001'));await latest;assert.match(f.get('linkedMemorySummary').textContent,/600001/);assert.equal(f.get('linkedMemoryRead').disabled,false);
});
test('public input invalidation removes old context instead of attaching it to a later uploaded study',async()=>{
 const f=fixture();f.get('linkedPublicSymbol').value='600000';const old=f.get('linkedPublicRun').click();
 f.get('linkedPublicSymbol').value='600001';await f.get('linkedPublicSymbol').fire('input');f.reply(0,{stockFlow:{symbol:'600000',mainNetInflow:123}});await old;
 assert.equal(f.get('linkedPublicSummary').textContent,'');assert.equal(f.get('linkedPublicOutput').textContent,'');
 f.get('linkedIntelligenceFile').files=[uploaded()];const analysis=f.get('linkedIntelligenceRun').click();await new Promise(r=>setImmediate(r));
 assert.equal(f.calls.length,2);assert.equal(Object.hasOwn(JSON.parse(f.calls[1].options.body),'publicContext'),false);
 f.reply(1,{stocks:[]});await analysis;
});
test('file selection changes during asynchronous reading prevent posting the prior private file',async()=>{
 const f=fixture();let release;f.get('linkedIntelligenceFile').files=[{size:100,text:()=>new Promise(r=>release=r)}];
 const old=f.get('linkedIntelligenceRun').click();f.get('linkedIntelligenceFile').files=[uploaded()];await f.get('linkedIntelligenceFile').fire('change');
 release(JSON.stringify(payload));await old;assert.equal(f.calls.length,0);assert.equal(f.get('linkedIntelligenceRun').disabled,false);
});
test('public scope changes clear dependent analysis while preserving independent memory results',async()=>{
 const f=fixture();f.get('linkedMemorySymbol').value='600000';const mem=f.get('linkedMemoryRead').click();f.reply(0,memory('600000'));await mem;
 f.get('linkedIntelligenceFile').files=[uploaded()];const analysis=f.get('linkedIntelligenceRun').click();await new Promise(r=>setImmediate(r));
 f.get('linkedPublicDate').value='2026-11-13';await f.get('linkedPublicDate').fire('input');
 assert.equal(f.calls[1].options.signal.aborted,true);assert.match(f.get('linkedMemorySummary').textContent,/600000/);
 f.reply(1,{stocks:[{symbol:'600999',name:'STALE_PRIVATE_STUDY'}]});await analysis;assert.equal(f.get('linkedStockSummary').textContent,'');
});
test('accepting new public evidence invalidates an analysis begun while that evidence was still pending',async()=>{
 const f=fixture();f.get('linkedPublicSymbol').value='600000';const publicRead=f.get('linkedPublicRun').click();
 f.get('linkedIntelligenceFile').files=[uploaded()];const analysis=f.get('linkedIntelligenceRun').click();await new Promise(r=>setImmediate(r));
 assert.equal(Object.hasOwn(JSON.parse(f.calls[1].options.body),'publicContext'),false);
 f.reply(0,{stockFlow:{symbol:'600000',mainNetInflow:12}});await publicRead;
 const wasAborted=f.calls[1].options.signal.aborted;
 f.reply(1,{stocks:[{symbol:'600000',name:'ANALYSIS_WITHOUT_NEW_CONTEXT'}]});await analysis;
 assert.equal(wasAborted,true);
 assert.equal(f.get('linkedStockSummary').textContent,'');assert.match(f.get('linkedPublicSummary').textContent,/600000/);
});
test('credential and lifecycle changes clear all private results and block late restoration',async()=>{
 for(const event of ['token','offline','pagehide','hidden']){
  const f=fixture();f.get('linkedMemorySymbol').value='600000';const first=f.get('linkedMemoryRead').click();f.reply(0,memory('600000'));await first;
  const old=f.get('linkedMemoryRead').click();
  if(event==='token'){f.get('token').value='changed-fixture-token';await f.get('token').fire('input');}
  else if(event==='hidden'){f.doc.hidden=true;await f.doc.fire('visibilitychange');}else await f.root.fire(event);
  assert.equal(f.get('linkedMemorySummary').textContent,'',event);assert.equal(f.calls[1].options.signal.aborted,true,event);
  f.reply(1,memory('600000'));await old;assert.equal(f.get('linkedMemorySummary').textContent,'',event);
 }
});
test('authorization refusal in any lane clears previously displayed private results in the other lanes',async()=>{
 const f=fixture();f.get('linkedMemorySymbol').value='600000';const mem=f.get('linkedMemoryRead').click();f.reply(0,memory('600000'));await mem;
 const refused=f.get('linkedPublicRun').click();f.reply(1,{},403);await refused;
 assert.equal(f.get('linkedMemorySummary').textContent,'');assert.equal(f.get('linkedMemoryOutput').textContent,'');
 assert.equal(f.get('linkedPublicRun').disabled,false);
});
