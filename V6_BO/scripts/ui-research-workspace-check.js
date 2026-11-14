#!/usr/bin/env node
'use strict';
// Real page/assets, actual projections and private synthetic API fixtures only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace');
const {fixture}=require('../tests/helpers/research-workspace-fixtures');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-workspace-browser-')),root=path.resolve(__dirname,'../public');
const output=process.env.V6_UI_QA_DIR||path.join(dir,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const workspaceRoot=path.join(dir,'private-'+width),options={workspaceRoot,observationRoot:path.join(dir,'observations')};
   const f=fixture();f.stock.name='<img src=x onerror=window.BAD=1>';W.saveObservation(f,options);W.saveObservation(fixture({index:71}),options);
   W.saveScreen(workspaceRoot,{items:Array.from({length:43},(_,i)=>({symbol:String(600000+i),quality:{usable:false,errors:['合成缺数']},score:0}))},'synthetic-browser-only');
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
   let permissionDenied=null,heldRead=null;
   function holdNextRead(){const gate={};gate.started=new Promise(r=>gate.markStarted=r);gate.wait=new Promise(r=>gate.release=r);gate.done=new Promise(r=>gate.markDone=r);heldRead=gate;return gate;}
   await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
    requests.push({method:req.method(),url:req.url()});if(req.headers().authorization!=='Bearer fixture-editor-token')return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
    const denial=permissionDenied,gate=heldRead;if(gate){heldRead=null;gate.markStarted();await gate.wait;}
    try{
     if(denial)return await route.fulfill({status:denial.status,json:denial.body});
     let value;if(req.method()==='POST'){const input=req.postDataJSON();const event=W.saveSettings(workspaceRoot,input);value={ok:true,revision:event.revision};}
     else{const q=Object.fromEntries([...url.searchParams].filter(([k])=>!['export'].includes(k)));for(const k of ['asOf','offset','limit','minScore'])if(k in q)q[k]=Number(q[k]);const view=W.workspaceView(workspaceRoot,q);value={ok:true,result:url.searchParams.get('export')==='1'?W.exportResearch(view):view};}
     await route.fulfill({json:value});
    }catch{await route.fulfill({status:409,json:{ok:false,error:'合成冲突'}}).catch(()=>{});}finally{gate?.markDone();}
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/research.html');assert.equal(requests.length,0);
   await page.locator('#token').fill('fixture-editor-token');await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   const evidence=await page.locator('#workspaceContent').innerText();assert.ok(evidence.includes('结论与证据'));assert.ok(evidence.includes('合成资金条件'));assert.equal(await page.locator('#workspaceContent img').count(),0);assert.equal(await page.evaluate(()=>window.BAD),undefined);
   for(const title of ['判断变化','四体系分歧','市场与题材','策略成绩','持仓防守','分析诊断']){await page.getByRole('tab',{name:title,exact:true}).click();assert.ok((await page.locator('#workspaceContent').innerText()).length>10);const geometry=await page.locator('#researchWorkspace').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify({width,title,...geometry}));}
   await page.locator('#workspaceContent summary').filter({hasText:'公开模型对照与借鉴'}).click();await page.locator('#workspaceContent summary').filter({hasText:'TimesFM 3.0 / 2.5'}).click();assert.ok((await page.locator('#workspaceContent').innerText()).includes('仅非商业/非生产'));assert.ok((await page.locator('#workspaceContent').innerText()).includes('尚未执行模型，无法比较'));
   await page.getByRole('tab',{name:'筛选与落选',exact:true}).click();assert.ok((await page.locator('#workspaceContent').innerText()).includes('600000'));
   await page.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('600020'));
   assert.ok(!(await page.locator('#workspaceContent').innerText()).includes('600000 '));
   await page.locator('#researchWorkspace > details').filter({has:page.locator('#workspaceObjective')}).locator('summary').click();
   await page.locator('#workspaceObjective').fill('跨会话保留的合成约束');await page.locator('#workspaceExcluded').fill('600001');await page.locator('#workspaceUnresolved').fill('补财报时间');
   await page.locator('#workspaceSavePreferences').click();await page.waitForFunction(()=>document.getElementById('workspacePreferenceVersion').options.length===1);assert.equal(await page.locator('#workspaceObjective').inputValue(),'跨会话保留的合成约束');
   await page.locator('#researchWorkspace > details').filter({has:page.locator('#workspacePresetName')}).locator('summary').click();
   await page.locator('#workspacePresetName').fill('合成筛选');await page.locator('#workspaceSavePreset').click();await page.waitForFunction(()=>document.getElementById('workspacePreset').options.length===1);
   await page.locator('#workspaceApplyPreset').click();assert.ok((await page.locator('#workspaceStatus').innerText()).includes('模板已应用'));await page.locator('#workspaceUndoPreset').click();assert.ok((await page.locator('#workspaceStatus').innerText()).includes('已撤销'));
   await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   const download=page.waitForEvent('download');await page.locator('#workspaceExport').click();const exported=await download;assert.equal(exported.suggestedFilename(),'tian-shu-research.json');
   await page.locator('#researchWorkspace').screenshot({path:path.join(output,'research-workspace-'+width+'.png')});
   await page.locator('#workspaceAsOf').fill('2026-04-10T16:30');assert.equal(await page.locator('#workspaceReview').isDisabled(),true);await page.locator('#workspaceAsOf').fill('');
   const deniedCases=[{status:401,body:{ok:false,error:'合成令牌失效'}},{status:403,body:{ok:false,error:'合成权限撤销'}},{status:200,body:{locked:true,needPassword:true}}];
   async function reloadPrivate(){permissionDenied=null;await page.locator('#token').fill('fixture-editor-token');await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));assert.equal(await page.locator('#workspaceObjective').inputValue(),'跨会话保留的合成约束');}
   async function stagePrivateFiles(){
    await page.locator('#workspacePresetName').fill('合成私有未保存模板');
    await page.locator('#workspaceNativeFile').setInputFiles({name:'synthetic-private-native.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({gptEvidence:{symbol:'600000',date:'2026-04-10'}}))});
    await page.waitForFunction(()=>document.getElementById('workspaceNativeStatus').textContent.includes('600000'));
    const input=W.workspaceView(workspaceRoot).forecastEvaluation.input;assert.ok(input);
    await page.locator('#workspaceForecastFile').setInputFiles({name:'synthetic-private-prediction.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({inputFingerprint:input.inputFingerprint,model:{id:'synthetic-private-model',revision:'synthetic-private-version'},forecasts:[{horizon:1,point:null}]}))});
    await page.waitForFunction(()=>document.getElementById('workspaceForecastStatus').textContent.includes('synthetic-private-version'));
   }
   async function assertPrivateCleared(){
    for(const id of ['workspaceObjective','workspaceAvoid','workspaceExcluded','workspaceUnresolved','workspacePresetName'])assert.equal(await page.locator('#'+id).inputValue(),'',id+' retained private text after permission loss');
    for(const id of ['workspaceNativeFile','workspaceForecastFile'])assert.equal(await page.locator('#'+id).inputValue(),'',id+' retained an uploaded file after permission loss');
    for(const id of ['workspacePreferenceVersion','workspacePreset','workspacePresetVersion','workspaceScreenRun','workspaceCompareRun'])assert.equal(await page.locator('#'+id+' option').count(),0,id+' retained private archive labels');
    assert.equal(await page.locator('#workspaceContent').innerText(),'');assert.equal(await page.locator('#workspaceSummary').isVisible(),false);
    assert.equal((await page.locator('#workspaceNativeStatus').innerText()).includes('600000'),false);assert.equal((await page.locator('#workspaceForecastStatus').innerText()).includes('synthetic-private-version'),false);assert.equal(await page.locator('#workspaceForecastFreeze').isDisabled(),true);
   }
   for(const denial of deniedCases){await reloadPrivate();await stagePrivateFiles();const posts=requests.filter(r=>r.method==='POST').length;permissionDenied=denial;await page.locator('#workspaceRead').click();await page.waitForFunction(()=>!document.getElementById('workspaceStatus').textContent.startsWith('正在'));await assertPrivateCleared();assert.equal(requests.filter(r=>r.method==='POST').length,posts);}
   // A denied refresh must also defeat an older successful read with the same
   // credential; no token-input event is used to trigger the privacy purge.
   await reloadPrivate();await stagePrivateFiles();const staleRead=holdNextRead();await page.locator('#workspaceRead').click();await staleRead.started;
   permissionDenied=deniedCases[1];await page.locator('#workspaceRead').click();await page.waitForFunction(()=>!document.getElementById('workspaceStatus').textContent.startsWith('正在'));await assertPrivateCleared();staleRead.release();await staleRead.done;await assertPrivateCleared();
   // Conversely, an older denial must not erase a newer successful read.
   await reloadPrivate();permissionDenied=deniedCases[1];const staleDenial=holdNextRead();await page.locator('#workspaceRead').click();await staleDenial.started;
   permissionDenied=null;await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));staleDenial.release();await staleDenial.done;
   assert.equal(await page.locator('#workspaceObjective').inputValue(),'跨会话保留的合成约束');assert.equal(await page.locator('#workspaceSummary').isVisible(),true);assert.ok((await page.locator('#workspaceStatus').innerText()).startsWith('已读取'));
   permissionDenied=null;await page.locator('#token').fill('fixture-editor-token');
   await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   const revokedRead=holdNextRead();await page.locator('#workspaceRead').click();await revokedRead.started;await page.locator('#token').fill('revoked-fixture-token');revokedRead.release();await revokedRead.done;
   await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent==='');assert.equal(await page.locator('#workspaceObjective').inputValue(),'');
   const count=requests.length;await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal(requests.length,count);assert.deepEqual(errors,[]);await page.close();console.log('workspace real browser '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
