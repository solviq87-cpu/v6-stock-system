#!/usr/bin/env node
'use strict';
// Actual page/assets and core functions, with explicit synthetic time and prices.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision'),F=require('../src/core/model-forward-evaluation');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-model-ui-')),root=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||path.join(dir,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const workspace=path.join(dir,'private-'+width),base=D.buildWorkspaceDecision(fixture()),seed=S.appendEvent(workspace,'analysis',base,{requestId:'browser_origin_001',now:base.asOf});let now=base.asOf+2000;
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'synthetic permission denial'}});calls.push(req.method());
    if(req.headers().authorization!=='Bearer synthetic-editor')return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
    try{if(req.method()==='POST')return route.fulfill({json:F.freezeForecast(workspace,S.readEvents(workspace),req.postDataJSON(),{now})});
     const q=Object.fromEntries(url.searchParams);for(const k of ['asOf','offset','limit','minScore'])if(k in q)q[k]=Number(q[k]);const view=W.workspaceView(workspace,q,{now});return route.fulfill({json:{ok:true,result:view}});
    }catch(e){return route.fulfill({status:422,json:{ok:false,error:e.code?.startsWith('FORECAST_')?e.message:'合成研究错误'}});}
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/research.html');assert.equal(calls.length,0);await page.locator('#token').fill('synthetic-editor');await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   await page.locator('#workspaceForecastTools summary').click();const download=page.waitForEvent('download');await page.locator('#workspaceForecastInput').click();const file=await download;await file.saveAs(path.join(output,'forecast-input-'+width+'.json'));
   const exported=JSON.parse(fs.readFileSync(path.join(output,'forecast-input-'+width+'.json')));assert.equal(exported.input.inputFingerprint,F.prepareInput(seed).inputFingerprint);assert.equal(exported.outputTemplate.forecasts[0].point,null);assert.equal(calls.filter(x=>x==='POST').length,0);
   const prediction={schemaVersion:1,inputFingerprint:exported.input.inputFingerprint,symbol:base.symbol,provider:base.provider,originDate:base.tradeDate,generatedAt:base.asOf+1000,model:{id:'M05',revision:'synthetic-browser-v1'},forecasts:[{...exported.input.targets[0],point:11,quantiles:[{level:.1,value:10},{level:.9,value:12}]}]};
   const upload=p=>page.locator('#workspaceForecastFile').setInputFiles({name:'synthetic-prediction.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
   await upload({...prediction,inputFingerprint:'f'.repeat(64)});await page.waitForFunction(()=>document.getElementById('workspaceForecastStatus').textContent.includes('不匹配'));assert.equal(await page.locator('#workspaceForecastFreeze').isDisabled(),true);
   await upload(prediction);await page.waitForFunction(()=>!document.getElementById('workspaceForecastFreeze').disabled);await page.locator('#workspaceForecastFreeze').click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('M05'));
   assert.equal(S.readEvents(F.rootFor(workspace)).length,1);assert.ok((await page.locator('#workspaceContent').innerText()).includes('预测误差，不是可成交收益'));
   await upload({...prediction,model:{...prediction.model,id:'M01'},forecasts:prediction.forecasts.map(f=>({...f,point:11.5}))});await page.waitForFunction(()=>!document.getElementById('workspaceForecastFreeze').disabled);await page.locator('#workspaceForecastFreeze').click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('M01'));assert.equal(S.readEvents(F.rootFor(workspace)).length,2);
   const later=D.buildWorkspaceDecision(fixture({index:71}));S.appendEvent(workspace,'analysis',later,{requestId:'browser_outcome_001',now:at(71)});now=at(71);await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('同输入配对'));
   assert.equal(await page.locator('#workspaceContent summary').filter({hasText:'同输入配对'}).count(),1);await page.locator('#workspaceContent summary').filter({hasText:/^M05 ·/}).first().click();assert.ok((await page.locator('#workspaceContent').innerText()).includes('前值基线'));await page.locator('#workspaceContent summary').filter({hasText:'同输入配对'}).click();assert.ok((await page.locator('#workspaceContent').innerText()).includes('完全匹配样本：1'));
   const geometry=await page.locator('#researchWorkspace').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify({width,...geometry}));
   await page.locator('#researchWorkspace').screenshot({path:path.join(output,'model-evaluation-'+width+'.png')});
   await page.locator('#workspaceAsOf').fill('2026-04-01T16:30');assert.equal(await page.locator('#workspaceForecastFreeze').isDisabled(),true);assert.equal(await page.locator('#workspaceForecastFile').inputValue(),'');await page.locator('#workspaceAsOf').fill('');
   await page.locator('#token').fill('revoked');assert.equal(await page.locator('#workspaceContent').innerText(),'');assert.equal(await page.locator('#workspaceForecastFreeze').isDisabled(),true);await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.deepEqual(errors,[]);await page.close();console.log('model forward UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
