'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../public/nova');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const api=import('../public/nova/terminal-workbench.js');
class El{
 constructor(tag){
  this.tag=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.className='';
  // Native reference views add/remove semantic classes after h() creates the
  // element. Keep the test DOM's className and classList in sync like a browser.
  this.classList={
   add:(...tokens)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...tokens])].join(' ');},
   remove:(...tokens)=>{this.className=this.className.split(/\s+/).filter(token=>token&&!tokens.includes(token)).join(' ');},
   contains:token=>this.className.split(/\s+/).includes(token)
  };
 }
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 setAttribute(key,value){this[key]=value;}
 get childElementCount(){return this.children.filter(x=>x.tag!=='text').length;}
 get firstElementChild(){return this.children.find(x=>x.tag!=='text');}
 querySelectorAll(selector){
  const all=this.children.flatMap(child=>[child,...(child.querySelectorAll?.('*')||[])]);
  return selector==='*'?all:all.filter(child=>selector==='details'?child.tag==='details':selector==='details[open]'&&child.tag==='details'&&child.open);
 }
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
 dom();const {renderTerminalOverview}=await api,ctx=context({trading:false,dashboard:{indices:[
  {code:'1.000001',price:3678.91,quoteSource:'无原始时点的来源'},
  {code:'0.399001',price:6789.12,quoteSource:'未来时点的来源',quoteAt:Date.now()+3600000}
 ]},review:null,sectors:[{name:'疑似资金板块',mainInflow:120000000}]});
 const view=renderTerminalOverview(ctx),t=textOf(view);
 const stats=locate(view,el=>el.classList?.contains('fy-terminal-stats'));
 assert.equal(stats.children.length,0,'unobserved source totals never appear as zero or empty metric cards');
 const ticker=locate(view,el=>el.classList?.contains('fy-market-ticker'));
 assert.equal(ticker?.children.length||0,0,'quotes without a verifiable original time never get price tiles');
 assert.doesNotMatch(textOf(ticker),/实时|原始报价|历史报价/);
 assert.doesNotMatch(t,/3,678\.91|6,789\.12|源端涨停\s*0/);
 assert.equal(t.match(/行情来源与补采状态/g)?.length,1,'collection status is accessible from one disclosure');
 assert.match(t,/等待服务端采集回执/);
 assert.match(t,/最近交易日快照/);
 assert.match(t,/暂无可核验的涨停明细/);
 assert.match(t,/资金来源交易日待核验/);
 assert.doesNotMatch(t,/1\.20 亿/,'unknown-unit amount must not be converted to Yuan');
 await tick();ctx.controller.abort();
});
test('overview keeps expanded collection details on a background refresh and displays the original date of each recovered value',async()=>{
 dom();const {renderTerminalOverview}=await api;
 const date='2026-11-17',previous='2026-11-16',knownAt=Date.parse(date+'T16:00:00+08:00');
 const clock=Date.now;Date.now=()=>knownAt+60000;
 const ctx=context({trading:false,marketRecovery:{referenceDay:date,phase:'searching',lastAttemptAt:knownAt}});
 try{
  const view=renderTerminalOverview(ctx),details=()=>locate(view,el=>el.classList?.contains('fy-recovery-status'));
  assert.equal(!!details().open,false);
  details().open=true;
  ctx.state.marketRecovery={referenceDay:date,phase:'partial',lastAttemptAt:knownAt,sources:[{name:'原始供应商甲',status:'retrying'}],
   metrics:{upLimit:{value:0,date:previous,source:'历史收盘供应商乙',knownAt}}};
  ctx.listeners.forEach(paint=>paint());
  assert.equal(details().open,true);
  assert.match(textOf(details()),/原始供应商甲 · 等待重试/);
  const stats=locate(view,el=>el.classList?.contains('fy-terminal-stats'));
  assert.equal(stats.children.length,1);
  assert.match(textOf(stats),/源端涨停\s+0\s+上次有效 · 2026-11-16 · 历史收盘供应商乙/);
  assert.doesNotMatch(textOf(stats),/上次有效 · 2026-11-17/);
 }finally{Date.now=clock;ctx.controller.abort();}
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
test('desktop and mobile show same-day supplier reasons separately from the review inference',async()=>{
 dom();const {renderTerminalOverview}=await api,state=fixture(3);
 Object.assign(state.review.items[0],{reasonRaw:'同日原始事件',reasonSource:'cls',reasonTradeDate:'2026-11-17',reasonDateStatus:'matched',reason:'推断不覆盖原文'});
 Object.assign(state.review.items[1],{reasonRaw:'跨日旧原因',reasonSource:'ths',reasonTradeDate:'2026-11-16',reasonDateStatus:'matched',reason:'同板块放量线索'});
 Object.assign(state.review.items[2],{reasonRaw:'缺来源的原因',reasonTradeDate:'2026-11-17',reasonDateStatus:'matched'});
 const ctx=context(state),view=renderTerminalOverview(ctx);
 for(const className of ['fy-terminal-desktop-table','fy-terminal-mobile-cards']){
  const text=textOf(locate(view,node=>node.className===className));
  assert.match(text,/涨停原因/);assert.match(text,/同日原始事件\s+财联社 · 2026-11-17\s+复盘推断 · 推断不覆盖原文/);
  assert.match(text,/源端原因待核验\s+复盘推断 · 同板块放量线索/);
  assert.doesNotMatch(text,/跨日旧原因|缺来源的原因/);
 }
 ctx.controller.abort();
});
test('homepage paper reference totals use only the editor projection and keep missing values unknown',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(1);
 s.paper={pool:{equity:123456.78,cash:0,marketValue:null,totalPnl:-12.5}};
 const editor=context(s),viewer=context(s,'view'),hidden=context({...s,paper:{...s.paper,hidden:true}}),
  missing=context({...s,paper:{pool:{equity:null,cash:null,marketValue:null,totalPnl:null}}});
 const panel=view=>locate(view,el=>el?.className==='fy-reference-account-body');
 const content=ctx=>textOf(panel(renderTerminalOverview(ctx)));
 const totals=content(editor);
 assert.match(totals,/参考权益\s+123,456\.78/);
 assert.match(totals,/参考累计盈亏\s+-12\.50/);
 assert.doesNotMatch(totals,/总权益|当前精确权益/,'legacy paper projection is labeled as reference, not current verified equity');
 assert.match(totals,/可用资金\s+0\.00/);
 assert.doesNotMatch(totals,/持仓市值/);
 assert.doesNotMatch(content(viewer),/123,456\.78/);
 assert.doesNotMatch(content(hidden),/123,456\.78/);
 const absent=content(missing);assert.match(absent,/暂无模拟盘估值/);
 assert.doesNotMatch(absent,/0\.00|参考权益|参考持仓市值/,'missing reference values are never converted to zero');
 await tick();assert.equal(viewer.calls.length,0,'viewer does not request private risk or account evidence');
 for(const ctx of [editor,viewer,hidden,missing])ctx.controller.abort();
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
  ['详细复盘',['pulse','review']],['选股核心',['opportunities','ranked']],
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
 for(const [label,view,sub] of [['首页总览','pulse','overview'],['我的十四条','opportunities','conditions'],['复盘 · 学习','pulse','review'],['策略中心','lab','strategies'],['发布看板','settings','release']])
  assert.ok(app.includes("['"+label+"','"+view+"','"+sub+"']"),'approved route remains reachable: '+label);
 assert.match(css,/V6 DEEP BLUE TERMINAL/);
 assert.match(css,/max-width:650px/);
 assert.match(worker,/\/nova\/terminal-workbench\.js/);
});

test('home previews three candidates from the same system picks list and links to it',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(2);
 s.dashboard.rows=[{code:'600101',name:'首页原始候选',price:11.2,pct:1.3,score:95,signals:['放量突破'],
   quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'existing-source'},...Array.from({length:5},(_,i)=>({
   code:String(600102+i),name:'其他候选'+i,price:12+i,pct:0,signals:['同日量能条件'],
   quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'existing-source'
 }))];
 s.pool=[{code:'600110',name:'另一个交易日的备选池'}];
 const ctx=context(s),view=renderTerminalOverview(ctx);
 const summary=view.children.find(el=>el?.classList?.contains('fy-risk-summary'));
 const research=locate(view,el=>el?.tag==='details'&&el?.className==='fy-home-research');
 assert.ok(summary,'the shared backend risk summary remains visible on the homepage');
 assert.ok(locate(research,el=>el?.classList?.contains('fy-home-risk')),'original research risk and account evidence remain in the research disclosure');
 assert.equal(!!research.open,false,'additional research evidence starts collapsed');
 const host=locate(view,el=>el?.className==='fy-terminal-preview-cards');
 const cards=locate(host,el=>el?.className==='fy-stock-grid');
 assert.ok(host&&cards,'home keeps a real evidence-backed candidate preview');
 assert.equal(cards.children.length,3,'home only previews three candidates');
 assert.doesNotMatch(textOf(host),/另一个交易日的备选池/,'the same snapshot feeds both the preview and dedicated list');
 assert.match(textOf(host),/首页原始候选/);
 assert.match(textOf(host),/existing-source/,'original quote source is visible');
 assert.doesNotMatch(textOf(host),/其他候选4/,'the rest are not dumped on the homepage');
 const full=locate(view,el=>el?.tag==='button'&&textOf(el).trim()==='查看系统精选');
 assert.ok(full,'full candidate workspace remains reachable');
 full.listeners.click();assert.deepEqual(ctx.navigations.at(-1),['opportunities','ranked']);
 await tick();
 assert.deepEqual(ctx.calls.map(call=>call.path),['/api/risk-workbench?account=pool'],
  'landing reads the shared account risk result and does not automatically load remote strategy pools');
 assert.ok(ctx.calls.every(call=>!call.options?.method||call.options.method==='GET'),'homepage risk read never mutates reminders or orders');
 ctx.controller.abort();
});

