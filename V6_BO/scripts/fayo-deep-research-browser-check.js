#!/usr/bin/env node
'use strict';
// Native presentation + actual HTTP handler/worker/store, all in an isolated
// fixture. No production account, collector, notification or order is started.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {deepResearchHttp}=require('../src/server/deep-research-http');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const {deepAccountProjection}=require('../src/core/deep-research-workspace');
const {createRuntimeAcceptance,buildUnifiedTaskStatus}=require('../src/core/runtime-acceptance');
const {inspectReleaseProvenanceAsync}=require('../src/core/release-provenance');
const Store=require('../src/core/research-workspace-store');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const output=process.env.FAYO_DEEP_RESEARCH_QA_DIR||(process.env.V6_UI_QA_DIR?path.join(process.env.V6_UI_QA_DIR,'deep-research'):fs.mkdtempSync(path.join(os.tmpdir(),'fayo-deep-browser-report-')));
const privateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-deep-browser-fixture-'));
fs.mkdirSync(output,{recursive:true});
const taskEvidence=JSON.parse(fs.readFileSync(path.join(root,'config/deep-research-tasks.json'),'utf8'));
const requests=[],responses=[],unexpectedWrites=[];
let session;
function fixture(name){
 const base=path.join(privateRoot,name);fs.mkdirSync(base,{mode:0o700});
 const value={authorized:true,root:path.join(base,'research'),newsRoot:path.join(base,'news'),shortlineRoot:path.join(base,'shortline'),
  observationRoot:path.join(base,'runtime'),backgroundRoot:path.join(base,'background'),readGate:null,readWaiting:false,jobs:0,
  account:{accountId:'isolated-browser-account',revision:1,account:{cash:100000,positions:{}},orders:{}}};
 value.accountBytes=JSON.stringify(value.account);
 const observedAt=Date.now()-100,raw=Buffer.from(JSON.stringify([{pages:1},[{countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},date:'2023',value:0},{countryiso3code:'CHN',indicator:{id:'NY.GDP.MKTP.CD'},date:'2024',value:null}]]));
 const receipt=require('../src/core/market-data-evidence').appendBackgroundReceipt({root:value.backgroundRoot,provider:'worldbank',
  scope:{country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2023,endYear:2024},raw,byteBasis:'response-body',observedAt,requestStartedAt:observedAt-1});
 value.backgroundHash=receipt.hash;value.backgroundRawFile=path.join(value.backgroundRoot,'blobs',receipt.data.dataVersion+'.bin');value.backgroundRaw=raw;
 value.backgroundEventFile=path.join(value.backgroundRoot,'events','000001.json');value.backgroundEvent=fs.readFileSync(value.backgroundEventFile);
 value.acceptance=createRuntimeAcceptance({root:value.observationRoot,appRoot:root,canWrite:()=>false,env:{NODE_ENV:'test'},taskEvidence});
 return value;
}
function harness(viewer){
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>绯曜深度研究隔离验收</title><link rel="stylesheet" href="/nova/fayo.css">
 <style>body{margin:0;padding:24px;background:#140f1c;color:#f5eafa}main{max-width:1220px;margin:auto;min-width:0}.qa-banner{font-size:13px;color:#bea8c9}@media(max-width:600px){body{padding:12px}}</style></head>
 <body><main><h1>绯曜 FAYO · 深度研究验收</h1><p class="qa-banner">隔离测试输入 · 真实界面、后台处理器与研究档案 · 不代表行情、成交、部署或长期验收</p><div id="research"></div></main>
 <script type="module">
 import {renderDeepResearch} from '/nova/deep-research.js';
 const controller=new AbortController(),calls=[];let role='${viewer?'view':'edit'}';
 const ctx={signal:controller.signal,get role(){return role;},get canEdit(){return role==='edit';},
  async api(url,options={}){const row={url,method:options.method||'GET',status:null};calls.push(row);
   try{const response=await fetch(url,{method:row.method,signal:options.signal,headers:{'Content-Type':'application/json','X-Fayo-Fixture-Role':role},
    ...(options.body?{body:JSON.stringify(options.body)}:{})});row.status=response.status;const data=await response.json();
    if(!response.ok||data.ok!==true)throw Error(data.error||'隔离请求未完成');return data;
   }catch(error){row.aborted=error.name==='AbortError';throw error;}}
 };
 document.querySelector('#research').append(renderDeepResearch(ctx));
 window.deepHarness={calls,ready:true,revoke(){role='view';controller.abort();}};
 </script></body></html>`;
}
function reply(res,status,type,value){if(res.destroyed)return;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(value);}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),current=session;
 requests.push({method:req.method,path:url.pathname});
 if(url.pathname==='/favicon.ico')return reply(res,204,'text/plain','');
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/m'))return reply(res,200,'text/html; charset=utf-8',harness(url.searchParams.get('role')==='view'));
 if(url.pathname.startsWith('/api/research/deep')){
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>524288)return reply(res,413,'application/json',JSON.stringify({ok:false}));}
   const end=res.end.bind(res);res.end=function(value){try{const parsed=JSON.parse(value);responses.push({path:url.pathname,status:res.statusCode,ok:parsed.ok,result:parsed.result});}catch{}return end(value);};
   return await deepResearchHttp(req,res,{url,body,root:current.root,newsRoot:current.newsRoot,shortlineRoot:current.shortlineRoot,backgroundRoot:current.backgroundRoot,
    authenticate:()=>current.authorized&&req.headers['x-fayo-fixture-role']==='edit',isReplica:()=>false,
    readSnapshot:async now=>{
     if(current.readGate){current.readWaiting=true;await current.readGate;current.readGate=null;}
     return {account:deepAccountProjection(current.account,{}, {now,day:new Date(now+28800000).toISOString().slice(0,10)}),quotes:{},
      constraints:{version:'isolated-browser-constraints',maxPositions:5,riskPolicy:{version:'isolated-risk-policy'}},
      feePolicy:{version:'isolated-fee-policy',feeBps:3,minFee:5,sellTaxBps:5}};
    },
    job:(payload,options)=>{current.jobs++;return runWorkspaceJob(payload,options);},
    readAcceptance:async()=>({release:await inspectReleaseProvenanceAsync({appRoot:root}),observation:await current.acceptance.report(),tasks:buildUnifiedTaskStatus(taskEvidence)})});
  }catch(error){return reply(res,500,'application/json',JSON.stringify({ok:false,error:'isolated-harness-request-failed'}));}
 }
 if(req.method!=='GET'){unexpectedWrites.push({method:req.method,path:url.pathname});return reply(res,405,'application/json','{"ok":false}');}
 const file=path.resolve(publicRoot,'.'+url.pathname);
 if(!url.pathname.startsWith('/nova/')||!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file))return reply(res,404,'text/plain','missing');
 reply(res,200,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',fs.readFileSync(file));
});
async function waitFor(check,message){const until=Date.now()+15000;while(!check()){if(Date.now()>until)throw Error(message);await new Promise(resolve=>setTimeout(resolve,25));}}
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;let browser;
 const report={fixtureOnly:true,productionDeployed:false,longTermAccepted:false,realObservationDays:0,
  backend:['deepResearchHttp','runWorkspaceJob','deepAccountProjection','runtimeAcceptance.report','inspectReleaseProvenanceAsync'],views:[]};
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const viewport of [{width:1536,height:1000,path:'/'},{width:390,height:844,path:'/m'}]){
   session=fixture('view-'+viewport.width);const current=session;
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block'}),page=await context.newPage();
   const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.origin);return route.abort();}return route.continue();});
   try{
    await page.goto(origin+viewport.path,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.deepHarness?.ready);
    assert.equal(await page.evaluate(()=>deepHarness.calls.length),0,'the unopened research page does not fetch private data');
    await page.getByRole('button',{name:'读取当前证据',exact:true}).click();
    await page.getByRole('heading',{name:'事件影响',exact:true}).waitFor();
    assert.match(await page.locator('#research').innerText(),/证据不足|未知/);
    assert.equal(fs.existsSync(current.root),false,'initial read cannot initialize the research journal');
    const background=page.getByRole('heading',{name:'官方背景档案',exact:true}).locator('xpath=ancestor::section[1]');
    await background.getByText(/世界银行宏观指标 · CHN/).click();
    const rows=await background.locator('tbody tr').allTextContents();assert.equal(rows.length,2);
    assert.match(rows[0],/2023\s*0\s*未知/);assert.match(rows[1],/2024\s*未知\s*未知/);
    const originalTime=background.getByText('原始发布时间',{exact:true});assert.match(await originalTime.locator('..').innerText(),/未知/);
    assert.match(await background.innerText(),/不认证全部历史原文/);
    const bgResponse=responses.filter(r=>r.path==='/api/research/deep'&&r.ok===true).at(-1).result.background;
    assert.equal(bgResponse.rows[0].archiveHash,current.backgroundHash);assert.equal(bgResponse.canTrade,false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'background hashes do not cause mobile overflow');
    await page.getByText('导入自有或已授权研究证据',{exact:true}).click();
    const old=Date.now()-86400000,imported={type:'events',records:[{id:'browser-event-'+viewport.width,revision:1,symbol:'600000',eventType:'buyback',
     title:'隔离输入：回购进展',source:'isolated-browser-declaration',sourceUrl:'https://example.org/isolated-disclosure',publishedAt:old,firstKnownAt:old+1,recordedAt:old+2}]};
    await page.getByLabel('选择结构化研究证据',{exact:true}).setInputFiles({name:'isolated-research.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await page.getByText('已读取 1 条，点击保存后才会进入研究档案。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'保存研究证据',exact:true}).click();
    await page.getByText('已保存带服务器接收时点的证据版本。',{exact:true}).waitFor();
    await page.waitForFunction(()=>deepHarness.calls.filter(c=>c.method==='GET'&&c.url==='/api/research/deep'&&c.status===200).length>=2);
    let stored=Store.readEvents(current.root);assert.equal(stored.length,1);assert.equal(stored[0].data.records[0].independentlyVerified,false);
    assert.equal(stored[0].data.records[0].firstKnownAt,stored[0].recordedAt);assert.equal(stored[0].data.records[0].declaredFirstKnownAt,old+1);
    await page.getByLabel('深度研究主题',{exact:true}).selectOption('review');
    await page.getByRole('button',{name:'封存当前对照方案',exact:true}).click();
    await waitFor(()=>Store.readEvents(current.root).length===2,'actual worker did not freeze the comparison');
    await page.waitForFunction(()=>deepHarness.calls.some(c=>c.url.endsWith('/alternatives')&&c.status===200));
    await page.waitForFunction(()=>deepHarness.calls.filter(c=>c.method==='GET'&&c.url==='/api/research/deep'&&c.status===200).length>=3);
    stored=Store.readEvents(current.root);const frozen=stored[1].data;
    assert.deepEqual(frozen.alternatives.map(a=>a.id),['hold','cash']);assert.equal(frozen.accountRevision,1);
    assert.equal(frozen.sourceSnapshot.account.cash,100000);assert.equal(frozen.sourceSnapshot.quotes.length,0);
    assert.equal(JSON.stringify(current.account),current.accountBytes,'research freezes never modify the authority account input');
    await page.screenshot({path:path.join(output,'deep-'+viewport.width+'-freeze-isolated.png'),fullPage:true});
    await page.getByLabel('深度研究主题',{exact:true}).selectOption('acceptance');
    await page.getByText('逐项交付状态（78项）',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'运行观察与持仓覆盖',exact:true}).waitFor();
    await page.getByText('尚无真实观察回执',{exact:true}).waitFor();
    assert.match(await page.locator('#research').innerText(),/完整范围待核|范围已核对/);
    const summary=page.getByText('查看78项任务明细',{exact:true});
    await summary.click();
    const checklist=summary.locator('..');
    assert.equal(await checklist.locator('tbody tr').count(),78);
    assert.match(await checklist.locator('tbody tr').first().innerText(),/统一风险工作台/);
    assert.deepEqual((await checklist.locator('tbody tr').first().locator('td').allTextContents()).slice(2),['部分具备','证据不足','证据不足','部分具备','证据不足','待验证']);
    const taskFilter=checklist.getByLabel('筛选任务交付状态',{exact:true});
    await taskFilter.selectOption('remaining');
    assert.equal(await checklist.locator('tbody tr').count(),78);
    await taskFilter.selectOption('blocked');
    assert.equal(await checklist.locator('tbody tr').count(),0);
    await taskFilter.selectOption('missing');
    assert.equal(await checklist.locator('tbody tr').count(),0);
    await taskFilter.selectOption('all');
    assert.equal(await checklist.locator('tbody tr').count(),78);
    assert.match(await page.locator('#research').innerText(),/尚未通过/);
    const acceptance=responses.filter(r=>r.path.endsWith('/acceptance')&&r.ok===true).at(-1).result;
    assert.equal(acceptance.observation.observedTradingDays,0);assert.equal(acceptance.observation.completeObservationDays,0);
    assert.equal(acceptance.observation.longTermAccepted,false);assert.deepEqual(acceptance.observation.stages.map(s=>s.tradingDays),[5,20,60]);
    assert.equal(fs.existsSync(current.observationRoot),false,'reading the acceptance table cannot create runtime days');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,'no page-level horizontal overflow');
    await page.screenshot({path:path.join(output,'deep-'+viewport.width+'-acceptance-isolated.png'),fullPage:true});
    // Revoke while the real HTTP handler is awaiting its read-only snapshot.
    // Abort must clear private UI state; the handler must not start a worker.
    await page.getByLabel('深度研究主题',{exact:true}).selectOption('events');
    let release;current.readGate=new Promise(resolve=>{release=resolve;});const jobs=current.jobs,events=Store.readEvents(current.root).length;
    const deniedBefore=responses.filter(r=>r.path==='/api/research/deep'&&r.status===403).length;
    await page.getByRole('button',{name:'读取当前证据',exact:true}).click();await waitFor(()=>current.readWaiting,'delayed snapshot was not reached');
    current.authorized=false;await page.evaluate(()=>deepHarness.revoke());release();
    await page.waitForFunction(()=>deepHarness.calls.some(c=>c.aborted===true));
    await waitFor(()=>responses.filter(r=>r.path==='/api/research/deep'&&r.status===403).length>deniedBefore,'revoked HTTP response was not denied');
    assert.equal(await page.getByRole('heading',{name:'事件影响',exact:true}).count(),0);assert.equal(current.jobs,jobs);
    assert.equal(Store.readEvents(current.root).length,events);assert.equal(JSON.stringify(current.account),current.accountBytes);
    assert.deepEqual(fs.readFileSync(current.backgroundRawFile),current.backgroundRaw);assert.deepEqual(fs.readFileSync(current.backgroundEventFile),current.backgroundEvent);
    assert.equal(Store.readEvents(path.join(current.backgroundRoot,'events')).length,1);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    report.views.push({...viewport,importedRecords:1,frozenComparisons:1,taskRows:78,unknownOriginalTasks:66,
     observedTradingDays:0,completeObservationDays:0,longTermAccepted:false,revokedReadDenied:true,abortedPrivateStateCleared:true,
     authorityAccountUnchanged:true,overflow,errors});
   }catch(error){
    fs.writeFileSync(path.join(output,'failure-'+viewport.width+'.txt'),String(error.stack)+'\n'+await page.locator('body').innerText());
    await page.screenshot({path:path.join(output,'failure-'+viewport.width+'.png'),fullPage:true});throw error;
   }finally{await context.close();}
  }
  session=fixture('viewer');const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
  try{
   await page.goto(origin+'/m?role=view',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.deepHarness?.ready);
   assert.equal(await page.getByRole('button',{name:'读取当前证据',exact:true}).isDisabled(),true);
   await page.getByText('导入自有或已授权研究证据',{exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'保存研究证据',exact:true}).isDisabled(),true);
   await page.getByLabel('深度研究主题',{exact:true}).selectOption('acceptance');
   assert.equal(await page.evaluate(()=>deepHarness.calls.length),0);report.viewerPrivateReads=0;
  }finally{await context.close();}
  assert.deepEqual(unexpectedWrites,[]);report.passed=true;report.unexpectedWrites=0;
  fs.writeFileSync(path.join(output,'deep-research-browser-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify({passed:true,output,...report},null,2)+'\n');
 }finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(privateRoot,{recursive:true,force:true});
 }
}
run().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
