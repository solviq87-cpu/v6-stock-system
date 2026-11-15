#!/usr/bin/env node
'use strict';
// Native rendering against conspicuously synthetic public data; no production API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const output=process.env.FAYO_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-daily-review-'));
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://127.0.0.1').pathname;
 if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"><main class="fy-main" id="mount"></main>');}
 if(!/^\/nova\/[a-z0-9.-]+$/i.test(name)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,name)));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 const result=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [390,1366]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],outside=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(outside.push('blocked-external-request'),route.abort()));
   await page.goto(origin);
   await page.evaluate(async()=>{
    const {renderPulse,renderMarket}=await import('/nova/market.js');
    const pool=Array.from({length:97},(_,i)=>({code:String(600000+i),name:i===96?'ST合成样本':'合成样本'+i,price:10,pct:10,sector:i%2?'合成行业甲':'合成行业乙',sectorTags:[i%2?'合成行业甲':'合成行业乙',...(i===96?['合成联动主题']:[])],limitUpCount:i%3+1,tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',reason:'隔离测试原因'+i,reasonTradeDate:'2026-11-13',reasonSource:'synthetic-cls',reasonDateStatus:'matched',canTrade:false,canNotify:false}));
    const state={trading:false,ztReviewPool:pool,ztReviewPoolMeta:{tradeDate:'2026-11-13',status:'ready',uniqueCount:97,wholeMarketCertified:false,intersectionCount:96,clsOnlyCount:1,eastmoneyOnlyCount:0,sources:[{source:'synthetic-eastmoney',tradeDate:'2026-11-13',totalCount:96,fetchedCount:96,providerComplete:true,includesST:false},{source:'synthetic-cls',tradeDate:'2026-11-13',totalCount:97,fetchedCount:97,providerComplete:true,includesST:true}]}};
    const mount=document.getElementById('mount');window.opened=null;window.refreshView=null;
    const ctx={role:'edit',state,signal:new AbortController().signal,stock:'',notify:()=>{},api:async()=>{throw Error('Synthetic fixture has no backend API');},selectStock:code=>window.opened=code,onState:fn=>window.refreshView=fn,navigate:(view,sub)=>{window.route={view,sub};mount.replaceChildren(renderMarket({sub},ctx));}};
    mount.replaceChildren(renderPulse({sub:'overview'},ctx));
   });
   await page.getByRole('button',{name:/每日复盘 · 全部涨停票/}).click();
   assert.equal(await page.evaluate(()=>window.route.sub),'review');
   assert.match(await page.locator('#mount').innerText(),/可见复盘池 97/);
   const seen=new Set();
   for(let i=0;i<4;i++){
    for(const code of await page.locator('[data-code]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-code'))))seen.add(code);
    if(i<3)await page.getByRole('button',{name:'下一页',exact:true}).click();
   }
   assert.equal(seen.size,97,'every synthetic record is reachable');
   const search=page.getByRole('searchbox',{name:'搜索每日复盘'});
   await search.fill('600096');assert.equal(await page.locator('[data-code]').count(),1);
   await page.locator('[data-code="600096"]').click();assert.equal(await page.evaluate(()=>window.opened),'600096');
   await search.fill('');await page.getByLabel('筛选复盘板块').selectOption('合成联动主题');
   assert.match(await page.locator('#mount').innerText(),/ST合成样本/);
   const evidence=page.locator('details').first();await evidence.evaluate(node=>node.open=true);
   await page.evaluate(()=>window.refreshView?.());assert.equal(await page.locator('details').first().evaluate(node=>node.open),true);
   const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
   await page.getByLabel('筛选复盘板块').selectOption('');await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
   assert.ok(await page.evaluate(()=>scrollY>0),'the complete mobile/desktop review remains vertically scrollable');
   await page.screenshot({path:path.join(output,'daily-review-'+width+'.png'),fullPage:true});
   assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
   result.push({width,reachableRecords:seen.size,search:true,sectorFilter:true,stockDrawerCallback:true,expandedEvidenceRetained:true,verticalScroll:true,horizontalOverflow:false,externalRequests:0});
   await page.close();
  }
  fs.writeFileSync(path.join(output,'daily-review-results.json'),JSON.stringify({scope:'synthetic-browser-only',checks:result},null,2)+'\n');
  console.log(JSON.stringify({ok:true,scope:'synthetic-browser-only',checks:result,output}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
