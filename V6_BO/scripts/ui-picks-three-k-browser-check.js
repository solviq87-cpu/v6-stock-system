#!/usr/bin/env node
'use strict';
// Isolated browser QA: fixture only, never launches server.js or contacts live markets.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),
 os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {paginateKlineRows}=require('../src/core/kline-read-pagination');
const {aggregate}=require('../public/assets/picks-periods');
const root=path.resolve(__dirname,'../public');
const out=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-three-k-'));
fs.mkdirSync(out,{recursive:true});
const files=new Set(['/picks.html','/assets/picks-page.js','/assets/picks-followup.js','/assets/picks-periods.js',
 '/assets/picks-three-k.js','/assets/picks-three-k.css']);
const tracking={schemaVersion:1,mode:'forward-signal-price-observation',
 canTrade:false,verifiedLive:false,prospectiveCertified:false,executionSimulated:false,
 asOf:'2026-11-09',cohortFingerprint:'a'.repeat(64),marketFingerprint:'b'.repeat(64),
 records:[{signalId:'fixture-1',symbol:'600519',system:'fourteen',cohort:'突破',
  signalDate:'2026-11-02',baselineClose:10,
  windows:[{tradingDays:1,targetDate:'2026-11-03',status:'observed',priceReturnPct:0},
   {tradingDays:5,targetDate:'2026-11-09',status:'observed',priceReturnPct:2.5},
   {tradingDays:20,targetDate:null,status:'pending',priceReturnPct:null},
   {tradingDays:60,targetDate:null,status:'calendar-incomplete',priceReturnPct:null}]}]};
