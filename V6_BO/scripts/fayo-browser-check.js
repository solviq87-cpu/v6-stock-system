#!/usr/bin/env node
'use strict';
// The real independent product modules run against an isolated synthetic HTTP
// transport. Prices are deliberately marked synthetic and never production.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const publicRoot=path.resolve(__dirname,'../public');
const releaseVersion=fs.readFileSync(path.join(publicRoot,'nova/index.html'),'utf8').match(/<meta name="application-version" content="([^"]+)"/)[1];
const output=process.env.FAYO_QA_DIR||process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-browser-'));
fs.mkdirSync(output,{recursive:true});
const sourceAt=Date.parse('2026-11-13T07:00:00Z');
const stocks=Array.from({length:8},(_,i)=>({code:String(600101+i),name:'合成光谱'+(i+1),sector:i%2?'合成材料':'合成能源',price:12.3+i,pct:i%2?-1.2:2.1,score:86-i*3,quoteAt:sourceAt,vendorQuoteAt:sourceAt,quoteSource:'synthetic-friday-provider',source:'synthetic-friday-provider',signals:['合成趋势条件','合成资金条件'],hit:[{id:'fixture-trend',text:'合成趋势条件'},{id:'fixture-volume',text:'合成量能条件'}],hitIds:['fixture-trend','fixture-volume'],explanation:['仅用于隔离浏览器交互检查'],fourteen:i%2===0,bazi:i%2?{verdict:'仅研究'}:null,focused:i<3,riskLevel:'未评估'}));
stocks[7].name='<img src=x onerror=window.fayoInjected=true>';
const candles=Array.from({length:900},(_,i)=>{
 const date=new Date(sourceAt-(899-i)*86400000);
 return {date:date.toISOString().slice(0,10),open:10+i*.01,high:10.4+i*.01,low:9.8+i*.01,close:10.2+i*.01,volume:100000+i*10,amount:1200000+i*100};
}).filter(row=>![0,6].includes(new Date(row.date+'T12:00:00Z').getUTCDay()));
const indices=[['1.000001','上证指数',3210.12,.9],['0.399001','深证成指',10020.32,-.6],['0.399006','创业板指',2100.45,1.2],['1.000688','科创50',1020.4,.3]].map(([code,name,price,pct])=>({code,name,price,pct,quoteAt:sourceAt,quoteSource:'synthetic-friday-provider'}));
let phase='normal',role='edit',holdAnalysis=false,heldAnalysisReply=null,holdMarks=false,heldMarksReply=null;
const requests=[],resources=[];
function state(){
 const rows=phase==='empty'?[]:stocks;
 const dashboard={observedAt:Date.now(),indexObservedAt:sourceAt,source:'合成浏览器数据 · 非真实行情',snapshotDay:phase==='empty'?'20261115':'20261113',snapshotRetained:true,isSnapshot:true,trading:false,indices:phase==='empty'?[]:indices,rows,counts:{candidates:rows.length,focused:3,signals:2,risk:1},mood:{upRatio:62,label:'休市观察',note:'保留合成周五快照'},strategies:[{label:'十四条选股',count:3},{label:'八字口诀',count:2},{label:'GPT 五策略',count:1},{label:'Python 三轮筛选',count:2}],pushes:{items:rows.slice(0,2).map(row=>({...row,stage:'history',triggerAt:sourceAt,sentAt:sourceAt,sendStatus:'sent'}))}};
 return {now:Date.now(),role,trading:false,ready:true,isSnapshot:true,snapshotRetained:true,snapshotDay:phase==='empty'?'20261115':'20261113',dashboard,pool:rows,poolSize:rows.length,stocks:rows,global:[{name:'合成全球指数',price:3210.12,pct:.5}],external:{},auction:{stage:'收盘',strong:rows.slice(0,3),validCount:3,time:'2026-11-13 15:00'},sectors:[{name:'合成能源',pct:1.1,mainInflow:1e8},{name:'合成材料',pct:-.3,mainInflow:-2e7}],ztPool:rows.slice(0,2),ztPre:rows.slice(0,2),trendPool:rows.slice(2,5),trendScan:rows.slice(0,5),steadyUp:rows.slice(3),myrules:{items:rows.slice(0,4)},nextplan:{date:'20261113',applyDate:'20261116',plan:{picked:rows.slice(0,2)}},signals:rows.slice(0,2).map(row=>({...row,title:'合成研究提醒',time:sourceAt})),mainline:{time:sourceAt,items:[{name:'合成能源',pct:1.1,note:'仅合成测试'}]},review:{date:'20261113',ztN:3,items:stocks.slice(0,3).map(row=>({...row,limitUpCount:1,sealAmount:11000000,breakCount:0,turnover:4.2,reason:'合成涨停复盘样本'})),poolEvidence:[{source:'em',tradeDate:'20261113',reportedCount:3,returnedCount:3,uniqueCount:3}]},config:{},cfgSet:{},cfgRange:{},paper:role==='edit'?{pool:{positions:[],trades:[],capital:100000,equity:100000},pre:{positions:[],trades:[],capital:100000,equity:100000}}:{hidden:true},goodNews:{items:[{title:'合成周末公告继续更新',source:'synthetic-news',publishedAt:'2026-11-15T08:00:00+08:00',codes:['600101'],url:'https://example.invalid/synthetic-news'}]},badNews:{items:[]},news:{items:[]}};
}
function respond(url,req,body){
 const p=url.pathname;
 if(p==='/api/lock/status')return {ok:true,role:phase==='revoked'||!req.headers.authorization?null:role,hasPassword:true,hasViewPassword:true,pushRole:'replica',appVer:releaseVersion};
 if(p==='/api/lock/unlock')return body?.password==='synthetic-fayo-password'?{ok:true,role,token:'fayo-synthetic-session'}:{ok:false,error:'合成测试口令不匹配'};
 if(phase==='revoked')return {ok:false,locked:true,needAuth:true,error:'合成设备授权已失效'};
 if(p==='/api/state'||p==='/api/mobile-digest')return state();
 if(p==='/api/quant-picks'||p==='/api/auction-resonance')return {ok:true,asOf:sourceAt,board:url.searchParams.get('board')||'all',count:stocks.length,items:phase==='empty'?[]:stocks,snapshotDay:'20261113',snapshotRetained:true,isSnapshot:true,note:'合成周五完成的扫描'};
 if(p==='/api/v6/matches')return {ok:true,snapshotId:'synthetic-friday',scope:'quant-picks-six-rules',asOf:sourceAt,totalStocks:stocks.length,totalSignals:16,items:stocks,hasMore:false,nextCursor:null};
 if(p==='/api/kline'){
  const end=url.searchParams.get('end'),limit=Math.min(240,Math.max(1,Number(url.searchParams.get('n')||120)));
  const rows=candles.filter(row=>!end||row.date<end).slice(-limit);
  return {ok:true,code:url.searchParams.get('code'),rows,asOf:'2026-11-13',source:'synthetic-friday-provider',dataQuality:{tradeDate:'2026-11-13',source:'synthetic-friday-provider',freshness:'snapshot-only'}};
 }
 if(p==='/api/search')return {ok:true,items:stocks,results:stocks};
 if(p==='/api/analyze')return {ok:true,code:url.searchParams.get('code'),name:'合成光谱1',price:12.3,pct:2.1,quoteAt:sourceAt,quoteSource:'synthetic-friday-provider',signals:['合成趋势条件'],explanation:['合成历史依据'],score:86};
 if(p==='/api/kline-marks')return {ok:true,items:[]};
 if(p==='/api/holdings')return {ok:true,items:[],summary:{capital:100000,totalCost:0,equity:100000},cfg:{stopPct:7,reducePct:4,takePct:15,maxPosPct:30},allTags:[],time:sourceAt};
 if(p==='/api/paper')return {ok:true,paper:{pool:{...state().paper.pool,name:'合成策略跟踪',cash:88888.88,initial:100000,totalPnl:345.67,totalPct:.35,enabled:true,positions:[],trades:[]},pre:{...state().paper.pre,name:'合成机会预选',cash:50000,initial:50000,totalPnl:0,totalPct:0,enabled:true,positions:[],trades:[]}}};
 if(p==='/api/paper/ledger')return {ok:true,paper:{pool:{schemaVersion:1,mode:'authoritative-paper-readonly-projection',accountId:'pool',paperOnly:true,canSubmitOrders:false,canCancelOrders:false,accounting:{initialCash:100000,cash:88888.88,realizedPnl:345.67,positions:[{code:'600101',shares:100,basis:1230}],tradeCount:1,auditStatus:'passed'},events:[{type:'FILL_RECORDED',side:'BUY',code:'600101',shares:100,price:12.3,amount:1230,fee:5,t:sourceAt,tradeDate:'2026-11-13',timeQuality:'known'}]},pre:{accountId:'pre',accounting:{initialCash:50000,cash:50000,realizedPnl:0,positions:[],tradeCount:0,auditStatus:'passed'},events:[]}}};
 if(p==='/api/push-log')return {ok:true,items:[]};
 if(p==='/api/lock/devices'||p==='/api/devices')return {ok:true,items:[],devices:[],online:[]};
 if(p==='/api/release/requests')return {ok:true,requests:[],items:[]};
 if(p==='/api/source')return {ok:true,file:url.searchParams.get('file')||'server.js',content:'// synthetic source fixture'};
 if(p==='/api/lock/phone')return {ok:true,bound:false};
 if(p==='/api/research/workspace')return {ok:true,result:{runs:[],total:0,items:[],selectedRun:null,preferences:{revision:0,value:{}},presets:[],timeline:[]}};
 if(p==='/api/learn-status')return {ok:true,status:{counts:{total:0,pending:0,matured:0},operation:{state:'idle'}}};
 if(p==='/api/research/learning-runtime')return {ok:true,result:{mode:'v6-learning-runtime-preflight',configuration:{status:'unconfigured'},overall:'unconfigured',current:{status:'unconfigured'},model:{status:'disabled'},lastRun:null}};
 if(p==='/api/strategy/dashboard')return {ok:true,strategies:state().dashboard.strategies,items:[],snapshotDay:'20261113'};
 if(p==='/api/research/strategy36')return {ok:true,result:{items:[],strategies:[]},items:[],catalog:[]};
 if(p.startsWith('/api/research/'))return {ok:true,result:{items:[],rows:[],records:[],status:'unconfigured',readOnly:true},items:[]};
 return {ok:true,items:[],rows:[],devices:[],requests:[]};
}
const aliases=new Set(['/','/m','/index.html','/mobile.html','/picks.html','/auction-picks.html','/reference-dashboard.html','/research.html','/model-library.html','/v6-studio.html','/v6-matches.html','/v6-research.html','/v6-validation.html','/v6-paper.html','/v6-market-radar.html']);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){
  let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
   let body;try{body=raw?JSON.parse(raw):null;}catch{body='invalid-json';}
   requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,body,authorization:req.headers.authorization||''});
   res.setHeader('Content-Type','application/json; charset=utf-8');
   if(holdAnalysis&&url.pathname==='/api/analyze'&&url.searchParams.get('code')==='600101'){holdAnalysis=false;heldAnalysisReply=()=>res.end(JSON.stringify({ok:true,code:'600101',privateNote:'late-analysis-A-must-not-paint'}));return;}
   if(holdMarks&&url.pathname==='/api/kline-marks'){holdMarks=false;heldMarksReply=()=>res.end(JSON.stringify({ok:true,items:[{note:'late-marks-wrong-date-must-not-paint'}]}));return;}
   res.end(JSON.stringify(respond(url,req,body)));
  });return;
 }
 try{
  const resource=aliases.has(url.pathname)?'nova/index.html':decodeURIComponent(url.pathname.slice(1));
  const file=path.resolve(publicRoot,resource);
  if(!file.startsWith(publicRoot+path.sep))throw Error('outside root');
  resources.push(url.pathname);
  const ext=path.extname(file);
  res.setHeader('Content-Type',ext==='.css'?'text/css':ext==='.js'?'application/javascript':ext==='.json'?'application/json':ext==='.svg'?'image/svg+xml':'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});

async function navigate(page,view,sub='') {
 const control=page.locator('[data-fy-route="'+view+'"]:visible').first();
 if(await control.count())await control.click();
 else await page.evaluate(({view,sub})=>{location.hash='#/'+view+(sub?'/'+sub:'');},{view,sub});
 if(sub)await page.evaluate(({view,sub})=>{location.hash='#/'+view+'/'+sub;},{view,sub});
 await page.waitForFunction(view=>location.hash.startsWith('#/'+view),view);
}
async function geometry(page,label){
 const result=await page.evaluate(()=>{
  const visible=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden';};
  const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
  return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
   duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),
   docks:[...document.querySelectorAll('.fy-dock')].filter(visible).length,
   iframeCount:document.querySelectorAll('iframe').length,
   oldShells:document.querySelectorAll('.vx-shell,.vx-sidebar,.workspace-header,#vx-dashboard').length,
   offenders:[...document.querySelectorAll('body *')].filter(visible).map(node=>({tag:node.tagName,cls:typeof node.className==='string'?node.className:'svg',right:node.getBoundingClientRect().right,width:node.getBoundingClientRect().width})).filter(node=>node.right>innerWidth+1).slice(0,15),
   brand:document.querySelector('.fy-header')?.innerText||'',
   brandBox:(()=>{const r=document.querySelector('.fy-brand')?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null;})()};
 });
 assert.ok(result.scrollWidth<=result.width+1,label+' never clips content horizontally: '+JSON.stringify(result));
 assert.deepEqual(result.duplicateIds,[],label+' has no duplicate identities');
 assert.equal(result.iframeCount,0,label+' does not embed a previous page');
 assert.equal(result.oldShells,0,label+' does not retain the previous shell');
 assert.match(result.brand,/天枢智策|绯曜|FAYO/i,label+' the approved V6 product brand is visible');
 assert.ok(result.brandBox&&result.brandBox.top>=-1&&result.brandBox.left>=0&&result.brandBox.right<=result.width+1&&result.brandBox.height>0,label+' new brand mark and name stay in the visible header: '+JSON.stringify(result.brandBox));
 return result;
}
const runChecks=async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 const report=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const origin='http://127.0.0.1:'+server.address().port;
  const widths=process.env.FAYO_UI_WIDTHS?process.env.FAYO_UI_WIDTHS.split(',').map(Number) :[320,390,402,768,1366,1920];
  for(const width of widths){
   phase='normal';role='edit';
   const context=await browser.newContext({
    viewport:{width,height:width===402?874:width<500?900:1000},
    deviceScaleFactor:width===402?3:1,isMobile:width===402,hasTouch:width===402,
    serviceWorkers:'block'
   });
   await context.addInitScript(()=>{localStorage.setItem('qd_device','fayo-synthetic-session');localStorage.setItem('qd_role','edit');});
   const page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.href);return route.abort();}return route.continue();});
   const before=requests.length;
   await page.goto(origin+'/');
   await page.locator('.fy-header').waitFor({state:'visible'});
   await page.locator('.fy-stock-card[data-code="600101"]').first().waitFor({state:'visible'});
   assert.equal(await page.locator('.fy-nav [data-fy-route]').count(),5,'five entirely new primary workspaces');
   if(width<500){assert.equal(await page.locator('.fy-dock [data-fy-route]').count(),5,'mobile primary destinations share the new five-space model');}
   const metrics=await geometry(page,'pulse-'+width);
   await page.screenshot({path:path.join(output,'fayo-pulse-'+width+'.png'),fullPage:false});
   if(width===402){
    const actual=await page.evaluate(()=>{
     const indices=[...document.querySelectorAll('.fy-terminal-index .fy-market-ticker>div')]
      .map(node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width};});
     return {width:innerWidth,devicePixelRatio,visibleReview:[...document.querySelectorAll('.fy-terminal-mobile-stock')]
      .filter(node=>getComputedStyle(node).display!=='none').length,
      tableDisplay:getComputedStyle(document.querySelector('.fy-terminal-desktop-table')).display,
      indexCards:indices,stickyDock: getComputedStyle(document.querySelector('.fy-dock')).position};
    });
    assert.equal(actual.width,402,'iPhone 17 Pro content uses 402 CSS px width');
    assert.equal(actual.devicePixelRatio,3,'iPhone 17 Pro browser emulation uses DPR 3');
    assert.ok(actual.visibleReview>=3,'real mobile review cards are displayed at the target size');
    assert.equal(actual.tableDisplay,'none','mobile cards replace desktop wide table at 402px');
    assert.equal(actual.indexCards.length,4,'four existing source-timestamped indices remain available');
    assert.equal(actual.indexCards[0].top,actual.indexCards[1].top,'iPhone first index row has two columns');
    assert.ok(actual.indexCards[2].top>actual.indexCards[0].top,'iPhone shows second row of indices');
    assert.equal(actual.stickyDock,'fixed','phone navigation stays accessible near the home indicator');
    await page.setViewportSize({width:402,height:714});
    await geometry(page,'iphone17pro-safari-compact-402x714');
    await page.screenshot({path:path.join(output,'iphone17pro-402x714.png'),fullPage:false});
    await page.setViewportSize({width:402,height:874});
   }
   await navigate(page,'opportunities','quant');
   await page.waitForFunction(()=>document.querySelectorAll('.fy-pool-board .fy-stock-card').length===8);
   assert.equal(await page.locator('.fy-stage-chip').count(),3,'all three workflow stage counts remain visible');
   assert.equal(await page.locator('.fy-pool-column').count(),1,'only populated stages consume card space');
   assert.equal(await page.locator('.fy-pool-column .fy-empty').count(),0,'empty stage panels never push actual opportunities below the fold');
   assert.match(await page.locator('.fy-main').innerText(),/2026[-/]11[-/]13/,'Friday source date remains visible');
   assert.equal(await page.locator('img[src="x"]').count(),0,'provider names are text, never executable markup');
   assert.equal(await page.evaluate(()=>window.fayoInjected),undefined,'provider strings cannot execute');
   await geometry(page,'opportunities-'+width);
   await page.screenshot({path:path.join(output,'fayo-opportunities-'+width+'.png'),fullPage:false});

   const originCard=page.locator('.fy-stock-card[data-code="600101"]').first();
   await originCard.click();
   const drawer=page.locator('.fy-stock-drawer');
   await drawer.waitFor({state:'visible'});
   await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/2026[-/]11[-/]13/,'drawer preserves original provider date');
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/synthetic-friday-provider/,'drawer shows original provider');
   assert.match(await drawer.locator('.fy-quote-time').innerText(),/历史/,'old prices are explicitly historical');
   assert.equal(await drawer.locator('[data-period]').count(),3,'day, month and year controls remain real interactions');
   for(const period of ['month','year','day']){
    await drawer.locator('[data-period="'+period+'"]').click();
    assert.equal(await drawer.locator('[data-period="'+period+'"]').getAttribute('aria-pressed'),'true','period selection is explicit');
    await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
   }
   const priorPages=requests.filter(r=>r.path==='/api/kline').length;
   await drawer.getByRole('button',{name:'加载更早的历史',exact:true}).click();
   await page.waitForTimeout(80);
   assert.ok(requests.filter(r=>r.path==='/api/kline').length>priorPages,'older history reads actual service pages');
   assert.ok(requests.some(r=>r.path==='/api/kline'&&r.query.end),'history pagination uses an older-date boundary');
   await page.screenshot({path:path.join(output,'fayo-stock-lens-'+width+'.png'),fullPage:false});
   await drawer.press('Escape');
   assert.equal(await drawer.isVisible(),false,'Escape closes the stock research panel');
   assert.equal(await originCard.evaluate(node=>document.activeElement===node),true,'focus returns to the selected opportunity');
   if(width===1366){
    await originCard.click();
    await drawer.locator('[data-detail-tab="marks"]').click();
    await drawer.getByLabel('标记交易日',{exact:true}).fill('2026-11-12');
    holdMarks=true;
    const pendingMarks=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/kline-marks');
    await drawer.getByRole('button',{name:'读取原始标记',exact:true}).click();
    await pendingMarks;
    for(let retry=0;retry<20&&!heldMarksReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldMarksReply,'function');
    await drawer.getByLabel('标记交易日',{exact:true}).fill('2026-11-13');
    heldMarksReply();heldMarksReply=null;
    await page.waitForTimeout(60);
    assert.doesNotMatch(await drawer.textContent(),/late-marks-wrong-date-must-not-paint/,'changing the date invalidates in-flight signal marks');
    await drawer.locator('[data-detail-tab="analysis"]').click();
    holdAnalysis=true;
    const pendingTab=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/analyze');
    await drawer.getByRole('button',{name:'读取分析',exact:true}).click();
    await pendingTab;
    for(let retry=0;retry<20&&!heldAnalysisReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldAnalysisReply,'function');
    await drawer.locator('[data-detail-tab="company"]').click();
    heldAnalysisReply();heldAnalysisReply=null;
    await page.waitForTimeout(60);
    assert.match(await drawer.innerText(),/公司原始公告/,'late diagnosis does not paint over a newly selected evidence tab');
    assert.doesNotMatch(await drawer.innerText(),/late-analysis-A-must-not-paint/);
    await drawer.press('Escape');
    await originCard.click();
    await drawer.locator('[data-detail-tab="analysis"]').click();
    holdAnalysis=true;
    const analyzing=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/analyze');
    await drawer.getByRole('button',{name:'读取分析',exact:true}).click();
    await analyzing;
    for(let retry=0;retry<20&&!heldAnalysisReply;retry++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(typeof heldAnalysisReply,'function','diagnosis response is held independently of UI selection');
    await drawer.press('Escape');
    await page.locator('.fy-stock-card[data-code="600102"]').first().click();
    await drawer.locator('.fy-chart svg').waitFor({state:'visible'});
    heldAnalysisReply();heldAnalysisReply=null;
    await page.waitForTimeout(60);
    assert.match(await drawer.locator('.fy-drawer-title').innerText(),/600102/,'late A diagnosis cannot replace selected B');
    assert.equal(await drawer.locator('.fy-chart svg').isVisible(),true,'late A diagnosis cannot replace B chart');
    assert.doesNotMatch(await drawer.innerText(),/late-analysis-A-must-not-paint/,'late private analysis is discarded');
    await drawer.press('Escape');
   }
   const search=page.getByRole('searchbox',{name:'筛选股票池'});
   await search.fill('合成光谱1');
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),1,'pool search actually filters its cards');
   await search.fill('');
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),8);

   // A same-session empty response cannot erase Friday's known pool. This
   // covers both /state and the independent quant results, not just a banner.
   phase='empty';
   await page.getByRole('button',{name:'刷新云端数据',exact:true}).click();
   await page.waitForTimeout(100);
   await page.getByRole('button',{name:'读取最新结果',exact:true}).click();
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.fy-pool-board .fy-stock-card').count(),8,'weekend empty replies retain the last valid Friday cards');
   assert.match(await page.locator('.fy-snapshot').innerText(),/2026[-/]11[-/]13/,'the retained dashboard banner keeps its source day when the empty read carries a newer date');
   assert.match(await page.locator('.fy-main').innerText(),/2026[-/]11[-/]13/);
   phase='normal';
   for(const view of ['lab','assets','settings','pulse']){
    await navigate(page,view);
    await page.waitForTimeout(40);
    await geometry(page,view+'-'+width);
   }
   await navigate(page,'assets','ledger');
   await page.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('88,888.88'));
   assert.match(await page.locator('.fy-main').innerText(),/600101/,'ledger reads authoritative accounting.positions');
   assert.match(await page.locator('.fy-main').innerText(),/345\.67/,'ledger reads authoritative realizedPnl');
   await page.screenshot({path:path.join(output,'fayo-ledger-'+width+'.png'),fullPage:false});
   const browsing=requests.slice(before);
   const mutations=browsing.filter(r=>r.method!=='GET'&&!(r.path==='/api/research/order-account'&&['read','audit'].includes(r.body?.action))&&!(r.path==='/api/research/paper-account'&&r.body?.action==='read')&&r.path!=='/api/online/beat');
   assert.deepEqual(mutations,[],'normal navigation never submits account, scan, publish or notification actions');
   phase='revoked';
   await page.getByRole('button',{name:'刷新云端数据',exact:true}).click();
   await page.locator('.fy-gate').waitFor({state:'visible'});
   assert.equal(await page.locator('.fy-stock-card').count(),0,'authorization loss removes retained cards, not just their visibility');
   assert.equal(await page.locator('.fy-stock-drawer:visible').count(),0,'authorization loss removes stock lens');
   assert.doesNotMatch(await page.locator('body').innerText(),/合成光谱|88,888\.88/,'private/previous market content clears on revoke');
   assert.equal(await page.evaluate(()=>localStorage.getItem('qd_device')),null,'revoked device token is cleared');
   assert.deepEqual(errors,[],'no application exceptions at '+width);
   assert.deepEqual(external,[],'no third-party data/font/model requests at '+width);
   report.push({width,metrics,requests:browsing.length,checks:['new-native-shell','five-workspaces','workflow-board','source-date','three-period-chart','older-history','focus-return','local-filter','weekend-retention','accounting-schema','no-automatic-writes','revocation-clears','no-external-egress']});
   await context.close();
  }
  // Read-only access remains usable without attempting editor endpoints.
  phase='normal';role='view';
  const reader=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  await reader.addInitScript(()=>{localStorage.setItem('qd_device','fayo-synthetic-reader');localStorage.setItem('qd_role','view');});
  const readPage=await reader.newPage(),readerStart=requests.length;
  await readPage.goto(origin+'/');await readPage.locator('.fy-header').waitFor({state:'visible'});
  await navigate(readPage,'assets','holdings');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('私人工作区'));
  await navigate(readPage,'settings','channels');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('私人工作区'));
  await navigate(readPage,'opportunities','wash');
  await readPage.waitForFunction(()=>document.querySelector('.fy-main')?.textContent.includes('需要开发者权限'));
  assert.equal(await readPage.locator('.fy-header').isVisible(),true,'a restricted tool does not log out an otherwise valid reader');
  const readerRequests=requests.slice(readerStart);
  assert.equal(readerRequests.filter(r=>['/api/holdings','/api/config','/api/wash-trend','/api/paper','/api/lock/devices'].includes(r.path)).length,0,'viewer navigation never attempts protected operations');
  await readPage.screenshot({path:path.join(output,'fayo-readonly-390.png'),fullPage:false});
  await readPage.getByRole('button',{name:'账户与授权',exact:true}).click();
  await readPage.getByRole('dialog',{name:'身份与访问',exact:true}).getByRole('button',{name:'切换登录身份',exact:true}).click();
  await readPage.locator('.fy-gate').waitFor({state:'visible'});
  assert.equal(await readPage.evaluate(()=>localStorage.getItem('qd_device')),null,'switching identity clears the prior device session');
  assert.equal(await readPage.locator('.fy-stock-card,.fy-stock-drawer').count(),0,'switching identity physically clears the previous research views');
  report.push({kind:'readonly',width:390,checks:['restricted-features-explained','no-private-endpoint-attempt','valid-reader-session-retained','native-identity-switch','prior-session-and-views-cleared']});
  await reader.close();

  phase='normal';role='edit';
  const anonymous=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'}),gatePage=await anonymous.newPage();
  await gatePage.goto(origin+'/');await gatePage.locator('.fy-gate').waitFor({state:'visible'});
  assert.equal(await gatePage.locator('.fy-header').count(),0,'anonymous users receive the new gate before market/account views');
  await gatePage.locator('.fy-gate input[name="password"]').fill('wrong-synthetic-password');
  await gatePage.getByRole('button',{name:'进入绯曜',exact:true}).click();
  await gatePage.waitForFunction(()=>document.querySelector('.fy-gate .fy-note')?.textContent.includes('不匹配'));
  assert.equal(await gatePage.locator('.fy-gate').isVisible(),true,'wrong password never opens the product');
  await gatePage.screenshot({path:path.join(output,'fayo-gate-390.png'),fullPage:false});
  await gatePage.locator('.fy-gate input[name="password"]').fill('synthetic-fayo-password');
  await gatePage.getByRole('button',{name:'进入绯曜',exact:true}).click();
  await gatePage.locator('.fy-header').waitFor({state:'visible'});
  assert.equal(await gatePage.evaluate(()=>localStorage.getItem('qd_device')),'fayo-synthetic-session','successful login uses the issued device token');
  assert.equal(await gatePage.locator('input[type=password]').count(),0,'the login password is removed from mounted product UI');
  assert.equal(await gatePage.evaluate(()=>Object.values(localStorage).some(value=>value.includes('synthetic-fayo-password'))),false,'password is never persisted as browser state');
  report.push({kind:'fresh-login',width:390,checks:['new-gate','wrong-password-denied','real-login-form','token-only-persistence','password-cleared']});
  await anonymous.close();

  const oldResources=resources.filter(resource=>/\/assets\/(?:app|terminal-dashboard|unified-workspace|original-workspace|v6-design|reference-match)\.(?:js|css)/.test(resource));
  assert.deepEqual(oldResources,[],'new frontend never loads the previous frontend');
  assert.ok(resources.some(resource=>resource.startsWith('/nova/app.js'))&&resources.some(resource=>resource.startsWith('/nova/fayo.css')),'the actual new product assets loaded');
  fs.writeFileSync(path.join(output,'fayo-browser-report.json'),JSON.stringify({scope:'real new FAYO modules and CSS; synthetic isolated HTTP only; no actual account/market/physical-device certification',report,requests,resources},null,2));
  console.log('FAYO native product: '+report.length+' scenarios across '+widths.length+' viewport widths passed; report and synthetic-data screenshots '+output);
 }finally{if(heldAnalysisReply){heldAnalysisReply();heldAnalysisReply=null;}if(heldMarksReply){heldMarksReply();heldMarksReply=null;}await browser?.close();await new Promise(resolve=>server.close(resolve));}
};
if(require.main===module)runChecks().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
module.exports={server,state,stocks,indices,candles,requests,resources,output,aliases,get phase(){return phase;},set phase(value){phase=value;},get role(){return role;},set role(value){role=value;}};
