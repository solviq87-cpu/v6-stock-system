#!/usr/bin/env node
'use strict';
// Real HTML/CSS/JS, synthetic public metadata plus the actual catalog. No private APIs.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-library-context-')),output=process.env.V6_UI_QA_DIR||temporary;
fs.mkdirSync(output,{recursive:true});
const entry=(id,category,adoption)=>({id,name:'合成公开资料'+id,category,adoption,kind:'合成公开目录',reads:[],borrow:['共享公开上下文'],license:'合成许可',weightsLicense:'无权重',runMode:[],implementation:[],limit:'不执行模型',runtimeNotes:'合成浏览器验证',status:'合成',v6MeasuredAccuracy:null,v6MeasuredLatencyMs:null});
const fixture={schemaVersion:1,reviewDate:'2026-11-14',entries:[entry('U02','interface','implemented'),entry('U08','interface','implemented'),entry('U09','interface','candidate'),entry('T01','workflow','candidate')]};
const actual=JSON.parse(fs.readFileSync(path.join(root,'assets/model-library-catalog.json'),'utf8'));
const allowed=new Set(['/model-library.html','/assets/model-library.js','/assets/public-library-context.js','/assets/model-library.css','/assets/model-library-catalog.json']);
let mode='fixture';const requests=[];
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;requests.push(pathname);
 if(!allowed.has(pathname)){res.writeHead(404);return res.end();}
 if(pathname==='/assets/model-library-catalog.json'){
  res.setHeader('Content-Type','application/json');
  if(mode==='failure'){res.writeHead(503);return res.end('{}');}
  return res.end(JSON.stringify(mode==='malformed'?{schemaVersion:1,reviewDate:'2026-11-14',entries:[{id:'U02'}]}:mode==='actual'?actual:fixture));
 }
 res.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css':'text/javascript');
 res.end(fs.readFileSync(path.join(root,pathname.slice(1))));
});
const ready=page=>page.waitForFunction(()=>document.getElementById('libraryStatus').textContent.startsWith('已读取'));
const failed=page=>page.waitForFunction(()=>document.getElementById('libraryRetry').hidden===false);
const compared=page=>page.locator('[data-compare-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.compareId));
(async()=>{let browser;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   mode='fixture';const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[],api=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.method());});
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.origin);return route.abort();}return route.continue();});
   let release;const held=new Promise(resolve=>release=resolve);await page.route('**/assets/model-library-catalog.json',async route=>{await held;return route.continue();});
   try{
    await page.goto(origin+'/model-library.html?category=interface&adoption=implemented&ids=U09,unknown,U02,U08,U09,T01&token=synthetic-private-token&runId=synthetic-private-run&q=synthetic-private-search',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#libraryShare').isVisible(),false);assert.deepEqual(await compared(page),[]);
   }finally{release();}
   await ready(page);await page.unroute('**/assets/model-library-catalog.json');
   assert.deepEqual(await compared(page),['U02','U08','U09']);assert.equal(await page.locator('#libraryCategory').inputValue(),'interface');assert.equal(await page.locator('#libraryAdoption').inputValue(),'implemented');assert.equal(await page.locator('#librarySearch').inputValue(),'');assert.equal(await page.locator('.catalog-card').count(),2);
   const canonical='/model-library.html?category=interface&adoption=implemented&ids=U02%2CU08%2CU09#compareHeading';
   assert.equal(await page.locator('#libraryShare').getAttribute('href'),canonical);
   await page.locator('#librarySearch').fill('不应进入链接的查询');assert.equal(await page.locator('.catalog-card').count(),0);assert.deepEqual(await compared(page),['U02','U08','U09']);assert.equal(await page.locator('#libraryShare').getAttribute('href'),canonical);
   await page.goto(origin+await page.locator('#libraryShare').getAttribute('href'));await ready(page);assert.deepEqual(await compared(page),['U02','U08','U09']);assert.equal(new URL(page.url()).searchParams.has('token'),false);assert.equal(new URL(page.url()).searchParams.has('q'),false);
   await page.locator('#libraryClear').click();await page.reload();await ready(page);assert.deepEqual(await compared(page),[]);assert.equal(new URL(page.url()).searchParams.has('ids'),false);
   await page.goto(origin+canonical);await ready(page);
   await page.locator('#libraryCategory').selectOption('workflow');await page.locator('#libraryAdoption').selectOption('candidate');assert.equal(await page.locator('.catalog-card').count(),1);assert.deepEqual(await compared(page),['U02','U08','U09']);assert.match(await page.locator('#libraryShare').getAttribute('href'),/category=workflow&adoption=candidate/);
   await page.locator('[data-compare-id=U09] button').click();assert.deepEqual(await compared(page),['U02','U08']);assert.match(await page.locator('#libraryShare').getAttribute('href'),/ids=U02%2CU08#compareHeading$/);
   await page.goto(origin+'/model-library.html?category=javascript:alert(1)&adoption=candidate&adoption=implemented&ids=U02&ids=U08&next=https://example.invalid/');await ready(page);assert.deepEqual(await compared(page),[]);assert.equal(await page.locator('#libraryCategory').inputValue(),'');assert.equal(await page.locator('#libraryAdoption').inputValue(),'');assert.equal(await page.locator('#libraryShare').getAttribute('href'),'/model-library.html#catalogHeading');
   mode='failure';await page.goto(origin+'/model-library.html?category=interface&ids=U02,U08');await failed(page);assert.deepEqual(await compared(page),[]);assert.equal(await page.locator('#libraryShare').isVisible(),false);assert.equal(await page.locator('#libraryShare').getAttribute('href'),null);
   mode='fixture';await page.locator('#libraryRetry').click();await ready(page);assert.deepEqual(await compared(page),[]);assert.equal(await page.locator('#libraryCategory').inputValue(),'');assert.equal(await page.locator('#libraryShare').getAttribute('href'),'/model-library.html#catalogHeading');
   mode='malformed';await page.reload();await failed(page);assert.equal(await page.locator('#libraryShare').isVisible(),false);assert.deepEqual(await compared(page),[]);mode='fixture';await page.locator('#libraryRetry').click();await ready(page);assert.deepEqual(await compared(page),[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const rect=await page.locator('#libraryShare').boundingBox();assert.ok(rect&&rect.height>=44&&rect.width>=44);await page.screenshot({path:path.join(output,'library-public-context-'+width+'.png'),fullPage:false});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(api,[]);await page.close();console.log('public catalog context '+width+' passed');
  }
  assert.ok(actual.entries.length>=53,'Build the 12 newly reviewed UI sources into the catalog before the actual-catalog check');
  for(const id of ['U02','U08','U09'])assert.ok(actual.entries.some(e=>e.id===id),'Actual catalog missing '+id);
  mode='actual';
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(new URL(route.request().url()).origin);return route.abort();}return route.continue();});
   await page.goto(origin+'/model-library.html?category=interface&ids=U02,U08,U09#compareHeading');await ready(page);assert.deepEqual(await compared(page),['U02','U08','U09']);assert.equal(await page.locator('#libraryCategory').inputValue(),'interface');assert.equal(await page.locator('#libraryShare').getAttribute('href'),'/model-library.html?category=interface&ids=U02%2CU08%2CU09#compareHeading');
   for(const id of ['U02','U08','U09'])assert.ok((await page.locator('[data-compare-id='+id+']').innerText()).includes(actual.entries.find(e=>e.id===id).license));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'library-public-context-actual-'+width+'.png'),fullPage:false});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();console.log('actual '+actual.entries.length+'-source public context '+width+' passed');
  }
  assert.ok(requests.every(p=>allowed.has(p)));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
