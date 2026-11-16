#!/usr/bin/env node
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main id="mount"></main></body></html>');}
 if(!/^\/nova\/[\w.-]+$/.test(pathname)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,pathname)));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));const origin='http://127.0.0.1:'+server.address().port;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin);
  await page.evaluate(async()=>{
   const {renderOperations}=await import('/nova/operations.js'),{renderMarket,renderOpportunities}=await import('/nova/market.js');window.calls=[];window.notices=[];
   const holdings={ok:true,time:'2026-11-13 15:00',items:[{code:'600000',name:'合成资产甲',cost:10,shares:100,price:11,floatPct:10,market:1100,weight:1,profitAmt:100,dayPnl:20,tags:['观察'],acts:[]},{code:'000001',name:'合成资产乙',cost:20,shares:200,price:19,floatPct:-5,market:3800,weight:3.8,profitAmt:-200,dayPnl:-10,tags:[],acts:[]}],summary:{market:4900,cost:5000,profit:-100,floatPct:-2,dayPnl:10,positionPct:4.9,capital:100000},cfg:{stopPct:5,reducePct:3,takePct:10,maxPosPct:80},allTags:['观察']};
   const account={cash:100000,equity:100000,initial:100000,realized:0,totalPnl:0,totalPct:0,positions:[],trades:[],enabled:true};
   window.renderRoute=(view,sub,role='edit')=>{
    window.routeController?.abort();window.routeController=new AbortController();window.stateListeners=[];
    const ctx={role,passwordCreated:()=>{window.firstPasswordInitialized=true;},auth:window.setupMode?{hasPassword:false}:undefined,onState:fn=>window.stateListeners.push(fn),signal:window.routeController.signal,state:{snapshotDay:'20261116',snapshotFieldDays:{pool:''},pool:[{code:'600101',name:'原日期未知的保留票',price:10}],paper:{pool:account,pre:account},cfgSet:{quiet:{kind:'bool',label:'静默',value:false},refreshSecs:{kind:'num',label:'刷新间隔',value:15}},cfgRange:{scoreGate:{label:'门槛',cur:50,min:0,max:100}},goodNews:{items:[{title:'合成资讯',publishedAt:'2026-11-13T15:00:00+08:00'}]},badNews:{items:[]}},notify:(...args)=>window.notices.push(args),navigate:()=>{},selectStock:()=>{},refresh:async()=>{},api:async(p,options={})=>{
     window.calls.push({path:p,method:options.method||'GET',body:options.body});
     if(options.signal?.aborted)throw new DOMException('aborted','AbortError');
     if(options.method==='POST'){
      if(p==='/api/research/order-account')return{ok:true,result:{revision:1,account:{cash:100000,positions:{},events:[]},riskPolicy:{}}};
      return{ok:true,msg:'合成服务已确认'};
     }
     if(p==='/api/holdings')return holdings;
     if(p.startsWith('/api/holdings/ops'))return{ok:true,ops:[],snapshots:[]};
     if(p==='/api/paper')return{ok:true,paper:{pool:account,pre:account}};
     if(p==='/api/paper/ledger')return{ok:true,paper:{pool:{accounting:{cash:100000,realizedPnl:0,positions:[],auditStatus:'passed'},events:[]},pre:{accounting:{cash:500000,positions:[],auditStatus:'passed'},events:[]}}};
     if(p.startsWith('/api/source?'))return{ok:true,file:new URL(p,location.origin).searchParams.get('file'),content:'const first = 1;'};
     if(p==='/api/release/requests')return{ok:true,requests:[{file:'a.json',summary:'合成请求甲'},{file:'b.json',summary:'合成请求乙'}]};
     if(p==='/api/lock/status')return{ok:true,role:'edit',hasPassword:true,hasViewPassword:true};
     if(p.startsWith('/api/push-log'))return{ok:true,count:0,shown:0,sentToday:0,log:[]};
     return{ok:true,items:[],list:[]};
    }};
    window.activeContext=ctx;document.getElementById('mount').replaceChildren(view==='pulse'?renderMarket({view,sub},ctx):view==='opportunities'?renderOpportunities({view,sub},ctx):renderOperations({view,sub},ctx));
   };
  });
  const cases={assets:['overview','holdings','risk','paper','ledger','authority','history'],inbox:['all','alerts','signals','push','compose'],settings:['preferences','diagnostics','channels','devices','security','source','release']};
  for(const [view,subs]of Object.entries(cases))for(const sub of subs){await page.evaluate(([view,sub])=>window.renderRoute(view,sub),[view,sub]);await page.waitForTimeout(30);assert.equal(await page.locator('.fy-operations').count(),1);assert.ok((await page.locator('#mount').innerText()).length>30,view+'/'+sub+' meaningful content');}
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.method!=='GET')),[],'navigation must never mutate or send');
  for(const [sub,key]of [['sectors','sectors'],['global','global'],['plans','nextplan'],['review','review']]){
   await page.evaluate(sub=>window.renderRoute('pulse',sub),sub);
   await page.evaluate(key=>{window.activeContext.state[key]=[{note:'更新后的共享市场证据'}];window.stateListeners.forEach(fn=>fn());},key);
   assert.equal(await page.getByText('更新后的共享市场证据',{exact:true}).isVisible(),true,'open '+sub+' follows independent cloud reads');
  }
  await page.evaluate(()=>window.renderRoute('assets','overview'));
  await page.evaluate(()=>{window.activeContext.state.paper={pool:{equity:123456.78,totalPct:2},pre:{equity:50000,totalPct:0}};window.stateListeners.forEach(fn=>fn());});
  assert.match(await page.locator('#mount').innerText(),/123,456\.78/,'open asset totals follow the current authoritative state');
  await page.evaluate(()=>window.renderRoute('settings','diagnostics'));
  await page.evaluate(()=>{window.activeContext.state.taskState={note:'更新后的任务状态'};window.stateListeners.forEach(fn=>fn());});
  assert.equal(await page.getByText('更新后的任务状态',{exact:true}).isVisible(),true,'diagnostics do not freeze at route-open time');
  await page.evaluate(()=>window.renderRoute('opportunities','ranked'));
  assert.match(await page.locator('#mount .fy-note').innerText(),/原始交易日待核验/,'unknown retained source day is never replaced by the date of the newest read');
  assert.doesNotMatch(await page.locator('#mount .fy-note').innerText(),/2026[-/]11[-/]16/);
  await page.evaluate(()=>window.renderRoute('settings','preferences'));
  const configBefore=await page.evaluate(()=>window.calls.filter(c=>c.path==='/api/config').length);
  await page.getByRole('button',{name:'预览修改',exact:true}).click();
  assert.equal(await page.getByRole('alertdialog').count(),0,'an untouched preference form does not propose a full stale overwrite');
  await page.locator('input[name=quiet]').check();
  await page.evaluate(()=>{window.activeContext.state.cfgSet.refreshSecs.value=30;window.activeContext.state.cfgRange.scoreGate.cur=60;window.stateListeners.forEach(fn=>fn());});
  await page.getByRole('button',{name:'预览修改',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行',exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/config'))).body,{quiet:true},'saving one preference preserves untouched values changed by another device');
  await page.getByRole('button',{name:'预览修改',exact:true}).click();
  assert.equal(await page.getByRole('alertdialog').count(),0,'a successful save advances its local baseline');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.path==='/api/config').length),configBefore+1,'no duplicate config write without new edits');
  await page.evaluate(()=>window.renderRoute('inbox','all'));
  await page.getByRole('searchbox',{name:'筛选资讯'}).fill('合成');
  await page.evaluate(()=>{window.activeContext.state.goodNews.items.push({title:'合成周末新公告',publishedAt:'2026-11-15T12:00:00+08:00'});window.stateListeners.forEach(fn=>fn());});
  assert.equal(await page.getByText('合成周末新公告',{exact:true}).isVisible(),true,'weekend news refreshes independently of frozen market prices');
  assert.equal(await page.getByRole('searchbox',{name:'筛选资讯'}).inputValue(),'合成','state updates preserve the active news filter');
  await page.evaluate(()=>window.renderRoute('assets','holdings'));
  await page.getByText('合成资产甲',{exact:true}).waitFor();
  await page.getByRole('button',{name:'记录持仓',exact:true}).click();
  await page.locator('form input[name=cost]').fill('123.45');
  const beforeDraftRefresh=await page.evaluate(()=>window.calls.filter(c=>c.path==='/api/holdings').length);
  await page.evaluate(()=>window.stateListeners.forEach(fn=>fn()));await page.waitForTimeout(30);
  assert.equal(await page.locator('form input[name=cost]').inputValue(),'123.45','background state updates do not erase a holdings draft');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.path==='/api/holdings').length),beforeDraftRefresh,'dirty private forms are not silently reloaded');
  await page.evaluate(()=>{window.setupMode=true;window.renderRoute('settings','security');});
  await page.getByRole('button',{name:'预览创建',exact:true}).waitFor();
  await page.locator('form').filter({has:page.getByRole('button',{name:'预览创建',exact:true})}).locator('input[name=password]').fill('fayo-first-synthetic-password');
  await page.getByRole('button',{name:'预览创建',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行',exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/lock/setup'))).body,{role:'edit',password:'fayo-first-synthetic-password'},'a new local instance can explicitly establish its first password');
  assert.equal(await page.evaluate(()=>window.firstPasswordInitialized),true,'first-password completion switches the next gate to ordinary login');
  await page.evaluate(()=>{window.setupMode=false;});
  const count=await page.evaluate(()=>window.calls.length);
  for(const sub of cases.assets){await page.evaluate(sub=>window.renderRoute('assets',sub,'view'),sub);await page.waitForTimeout(5);assert.match(await page.locator('#mount').innerText(),/私人工作区/);}
  assert.equal(await page.evaluate(()=>window.calls.length),count,'viewer cannot read private account endpoints');
  await page.evaluate(()=>window.renderRoute('assets','holdings'));
  await page.getByText('合成资产甲',{exact:true}).waitFor();
  await page.locator('[data-holding-code="600000"] input[type=checkbox]').check();
  await page.getByRole('button',{name:'移除所选',exact:true}).click();
  await page.locator('[data-holding-code="000001"] input[type=checkbox]').check();
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行'}).click();
  const removal=await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/holdings'&&c.body?.action==='removeMany'));
  assert.deepEqual(removal.body.codes,['600000'],'confirmation freezes the exact selected asset set');
  await page.evaluate(()=>window.renderRoute('settings','source'));
  assert.equal(await page.locator('select[name=source-file]').inputValue(),'public/nova/app.js','source editor opens the active native frontend by default');
  assert.equal(await page.getByRole('option',{name:'历史页面 · public/index.html',exact:true}).count(),1);
  await page.getByRole('button',{name:'读取文件',exact:true}).click();
  const source=page.getByRole('textbox',{name:'源文件内容'});await source.fill('const original = 2;');
  await page.getByRole('button',{name:'预览保存',exact:true}).click();await source.fill('const later = 3;');
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行'}).click();
  assert.equal((await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/source'))).body.content,'const original = 2;','source review freezes its own content');
  await page.evaluate(()=>window.renderRoute('settings','release'));
  await page.getByRole('checkbox',{name:'选择发布请求 合成请求甲'}).check();
  await page.getByRole('button',{name:'发布所选请求',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择发布请求 合成请求乙'}).check();
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行'}).click();
  assert.deepEqual((await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/release/publish'))).body.files,['a.json'],'release review freezes its file selection');
  await page.evaluate(()=>window.renderRoute('settings','security'));
  await page.getByRole('button',{name:'生成一次性授权码',exact:true}).click();
  await page.locator('select[name=role]').selectOption('edit');
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行'}).click();
  assert.equal((await page.evaluate(()=>window.calls.findLast(c=>c.path==='/api/auth/code'))).body.role,'view','reviewed device authorization cannot silently escalate from viewer to editor');
  await page.evaluate(()=>window.renderRoute('assets','authority'));
  await page.locator('input[name=maxPositionPct]').fill('50');
  await page.getByRole('button',{name:'预览风险配置',exact:true}).click();
  await page.getByRole('alertdialog').waitFor();
  await page.locator('select[name=accountId]').selectOption('pre');
  await page.getByRole('alertdialog').getByRole('button',{name:'确认执行'}).click();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.path==='/api/research/order-account'&&c.body.action==='configure').length),0,'account change invalidates the reviewed authority plan');
  for(const width of [320,390]){
   await page.setViewportSize({width,height:900});
   for(const [view,subs]of Object.entries(cases))for(const sub of subs){
    await page.evaluate(([view,sub])=>window.renderRoute(view,sub),[view,sub]);await page.waitForTimeout(15);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' '+view+'/'+sub+' page overflow');
   }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('FAYO operations: 19 native views, 6 live state projections, changed-only preference writes, viewer privacy, navigation zero-writes, 4 frozen confirmation plans, authority context invalidation, first-password setup, weekend news refresh, dirty-form retention, and 38 narrow-screen route layouts passed.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
