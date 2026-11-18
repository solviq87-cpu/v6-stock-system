'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../public/nova');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const UI=uri(read('ui.js'));
const market=uri(read('market.js').replace("'./ui.js'",JSON.stringify(UI))
  .replace("'./market-evidence.js'",JSON.stringify(uri(read('market-evidence.js')))));
const api=import(uri(read('terminal-workbench.js').replace("'./ui.js'",JSON.stringify(UI))
  .replace("'./market.js'",JSON.stringify(market))));
class El{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.className='';}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 setAttribute(key,value){this[key]=value;}
 contains(){return false;}
}
function dom(){
 global.Node=El;
 global.document={createElement:tag=>new El(tag),createElementNS:(_ns,tag)=>new El(tag),
  createTextNode:content=>Object.assign(new El('text'),{textContent:content})};
}
const textOf=el=>[el?.textContent||'',...(el?.children||[]).map(textOf)].join(' ');
const locate=(el,predicate)=>predicate(el)?el:(el.children||[]).map(child=>locate(child,predicate)).find(Boolean);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function context(state,role='edit'){
 const controller=new AbortController(),calls=[],navigations=[],listeners=[];
 return {state,role,signal:controller.signal,calls,navigations,listeners,
  api:async(path,options)=>{calls.push({path,options});return {items:[],note:'当前服务未返回可用候选'};},
  readPool:(_key,loader)=>loader(),refresh:async()=>{calls.push({path:'state-refresh'});},
  navigate:(view,sub)=>navigations.push([view,sub]),
  selectStock:(code)=>navigations.push(['stock',code]),
  notify:()=>{},onState:cb=>listeners.push(cb),controller};
}
function fixture(count=33){
 const items=Array.from({length:count},(_,i)=>({
  code:String(600000+i),name:'复盘股票'+i,sector:i<16?'算力·存储':'人工智能',
  limitUpCount:i<28?1:2,breakCount:0,aboveMa5:true,
  sealAmount:42000000+i*100000,turnover:5.8,mainInflow:null
 }));
 return {
  trading:false,snapshotDay:'20261117',
  dashboard:{snapshotDay:'20261117',indices:[{code:'1.000001',price:3584.58,pct:-.5,
   quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'tencent-index'}],rows:[]},
  review:{date:'20261117',ztN:37,items,poolEvidence:[{
   source:'em',tradeDate:'20261117',reportedCount:37,returnedCount:37,uniqueCount:37
  }]},
  ztDay:'20261117',snapshotFieldDays:{ztBySector:'20261117'},
  ztBySector:[{sector:'算力·存储',count:16,
   stocks:[{code:'600001',name:'测试龙头',role:'leader'}]}],
  sectors:[]
 };
}
test('approved V6 layout uses actual review rows and keeps source 37 / analyzed 33 distinct',async()=>{
 dom();const {renderTerminalOverview}=await api,ctx=context(fixture());
 const view=renderTerminalOverview(ctx),t=textOf(view);
 assert.match(t,/盘面总览 · 涨停复盘工作台/);
 assert.match(t,/源端 37 只/);
 assert.match(t,/明细 33 只/);
 assert.match(t,/源端 37 只 \/ 本次明细 33 只/);
 assert.match(t,/复盘股票0 600000/);
 assert.match(t,/测试龙头/);
 assert.match(t,/板块资金排行/);
 assert.match(t,/尚无单位明确的板块资金数据/);
 assert.match(t,/3,584\.58/);
 assert.match(t,/tencent-index/);
 assert.match(t,/单源观测/);
 await tick();
 assert.equal(ctx.calls.every(x=>!['POST','DELETE','PUT'].includes(x.options?.method)),true,'rendering is read-only');
 ctx.controller.abort();
});
test('no review data, no source count and no price timestamp do not become fabricated zero or live quote',async()=>{
 dom();const {renderTerminalOverview}=await api,ctx=context({trading:false,dashboard:{indices:[]},review:null,sectors:[{name:'疑似资金板块',mainInflow:120000000}]});
 const view=renderTerminalOverview(ctx),t=textOf(view);
 assert.match(t,/源端涨停总数尚未核验/);
 assert.match(t,/源端涨停\s*—/);
 assert.match(t,/暂无可核验的涨停明细/);
 assert.match(t,/尚无单位明确的板块资金数据/);
 assert.match(t,/报价时点待核验/);
 assert.doesNotMatch(t,/1\.20 亿/,'unknown-unit amount must not be converted to Yuan');
 await tick();ctx.controller.abort();
});
test('a stale sector classification cannot be merged into a new-day review',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(2);
 s.snapshotFieldDays.ztBySector='20261116';
 s.ztBySector=[{sector:'旧版题材',count:1,stocks:[{code:'600001',name:'旧版龙头'}]}];
 const ctx=context(s),view=renderTerminalOverview(ctx),t=textOf(view);
 assert.match(t,/日期不一致时不混用/);
 assert.doesNotMatch(t,/旧版龙头/);
 await tick();ctx.controller.abort();
});
test('real V6 module links route to existing review, strategies, simulated account and holdings',async()=>{
 dom();const {renderTerminalOverview}=await api,ctx=context(fixture(3));
 const view=renderTerminalOverview(ctx);
 for(const [label,expected] of [
  ['详细复盘',['pulse','review']],['选股核心',['opportunities','all']],
  ['模拟盘',['assets','paper']],['我的持仓',['assets','holdings']],
  ['十四条选股',['opportunities','conditions']]
 ]){
  const btn=locate(view,el=>el?.tag==='button'&&textOf(el).trim()===label);
  assert.ok(btn,'missing real route: '+label);
  btn.listeners.click();
  assert.deepEqual(ctx.navigations.at(-1),expected);
 }
 await tick();ctx.controller.abort();
});
test('native shell uses approved business navigation and worker caches every eagerly imported module',()=>{
 const app=read('app.js'),css=read('fayo.css'),worker=fs.readFileSync(path.join(dir,'../sw.js'),'utf8');
 assert.match(app,/renderTerminalOverview\(ctx\)/);
 assert.match(app,/BUSINESS_NAV=/);
 for(const label of ['盘面总览','我的十四条','复盘 · 学习','智能策略中心','发布看板'])assert.ok(app.includes(label));
 assert.match(css,/V6 DEEP BLUE TERMINAL/);
 assert.match(css,/max-width:650px/);
 assert.match(worker,/\/nova\/terminal-workbench\.js/);
});

