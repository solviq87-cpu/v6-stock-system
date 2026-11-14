#!/usr/bin/env node
'use strict';
// Actual research page and core archives; synthetic records and loopback-only API.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-navigation-browser-')),publicRoot=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||temporary;
fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
function seed(root){
 const oldData=D.buildWorkspaceDecision(fixture());oldData.name='合成旧版导航研究';const old=S.appendEvent(root,'analysis',oldData,{requestId:'navigation_old_001',now:at(70)});
 let latest;
 for(let i=0;i<27;i++){const d=D.buildWorkspaceDecision(fixture({index:71}));d.name='合成更新导航研究';d.asOf+=i;latest=S.appendEvent(root,'analysis',d,{requestId:'navigation_new_'+String(i).padStart(3,'0'),now:at(71)+i});}
 return {old,latest};
}
(async()=>{
 let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const root=path.join(temporary,'workspace-'+width),data=seed(root),page=await browser.newPage({viewport:{width,height:1000}}),requests=[],apiRequests=[],errors=[],external=[];
   let heldRead=null,lastView;
   function holdNextRead(failure=false){
    const gate={failure};gate.started=new Promise(r=>gate.markStarted=r);gate.wait=new Promise(r=>gate.release=r);gate.done=new Promise(r=>gate.markDone=r);heldRead=gate;return gate;
   }
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    apiRequests.push({method:req.method(),path:url.pathname});assert.equal(req.method(),'GET','navigation page API must not write: '+url.pathname);
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'synthetic unrelated permission denial'}});
    requests.push({method:req.method(),query:Object.fromEntries(url.searchParams)});
    if(req.headers().authorization!=='Bearer navigation-fixture-editor')return route.fulfill({status:403,json:{ok:false,error:'synthetic permission denial'}});
    const gate=heldRead;if(gate){heldRead=null;gate.markStarted();await gate.wait;}
    try{
     if(gate?.failure)return await route.fulfill({status:503,json:{ok:false,error:'synthetic navigation unavailable'}});
     const q=Object.fromEntries(url.searchParams);for(const k of ['asOf','offset','limit','minScore'])if(k in q)q[k]=Number(q[k]);const v=W.workspaceView(root,q);
     if(url.searchParams.get('export')==='1')return await route.fulfill({json:{ok:true,result:W.exportResearch(v)}});
     lastView=v;return await route.fulfill({json:{ok:true,result:v}});
    }finally{gate?.markDone();}
   });
   const panel=page.locator('#workspaceContent'),status=page.locator('#workspaceStatus'),tabs=page.locator('#workspaceTabs [role=tab]'),tab=key=>page.locator('#workspaceTab-'+key);
   async function loaded(){await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));}
   async function active(id){assert.equal(await page.evaluate(()=>document.activeElement.id),id);}
   async function selected(key){assert.equal(await tab(key).getAttribute('aria-selected'),'true');assert.equal(await panel.getAttribute('aria-labelledby'),'workspaceTab-'+key);}
   async function read(){await page.locator('#workspaceRead').click();await loaded();}
   async function paginate(name,{moveFocus=false,failure=false}={}){
    const gate=holdNextRead(failure),next=panel.getByRole('button',{name,exact:true});await next.focus();await next.press('Enter');await gate.started;await active('workspaceStatus');
    if(moveFocus)await page.locator('#workspaceSymbol').focus();gate.release();await gate.done;
    if(failure){await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('synthetic navigation unavailable'));await active('workspaceStatus');assert.equal(await panel.innerText(),'');assert.equal(await page.locator('#workspaceExport').isDisabled(),true);}
    else{await loaded();await active(moveFocus?'workspaceSymbol':'workspaceContent');if(!moveFocus){const box=await panel.boundingBox();assert.ok(box.y>=-1&&box.y<100,'new page should scroll to content start: '+box.y);}}
   }
   await page.goto(origin+'/research.html');assert.equal(requests.length,0);await page.locator('#token').fill('navigation-fixture-editor');await page.locator('#workspaceSymbol').fill('600000');await read();assert.equal(lastView.selectedRun.id,data.latest.hash);
   assert.equal(await tabs.count(),8);assert.equal(await panel.getAttribute('role'),'tabpanel');assert.equal(await panel.getAttribute('tabindex'),'-1');await selected('evidence');
   assert.equal(await tabs.evaluateAll(nodes=>nodes.filter(n=>n.tabIndex===0).length),1);
   for(const key of ['evidence','timeline','systems','screening','market','scorecard','defense','diagnostics'])assert.equal(await tab(key).getAttribute('aria-controls'),'workspaceContent');
   const beforeArrows=requests.length;await tab('evidence').focus();await page.keyboard.press('ArrowRight');await active('workspaceTab-timeline');await selected('evidence');
   await page.keyboard.press('End');await active('workspaceTab-diagnostics');await page.keyboard.press('ArrowRight');await active('workspaceTab-evidence');await page.keyboard.press('ArrowLeft');await active('workspaceTab-diagnostics');await page.keyboard.press('Home');await active('workspaceTab-evidence');
   assert.equal(requests.length,beforeArrows,'arrow/Home/End navigation must not fetch');assert.equal(await tabs.evaluateAll(nodes=>nodes.filter(n=>n.tabIndex===0).length),1);
   await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await selected('timeline');await active('workspaceTab-timeline');
   await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await selected('systems');await active('workspaceTab-systems');await tab('evidence').click();await selected('evidence');
   const region=panel.getByRole('region',{name:'研究版本列表',exact:true});assert.equal(await region.getAttribute('tabindex'),'0');
   const geometry=await region.evaluate(el=>({height:el.getBoundingClientRect().height,maxHeight:parseFloat(getComputedStyle(el).maxHeight),columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,overflow:getComputedStyle(el).overflowY,extra:['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,k)=>sum+parseFloat(getComputedStyle(el)[k]||0),0),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
   assert.ok(geometry.height<=geometry.maxHeight+geometry.extra+1,JSON.stringify(geometry));assert.equal(geometry.columns,width<600?1:2);assert.equal(geometry.overflow,'auto');assert.ok(geometry.scrollHeight>geometry.clientHeight,'fixture must exercise list scrolling');
   await region.focus();await page.keyboard.press('PageDown');await page.waitForFunction(()=>document.querySelector('.workspace-run-list').scrollTop>0);
   await paginate('下一页');assert.equal(lastView.runs.offset,20);assert.equal(lastView.selectedRun.id,data.latest.hash);assert.equal(requests.at(-1).query.runId,data.latest.hash);
   const oldChoice=panel.locator('[data-workspace-run="'+data.old.hash+'"]'),versionGate=holdNextRead();await oldChoice.focus();await oldChoice.press('Enter');await versionGate.started;await active('workspaceStatus');versionGate.release();await versionGate.done;await loaded();await active('workspaceContent');assert.equal(lastView.selectedRun.id,data.old.hash);assert.equal(await panel.locator('[data-workspace-run="'+data.old.hash+'"]').getAttribute('aria-pressed'),'true');
   await paginate('上一页',{moveFocus:true});assert.equal(lastView.runs.offset,0);assert.equal(lastView.selectedRun.id,data.old.hash);
   const snapshot=structuredClone(lastView),downloadEvent=page.waitForEvent('download');await page.locator('#workspaceExport').click();const download=await downloadEvent,file=path.join(output,'research-navigation-export-'+width+'.json');await download.saveAs(file);const exported=JSON.parse(fs.readFileSync(file));assert.equal(exported.run.id,data.old.hash);assert.equal(exported.asOf,snapshot.asOf);assert.equal(requests.at(-1).query.runId,data.old.hash);assert.equal(requests.at(-1).query.asOf,String(snapshot.asOf));
   await paginate('下一页',{failure:true});await read();assert.equal(lastView.runs.offset,0);assert.equal(lastView.selectedRun.id,data.old.hash);
   await paginate('下一页');await selected('evidence');const beforePagedArrows=requests.length;await tab('evidence').focus();await page.keyboard.press('ArrowRight');await selected('evidence');assert.equal(requests.length,beforePagedArrows);const tabGate=holdNextRead();await page.keyboard.press('Enter');await tabGate.started;await selected('timeline');assert.equal(await panel.getAttribute('aria-busy'),'true');tabGate.release();await tabGate.done;await loaded();await selected('timeline');assert.equal(lastView.runs.offset,0);assert.equal(lastView.selectedRun.id,data.old.hash);
   await tab('evidence').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(apiRequests.length>=requests.length);assert.ok(apiRequests.every(r=>r.method==='GET'),'all API requests must be read-only');await page.locator('#researchWorkspace').screenshot({path:path.join(output,'research-navigation-'+width+'.png')});await page.close();console.log('research navigation UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
