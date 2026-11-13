'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../public/assets/research-risk-center.js'),'utf8');
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.disabled=false;this.ownText='';}
 set textContent(v){this.ownText=String(v);this.children=[];}get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
 set innerHTML(_){throw Error('unsafe innerHTML');}
 appendChild(n){this.children.push(n);return n;}replaceChildren(...n){this.children=n;this.ownText='';}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}fire(type){return Promise.all((this.listeners[type]||[]).map(fn=>fn()));}
}
function setup(){
 const nodes=new Map(['riskCenterRead','riskCenterStatus','riskCenterContent','token'].map(id=>[id,new Element()]));nodes.get('token').value='private-test-token';
 const events={},calls=[],document={hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener:(type,fn)=>{events[type]=fn;}};
 const root={document,URL,Date,addEventListener:(type,fn)=>{events[type]=fn;},fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))};
 vm.runInNewContext(source,root);return {nodes,calls,document,events,click:()=>nodes.get('riskCenterRead').fire('click')};
}
function result(title='PRIVATE_RISK_TITLE'){
 return {mode:'research-risk-center-readonly',generatedAt:Date.parse('2026-11-06T02:00:00Z'),canTrade:false,canNotify:false,
  supports:[],contra:[],missing:[{domain:'strategy-decay',message:'独立样本不足'}],market:{receivedAt:null,quotes:null},
  manualHoldings:{status:'unconfigured'},news:{summary:{totalRevisions:2,currentEvents:2,retractedEvents:0,unknownEvents:0},rows:[
   {kind:'original',title,url:'javascript:alert(1)',source:'source',current:true,publishedAt:null},
   {kind:'revised',title:'可信协议链接',url:'https://example.com/original',source:'source',current:true,publishedAt:null}]},
  researchAgent:{status:'unconfigured'},strategyDecay:{status:'unknown',reason:'样本不足'}};
}
const response=r=>({ok:true,json:async()=>({ok:true,result:r})});
function descend(n){return [n,...n.children.flatMap(descend)];}
test('risk center is opt-in GET with bearer/no-store and renders text and safe links',async()=>{
 const x=setup();assert.equal(x.calls.length,0);const pending=x.click();assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].url,'/api/research/risk-center');assert.equal(x.calls[0].options.method,'GET');
 assert.equal(x.calls[0].options.cache,'no-store');assert.equal(x.calls[0].options.headers.Authorization,'Bearer private-test-token');
 x.calls[0].resolve(response(result('<img src=x onerror=bad()>PRIVATE')));await pending;
 const content=x.nodes.get('riskCenterContent');assert.match(content.textContent,/<img src=x onerror=bad\(\)>PRIVATE/);
 assert.match(content.textContent,/策略衰减：未知/);assert.doesNotMatch(content.textContent,/风险为零|0风险/);
 const links=descend(content).filter(n=>n.tagName==='a');assert.equal(links.length,1);assert.equal(links[0].href,'https://example.com/original');
 assert.equal(links[0].rel,'noopener noreferrer');assert.equal(links[0].target,'_blank');
 const html=fs.readFileSync(path.resolve(__dirname,'../public/research.html'),'utf8');assert.match(html,/id="riskCenterRead"/);assert.match(html,/assets\/research-risk-center\.js/);
});
test('token changes clear private results and prevent an older response from restoring them',async()=>{
 const x=setup(),first=x.click();x.nodes.get('token').value='new-token';await x.nodes.get('token').fire('input');
 assert.equal(x.nodes.get('riskCenterContent').textContent,'');const second=x.click();
 x.calls[0].resolve(response(result('PRIVATE_OLD')));await first;
 assert.equal(x.nodes.get('riskCenterContent').textContent,'');assert.equal(x.nodes.get('riskCenterRead').disabled,true,'old finally cannot release the newer request button');
 x.calls[1].resolve(response(result('PRIVATE_NEW')));await second;
 assert.match(x.nodes.get('riskCenterContent').textContent,/PRIVATE_NEW/);assert.doesNotMatch(x.nodes.get('riskCenterContent').textContent,/PRIVATE_OLD/);
 await x.nodes.get('token').fire('change');assert.equal(x.nodes.get('riskCenterContent').textContent,'');
});
test('page hiding and offline transitions clear private results and invalidate pending responses',async()=>{
 const x=setup(),first=x.click();x.calls[0].resolve(response(result()));await first;
 assert.match(x.nodes.get('riskCenterContent').textContent,/PRIVATE_RISK_TITLE/);
 x.document.hidden=true;x.events.visibilitychange();assert.equal(x.nodes.get('riskCenterContent').textContent,'');
 x.document.hidden=false;const pending=x.click();x.document.hidden=true;x.events.visibilitychange();x.document.hidden=false;
 x.calls[1].resolve(response(result('PRIVATE_LATE')));await pending;assert.equal(x.nodes.get('riskCenterContent').textContent,'');
 x.events.pagehide();assert.equal(x.nodes.get('riskCenterContent').textContent,'');
 const online=x.click();x.calls[2].resolve(response(result('PRIVATE_ONLINE')));await online;
 assert.match(x.nodes.get('riskCenterContent').textContent,/PRIVATE_ONLINE/);
 const offline=x.click();x.events.offline();x.calls[3].resolve(response(result('PRIVATE_OFFLINE_LATE')));await offline;
 assert.equal(x.nodes.get('riskCenterContent').textContent,'');assert.match(x.nodes.get('riskCenterStatus').textContent,/网络离线/);
});
test('failed or malformed reads clear all previous private results and retain unknown risk',async()=>{
 const x=setup(),first=x.click();x.calls[0].resolve(response(result()));await first;
 for(const mode of ['denied','malformed','network']){
  const p=x.click(),call=x.calls.at(-1);assert.equal(x.nodes.get('riskCenterContent').textContent,'');
  if(mode==='network')call.reject(Error('PRIVATE_ERROR_DO_NOT_SHOW'));
  else if(mode==='denied')call.resolve({ok:false,json:async()=>({ok:false,error:'PRIVATE_ERROR_DO_NOT_SHOW'})});
  else call.resolve(response({}));
  await p;assert.equal(x.nodes.get('riskCenterContent').textContent,'');assert.match(x.nodes.get('riskCenterStatus').textContent,/风险未知/);
  assert.doesNotMatch(x.nodes.get('riskCenterStatus').textContent,/PRIVATE_ERROR/);
 }
});