test('all received review rows are available on desktop and on-demand mobile, without inventing stocks',async()=>{
 dom();const {renderTerminalOverview}=await api;
 const ctx=context(fixture(33)),view=renderTerminalOverview(ctx);
 const desktop=locate(view,el=>el?.className==='fy-terminal-desktop-table');
 const mobile=locate(view,el=>el?.className==='fy-terminal-mobile-cards');
 assert.ok(desktop&&mobile);
 assert.match(textOf(desktop),/复盘股票32/,'33rd real row is present on desktop');
 assert.doesNotMatch(textOf(mobile),/复盘股票32/,'mobile preview starts with 12 rows');
 const expand=locate(view,el=>el?.className?.includes?.('fy-terminal-review-expand'));
 assert.ok(expand,'more rows must have a real interactive control');
 assert.equal(expand['aria-expanded'],'false');
 expand.listeners.click();
 assert.match(textOf(mobile),/复盘股票32/,'mobile can reveal all received rows');
 assert.equal(expand['aria-expanded'],'true');
 expand.listeners.click();
 assert.doesNotMatch(textOf(mobile),/复盘股票32/,'mobile can collapse large list');
 assert.match(textOf(view),/未独立核实的题材不是涨停因果证明/);
 await tick();ctx.controller.abort();
});