const candidates={snapshotDay:'2026-11-06',forwardTracking:tracking,items:[
 {code:'600519',name:'测试股票甲',price:11.4,pct:1.4,score:82,sector:'专用设备',
  hit:[{text:'放量突破'},{text:'红三兵'}],riskLevel:'待评估'},
 {code:'000001',name:'测试股票乙',price:18,pct:-1.1,score:69,hit:[],risk:{blocked:true}}
]};
const series=[];
let d=new Date(Date.UTC(2024,0,1));
for(let i=0;series.length<500&&i<800;i++){
 const day=d.getUTCDay();
 if(day!==0&&day!==6){
  const n=series.length,p=10+n*.01;
  series.push({date:d.toISOString().slice(0,10),open:p,close:p+.07,high:p+.2,low:p-.2,volume:10000+n});
 }
 d=new Date(d.getTime()+86400000);
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1'),file=u.pathname;
 if(!files.has(file)){res.writeHead(404);res.end('fixture missing');return;}
 try{const data=fs.readFileSync(path.join(root,file.slice(1)));
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'application/javascript');
 res.end(data);}catch(e){res.writeHead(500);res.end('missing source');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const report=[];
 try{
  for(const [label,width,height] of [['phone-320',320,700],['phone-390',390,844],
   ['phone-430',430,932],['tablet-1024',1024,768],['desktop-1536',1536,864]]){
   const page=await browser.newPage({viewport:{width,height}});
   const errors=[],calls=[];let revoked=false;
   page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.url().includes('/api/'))calls.push({method:r.method(),url:r.url()});});
   await page.route('**/api/quant-picks?**',r=>r.fulfill({status:revoked?401:200,
    contentType:'application/json',body:JSON.stringify(revoked?{locked:true}:candidates)}));
   await page.route('**/api/kline?**',async r=>{
    const url=new URL(r.request().url()),end=url.searchParams.get('end')||'';
    const pageData=paginateKlineRows(series,{n:url.searchParams.get('n'),end});
    if(end)await new Promise(resolve=>setTimeout(resolve,160)); // Inspect partial first period before paging finishes.
    return r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,code:url.searchParams.get('code'),...pageData})});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/picks.html');
   await page.waitForFunction(()=>document.querySelectorAll('.pick').length===2);
   assert.match(await page.locator('.pick').first().textContent(),/放量突破/);
   assert.match(await page.locator('.pick').first().textContent(),/红三兵/);
   assert.equal(await page.locator('button.pick-open').count(),2);
   await page.locator('.pick-open').first().click();
   await page.waitForFunction(()=>document.querySelector('#periodChart svg'));
   assert.match(await page.locator('#pickDetailCaption').textContent(),/测试股票甲/);
   assert.match(await page.locator('#pickFollowup').textContent(),/\+2\.50%/);
   assert.match(await page.locator('#pickFollowup').textContent(),/待成熟/);
   assert.match(await page.locator('.pick').first().textContent(),/2 项已观察/);
   await page.locator('[data-period="month"]').click();
   const completeFirstPage=aggregate(series.slice(-240),'month').length-1;
   // The loading spinner can replace the intermediate caption in the same
   // input event, so assert real visible candles rather than a transient label.
   await page.waitForFunction(n=>document.querySelectorAll('#periodChart svg g').length===n,
     completeFirstPage,{timeout:8000});
   assert.equal(await page.locator('#periodChart svg g').count(),completeFirstPage,
     'must not render the first, truncated monthly candle while older pages remain');
   await page.waitForFunction(()=>document.getElementById('periodStatus')?.textContent?.includes('历史起点可能从上市日开始'),null,{timeout:10000});
   assert.equal(await page.locator('[data-period="month"]').getAttribute('aria-pressed'),'true');
   for(const [name,period] of [['年K','year'],['日K','day']]){
    await page.locator('[data-period="'+period+'"]').click();
    await page.waitForFunction(p=>document.getElementById('periodStatus')?.textContent?.includes(p),name);
    assert.equal(await page.locator('[data-period="'+period+'"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#periodChart svg').count(),1);
   }
   const historyCalls=calls.filter(c=>c.url.includes('/api/kline'));
   assert.equal(historyCalls.length,3,'240+240+20 history pages should be fetched; period tabs reuse cached rows');
   assert.ok(historyCalls.slice(1).every(c=>/^\d{8}$/.test(new URL(c.url).searchParams.get('end')||'')),
     'older pages must use an exclusive ISO trading-date cursor');
   const sizes=await page.evaluate(()=>{
    const rect=q=>document.querySelector(q).getBoundingClientRect().toJSON();
    return {bodyWidth:document.body.scrollWidth,viewport:innerWidth,
     list:rect('#selectionList'),detail:rect('#pickDetail'),chart:rect('#periodChart')};
   });
   assert.ok(sizes.bodyWidth<=width+1,label+' horizontal overflow '+JSON.stringify(sizes));
   if(width>900)assert.ok(sizes.list.right<=sizes.detail.left+3,label+' desktop must keep list and detail side by side');
   else assert.ok(sizes.detail.top>=sizes.list.top,label+' mobile/tablet must stack in natural scroll flow');
   await page.locator('.pick-open').nth(1).click();
   await page.waitForFunction(()=>document.querySelector('#pickDetailCode')?.textContent==='000001');
   assert.match(await page.locator('#detailReasons').textContent(),/不能视作已命中/);
   assert.match(await page.locator('#pickFollowup').textContent(),/没有与这只股票代码匹配/);
   revoked=true;
   await page.locator('#reload').click();
   await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('没有只读查看权限'));
   assert.equal(await page.locator('.pick').count(),0,'revocation must erase old picks');
   assert.equal(await page.locator('#pickDetailCode').textContent(),'尚未选择');
   assert.doesNotMatch(await page.locator('#pickFollowup').textContent(),/2\.50%/);
   assert.ok(calls.every(c=>c.method==='GET'),'must not write to stock scanners or Feishu');
   assert.deepEqual(errors,[],'browser errors '+label);
   if(process.env.V6_UI_SCREENSHOTS==='1'){
    revoked=false;await page.locator('#reload').click();
    await page.waitForFunction(()=>document.querySelectorAll('.pick').length===2);
    await page.locator('.pick-open').first().click();
    await page.waitForFunction(()=>document.querySelector('#periodChart svg'));
    await page.screenshot({path:path.join(out,'picks-'+label+'.png'),fullPage:true});
   }
   report.push({label,...sizes,requests:calls.length});
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 fs.writeFileSync(path.join(out,'three-k-geometry.json'),JSON.stringify(report,null,2));
 console.log('PASS PICKS THREE-K VIEWPORTS: '+report.length);
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
