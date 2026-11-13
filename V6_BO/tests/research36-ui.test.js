'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const engine=require('../src/strategy/research36');
const source=fs.readFileSync(require.resolve('../public/assets/research36-workbench.js'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.value='';this.files=[];this.disabled=false;this.ownText='';}
 set textContent(v){this.ownText=String(v);this.children=[];}get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
 set innerHTML(_){throw Error('unsafe HTML');}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.ownText='';}
 setAttribute(k,v){this[k]=v;}addEventListener(k,f){(this.listeners[k]||=[]).push(f);}fire(k){return Promise.all((this.listeners[k]||[]).map(f=>f()));}
}
function setup(){
 const ids=['research36Catalog','research36Run','token','research36File','research36Status','research36Config','research36Result'];
 const nodes=new Map(ids.map(id=>[id,new Element()])),events={},calls=[];
 const document={hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener:(k,f)=>events[k]=f};
 const root={document,Date,addEventListener:(k,f)=>events[k]=f,fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))};
 vm.runInNewContext(source,root);return {nodes,calls,events,document};
}
const reply=value=>({ok:true,json:async()=>value});
const flush=()=>new Promise(r=>setImmediate(r));
test('research36 UI makes no automatic requests and config is research-only; catalog strings use safe text',async()=>{
 const x=setup();assert.equal(x.calls.length,0);x.nodes.get('token').value='fixture';
 const pending=x.nodes.get('research36Catalog').fire('click');const catalog=engine.getCatalog();catalog.strategies[0].name='<img src=x onerror=bad()>';
 assert.equal(x.calls[0].options.headers.Authorization,'Bearer fixture');assert.equal(x.calls[0].options.cache,'no-store');x.calls[0].resolve(reply({ok:true,catalog}));await pending;
 assert.equal(x.nodes.get('research36Config').children.length,36);assert.match(x.nodes.get('research36Config').textContent,/<img src=x onerror/);
});
test('uploaded stock evidence is sent only on explicit click and missing evidence stays unknown',async()=>{
 const x=setup(),input={stock:{code:'600000'},asOf:Date.now()};x.nodes.get('research36File').files=[{size:100,text:async()=>JSON.stringify(input)}];
 const pending=x.nodes.get('research36Run').fire('click');await flush();assert.equal(x.calls.length,1);assert.equal(x.calls[0].options.method,'POST');
 const payload=JSON.parse(x.calls[0].options.body);assert.equal(payload.stock.code,'600000');
 x.calls[0].resolve(reply({ok:true,result:engine.evaluateResearch36(payload)}));await pending;
 assert.equal(x.nodes.get('research36Result').children.length,36);assert.match(x.nodes.get('research36Result').textContent,/等待数据/);assert.match(x.nodes.get('research36Result').textContent,/条件分：未知/);
 x.events.offline();assert.equal(x.nodes.get('research36Result').textContent,'');
});
test('file changes, token changes and pagehide suppress late results',async()=>{
 for(const action of ['file','token','pagehide']){
  const x=setup(),input={stock:{code:'600000'},asOf:Date.now()};x.nodes.get('research36File').files=[{size:100,text:async()=>JSON.stringify(input)}];
  const pending=x.nodes.get('research36Run').fire('click');await flush();
  if(action==='file')await x.nodes.get('research36File').fire('change');else if(action==='token'){x.nodes.get('token').value='changed';await x.nodes.get('token').fire('input');}else x.events.pagehide();
  x.calls[0].resolve(reply({ok:true,result:engine.evaluateResearch36(input)}));await pending;assert.equal(x.nodes.get('research36Result').children.length,0);
 }
});
test('oversize imports never reach the API',async()=>{
 const x=setup();x.nodes.get('research36File').files=[{size:256*1024+1,text:async()=>{throw Error('must not read');}}];
 await x.nodes.get('research36Run').fire('click');assert.equal(x.calls.length,0);assert.match(x.nodes.get('research36Status').textContent,/未完成/);
});
