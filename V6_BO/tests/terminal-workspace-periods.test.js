'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const periods=require('../public/assets/picks-periods');
function fixture(){
 const nodes=new Map(),events={},clicks={},requests=[];
 const node=(id='')=>{
  const n={id,value:'',dataset:{},classList:{add(){}},setAttribute(k,v){this[k]=v;},addEventListener(){},append(){},prepend(){},after(){}};
  let html='',text='';
  Object.defineProperty(n,'innerHTML',{get:()=>html,set:s=>{html=String(s);for(const match of html.matchAll(/id="([^"]+)"/g))if(!nodes.has(match[1]))nodes.set(match[1],node(match[1]));}});
  Object.defineProperty(n,'textContent',{get:()=>text,set:s=>{text=String(s);html='';}});return n;
 };
 const buttons=['day','month','year'].map(period=>({dataset:{vxPeriod:period},setAttribute(k,v){this[k]=v;}}));
 const document={body:node(),getElementById:id=>nodes.get(id)||null,createElement:()=>node(),querySelector:s=>s==='.wrap'?node():null,querySelectorAll:s=>s==='[data-vx-period]'?buttons:[],addEventListener:(e,fn)=>clicks[e]=fn};
 const context={document,window:null,console,AbortController,Date,Map,Set,V6PicksPeriods:periods,location:{href:''},addEventListener:(e,fn)=>events[e]=fn,fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/assets/terminal-dashboard.js'),'utf8'),context);
 return {nodes,events,requests,buttons,period(period){clicks.click({target:{closest:s=>s==='[data-vx-period]'?{dataset:{vxPeriod:period}}:null}});},stock(code){clicks.click({target:{closest:s=>s==='[data-vx-code]'?{dataset:{vxCode:code}}:null}});}};
}
const data=()=>({observedAt:Date.now(),indices:[],counts:{},mood:{},rows:[{code:'000001',name:'甲',price:10,quoteSource:'fixture',quoteAt:Date.now()-60000,signals:[],explanation:[]},{code:'000002',name:'乙',price:20,signals:[],explanation:[]}]});
const reply=(request,rows)=>request.resolve({ok:true,json:async()=>({ok:true,asOf:'2026-02-02',rows})});
const row=(date,close)=>({date,open:close,high:close+1,low:close-1,close,volume:10});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('official workspace period controls aggregate returned history and never manufacture missing sessions',async()=>{
 const h=fixture();h.events['v6-dashboard-data']({detail:data()});
 h.period('month');assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.requests[1].url,'/api/kline?code=000001&n=1200');
 reply(h.requests[1],[row('2026-01-02',10),row('2026-01-30',12),row('2026-02-02',14)]);await tick();
 assert.equal((h.nodes.get('vx-chart').innerHTML.match(/<rect /g)||[]).length,4,'two monthly candles and two actual volume bars');
 assert.match(h.nodes.get('vx-chart-source').textContent,/月K.*可能不完整/);assert.equal(h.buttons[1]['aria-pressed'],'true');
 assert.match(h.nodes.get('vx-selected-provenance').textContent,/fixture.*旧快照/);
 h.period('year');reply(h.requests[2],[row('2025-12-31',8),row('2026-01-02',10),row('2026-02-02',14)]);await tick();
 assert.equal((h.nodes.get('vx-chart').innerHTML.match(/<rect /g)||[]).length,4);assert.match(h.nodes.get('vx-chart-source').textContent,/年K/);
 assert.ok(h.requests.every(request=>!request.options.method||request.options.method==='GET'));
});
test('switching stock during a period request rejects the late previous-stock history',async()=>{
 const h=fixture();h.events['v6-dashboard-data']({detail:data()});h.period('month');h.stock('000002');
 reply(h.requests[2],[row('2026-02-02',20)]);await tick();const current=h.nodes.get('vx-chart').innerHTML;
 reply(h.requests[1],[row('2026-01-02',999)]);reply(h.requests[0],[row('2026-01-02',888)]);await tick();
 assert.equal(h.nodes.get('vx-chart').innerHTML,current);assert.match(h.nodes.get('vx-selected').textContent,/000002/);
});
test('access loss during aggregated history clears chart and original quote provenance',async()=>{
 const h=fixture();h.events['v6-dashboard-data']({detail:data()});h.period('year');h.events['v6-dashboard-data']({detail:null});
 reply(h.requests[1],[row('2026-02-02',20)]);await tick();assert.equal(h.nodes.get('vx-chart').textContent,'请登录后查看行情');assert.match(h.nodes.get('vx-selected-provenance').textContent,/请登录/);
});
