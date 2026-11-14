'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const scripts={factor:fs.readFileSync(path.join(__dirname,'../public/assets/factor-agent-workbench.js'),'utf8'),adaptive:fs.readFileSync(path.join(__dirname,'../public/assets/adaptive-workbench.js'),'utf8')};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(kind){
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.handlers={};this.style={};this.files=[];this._value='';this.ownText='';this.disabled=false;}
  addEventListener(type,fn,options){super.addEventListener(type,fn,options);this.handlers[type]=fn;}
  append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];this.ownText='';}
  set value(x){this._value=x;if(x==='')this.files=[];}get value(){return this._value;}
  set textContent(x){this.ownText=x;this.children=[];}get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const doc=new EventTarget();doc.hidden=false;doc.getElementById=get;doc.createElement=()=>new Element();doc.createTextNode=text=>{const n=new Element();n.textContent=text;return n;};
 const root=new EventTarget();root.document=doc;root.navigator={onLine:true};const calls=[],timers=new Map();let timerId=0;
 root.fetch=(url,options)=>{const d=deferred();calls.push({url,options,...d});return d.promise;};root.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};root.clearTimeout=id=>timers.delete(id);
 get('token').value='credential';vm.runInNewContext(scripts[kind],{window:root,AbortController});
 const ids=kind==='factor'?{read:'factorAgentRefresh',run:'publicFactorRun',file:'publicFactorFile',output:'factorAgentOutput',result:'publicFactorOutput',status:'factorAgentStatus',runStatus:'publicFactorStatus'}:{read:'adaptiveLatest',run:'adaptiveRun',file:'adaptiveFile',output:'adaptiveOutput',result:'adaptiveOutput',status:'adaptiveLatestStatus',runStatus:'adaptiveStatus'};
 const click=which=>get(ids[which]).handlers.click(),file=(text=Promise.resolve('{}'))=>{get(ids.file).value='selected';get(ids.file).files=[{size:20,text:()=>text}];};
 const reply=(i,value)=>calls[i].resolve({ok:true,status:200,json:async()=>value});
 return {root,doc,get,calls,timers,ids,click,file,reply};
}
const agent=(marker='current')=>({ok:true,agent:{status:'reflection',nextAction:'await-next-source-or-research-lineage',version:marker,modelName:'Qwen3 local',modelDigest:'0123456789abcdef1234',hypothesis:'PRIVATE HYPOTHESIS'},catalog:[{label:'公开因子',source:'https://example.com',formula:'x'}]});
const result=marker=>({market:{regime:'mixed'},latest:{version:marker,ranking:[{eligible:true}]},simulation:{metrics:{returnPct:1}},indexModels:{shanghai:{latest:{upProbability:.6}}}});
const report=marker=>({ok:true,status:'verified',result:result(marker),revision:2,asOf:'2026-11-13',stale:false,ageDays:1,sourceStatus:'configured'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('both panels stay inert and preserve explicit endpoints, headers and original render information',async()=>{
 for(const kind of ['factor','adaptive']){const f=fixture(kind);assert.equal(f.calls.length,0);let p=f.click('read');assert.equal(f.calls[0].url,kind==='factor'?'/api/research/agent-status':'/api/research/adaptive-latest');assert.equal(f.calls[0].options.headers.Authorization,'Bearer credential');assert.equal(f.calls[0].options.cache,'no-store');f.reply(0,kind==='factor'?agent():report('version-current'));await p;
  if(kind==='factor'){assert.match(f.get(f.ids.status).textContent,/建议模型：Qwen3 local \/ 摘要 0123456789abcdef/);assert.match(f.get(f.ids.output).textContent,/"version": "current"/);assert.doesNotMatch(f.get(f.ids.output).textContent,/PRIVATE HYPOTHESIS/);assert.equal(f.get('factorAgentCatalog').children.length,1);}else{assert.match(f.get(f.ids.status).textContent,/第2版/);assert.equal(f.get('adaptiveSummary').children.length,8);assert.match(f.get('adaptiveSummary').textContent,/60.0%/);}
  f.file();p=f.click('run');await tick();assert.equal(f.calls[1].url,kind==='factor'?'/api/research/public-factors':'/api/research/adaptive-market');assert.equal(f.calls[1].options.method,'POST');assert.deepEqual(JSON.parse(f.calls[1].options.body),{});f.reply(1,{ok:true,result:kind==='factor'?{value:1}:result('manual')});await p;assert.match(f.get(f.ids.result).textContent,kind==='factor'?/"value": 1/:/manual/);
 }
});
test('factor credential replacement releases controls immediately and late read/finally cannot overwrite newer POST',async()=>{
 const f=fixture('factor'),old=f.click('read');f.get('token').value='new';f.get('token').dispatchEvent(new Event('input'));assert.equal(f.calls[0].options.signal.aborted,true);f.file();const latest=f.click('run');await tick();await old;assert.equal(f.get(f.ids.run).disabled,true);f.reply(0,agent('OLD'));await tick();assert.equal(f.get(f.ids.output).textContent,'');assert.equal(f.get(f.ids.run).disabled,true);f.reply(1,{ok:true,result:{marker:'NEW'}});await latest;assert.match(f.get(f.ids.result).textContent,/NEW/);assert.equal(f.get(f.ids.run).disabled,false);
});
test('factor file read rechecks identity and file snapshot before POST; model fields absent stay unrecorded',async()=>{
 for(const action of ['token','file']){const f=fixture('factor'),text=deferred();f.file(text.promise);const p=f.click('run');if(action==='token'){f.get('token').value='new';f.get('token').dispatchEvent(new Event('change'));}else f.file(Promise.resolve('{}'));text.resolve('{}');await p;assert.equal(f.calls.length,0);assert.equal(f.get(f.ids.run).disabled,false);}
 const f=fixture('factor'),p=f.click('read');f.reply(0,{ok:true,agent:{status:'idle'},catalog:[]});await p;assert.match(f.get(f.ids.status).textContent,/建议模型：未记录 \/ 摘要 未记录/);
});
test('factor timeouts bound stalled fetch and file parsing; late replies cannot repopulate results',async()=>{
 for(const kind of ['read','run']){const f=fixture('factor');if(kind==='run')f.file(deferred().promise);const p=f.click(kind),timer=[...f.timers.values()][0];assert.equal(timer.ms,kind==='run'?60000:15000);timer.fn();await p;assert.match(f.get(kind==='run'?f.ids.runStatus:f.ids.status).textContent,/超时/);assert.equal(f.get(f.ids.run).disabled,false);if(kind==='read'){f.reply(0,agent('LATE'));await tick();assert.equal(f.get(f.ids.output).textContent,'');}assert.equal(f.timers.size,0);}
});
test('adaptive credential clear releases old busy and old finally cannot unlock a new research request',async()=>{
 const f=fixture('adaptive'),old=f.click('read');f.get('token').value='new';f.get('token').dispatchEvent(new Event('input'));assert.equal(f.get(f.ids.run).disabled,false);f.file();const latest=f.click('run');await tick();await old;assert.equal(f.get(f.ids.run).disabled,true);f.reply(0,report('OLD'));await tick();assert.equal(f.get(f.ids.output).textContent,'');assert.equal(f.get(f.ids.run).disabled,true);f.reply(1,{ok:true,result:result('NEW')});await latest;assert.match(f.get(f.ids.output).textContent,/NEW/);
});
test('both panels clear private output and file inputs on hidden, offline and pagehide; file waits never POST after deactivation',async()=>{
 for(const kind of ['factor','adaptive'])for(const event of ['hidden','offline','pagehide']){const f=fixture(kind),p=f.click('read');f.reply(0,kind==='factor'?agent():report('private'));await p;f.file(deferred().promise);const pending=f.click('run');if(event==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}else{if(event==='offline')f.root.navigator.onLine=false;f.root.dispatchEvent(new Event(event));}await pending;assert.equal(f.get(f.ids.output).textContent,'');assert.equal(f.get(f.ids.result).textContent,'');assert.equal(f.get(f.ids.file).value,'');assert.equal(f.get(f.ids.run).disabled,false);assert.equal(f.calls.length,1);}
});
test('both panels clear on 401/403 without parsing error HTML and on locked/password replies',async()=>{
 for(const kind of ['factor','adaptive'])for(const denial of [401,403,'locked','needPassword']){const f=fixture(kind);f.file();const p=f.click('run');await tick();if(typeof denial==='number')f.calls[0].resolve({ok:false,status:denial,json:async()=>{throw Error('HTML');}});else f.reply(0,{ok:false,[denial]:true});await p;assert.equal(f.get(f.ids.output).textContent,'');assert.equal(f.get(f.ids.file).value,'');assert.match(f.get(f.ids.runStatus).textContent,/权限已失效/);assert.equal(f.get(f.ids.run).disabled,false);}
});
test('adaptive request timeout also bounds stalled JSON and prevents delayed renderer after timeout',async()=>{
 for(const kind of ['read','run']){const f=fixture('adaptive');if(kind==='run')f.file();const p=f.click(kind);await tick();const body=deferred();f.calls[0].resolve({ok:true,status:200,json:()=>body.promise});await tick();const timer=[...f.timers.values()][0];assert.equal(timer.ms,kind==='run'?60000:15000);timer.fn();await p;assert.match(f.get(f.ids.runStatus).textContent,/超时/);body.resolve(kind==='read'?report('LATE'):{ok:true,result:result('LATE')});await tick();assert.equal(f.get(f.ids.output).textContent,'');assert.equal(f.get('adaptiveSummary').children.length,0);assert.equal(f.get(f.ids.run).disabled,false);assert.equal(f.timers.size,0);}
});
