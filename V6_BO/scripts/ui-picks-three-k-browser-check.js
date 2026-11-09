#!/usr/bin/env node
'use strict';
// Isolated browser QA: fixture only, never launches server.js or contacts live markets.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),
 os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const out=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-three-k-'));
fs.mkdirSync(out,{recursive:true});
const files=new Set(['/picks.html','/assets/picks-page.js','/assets/picks-periods.js',
 '/assets/picks-three-k.js','/assets/picks-three-k.css']);
const candidates={snapshotDay:'2026-11-06',items:[
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
   await page.route('**/api/kline?**',r=>{
    const url=new URL(r.request().url());
    const code=url.searchParams.get('code');
    const limit=Math.max(20,Math.min(240,Number(url.searchParams.get('n'))||60));
    const end=url.searchParams.get('end');
    const eligible=end?series.filter(bar=>bar.date.replace(/-/g,'')<end):series;
    const rows=eligible.slice(-limit);
    return r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,code,rows,asOf:rows.at(-1)?.date||null,n:rows.length})});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/picks.html');
   await page.waitForFunction(()=>document.querySelectorAll('.pick').length===2);
   assert.match(await page.locator('.pick').first().textContent(),/放量突破/);
   assert.match(await page.locator('.pick').first().textContent(),/红三兵/);
   assert.equal(await page.locator('button.pick-open').count(),2);
   await page.locator('.pick-open').first().click();
   await page.waitForFunction(()=>document.querySelector('#periodChart svg'));
   assert.match(await page.locator('#pickDetailCaption').textContent(),/测试股票甲/);
   for(const [name,period] of [['月K','month'],['年K','year'],['日K','day']]){
    await page.locator('[data-period="'+period+'"]').click();
    await page.waitForFunction(p=>document.getElementById('periodStatus')?.textContent?.includes(p),name);
    assert.equal(await page.locator('[data-period="'+period+'"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#periodChart svg').count(),1);
   }
   await page.waitForFunction(()=>document.getElementById('periodStatus')?.textContent?.includes('已取得 500 根真实日K'),null,{timeout:10000});
   const historyRequests=calls.filter(c=>c.url.includes('/api/kline'));
   assert.equal(historyRequests.length,3,'240-bar API pagination should load 240+240+20 on month/year tabs');
   assert.ok(historyRequests.every(c=>new URL(c.url).searchParams.get('n')==='240'));
   assert.equal(new URL(historyRequests[0].url).searchParams.has('end'),false);
   assert.ok(historyRequests.slice(1).every(c=>/^\d{8}$/.test(new URL(c.url).searchParams.get('end')||'')),'older queries must carry explicit exclusive date');
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
   revoked=true;
   await page.locator('#reload').click();
   await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('没有只读查看权限'));
   assert.equal(await page.locator('.pick').count(),0,'revocation must erase old picks');
   assert.equal(await page.locator('#pickDetailCode').textContent(),'尚未选择');
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
