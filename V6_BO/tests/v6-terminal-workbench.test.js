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
 assert.match(t,/FAYO.*V6\s+盘面总览/,'concise page heading retains the FAYO identity');
 assert.match(t,/市场\s+最近交易日快照/,'market mode is visible and explicitly historical');
 assert.match(t,/机会\s+复盘明细 33 条/,'opportunity digest is based on actual analyzed rows');
 assert.match(t,/风险\s+明细覆盖有缺口/,'same-batch total mismatch remains a risk');
 assert.match(t,/下一步\s+核对复盘缺口/,'mismatched totals lead to verification instead of trading');
 assert.match(t,/源端 37 只/);
 assert.match(t,/明细 33 只/);
 assert.match(t,/源端 37 只 \/ 本次明细 33 只/);
 assert.match(t,/复盘股票0 600000/);
 assert.match(t,/测试龙头/);
 assert.match(t,/板块资金排行/);
 assert.match(t,/资金来源交易日待核验/);
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
 assert.match(t,/资金来源交易日待核验/);
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
 const details=locate(view,el=>el?.tag==='details'&&el?.className==='fy-terminal-quick');
 const shortcuts=locate(details,el=>el?.className==='fy-terminal-shortcuts');
 assert.ok(details&&shortcuts,'12 original business routes remain in a native disclosure');
 assert.equal(shortcuts.children.filter(el=>el?.tag==='button').length,12,
  'progressive disclosure preserves every business shortcut and its handler');
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

test('home shows only three current-state candidates and leaves full pool research in its own workspace',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(2);
 s.dashboard.rows=[{code:'600101',name:'首页原始候选',price:11.2,pct:1.3,
   quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'existing-source'}];
 s.pool=[{code:'600101',name:'重复候选不应两次展示'},...Array.from({length:5},(_,i)=>({
   code:String(600102+i),name:'其他候选'+i,price:12+i,pct:0,
   quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'existing-source'
 }))];
 const ctx=context(s),view=renderTerminalOverview(ctx);
 const host=locate(view,el=>el?.className==='fy-terminal-preview-cards');
 const cards=locate(host,el=>el?.className==='fy-stock-grid');
 assert.ok(host&&cards,'home keeps a real evidence-backed candidate preview');
 assert.equal(cards.children.length,3,'home only previews three candidates');
 assert.doesNotMatch(textOf(cards.children[1]),/结果日期 2026-11-17/,
  'undated retained pool rows must not inherit a newer dashboard day');
 assert.match(textOf(host),/首页原始候选/);
 assert.match(textOf(host),/existing-source/,'original quote source is visible');
 assert.doesNotMatch(textOf(host),/其他候选4/,'the rest are not dumped on the homepage');
 const full=locate(view,el=>el?.tag==='button'&&textOf(el).trim()==='查看全部候选');
 assert.ok(full,'full candidate workspace remains reachable');
 full.listeners.click();assert.deepEqual(ctx.navigations.at(-1),['opportunities','all']);
 await tick();assert.equal(ctx.calls.length,0,'landing does not automatically load remote strategy pools');
 ctx.controller.abort();
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

test('fund bar is displayed only with an explicit Yuan unit and a matching original sector day',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(3);
 s.snapshotFieldDays.sectors='20261117';
 s.sectors=[{name:'算力资金',mainInflowYuan:126000000},{name:'无单位板块',mainInflow:970000000}];
 const ctx=context(s),view=renderTerminalOverview(ctx),t=textOf(view);
 assert.match(t,/资金来源交易日 2026-11-17/);
 assert.match(t,/算力资金/);
 assert.match(t,/1\.26 亿/);
 assert.doesNotMatch(t,/无单位板块/);
 await tick();ctx.controller.abort();
});
test('mismatched, missing, and stale retained sector days never draw a false same-day fund bar',async()=>{
 dom();const {renderTerminalOverview}=await api;
 for(const [day,reviewDay,expected] of [
  ['20261116','20261117',/与大盘 2026-11-17 不同日/],
  [undefined,'20261117',/板块资金原始交易日缺失/],
  ['20261117','20261118',/与复盘 2026-11-18 不同日/]
 ]){
  const s=fixture(3);
  s.snapshotFieldDays.sectors=day;
  s.review.date=reviewDay;
  s.sectors=[{name:'旧资金不应显示',netInflowYuan:999000000}];
  const ctx=context(s),t=textOf(renderTerminalOverview(ctx));
  assert.match(t,/资金来源交易日待核验/);
  assert.match(t,expected);
  assert.doesNotMatch(t,/旧资金不应显示/);
  assert.doesNotMatch(t,/9\.99 亿/);
  await tick();ctx.controller.abort();
 }
});
test('a retained dashboard field day is authoritative over refreshed wrapper dates',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(2);
 s.snapshotFieldDays.dashboard='20261116';
 s.snapshotFieldDays.sectors='20261117';
 s.dashboard.snapshotDay='20261117';
 s.sectors=[{name:'不可冒充今日',mainInflowYuan:700000000}];
 const ctx=context(s),t=textOf(renderTerminalOverview(ctx));
 assert.match(t,/板块资金 2026-11-17 与大盘 2026-11-16 不同日/);
 assert.doesNotMatch(t,/不可冒充今日/);
 await tick();ctx.controller.abort();
});
