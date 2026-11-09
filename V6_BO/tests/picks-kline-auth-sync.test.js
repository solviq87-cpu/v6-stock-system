'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const periods=require('../public/assets/picks-periods.js');
const root=path.join(__dirname,'../public/assets');
const detailCode=fs.readFileSync(path.join(root,'picks-three-k.js'),'utf8');
const listCode=fs.readFileSync(path.join(root,'picks-page.js'),'utf8');

class El{
 constructor(tag='div'){
  this.tag=tag;this.textContent='';this.children=[];this.className='';
  this.listeners={};this.value='';this.disabled=false;this.dataset={};
  this.classList={toggle(){}};
 }
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(key,value){this[key]=String(value);}
 scrollIntoView(){}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const bars=[
 {date:'2026-11-05',open:10,high:11,low:9,close:10.5,volume:123},
 {date:'2026-11-06',open:10.5,high:12,low:10,close:11.5,volume:456}
];
function fixture(klineFetch){
 const ids=Object.fromEntries([
  'reload','board','sort','search','candidates','status','cloudSync',
  'total','visible','explained','day','periodStatus','periodChart',
  'pickDetailCode','pickDetailCaption','detailReasons','detailRisk',
  'detailQuote','pickDetail'
 ].map(id=>[id,new El()]));
 ids.board.value='all';ids.sort.value='original';
 const listeners=new Map(),calls=[];
 const buttons=['day','month','year'].map(period=>{
  const b=new El('button');b.dataset.period=period;return b;
 });
 const document={
  hidden:false,
  getElementById:id=>ids[id],
  createElement:tag=>new El(tag),
  createElementNS:(_ns,tag)=>new El(tag),
  createTextNode:text=>({textContent:text}),
  createDocumentFragment:()=>new El('fragment'),
  querySelectorAll:()=>buttons,
  addEventListener(name,fn){
   if(!listeners.has(name))listeners.set(name,[]);
   listeners.get(name).push(fn);
  },
  dispatchEvent(event){
   for(const fn of listeners.get(event.type)||[])fn(event);
   return true;
  }
 };
 const context={
  document,window:{V6PicksPeriods:periods,addEventListener(){},setInterval(){}},
  localStorage:{getItem:()=>''},
  fetch:async(url,options)=>{
   calls.push({url,options});
   if(url.startsWith('/api/quant-picks?'))
    return {ok:true,json:async()=>({snapshotDay:'2026-11-09',items:[
     {code:'000001',name:'候选甲',hit:['真实命中条件甲']},
     {code:'000002',name:'候选乙',hit:['真实命中条件乙']}
    ]})};
   if(url.startsWith('/api/kline?'))return klineFetch(url,options);
   throw Error('unexpected fetch '+url);
  },
  Event:class Event{constructor(type){this.type=type;}},
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}},
  matchMedia:()=>({matches:false}),URLSearchParams,AbortController,Date,
  Number,String,Array,RegExp,Error,Object,Math
 };
 // Same order as real picks.html; both controllers use the same DOM event bus.
 vm.runInNewContext(detailCode,context);
 vm.runInNewContext(listCode,context);
 const findButtons=(el,out=[])=>{
  if(el?.tag==='button'&&el.className==='pick-open')out.push(el);
  for(const child of el?.children||[])findButtons(child,out);
  return out;
 };
 return {ids,calls,buttons,findButtons:()=>findButtons(ids.candidates)};
}
for(const status of [401,403,'locked']){
 test('K-line '+status+' permission revocation clears both stock list and detail',async()=>{
  const fx=fixture(async()=>{
   if(status==='locked')return {ok:true,status:200,json:async()=>({ok:true,locked:true,rows:[]})};
   return {ok:false,status,json:async()=>({})};
  });
  await flush();
  assert.equal(fx.ids.total.textContent,2);
  assert.equal(fx.findButtons().length,2);
  fx.findButtons()[0].listeners.click();
  await flush();
  assert.equal(fx.ids.total.textContent,'—','no stale candidate survives K-line authorization loss');
  assert.equal(fx.ids.day.textContent,'未知');
  assert.equal(fx.ids.pickDetailCode.textContent,'尚未选择');
  assert.equal(fx.ids.periodChart.children[0].textContent,'没有已选择的股票');
  assert.match(fx.ids.cloudSync.textContent,/已清空/);
  assert.match(fx.ids.status.textContent,/权限已失效/);
  assert.equal(fx.ids.reload.disabled,false);
  assert.equal(fx.calls.length,2,'reading a stock does not rescan the selection engine');
  assert.ok(fx.calls.every(x=>x.options.method==='GET'));
  assert.ok(fx.calls.every(x=>!x.url.includes('force=1')));
 });
}
test('late unauthorized reply for a previously deselected stock cannot revoke a new selection',async()=>{
 let resolveOld;
 const fx=fixture((url)=>{
  if(url.includes('code=000001'))
   return new Promise(resolve=>{resolveOld=resolve;});
  return Promise.resolve({ok:true,status:200,json:async()=>({
   ok:true,code:'000002',rows:bars,hasMore:false
  })});
 });
 await flush();
 const [first,second]=fx.findButtons();
 first.listeners.click();
 second.listeners.click();
 await flush();
 assert.equal(fx.ids.pickDetailCode.textContent,'000002');
 resolveOld({ok:false,status:401});
 await flush();
 assert.equal(fx.ids.total.textContent,2);
 assert.equal(fx.ids.pickDetailCode.textContent,'000002');
 assert.ok(fx.ids.periodChart.children.some(x=>x.tag==='svg'));
});
