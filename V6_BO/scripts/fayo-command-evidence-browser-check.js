#!/usr/bin/env node
'use strict';
// Native desktop/mobile views and the actual shared research endpoint. All
// state is in a disposable server; upstream network and trade calls are denied.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');
const root=path.resolve(__dirname,'..'),endpoint='/api/research/evidence-workbench';
const output=process.env.FAYO_COMMAND_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-command-evidence-'));
fs.mkdirSync(output,{recursive:true});
async function run(){
 let fixture,browser;
 const report={scope:'isolated native browser and actual durable template API',views:[],requests:[],external:[]};
 try{
  fixture=await createFixture({count:3});
  for(const file of ['public-model-comparison-20261114.json','intelligence-center.json'])
   fs.copyFileSync(path.join(root,'config',file),path.join(fixture.tmp,'config',file));
  const origin='http://127.0.0.1:'+fixture.port;
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const pages=[];
  for(const viewport of [{width:1366,height:900,path:'/'},{width:390,height:844,path:'/m'}]){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block'});
   await context.addInitScript(token=>{localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','edit');},fixture.token);
   const page=await context.newPage(),errors=[],reads=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.method()==='POST')report.requests.push({path:new URL(r.url()).pathname,action:r.postDataJSON()?.action});});
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){report.external.push(route.request().url());return route.abort();}return route.continue();});
   await page.goto(origin+viewport.path,{waitUntil:'domcontentloaded'});
   const panel=page.locator('#fy-decision-query');await panel.waitFor({timeout:15000});await panel.locator(':scope > summary').click();
   const read=async()=>{
    for(let attempt=0;attempt<3;attempt++){
     const response=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&new URL(r.url()).searchParams.get('mode')==='templates');
     await panel.getByRole('button',{name:'读取共享模板',exact:true}).click();
     const received=await response,value=await received.json();reads.push({status:received.status(),ok:value.ok,error:value.error||null});
     if(value.ok)return value.result;
     assert.equal(received.status(),503,'only a reported bounded-worker busy response may be retried');
     await page.waitForTimeout(150);
    }
    throw Error('shared template reader stayed busy: '+JSON.stringify(reads));
   };
   await read();pages.push({page,panel,errors,reads,read,viewport});
  }
  const [desktop,mobile]=pages,raw='精选评分前7且涨幅小于4%';
  const save=async view=>{
   const response=view.page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='POST');
   await view.panel.getByRole('button',{name:'保存本次条件',exact:true}).click();
   const r=await response,result=await r.json();
   await view.page.waitForFunction(()=>{const x=[...document.querySelectorAll('#fy-decision-query button')].find(b=>b.textContent==='保存本次条件');return x&&!x.disabled;});
   return {status:r.status(),...result};
  };
  await desktop.panel.getByRole('textbox',{name:'一句话选股指令',exact:true}).fill(raw);
  const first=await save(desktop);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.result.revision,1);
  await mobile.read();await mobile.panel.getByRole('button',{name:raw,exact:true}).click();
  assert.equal(await mobile.panel.getByRole('textbox',{name:'一句话选股指令',exact:true}).inputValue(),raw);
  assert.equal(await mobile.panel.locator('.fy-command-results').textContent(),'','applying a shared template cannot execute the query');
  const second=await save(desktop);assert.equal(second.ok,true,JSON.stringify(second));assert.equal(second.result.revision,2);
  const stale=await save(mobile);assert.equal(stale.ok,false,'another device must not silently overwrite a newer revision');
  assert.equal(await mobile.panel.getByRole('textbox',{name:'一句话选股指令',exact:true}).inputValue(),raw);
  await mobile.read();
  let held;await mobile.page.route('**/api/selection-command/context?*',route=>{held=route;});
  await mobile.panel.getByRole('textbox',{name:'一句话选股指令',exact:true}).fill('近5日主力净流入前5且评分至少80');
  await mobile.panel.getByRole('button',{name:'筛选股票',exact:true}).click();
  for(let i=0;i<100&&!held;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(held,'query is waiting on its actual funds-context route');
  await mobile.panel.getByRole('textbox',{name:'条件 2',exact:true}).fill('未知条件');
  assert.equal(await mobile.panel.locator('.fy-command-results').textContent(),'','input invalidation must happen before blur/change');
  await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,day:'2000-01-01',days:5,expectedDays:[],flowHistory:{}})});
  await mobile.page.waitForTimeout(100);
  assert.equal(await mobile.panel.locator('.fy-command-results').textContent(),'','late data cannot restore the old result');
  const persisted=await fixture.request(endpoint+'?mode=templates');assert.equal(persisted.body.result.templates.length,1);assert.equal(persisted.body.result.templates[0].revision,2);
  for(const {page,viewport,errors,reads}of pages){
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,JSON.stringify(viewport));assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(output,'command-'+viewport.width+'.png'),fullPage:true});
   report.views.push({path:viewport.path,width:viewport.width,overflow,pageErrors:errors.length,reads});
  }
  assert.deepEqual(report.external,[]);assert.ok(report.requests.every(r=>r.path===endpoint&&r.action==='save-template'),JSON.stringify(report.requests));
  report.checks=['desktop-to-mobile shared read','explicit screening','stale revision preserves input','immediate clause invalidation','late response isolation','no trade or notification request'];
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output},null,2));
 }finally{await browser?.close();await fixture?.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
