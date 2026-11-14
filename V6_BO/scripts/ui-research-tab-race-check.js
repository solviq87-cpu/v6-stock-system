#!/usr/bin/env node
'use strict';
// Actual page and W/S/D projections, using only synthetic archives and local
// intercepted transport. Delayed responses exercise navigation ownership.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-tab-race-'));
const publicRoot=process.env.V6_UI_PUBLIC_ROOT||path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||temporary;fs.mkdirSync(output,{recursive:true});
const archive=path.join(temporary,'archive');
for(let i=0;i<43;i++){
 const value=D.buildWorkspaceDecision(fixture({index:70}));value.name='合成导航研究 '+i;
 S.appendEvent(archive,'analysis',value,{requestId:'tab_race_run_'+String(i).padStart(3,'0'),now:at(70)+i});
}
S.appendEvent(archive,'screen',D.screeningRecord({items:Array.from({length:43},(_,i)=>({symbol:String(600000+i),name:'合成导航筛选 '+i,quality:{usable:true,errors:[]},score:10,blockedBySafety:false,strategy:{pass:true},tradable:true}))},{provenance:'synthetic-tab-race-only',asOf:at(72)}),{requestId:'tab_race_screen_001',now:at(72)});
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}
 catch{res.writeHead(404);res.end();}
});
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:1000}}),requests=[],errors=[],external=[];let delayed=null,lastView;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(req.method(),'GET','navigation fixture must not issue writes');
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'synthetic unused endpoint'}});
    assert.equal(req.method(),'GET','tab navigation must never write');
    assert.equal(req.headers().authorization,'Bearer synthetic-tab-race-editor');
    const query=Object.fromEntries(url.searchParams);for(const k of ['offset','limit','asOf','minScore'])if(k in query)query[k]=Number(query[k]);requests.push(query);
    const result=W.workspaceView(archive,query);
    if(delayed&&query.offset===20){
     const pending=delayed;delayed=null;pending.started();await pending.release;
     try{await route.fulfill(pending.failure?{status:503,json:{ok:false,error:'synthetic older page failure'}}:{json:{ok:true,result}});}catch{/* An aborted older browser request cannot be fulfilled. */}
     pending.finished();return;
    }
    lastView=result;return route.fulfill({json:{ok:true,result}});
   });
   const host=page.locator('#workspaceContent'),tab=name=>page.getByRole('tab',{name,exact:true});
   async function loaded(){await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));}
   async function read(){await page.locator('#workspaceRead').click();await loaded();}
   async function showEvidence(){await tab('结论与证据').click();await loaded();}
   async function assertFirstScreenPage(){
    assert.equal(lastView.screening.total,43);assert.deepEqual(lastView.screening.rows.map(x=>x.symbol),Array.from({length:20},(_,i)=>String(600000+i)));
    assert.match(await host.locator(':scope > .linked-actions').innerText(),/记录：1—20 \/ 43/);
    assert.equal(await host.getByRole('button',{name:'上一页',exact:true}).isDisabled(),true);
    assert.match(await host.locator('article').first().locator('details').first().locator('summary').innerText(),/600000/);
    assert.equal(await tab('筛选与落选').getAttribute('aria-selected'),'true');
   }
   await page.goto(origin+'/research.html');await page.locator('#token').fill('synthetic-tab-race-editor');await read();
   const pinned=lastView.selectedRun.id;
   for(const failure of [false,true]){
    await showEvidence();
    let started,release,finished;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r),completed=new Promise(r=>finished=r);
    delayed={started,release:gate,finished,failure};
    await host.getByRole('button',{name:'下一页',exact:true}).click();await began;
    const freshRequest=page.waitForRequest(req=>{const url=new URL(req.url());return url.pathname==='/api/research/workspace'&&url.searchParams.get('offset')==='0';},{timeout:4000});
    await tab('筛选与落选').click();
    try{await freshRequest;}catch(error){release();await completed;throw Error('Switching tabs during an offset20 GET must request offset0: '+error.message);}
    await loaded();await assertFirstScreenPage();assert.equal(requests.at(-1).runId,pinned);
    assert.equal(await host.getAttribute('aria-busy'),'false');
    const before=await host.innerText(),state=await page.locator('#workspaceStatus').innerText();release();await completed;await page.waitForTimeout(60);
    assert.equal(await host.innerText(),before,'a late older response cannot replace the newer tab data');
    assert.equal(await page.locator('#workspaceStatus').innerText(),state,'an older failure cannot clear the newer success');
    assert.equal(await host.getAttribute('aria-busy'),'false');
   }
   await showEvidence();await host.getByRole('button',{name:'下一页',exact:true}).click();await loaded();assert.equal(lastView.runs.offset,20);
   await tab('筛选与落选').focus();await tab('筛选与落选').press('Enter');await loaded();await assertFirstScreenPage();assert.equal(requests.at(-1).offset,0);assert.equal(requests.at(-1).runId,pinned);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'workspaceContent');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   await page.locator('#researchWorkspace').screenshot({path:path.join(output,'research-tab-race-'+width+'.png')});await page.close();console.log('research tab race UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
