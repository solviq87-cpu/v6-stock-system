'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.V6_PLAYWRIGHT_MODULE||'playwright');
const engine=require('../src/strategy/research36'),root=path.resolve(__dirname,'../public');
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+p);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.V6_CHROMIUM_PATH?{executablePath:process.env.V6_CHROMIUM_PATH}:{})});
  const observations=[];
  for(const width of [320,390,1440]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname!=='/api/research/strategy36')return route.fulfill({status:403,contentType:'application/json',body:'{"ok":false}'});
    const data=route.request().method()==='GET'?{ok:true,catalog:engine.getCatalog()}:{ok:true,result:engine.evaluateResearch36(JSON.parse(route.request().postData()))};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/research.html');
   await page.locator('#research36Catalog').click();await page.waitForFunction(()=>document.querySelectorAll('#research36Config>details').length===36);
   const first=page.locator('#research36Config>details').first();await first.locator('summary').click();await first.locator('input[type=checkbox]').uncheck();
   await page.locator('#research36File').setInputFiles({name:'declared-research-evidence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({stock:{code:'600000'},asOf:Date.now()}))});
   await page.locator('#research36Run').click();await page.waitForFunction(()=>document.querySelectorAll('#research36Result>article').length===36);
   assert.match(await page.locator('#research36Result>article').first().textContent(),/未启用/);
   assert.match(await page.locator('#research36Result').textContent(),/等待数据/);
   const geometry=await page.locator('#research36Workspace').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}));
   assert.ok(geometry.left>=0&&geometry.right<=width+1&&!geometry.overflow,JSON.stringify(geometry));
   if(process.env.V6_UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.V6_UI_SCREENSHOT_DIR,{recursive:true});await page.locator('#research36Workspace').screenshot({path:path.join(process.env.V6_UI_SCREENSHOT_DIR,'research36-'+width+'.png')});}
   await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await page.locator('#research36Result>article').count(),0);
   assert.deepEqual(errors,[]);observations.push({width,catalog:36,results:36,overflow:false,pageErrors:0,offlineCleared:true});await page.close();
  }
  console.log(JSON.stringify({fixtureOnly:true,realDeviceVerified:false,observations},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
