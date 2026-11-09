#!/usr/bin/env node
'use strict';
// Browser-only V6 picks hub test. Test data and responses never leave localhost.
// No production service, scanning, paid feed, broker, or Feishu webhook is started.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),
 assert=require('node:assert/strict'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const out=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-picks-ui-'));
fs.mkdirSync(out,{recursive:true});
const fake={
  asOf:'2026-11-06',count:4,items:[
   {code:'600519',name:'测试股票甲',sector:'专用设备',price:12.46,pct:1.25,score:81,quoteAt:Date.parse('2026-11-06T07:00:00Z'),quoteSource:'qa-fixture',hit:[{text:'条件1：量能确认'},{text:'条件2：收盘突破'}],strategy:'样本战法',riskLevel:'未知'},
   {code:'000001',name:'测试股票乙',price:25.32,pct:-1.8,score:70,hit:[],blocked:true,risk:{blocked:true}},
   {code:'300750',name:'测试股票丙',price:88.2,pct:2.2,score:63,hit:[{text:'形态研究确认'}],riskLevel:'待评估'},
   {code:'688001',name:'<img src=x onerror=alert(1)>',price:18,pct:0,score:0,hit:[{text:'<svg/onload=alert(2)>'}],riskLevel:'未知'}
 ]};
const candles=Array.from({length:34},(_,i)=>({
 date:'2026-10-'+String(i%28+1).padStart(2,'0'),open:12+i*.17,close:12.07+i*.16,
 high:12.3+i*.17,low:11.86+i*.16
}));
const files=new Set(['/picks.html','/assets/picks-center.css','/assets/picks-center.js','/assets/picks-rule-catalog.js']);
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(!files.has(p)){res.writeHead(404);res.end('not found');return;}
 try{const f=path.join(root,p.replace(/^\//,''));const bytes=fs.readFileSync(f);
  res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
  res.end(bytes);
 }catch(e){res.statusCode=500;res.end('fixture test missing file');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,
  args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 const report=[];
 try{
  for(const [label,width,height] of [['picks-phone-320',320,700],['picks-phone-390',390,844],
   ['picks-phone-430',430,932],['picks-tablet-1024',1024,768],['picks-desktop-1536',1536,864]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
   let unauthorized=false;
   const calls=[],errors=[];
   page.on('pageerror',err=>errors.push(err.message));
   page.on('request',req=>{if(req.url().includes('/api/'))calls.push({method:req.method(),url:req.url()});});
   await page.route('**/api/quant-picks?**',route=>route.fulfill({
    status:unauthorized?401:200,contentType:'application/json',body:JSON.stringify(unauthorized?{error:'unauthorized'}:fake)}));
   await page.route('**/api/kline?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({ok:true,asOf:'2026-11-06',rows:candles})}));
   await page.goto('http://127.0.0.1:'+server.address().port+'/picks.html',{waitUntil:'load'});
   await page.waitForFunction(()=>document.querySelectorAll('button.stock').length===4);
   assert.equal(await page.locator('.rule').count(),9,label+' must show source-verified research catalog');
   assert.equal(await page.locator('#totalVisible').textContent(),'4');
   assert.equal(await page.locator('#hitCount').textContent(),'3');
   assert.equal(await page.locator('#riskCount').textContent(),'1');
   assert.equal(await page.locator('#stockDetail .reasons').count(),2);
   assert.equal(await page.locator('#chartCanvas svg').count(),1,'chart must use fetched OHLC instead of sample DOM');
   assert.equal(await page.locator('.stock img').count(),0,'source-provided markup must not execute');
   assert.ok((await page.locator('#pickCards').innerHTML()).includes('&lt;img'),'escape untrusted names');
   const size=await page.evaluate(()=>({
    viewport:innerWidth,bodyWidth:document.body.scrollWidth,
    cards:document.querySelectorAll('button.stock').length,
    resultRect:document.getElementById('pickCards').getBoundingClientRect().toJSON(),
    detailRect:document.getElementById('stockDetail').getBoundingClientRect().toJSON(),
    dockRect:document.querySelector('.bottom').getBoundingClientRect().toJSON()
   }));
   assert.ok(size.bodyWidth<=width+1,label+' horizontal page overflow '+JSON.stringify(size));
   assert.ok(size.resultRect.width>=width*.72,label+' candidate list too narrow '+JSON.stringify(size));
   if(width<=650){
    assert.ok(size.dockRect.height>40&&size.dockRect.width>=width-1,'mobile dock missing');
    assert.ok(size.detailRect.width>=width*.72,'mobile detail pane too narrow');
   }
   const initialScroll=await page.evaluate(()=>scrollY);
   await page.locator('button.stock').nth(1).click();
   await page.waitForFunction(()=>document.querySelector('#detailStatus')?.textContent?.includes('000001'));
   assert.match(await page.locator('#detailBody').textContent(),/风险|阻断/);
   assert.equal(await page.locator('button.stock.is-selected').count(),1);
   await page.locator('[data-filter="hit"]').click();
   assert.equal(await page.locator('button.stock').count(),3);
   await page.locator('[data-filter="all"]').click();
   await page.locator('#stockSearch').fill('300750');
   assert.equal(await page.locator('button.stock').count(),1);
   await page.locator('#stockSearch').fill('');
   await page.locator('#refreshPicks').click();
   await page.waitForFunction(()=>document.querySelector('#cloudStatus')?.textContent?.includes('选股结果已同步'));
   assert.ok(calls.every(c=>c.method==='GET'&&!c.url.includes('force=')&&!c.url.includes('send=')),label+' may not trigger scanner writes or trade operations');
   // Explicit authorization revocation must remove old holdings/selection, including metrics.
   unauthorized=true;
   await page.locator('#refreshPicks').click();
   await page.waitForFunction(()=>document.querySelector('#cloudStatus')?.textContent?.includes('没有查看候选池的权限'));
   assert.equal(await page.locator('button.stock').count(),0,label+' old picks must disappear after 401');
   assert.equal(await page.locator('#totalVisible').textContent(),'—',label+' counts must be cleared after 401');
   assert.match(await page.locator('#detailBody').textContent(),/权限已失效/);
   assert.deepEqual(errors,[],label+' unhandled JS error');
   if(process.env.V6_UI_SCREENSHOTS==='1'){
    unauthorized=false;
    await page.locator('#refreshPicks').click();
    await page.waitForFunction(()=>document.querySelectorAll('button.stock').length===4);
    await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});
   }
   report.push({label,...size,apiCalls:calls.length,errors,scrolled:await page.evaluate(()=>scrollY>0),initialScroll});
   await page.close();
  }
 }finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
 fs.writeFileSync(path.join(out,'picks-report.json'),JSON.stringify(report,null,2));
 console.log('PICKS BROWSER PASS '+report.length+' viewport cases: '+JSON.stringify(report.map(r=>({label:r.label,bodyWidth:r.bodyWidth,viewport:r.viewport,apiCalls:r.apiCalls}))));
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
