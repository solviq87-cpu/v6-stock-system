#!/usr/bin/env node
'use strict';
// Optional end-to-end browser check against a fresh, isolated server.
// Fixture account, credentials and evidence never enter the real deployment.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-operator-browser-'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const copy=rel=>{const source=path.join(root,rel);if(fs.existsSync(source))fs.cpSync(source,path.join(temp,rel),{recursive:true});};
 for(const rel of ['server.js','src','strategies','public','package.json'])copy(rel);
 for(const name of fs.readdirSync(root))if(name.endsWith('.js')&&name!=='server.js')copy(name);
 const salt=crypto.randomBytes(16).toString('hex'),password='fixture-'+crypto.randomBytes(8).toString('hex');fs.writeFileSync(path.join(temp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync(password,salt,32).toString('hex'),devices:{}}));
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),prior=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
 fs.writeFileSync(path.join(temp,'calendar.json'),JSON.stringify({schemaVersion:1,exchange:'SSE',source:'test-fixture-not-official',from:prior,to:today,sessions:[{date:prior,open:true},{date:today,open:true}]}));
 const monitorRoot=path.join(temp,'adaptive-runs'),monitorInput=path.join(temp,'adaptive-input.json');
 fs.writeFileSync(monitorInput,JSON.stringify(require('../tests/helpers/adaptive-fixture').fixture(65)));
 const saved=await require('../src/core/adaptive-research-monitor').createAdaptiveMonitor({inputFile:monitorInput,outputRoot:monitorRoot}).runOnce();
 const savedPath=path.join(monitorRoot,'reports',saved.reportFile),savedBytes=fs.readFileSync(savedPath);
 const child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,V6_ADAPTIVE_RUNS_DIR:monitorRoot,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_ORDER_ACCOUNTS_DIR:path.join(temp,'data/order-accounts'),V6_TRADING_CALENDAR_FILE:path.join(temp,'calendar.json'),V6_RESEARCH_CACHE_DIR:path.join(temp,'empty-cache')},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 let browser;const report=[];
 try{
  let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Isolated server exited');try{const r=await fetch(`http://127.0.0.1:${port}/api/lock/status`);if(r.ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Isolated server failed to start');
  browser=await chromium.launch({executablePath:process.env.V6_UI_BROWSER||undefined,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  for(const width of [1536,390]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const login=await page.request.post(`http://127.0.0.1:${port}/api/lock/unlock`,{data:{password,role:'edit',fp:'operator-browser-'+width}});const auth=await login.json();assert.equal(auth.ok,true);
   await page.goto(`http://127.0.0.1:${port}/research.html`);await page.locator('#token').fill(auth.token);
   const api=async(action,extra={})=>{const r=await page.request.post(`http://127.0.0.1:${port}/api/research/order-account`,{headers:{Authorization:'Bearer '+auth.token},data:{accountId:'pool',action,...extra}});const result=await r.json();assert.equal(result.ok,true,result.error);return result.result;};
   await page.locator('#authorityRead').click();await page.waitForFunction(()=>document.getElementById('authorityStatus').textContent.includes('主账户已刷新'));
   await page.getByText('调整新增仓位风控',{exact:true}).click();
   for(const [id,value] of [['riskGross','80'],['riskSector','20'],['riskDrawdown','10'],['riskDailyLoss','3']])await page.locator('#'+id).fill(value);
   await page.locator('#authorityConfigure').click();await page.waitForFunction(()=>document.getElementById('authorityStatus').textContent.includes('已保存'));
   const before=await api('read');assert.equal(before.riskPolicy.maxDrawdownPausePct,10);assert.equal(before.riskPolicy.maxDailyLossPausePct,3);
   await page.getByText('行业与前收盘证据',{exact:true}).click();
   const sector={schemaVersion:1,source:'imported',kind:'sector',provider:'browser-fixture',version:'sector-'+width,sourceRecordId:'sector-'+width,tradeDate:today,publishedAt:prior+'T08:00:00Z',knownAt:prior+'T08:01:00Z',classificationAsOf:prior,sectors:{600000:'fixture-sector'}};
   const close={...sector,kind:'previous-close',version:'close-'+width,sourceRecordId:'close-'+width,observedThrough:prior,priorEquity:100000,priorPeak:100000,previousEquity:100000};
   await page.locator('#evidenceFile').setInputFiles({name:'fixture-evidence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([sector,close]))});
   assert.equal(await page.locator('#evidenceImport').isDisabled(),true);await page.locator('#evidencePreview').click();await page.waitForFunction(()=>document.getElementById('authorityStatus').textContent.includes('预检通过'));
   assert.equal(await page.locator('#evidenceImport').isEnabled(),true);assert.equal((await api('read')).revision,before.revision);
   await page.locator('#evidenceImport').click();await page.waitForFunction(()=>document.getElementById('authorityStatus').textContent.includes('整组证据已导入'));
   const after=await api('read');assert.equal(after.revision,before.revision+1);assert.equal(after.account.cash,100000);assert.equal(Object.keys(after.orders).length,0);
   await page.locator('#evidenceDate').fill(today);await page.locator('#evidenceSymbol').fill('600000');await page.locator('#evidenceCheck').click();await page.waitForFunction(()=>document.getElementById('authorityStatus').textContent.includes('证据齐备'));
   const adaptiveInput=require('../tests/helpers/adaptive-fixture').fixture(65);adaptiveInput.simulation={start:45,end:64,topN:2};
   const beforeAdaptive=await api('read');await page.locator('#adaptiveFile').setInputFiles({name:'adaptive-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(adaptiveInput))});await page.locator('#adaptiveRun').click();await page.waitForFunction(()=>document.getElementById('adaptiveStatus').textContent.includes('研究完成'));
   assert.equal(await page.locator('#adaptiveSummary article').count(),8);assert.equal((await api('read')).revision,beforeAdaptive.revision);
   const beforeSaved=await api('read'),manifestBefore=fs.readFileSync(path.join(monitorRoot,'manifest.json'));
   await page.locator('#adaptiveLatest').click();await page.waitForFunction(()=>document.getElementById('adaptiveLatestStatus').textContent.includes('历史与报告校验通过'));
   assert.equal(await page.locator('#adaptiveSummary article').count(),8);assert.match(await page.locator('#adaptiveLatestStatus').textContent(),/已过期.*模拟数据/);
   assert.equal((await api('read')).revision,beforeSaved.revision);assert.deepEqual(fs.readFileSync(path.join(monitorRoot,'manifest.json')),manifestBefore);
   await page.locator('#adaptiveLatest').scrollIntoViewIfNeeded();await page.screenshot({path:'/workspace/scratch/2edeae4edcb6/view-'+width+'.png'});
   fs.writeFileSync(savedPath,'broken');await page.locator('#adaptiveLatest').click();await page.waitForFunction(()=>document.getElementById('adaptiveLatestStatus').textContent.includes('未显示报告'));
   assert.equal(await page.locator('#adaptiveSummary article').count(),0);assert.equal(await page.locator('#adaptiveOutput').textContent(),'');fs.writeFileSync(savedPath,savedBytes);
   let release;const pending=new Promise(r=>release=r);let observed;const started=new Promise(r=>observed=r);
   await page.route('**/api/research/adaptive-latest',async route=>{observed();await pending;await route.continue();});
   await page.locator('#adaptiveLatest').click();await started;await page.locator('#token').fill('fixture-changed-token');release();
   await page.waitForFunction(()=>!document.getElementById('adaptiveLatest').disabled);assert.equal(await page.locator('#adaptiveSummary article').count(),0);assert.match(await page.locator('#adaptiveLatestStatus').textContent(),/凭据已变更/);
   await page.unroute('**/api/research/adaptive-latest');await page.locator('#token').fill(auth.token);
   await page.locator('#authorityAccount').selectOption('pre');assert.equal(await page.locator('#evidenceImport').isDisabled(),true);assert.equal(await page.locator('#authorityOutput').textContent(),'');
   const layout=await page.evaluate(()=>({viewport:innerWidth,bodyWidth:document.body.scrollWidth}));assert.ok(layout.bodyWidth<=width);assert.deepEqual(errors,[]);
   report.push({width,...layout,previewReadOnly:true,importAtomic:true,cashUnchanged:true,noOrders:true,readiness:true,adaptiveForecastCards:8,savedReportVerified:true,staleAndSimulatedLabel:true,corruptionClearsOutput:true,lateResponseIgnored:true,monitorManifestUnchanged:true,researchRevisionUnchanged:true,accountSwitchInvalidates:true,uncaughtErrors:errors.length});await page.close();
  }
 }finally{if(browser)await browser.close();child.kill('SIGTERM');await delay(300);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(temp,{recursive:true,force:true});}
 console.log(JSON.stringify({ok:true,fixtureOnly:true,report},null,2));
})().catch(e=>{console.error(String(e.stack||e));process.exitCode=1;});