test('all received review rows are available on desktop and on-demand mobile, without inventing stocks',async()=>{
 dom();const {renderTerminalOverview}=await api;
 const ctx=context(fixture(33)),view=renderTerminalOverview(ctx);
 const desktop=locate(view,el=>el?.className==='fy-terminal-desktop-table');
 const mobile=()=>locate(view,el=>el?.className==='fy-terminal-mobile-cards');
 assert.ok(desktop&&mobile());
 assert.match(textOf(desktop),/复盘股票32/,'33rd real row is present on desktop');
 assert.doesNotMatch(textOf(mobile()),/复盘股票32/,'mobile preview starts with 12 rows');
 const expand=()=>locate(view,el=>el?.className?.includes?.('fy-terminal-review-expand'));
 assert.ok(expand(),'more rows must have a real interactive control');
 assert.equal(expand()['aria-expanded'],'false');
 expand().listeners.click();
 assert.match(textOf(mobile()),/复盘股票32/,'mobile can reveal all received rows');
 assert.equal(expand()['aria-expanded'],'true');
 expand().listeners.click();
 assert.doesNotMatch(textOf(mobile()),/复盘股票32/,'mobile can collapse large list');
 assert.match(textOf(view),/未独立核实的题材不是涨停因果证明/);
 await tick();ctx.controller.abort();
});

