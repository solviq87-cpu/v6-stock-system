'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const periods=require('../public/assets/picks-periods.js');
const asset=name=>fs.readFileSync(path.join(__dirname,'../public/assets',name),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

class El{
 constructor(tag='div'){
  this.tag=tag;this.textContent='';this.children=[];this.className='';
  this.listeners={};this.value='';this.disabled=false;this.dataset={};
  this.classList={toggle(){}};
 }
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,listener){this.listeners[name]=listener;}
 setAttribute(name,value){this[name]=String(value);}
 scrollIntoView(){}
}
function allText(el){
 return [String(el?.textContent||''),...(el?.children||[]).flatMap(allText)].join(' ');
}
test('cloud refresh updates existing selected-stock reasons, risk and quote proof without rereading Kline',async()=>{
 const ids=Object.fromEntries([
  'reload','board','sort','search','candidates','status','cloudSync',
  'total','visible','explained','day','periodStatus','periodChart',
  'pickDetailCode','pickDetailCaption','detailReasons','detailRisk',
  'detailQuote','pickDetail'
 ].map(id=>[id,new El()]));
 ids.board.value='all';ids.sort.value='original';
 const listeners=new Map(),calls=[],periodButtons=['day','month','year'].map(period=>{
  const button=new El('button');button.dataset.period=period;return button;
 });
 const dom={
  hidden:false,getElementById:id=>ids[id],
  createElement:tag=>new El(tag),createElementNS:(_ns,tag)=>new El(tag),
  createTextNode:text=>({textContent:text}),
  createDocumentFragment:()=>new El('fragment'),querySelectorAll:()=>periodButtons,
  addEventListener(event,callback){
   if(!listeners.has(event))listeners.set(event,[]);
   listeners.get(event).push(callback);
  },
  dispatchEvent(event){
   for(const callback of listeners.get(event.type)||[])callback(event);
   return true;
  }
 };
 const responses=[
  {items:[{code:'000001',name:'示例股票',hit:['旧条件'],
   riskStatus:'低风险',vendorQuoteAt:1794000000000}]},
  {items:[{code:'000001',name:'示例股票',hit:['新条件'],
   riskStatus:'高风险'}]},
  {items:[{code:'000001',name:'示例股票',hit:[],
   riskStatus:'风险待核对'}]},
  {items:[]}
 ];
 const candles=[
  {date:'2026-11-05',open:10,high:11,low:9,close:10.5,volume:100},
  {date:'2026-11-06',open:10.5,high:12,low:10,close:11.5,volume:200}
 ];
 const context={
  document:dom,window:{V6PicksPeriods:periods,addEventListener(){},setInterval(){}},
  localStorage:{getItem:()=>''},
  fetch:async(url,options)=>{
   calls.push({url,options});
   if(url.startsWith('/api/quant-picks?'))
    return {ok:true,json:async()=>({...responses.shift(),snapshotDay:'2026-11-09'})};
   if(url.startsWith('/api/kline?'))
    return {ok:true,status:200,json:async()=>({ok:true,code:'000001',rows:candles,hasMore:false})};
   throw Error('unexpected network request: '+url);
  },
  Event:class Event{constructor(type){this.type=type;}},
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}},
  URLSearchParams,AbortController,Date,Number,String,Array,RegExp,Error,Object,Math,
  matchMedia:()=>({matches:false})
 };
 vm.runInNewContext(asset('picks-three-k.js'),context);
 vm.runInNewContext(asset('picks-page.js'),context);
 await flush();
 const findButtons=(el,result=[])=>{
  if(el?.tag==='button'&&el.className==='pick-open')result.push(el);
  for(const child of el?.children||[])findButtons(child,result);
  return result;
 };
 assert.equal(ids.total.textContent,1);
 findButtons(ids.candidates)[0].listeners.click();
 await flush();
 assert.match(allText(ids.detailReasons),/旧条件/);
 assert.equal(ids.detailRisk.textContent,'低风险');
 assert.match(ids.detailQuote.textContent,/第三方自报报价时点/);
 assert.ok(ids.periodChart.children.some(x=>x.tag==='svg'));
 const klineCount=()=>calls.filter(x=>x.url.startsWith('/api/kline?')).length;
 assert.equal(klineCount(),1);

 await ids.reload.listeners.click();
 assert.match(allText(ids.detailReasons),/新条件/);
 assert.doesNotMatch(allText(ids.detailReasons),/旧条件/);
 assert.equal(ids.detailRisk.textContent,'高风险');
 assert.match(ids.detailQuote.textContent,/原始报价时点未知/);
 assert.equal(ids.pickDetailCode.textContent,'000001');
 assert.equal(klineCount(),1,'metadata refresh must not refetch or rebuild historical OHLC');
 assert.ok(ids.periodChart.children.some(x=>x.tag==='svg'));

 await ids.reload.listeners.click();
 assert.match(allText(ids.detailReasons),/不能视作已命中/);
 assert.doesNotMatch(allText(ids.detailReasons),/新条件/);
 assert.equal(ids.detailRisk.textContent,'风险待核对');
 assert.equal(klineCount(),1);

 await ids.reload.listeners.click();
 assert.equal(ids.total.textContent,0);
 assert.equal(ids.pickDetailCode.textContent,'尚未选择');
 assert.equal(ids.periodChart.children[0].textContent,'没有已选择的股票');
 assert.equal(klineCount(),1);
 assert.ok(calls.every(x=>x.options.method==='GET'));
});
