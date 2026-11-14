#!/usr/bin/env node
'use strict';
// Real research page, explicitly synthetic state/transport; no market/model egress.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-learning-ui-')),publicRoot=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||path.join(temp,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}});
const at=Date.parse('2026-11-13T16:00:00+08:00');
function status(state='idle'){return {counts:{total:20,pending:5,matured:10,live:16,invalid:1,backtest:2,posthoc:1,void:1},byType:{trendsig:{total:16,matured:10,pending:5,invalid:1}},outcomeVersion:'calendar-final-ohlcv-v1',operation:{state,kind:state==='idle'?null:'force',startedAt:at,finishedAt:state==='success'?at+3000:null,beforeMatured:8,afterMatured:10,newOutcomes:2,attempted:3,fetched:2}};}
function runtime(overrides={}){return {schemaVersion:1,mode:'v6-learning-runtime-preflight',checkedAt:at,readOnly:true,researchOnly:true,canTrade:false,productionWeightsChanged:false,overall:'awaiting-model-probe',nextAction:'probe-local-model',configuration:{status:'configured'},model:{status:'not-probed',modelName:'fixture-model:v1',modelDigest:'a'.repeat(64),checkedAt:null,inferenceVerified:false},current:{status:'preview-ready',nextAction:'run-capture-research-cycle',sourceDay:'2026-11-13',captureDays:2},lastRun:{status:'research-cycle-completed-not-certified',checkTime:at-86400000,sourceDay:'2026-11-12',captureDays:1,nextAction:'await-next-source-or-research-lineage'},...overrides};}
const runtimeFixtures=[
 ['unconfigured',runtime({overall:'unconfigured',nextAction:'configure-private-research-agent',configuration:{status:'unconfigured'},current:{status:'unconfigured',nextAction:null,sourceDay:null,captureDays:null},model:{status:'disabled'},lastRun:null}),'尚未配置研究任务','未启用'],
 ['unconfigured-verified',runtime({overall:'unconfigured',configuration:{status:'unconfigured'},model:{status:'verified',modelName:'fixture:v1',modelDigest:'a'.repeat(64),checkedAt:at,inferenceVerified:false}}),'尚未配置研究任务','模型摘要已核对'],
 ['invalid-config',runtime({overall:'blocked',nextAction:'check-private-configuration',configuration:{status:'invalid'},current:{status:'not-checked'},model:{status:'invalid-config'}}),'运行条件受阻','配置无效'],
 ['memory-mismatch',runtime({overall:'blocked',nextAction:'check-private-configuration',configuration:{status:'memory-mismatch'},current:{status:'blocked'}}),'记忆目录不匹配','条件受阻'],
 ['awaiting-probe',runtime(),'等待本地模型检查','尚未检查'],
 ['model-unavailable',runtime({overall:'blocked',nextAction:'check-local-model-configuration',model:{status:'unavailable'}}),'运行条件受阻','本地模型服务不可用'],
 ['digest-mismatch',runtime({overall:'blocked',nextAction:'verify-local-model-digest',model:{status:'digest-mismatch'}}),'运行条件受阻','模型摘要不匹配'],
 ['needs-data',runtime({overall:'needs-data',nextAction:'await-independent-matured-h5-days',current:{status:'needs-data',nextAction:'await-independent-matured-h5-days',sourceDay:'2026-11-13',captureDays:2}}),'需要补充研究数据','现有冻结天数：2'],
 ['ready',runtime({overall:'ready-for-research',nextAction:'run-capture-research-cycle',model:{status:'verified',modelName:'fixture-model:v1',modelDigest:'a'.repeat(64),checkedAt:at,inferenceVerified:false}}),'具备研究预检条件','模型摘要已核对'],
 ['unchanged',runtime({overall:'ready-for-research',current:{status:'unchanged',nextAction:'await-next-source-or-research-lineage',sourceDay:'2026-11-13',captureDays:0}}),'条件暂无变化','现有冻结天数：0'],
 ['unknown',runtime({overall:'UNKNOWN_PRIVATE',nextAction:'UNKNOWN_ACTION',checkedAt:'unknown',configuration:{status:'UNKNOWN_CONFIG'},model:{status:'UNKNOWN_MODEL',modelName:'SECRET?token=private',modelDigest:'SECRET'},current:{status:'UNKNOWN_CURRENT',sourceDay:'2026-02-30',captureDays:'2'},lastRun:{status:'UNKNOWN_LAST',checkTime:-1,secretPath:'/SECRET'}}),'运行预检：未知','现有冻结天数：未知']
];
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:1000}}),requests=[],runtimeRequests=[],errors=[],external=[];let state='idle',deny=false,hold=false,held,release,runtimeReport=runtime();
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin){external.push(u.origin);return route.abort();}if(!u.pathname.startsWith('/api/'))return route.continue();
    if(!['/api/learn-status','/api/research/learning-runtime'].includes(u.pathname))return route.fulfill({status:403,json:{ok:false,error:'synthetic-unused'}});
    if(u.pathname==='/api/research/learning-runtime'){
     runtimeRequests.push({method:req.method(),url:req.url(),body:req.postDataJSON(),auth:req.headers().authorization});
     if(deny)return route.fulfill({status:403,json:{ok:false,error:'synthetic-denied'}}).catch(()=>{});
     if(req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{probeModel:true});runtimeReport={...runtimeReport,model:{...runtimeReport.model,status:'verified',checkedAt:at,inferenceVerified:false}};}
     return route.fulfill({json:{ok:true,result:runtimeReport}}).catch(()=>{});
    }
    requests.push({method:req.method(),url:req.url(),body:req.postDataJSON(),auth:req.headers().authorization});
    if(hold){hold=false;held();await new Promise(r=>release=r);}
    if(deny)return route.fulfill({status:403,json:{ok:false,error:'synthetic-denied'}}).catch(()=>{});
    if(req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{force:true,limit:30});state='success';}
    return route.fulfill({json:{ok:true,status:status(state)}}).catch(()=>{});
   });
   await page.goto(origin+'/research.html');assert.equal(requests.length,0);assert.equal(runtimeRequests.length,0);await page.locator('#token').fill('synthetic-learning-editor');
   const card=page.locator('#learningWorkbench');await card.scrollIntoViewIfNeeded();assert.equal(await page.locator('#learningSummary').isVisible(),false);
   await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.startsWith('已读取'));
   assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].auth,'Bearer synthetic-learning-editor');assert.equal(new URL(requests[0].url).searchParams.get('token'),null);
   assert.ok((await page.locator('#learningSummary').textContent()).includes('实盘有效已验10'));
   const receipt=card.locator('#learningDetails details').last();await receipt.locator('summary').click();assert.ok((await receipt.textContent()).includes('模型 / 规则 / 结果口径版本：未知 / 未知 / calendar-final-ohlcv-v1'));
   await page.locator('#learningLimit').fill('61');await page.locator('#learningForce').click();assert.equal(requests.length,1);assert.ok((await page.locator('#learningStatus').textContent()).includes('1至60'));
   await page.locator('#learningLimit').fill('30');await page.locator('#learningForce').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.startsWith('已读取'));
   assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.ok((await page.locator('#learningSummary').textContent()).includes('新增有效结果 2'));
   state='running';await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.includes('服务端学习任务正在运行'));
   assert.equal(await page.locator('#learningForce').isDisabled(),true);assert.equal(await page.locator('#learningRead').isDisabled(),false);
   state='success';await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.startsWith('已读取'));assert.equal(await page.locator('#learningForce').isDisabled(),false);
   await card.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const geometry=await card.locator('button,input,summary').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().height));assert.ok(geometry.every(h=>h>=44));
   await card.screenshot({path:path.join(output,'learning-workbench-'+width+'.png')});
   const runtimeArea=page.locator('#learningRuntimeSummary');
   for(const [name,report,...expected]of runtimeFixtures){
    runtimeReport=report;await page.locator('#learningRuntimeRead').click();await page.waitForFunction(()=>document.getElementById('learningRuntimeStatus').textContent.startsWith('已检查'));
    const text=await runtimeArea.textContent();for(const phrase of expected)assert.ok(text.includes(phrase),name+' missing '+phrase);assert.ok(!/UNKNOWN_|SECRET|2026-02-30/.test(text));
    assert.ok((await page.locator('#learningSummary').textContent()).includes('实盘有效已验10'));
    const last=runtimeArea.locator('details');await last.locator('summary').click();assert.ok((await last.textContent()).includes('上次记录'));assert.ok((await last.textContent()).includes('不能证明后台任务仍在运行'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const runtimeGeometry=await card.locator('button,input,summary').evaluateAll(xs=>xs.filter(x=>x.getClientRects().length).map(x=>x.getBoundingClientRect().height));assert.ok(runtimeGeometry.every(h=>h>=44));
    await card.screenshot({path:path.join(output,'learning-runtime-'+name+'-'+width+'.png')});
   }
   runtimeReport=runtime();await page.locator('#learningModelProbe').click();await page.waitForFunction(()=>document.getElementById('learningRuntimeStatus').textContent.startsWith('已检查'));assert.ok((await runtimeArea.textContent()).includes('模型摘要已核对'));
   assert.equal(runtimeRequests.filter(r=>r.method==='POST').length,1);assert.equal(runtimeRequests.filter(r=>r.method==='GET').length,runtimeFixtures.length);
   for(const request of runtimeRequests){assert.equal(new URL(request.url).search,'');assert.equal(request.auth,'Bearer synthetic-learning-editor');if(request.method==='GET')assert.equal(request.body,null);else assert.deepEqual(request.body,{probeModel:true});}
   const noAutoCount=runtimeRequests.length;await page.waitForTimeout(50);assert.equal(runtimeRequests.length,noAutoCount);
   hold=true;const waiting=new Promise(r=>held=r);await page.locator('#learningRead').click();await waiting;
   await page.locator('#token').fill('synthetic-learning-another');assert.equal(await page.locator('#learningSummary').textContent(),'');assert.equal(await runtimeArea.textContent(),'');release();await page.waitForTimeout(40);assert.equal(await page.locator('#learningSummary').textContent(),'');
   deny=true;await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.includes('读取权限已失效'));assert.equal(await page.locator('#learningDetails').textContent(),'');assert.equal(await runtimeArea.textContent(),'');
   deny=false;runtimeReport=runtime();await page.locator('#learningRuntimeRead').click();await page.waitForFunction(()=>document.getElementById('learningRuntimeStatus').textContent.startsWith('已检查'));deny=true;await page.locator('#learningModelProbe').click();await page.waitForFunction(()=>document.getElementById('learningRuntimeStatus').textContent.includes('读取权限已失效'));assert.equal(await runtimeArea.textContent(),'');
   deny=false;await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.startsWith('已读取'));const before=requests.length;
   await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal(await page.locator('#learningSummary').textContent(),'');assert.equal(requests.length,before);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();console.log('learning workbench UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
