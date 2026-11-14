'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../public/assets/picks-page.js'),'utf8');
class El{
 constructor(tag){this.tag=tag;this.textContent='';this.className='';this.children=[];
  this.listeners={};this.value='';this.disabled=false;}
 append(...x){this.children.push(...x);}
 replaceChildren(...x){this.children=x;}
 addEventListener(name,callback){this.listeners[name]=callback;}
 setAttribute(){}
}
function texts(el){return [String(el?.textContent||''),...(el?.children||[]).flatMap(texts)].join(' ');}
test('per-stock source/quality badge is safe, explanatory and refreshed when evidence disappears',async()=>{
 const ids=Object.fromEntries(['reload','board','sort','search','candidates','status','cloudSync','total','visible','explained','day'].map(id=>[id,new El('div')]));
 ids.board.value='all';ids.sort.value='original';const events=[];
 const responses=[
  {items:[{code:'600000',name:'数据样本',src:'em',score:null,
   hit:['来自服务器的命中条件'],quoteTimeStatus:'stale-source-time',quoteAt:null}]},
  {items:[{code:'600000',name:'数据样本',score:null,hit:[],src:null}]}
 ];
 const ctx={
  document:{hidden:false,getElementById:id=>ids[id],createElement:tag=>new El(tag),
   createDocumentFragment:()=>new El('fragment'),addEventListener(){},
   dispatchEvent:e=>{events.push(e);return true;}},
  window:{addEventListener(){},setInterval(){}},
  localStorage:{getItem:()=>''},URLSearchParams,AbortController,Date,Number,String,
  Array,RegExp,Error,Math,Object,
  Event:class Event{constructor(type){this.type=type;}},
  CustomEvent:class CustomEvent{constructor(type,opt){this.type=type;this.detail=opt.detail;}},
  fetch:async(_url,options)=>{assert.equal(options.method,'GET');
   return {ok:true,json:async()=>({...responses.shift(),snapshotDay:'2026-11-09'})};}
 };
 vm.runInNewContext(script,ctx);
 await new Promise(setImmediate);
 const first=texts(ids.candidates);
 assert.match(first,/价格源 东财/);
 assert.match(first,/质量 报价已过时/);
 assert.match(first,/非交易认证/);
 assert.match(first,/逐票报价原始时点：未知/);
 assert.doesNotMatch(first,/undefined|NaN|认证实时价/);
 await ids.reload.listeners.click();
 const second=texts(ids.candidates);
 assert.match(second,/价格源 价格来源未知/);
 assert.match(second,/质量 真实性待独立核验/);
 assert.doesNotMatch(second,/价格源 东财|质量 报价已过时/);
 assert.equal(ids.total.textContent,1);
});
test('relevant subpage cache stamp advances but protected desktop and mobile homepages are never touched',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/picks.html'),'utf8');
 assert.match(html,/picks-page\.js\?v=20261114data1/);
 assert.match(html,/id="candidates"/);
 assert.equal((html.match(/class="bottom"/g)||[]).length,1);
 assert.doesNotMatch(script,/method:\s*['"]POST|force=1|\/api\/paper\//);
});
