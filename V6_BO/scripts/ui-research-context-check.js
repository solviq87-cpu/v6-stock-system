#!/usr/bin/env node
'use strict';
// Actual picks/research pages with explicitly synthetic archives and transport.
// Selection never contacts a market source or executes a write operation.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-stock-context-')),publicRoot=path.resolve(__dirname,'../public');
const output=process.env.V6_UI_QA_DIR||path.join(temporary,'screenshots');fs.mkdirSync(output,{recursive:true});
const archive=path.join(temporary,'archive');
for(const [index,symbol] of [[70,'600000'],[71,'600001']])S.appendEvent(archive,'analysis',D.buildWorkspaceDecision(fixture({index,symbol})),{requestId:'context_fixture_'+symbol,now:at(index)});
const screen=S.appendEvent(archive,'screen',D.screeningRecord({items:['600000','600001'].map(symbol=>({symbol,name:'合成筛选股'+symbol,quality:{usable:true,errors:[]},score:10,blockedBySafety:false,strategy:{pass:true},tradable:true}))},{provenance:'synthetic-context-only',asOf:at(72)}),{requestId:'context_screen_fixture',now:at(72)});
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(!['/research.html','/picks.html'].includes(p)&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}
 catch{res.writeHead(404);res.end();}
});
const symbols=['workspaceSymbol','captureSymbol','newsEvidenceSymbol','linkedMemorySymbol','linkedPublicSymbol','research36Symbol'];
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:1000}}),requests=[],errors=[],external=[];let hold=false,release,heldResolve;
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>localStorage.setItem('qd_token','synthetic-context-view-token'));
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    requests.push({method:req.method(),path:url.pathname,url:req.url()});
    if(url.pathname==='/api/quant-picks')return route.fulfill({json:{snapshotDay:'2026-11-06',items:[
     {code:'600519',name:'合成股票甲',score:0,hit:[]},{code:'600519&token=untrusted',name:'合成坏代码',hit:[]}]}});
    if(url.pathname==='/api/research/workspace'){
     assert.equal(req.method(),'GET','context navigation cannot write');
     if(hold){hold=false;heldResolve();await new Promise(r=>release=r);}
     if(req.headers().authorization!=='Bearer synthetic-context-editor')return route.fulfill({status:403,json:{ok:false,error:'synthetic denial'}}).catch(()=>{});
     const query=Object.fromEntries(url.searchParams);for(const key of ['asOf','offset','limit','minScore'])if(key in query)query[key]=Number(query[key]);
     return route.fulfill({json:{ok:true,result:W.workspaceView(archive,query)}}).catch(()=>{});
    }
    if(url.pathname==='/api/research/stock-memory')return route.fulfill({json:{ok:true,result:{symbol:url.searchParams.get('symbol'),totalRevisions:1,revisions:[{revision:1,decisionAt:at(70),recordedAt:at(70),note:'合成旧股私有记忆'}]}}});
    return route.fulfill({status:403,json:{ok:false,error:'synthetic unused endpoint'}});
   });
   const select=async(symbol,provider='')=>{await page.locator('#researchContextSymbol').fill(symbol);await page.locator('#researchContextProvider').selectOption(provider);await page.locator('#researchContextForm button[type=submit]').click();};
   const read=async()=>{await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));};
   const selectedRun=()=>page.locator('#workspaceContent [data-workspace-run][aria-pressed=true]').getAttribute('data-workspace-run');
   await page.goto(origin+'/picks.html');await page.waitForFunction(()=>document.querySelectorAll('.pick').length===2);
   const href=await page.locator('.pick').first().locator('a').getAttribute('href');
   assert.equal(href,'/research.html?symbol=600519#researchWorkspace');assert.equal(new URL(href,origin).searchParams.get('token'),null);
   assert.equal(await page.locator('.pick').nth(1).locator('a').getAttribute('href'),'/research.html#researchWorkspace');
   await page.locator('.pick').first().locator('a').click();
   await page.waitForFunction(()=>document.getElementById('researchContextCurrent').textContent.includes('600519'));
   for(const id of symbols)assert.equal(await page.locator('#'+id).inputValue(),'600519');
   assert.equal(await page.locator('#token').inputValue(),'');
   assert.equal(requests.filter(r=>r.path==='/api/research/workspace').length,0);
   assert.equal(requests.filter(r=>r.path==='/api/research/news-evidence').length,0);
   const before=requests.length;await select('600000','tencent');assert.equal(requests.length,before);
   for(const id of symbols)assert.equal(await page.locator('#'+id).inputValue(),'600000');
   for(const id of ['workspaceProvider','captureProvider'])assert.equal(await page.locator('#'+id).inputValue(),'tencent');
   const news=page.locator('[data-research-target=news]');await news.focus();await news.press('Enter');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'newsEvidenceSymbol');assert.equal(requests.length,before);
   await page.locator('#workspaceSymbol').fill('600001');await page.locator('#captureSymbol').fill('000003');
   await news.click();assert.equal(await page.locator('#workspaceSymbol').inputValue(),'600001');assert.equal(await page.locator('#captureSymbol').inputValue(),'000003');
   assert.ok((await page.locator('#researchContextStatus').textContent()).includes('分区代码不同'));assert.equal(requests.length,before);
   await select('600000','tencent');
   await page.locator('#token').fill('synthetic-context-editor');
   assert.ok((await page.locator('#researchContextCurrent').innerText()).includes('尚未选择'));
   assert.equal(await page.locator('#workspaceSymbol').inputValue(),'600000','auth entry retains candidate identity but clears prior private views');
   await select('600000','tencent');await read();
   const run=await selectedRun(),sameStockRequests=requests.length;
   await page.locator('[data-research-target=workspace]').click();
   assert.equal(await selectedRun(),run);assert.equal(requests.length,sameStockRequests);
   await page.evaluate(()=>dispatchEvent(new CustomEvent('v6:research-context',{detail:{symbol:'600000',provider:'tencent',runId:'private-not-carried',token:'private-not-carried'}})));
   assert.equal(await selectedRun(),run);assert.equal(await page.locator('#token').inputValue(),'synthetic-context-editor');
   assert.equal(requests.length,sameStockRequests);
   await page.locator('#linkedMemoryRead').click();await page.waitForFunction(()=>document.getElementById('linkedMemoryStatus').textContent.startsWith('已读取'));
   assert.ok((await page.locator('#linkedMemorySummary').textContent()).includes('600000'));
   const native=page.locator('#workspaceNativeFile');await native.setInputFiles({name:'synthetic-native.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({pythonEvidence:{symbol:'600000'}}))});
   await page.waitForFunction(()=>document.getElementById('workspaceNativeStatus').textContent.includes('600000'));
   hold=true;const held=new Promise(r=>heldResolve=r);await page.locator('#workspaceRead').click();await held;
   const atHold=requests.length;await select('600001','tencent');
   assert.equal(requests.length,atHold);assert.equal(await native.evaluate(e=>e.files.length),0);
   assert.equal(await page.locator('#workspaceContent').textContent(),'');
   assert.equal(await page.locator('#linkedMemorySummary').textContent(),'');
   assert.equal(await page.locator('#linkedMemoryOutput').textContent(),'');
   assert.equal(requests.filter(r=>r.path==='/api/research/stock-memory').length,1,'stock switch only clears memory; it must not read another stock automatically');
   release();await page.waitForTimeout(40);assert.equal(await page.locator('#workspaceContent').textContent(),'','old stock reply cannot repopulate a new selection');
   await page.locator('#workspaceAsOf').fill('2026-11-01T09:30');
   await page.locator('#workspaceSymbol').fill('');await read();
   const screenLoaded=page.waitForResponse(r=>r.url().includes('/api/research/workspace'));
   await page.locator('#workspaceScreenRun').selectOption(screen.hash);await screenLoaded;
   await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   await page.getByRole('tab',{name:'筛选与落选',exact:true}).click();
   const changedRow=page.locator('#workspaceContent details').filter({has:page.locator('[data-workspace-symbol="600000"]')});await changedRow.locator('summary').click();
   const beforeDrill=requests.filter(r=>r.path==='/api/research/workspace').length;
   await changedRow.locator('[data-workspace-symbol="600000"]').click();
   await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   assert.equal(requests.filter(r=>r.path==='/api/research/workspace').length,beforeDrill+1);
   const drill=new URL(requests.filter(r=>r.path==='/api/research/workspace').at(-1).url).searchParams;
   assert.equal(drill.get('symbol'),'600000');assert.equal(drill.get('offset'),'0');assert.equal(drill.get('screenId'),screen.hash);assert.equal(drill.get('asOf'),String(Date.parse('2026-11-01T09:30:00+08:00')));assert.equal(drill.get('runId'),null);
   assert.ok((await page.locator('#researchContextCurrent').textContent()).includes('600000'));
   assert.equal(await page.evaluate(()=>document.activeElement.id),'workspaceContent');
   const pinned=await selectedRun();await page.getByRole('tab',{name:'筛选与落选',exact:true}).click();
   const sameRow=page.locator('#workspaceContent details').filter({has:page.locator('[data-workspace-symbol="600000"]')});await sameRow.locator('summary').click();await sameRow.locator('[data-workspace-symbol="600000"]').click();
   await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   assert.equal(await selectedRun(),pinned);assert.equal(new URL(requests.filter(r=>r.path==='/api/research/workspace').at(-1).url).searchParams.get('runId'),pinned);
   assert.equal(await page.locator('#workspaceAsOf').inputValue(),'2026-11-01T09:30');
   assert.ok((await page.locator('#researchContextStatus').textContent()).includes('历史时点'));
   await page.locator('#newsEvidenceSymbol').fill('000002');
   await page.locator('#researchContextClear').click();assert.equal(await page.locator('#workspaceSymbol').inputValue(),'');
   assert.equal(await page.locator('#newsEvidenceSymbol').inputValue(),'000002');
   assert.equal(await page.locator('#workspaceAsOf').inputValue(),'2026-11-01T09:30');
   await select('600000');const offlineRequests=requests.length;
   await page.evaluate(()=>dispatchEvent(new Event('offline')));
   assert.ok((await page.locator('#researchContextCurrent').textContent()).includes('尚未选择'));
   assert.equal(await page.locator('[data-research-target=workspace]').isDisabled(),true);assert.equal(requests.length,offlineRequests);
   await select('600000');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const geometry=await page.locator('#researchContext button').evaluateAll(elements=>elements.map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})));
   assert.ok(geometry.every(r=>r.height>=44&&r.width>0));
   await page.locator('#researchContext').screenshot({path:path.join(output,'research-context-'+width+'.png')});
   assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   await page.goto(origin+'/research.html?symbol=600000&symbol=600001&token=untrusted#researchWorkspace');
   assert.equal(await page.locator('#workspaceSymbol').inputValue(),'');assert.equal(await page.locator('#token').inputValue(),'');
   await page.close();console.log('research stock context UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
