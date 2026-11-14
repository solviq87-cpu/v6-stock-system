#!/usr/bin/env node
'use strict';
// Real research page, explicitly synthetic state/transport; no market/model egress.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-learning-ui-')),publicRoot=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||path.join(temp,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}});
const at=Date.parse('2026-11-13T16:00:00+08:00');
function status(state='idle'){return {counts:{total:20,pending:5,matured:10,live:16,invalid:1,backtest:2,posthoc:1,void:1},byType:{trendsig:{total:16,matured:10,pending:5,invalid:1}},outcomeVersion:'calendar-final-ohlcv-v1',operation:{state,kind:state==='idle'?null:'force',startedAt:at,finishedAt:state==='success'?at+3000:null,beforeMatured:8,afterMatured:10,newOutcomes:2,attempted:3,fetched:2}};}
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:1000}}),requests=[],errors=[],external=[];let state='idle',deny=false,hold=false,held,release;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin){external.push(u.origin);return route.abort();}if(!u.pathname.startsWith('/api/'))return route.continue();
    if(u.pathname!=='/api/learn-status')return route.fulfill({status:403,json:{ok:false,error:'synthetic-unused'}});
    requests.push({method:req.method(),url:req.url(),body:req.postDataJSON(),auth:req.headers().authorization});
    if(hold){hold=false;held();await new Promise(r=>release=r);}
    if(deny)return route.fulfill({status:403,json:{ok:false,error:'synthetic-denied'}}).catch(()=>{});
    if(req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{force:true,limit:30});state='success';}
    return route.fulfill({json:{ok:true,status:status(state)}}).catch(()=>{});
   });
   await page.goto(origin+'/research.html');assert.equal(requests.length,0);await page.locator('#token').fill('synthetic-learning-editor');
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
   hold=true;const waiting=new Promise(r=>held=r);await page.locator('#learningRead').click();await waiting;
   await page.locator('#token').fill('synthetic-learning-another');assert.equal(await page.locator('#learningSummary').textContent(),'');release();await page.waitForTimeout(40);assert.equal(await page.locator('#learningSummary').textContent(),'');
   deny=true;await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.includes('读取权限已失效'));assert.equal(await page.locator('#learningDetails').textContent(),'');
   deny=false;await page.locator('#learningRead').click();await page.waitForFunction(()=>document.getElementById('learningStatus').textContent.startsWith('已读取'));const before=requests.length;
   await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal(await page.locator('#learningSummary').textContent(),'');assert.equal(requests.length,before);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();console.log('learning workbench UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