test('fund bar is displayed only with an explicit Yuan unit and a matching original sector day',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(3);
 s.snapshotFieldDays.sectors='20261117';
 s.sectors=[{name:'算力资金',mainInflow:126000000,source:'eastmoney',fundsUnit:'CNY',fundsMethod:'vendor-order-size-estimate',
  retrievedAt:Date.parse('2026-11-17T15:00:00+08:00'),sourceTimestamp:null},{name:'无单位板块',mainInflow:970000000}];
 const ctx=context(s),view=renderTerminalOverview(ctx),t=textOf(view);
 assert.match(t,/资金来源交易日 2026-11-17/);
 assert.match(t,/算力资金/);
 assert.match(t,/1\.26 亿/);
 assert.match(t,/eastmoney/);assert.match(t,/源端资金时刻未提供/);
 assert.doesNotMatch(t,/无单位板块/);
 await tick();ctx.controller.abort();
});
test('the sector main panel and picker follow the selected stock and date, including an absent historical day',async()=>{
 dom();const {renderMarket}=await import('../public/nova/market.js'),day='2026-11-17',s=fixture(2);
 const funds=(code,name,value)=>({code,name,mainInflow:value,source:'eastmoney',fundsUnit:'CNY',
  fundsMethod:'vendor-order-size-estimate',retrievedAt:Date.parse(day+'T14:00:00+08:00'),sourceTimestamp:null});
 const bank=funds('BK0475','银行',126000000),chip=funds('BK1034','芯片',200000000),other=funds('BK0937','消费电子',-20000000);
 s.sectors=[chip];s.sectorsDay=day;
 const ctx=context(s),changed=[];ctx.decisionSelection={code:'600001',day,row:{name:'所选股票',sector:'银行',themes:['消费电子']}};
 ctx.onDecisionSelection=fn=>changed.push(fn);
 ctx.api=async url=>{
  if(!url.startsWith('/api/decision-sector-context?'))return {items:[]};
  const date=new URL(url,'http://localhost').searchParams.get('date');
  return {ok:true,day:date,sectorsDay:date,rows:date===day?[bank,chip,other]:[],missing:date===day?[]:['未留存该日板块资金']};
 };
 const view=renderMarket({sub:'sectors'},ctx),panel=()=>locate(view,n=>n.dataset?.sectorSelection==='600001');
 await tick();
 assert.match(textOf(panel()),/银行.*1\.26 亿/s);assert.doesNotMatch(textOf(panel()),/芯片/);
 const picker=locate(panel(),n=>n['aria-label']==='当前股票对应板块');
 assert.equal(picker.value,'BK0475');assert.deepEqual(picker.children.map(n=>textOf(n).trim()),['银行 · BK0475','消费电子 · BK0937']);
 picker.value='BK0937';picker.listeners.change({currentTarget:picker});
 assert.equal(locate(panel(),n=>n['data-selected-sector']==='BK0937')['data-day'],day);
 assert.match(textOf(panel()),/-2,000\.00 万元/);
 ctx.decisionSelection={...ctx.decisionSelection,day:'2026-11-16'};changed.forEach(fn=>fn());await tick();
 assert.equal(panel().dataset.day,'2026-11-16');assert.match(textOf(panel()),/未留存该日板块资金/);
 assert.doesNotMatch(textOf(panel()),/1\.26 亿|2\.00 亿|-2,000\.00 万/,'the linked main panel never shows the other date’s funds');
 ctx.controller.abort();
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

test('decision panel shows real dated good/bad evidence, watch counts and no automatic writes',async()=>{
 dom();const {renderTerminalOverview}=await api,s=fixture(2);
 s.dashboard.rows=[{code:'600010',name:'真实复盘候选',score:90,quoteAt:Date.parse('2026-11-17T07:00:00Z'),
  quoteSource:'existing-source',aboveMa5:true,hit:['已有策略条件'],
  issuerEvidence:{events:[{category:'risk-clue',title:'明确利空公告标题',publishedAt:'2026-11-16T00:00:00Z'},
   {category:'strength-clue',title:'明确利好公告标题',publishedAt:'2026-11-16T00:00:00Z'}]}}];
 const ctx=context(s,'view'),view=renderTerminalOverview(ctx);
 const panel=locate(view,node=>node?.['data-v6-decision-brief']==='true');
 assert.ok(panel,'dashboard is part of the original terminal, not a second application');
 const display=textOf(panel);
 assert.match(display,/逐股决策仪表盘/);
 assert.match(display,/买入研究标签\s*0/);
 assert.match(display,/仅供观察\s*1/);
 assert.match(display,/明确利空公告标题/);
 assert.match(display,/明确利好公告标题/);
 assert.match(display,/原始行情日 2026-11-17/);
 assert.match(display,/历史 \/ 未知 \/ 异常时点/);
 assert.match(display,/已有策略条件/);
 assert.ok(ctx.calls.every(call=>!['POST','PUT','DELETE'].includes(call.options?.method)));
 ctx.controller.abort();
});

test('homepage dates compact and full sector evidence without dating an undated report',async()=>{
 dom();const {renderTerminalOverview}=await api;
 const row={code:'000001',name:'已返回标的',sector:'源端板块',limitUpCount:2};
 const digest={trading:true,snapshotDay:'20261123',dashboard:{snapshotDay:'20261123'},sectorsDay:'20261123',
  sectors:[{name:'同日资金',mainInflow:200000000,source:'eastmoney',fundsUnit:'CNY',fundsMethod:'vendor-order-size-estimate',
   retrievedAt:Date.parse('2026-11-23T14:00:00+08:00'),sourceTimestamp:null}],ztPool:{day:'20261123',count:95,top:[row,row]}};
 const check=(s,assertions)=>{
  const ctx=context(s),view=renderTerminalOverview(ctx);
  try{assertions(textOf(locate(view,n=>n?.className==='fy-terminal-context')),textOf(locate(view,n=>n?.className==='fy-terminal-provenance')));}
  finally{ctx.controller.abort();}
 };
 check(digest,(cards,status)=>{
  assert.match(cards,/速览涨停池节选 · 2026-11-23/);assert.match(cards,/源端板块\s+1 只/);
  assert.match(cards,/已返回标的/);assert.match(cards,/同日资金/);assert.match(cards,/2\.00 亿/);
  assert.doesNotMatch(cards,/日期未知|95 只/);assert.match(status,/盘面参考交易日 2026-11-23/);assert.doesNotMatch(status,/原始复盘日期/);
 });
 const full={...digest,ztPool:[],ztDay:'20261123',ztBySector:[{sector:'已核分类',count:2,stocks:[{...row,lb:2}]}]};
 check(full,cards=>{assert.match(cards,/同日涨停板块分类 · 2026-11-23/);assert.match(cards,/已核分类\s+2 只/);});
 check({...full,ztDay:'',snapshotFieldDays:{ztBySector:'20261123'}},cards=>assert.match(cards,/已核分类/));
 check({...full,review:{date:'20261120',items:[]}},cards=>assert.doesNotMatch(cards,/已核分类|同日资金|2\.00 亿/));
 check({...full,ztDay:'',snapshotFieldDays:{ztBySector:'20261120'},sectorsDay:'20261120'},cards=>{
  assert.doesNotMatch(cards,/已核分类|同日资金|2\.00 亿/);assert.match(cards,/2026-11-23，板块分类 2026-11-20/);
 });
 check({...digest,ztPool:{top:[row]},review:{items:[row]}},cards=>assert.doesNotMatch(cards,/已返回标的|源端板块/));
 check({...digest,ztPool:{day:'20261123',top:[{...row,sourceTradeDate:'20261120'}]}},cards=>assert.doesNotMatch(cards,/已返回标的|源端板块/));
 check({...digest,snapshotFieldDays:{ztPool:'20261120'}},cards=>assert.doesNotMatch(cards,/已返回标的|源端板块/));
});

test('closing snapshot preserves the intraday identity of an earlier index quote',async()=>{
 dom();const {marketOverviewParts}=await import('../public/nova/market.js');
 const day='2026-11-06',at=Date.parse(day+'T10:15:00+08:00');
 const parts=marketOverviewParts({closeSession:{day},marketClock:{trading:false},dashboard:{indices:[{code:'1.000001',price:3210,pct:1,quoteAt:at,quoteSource:'fixture'}]}});
 assert.match(textOf(parts.indices[0]),/盘中/);assert.doesNotMatch(textOf(parts.indices[0]),/收盘/);
});
