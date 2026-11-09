#!/usr/bin/env node
'use strict';
// Isolated Chrome QA: does not start V6 server, place orders, or send Feishu.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),
 assert=require('node:assert/strict'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public'),out=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-picks-'));
fs.mkdirSync(out,{recursive:true});
const fixture={count:3,snapshotDay:'2026-11-06',items:[
 {code:'600519',name:'测试甲',sector:'专用设备',price:20.45,pct:1.6,score:86,hit:[{text:'条件一：日K趋势确认'},{text:'条件二：有效量能'}],quoteAt:Date.parse('2026-11-06T07:00:00Z'),strategy:'研究样本'},
 {code:'000001',name:'测试乙',price:10.12,pct:-1.2,score:75,hit:[],risk:{blocked:true}},
 {code:'300750',name:'<img src=x onerror=alert(1)>',price:30.2,pct:2,score:60,hit:[{text:'<svg onload=alert(2)>'}]}
]};
const bars=Array.from({length:35},(_,i)=>({date:'2026-10-'+String(i%28+1).padStart(2,'0'),open:10+i*.1,close:10.07+i*.1,high:10.25+i*.1,low:9.8+i*.1}));
const paths=new Set(['/picks.html','/assets/picks-page.js','/assets/picks-detail.js','/assets/picks-enhance.css','/assets/picks-rule-catalog.js']);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(!paths.has(pathname)){res.statusCode=404;res.end('not found');return;}
 try{
  const file=path.join(root,pathname.slice(1));const bytes=fs.readFileSync(file);
  res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'application/javascript':'text/html');
  res.end(bytes);
 }catch(err){res.statusCode=500;res.end('test fixture missing');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 const cases=[];
 try{
  for(const [label,width,height] of [['picks-320',320,700],['picks-375',375,812],['picks-390',390,844],['picks-430',430,932],['picks-1024',1024,768],['picks-1536',1536,864]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
   const errors=[],methods=[];let unauthorized=false;
   page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.url().includes('/api/'))methods.push(r.method());});
   await page.route('**/api/quant-picks?**',route=>route.fulfill({status:unauthorized?401:200,contentType:'application/json',body:JSON.stringify(unauthorized?{locked:true}:fixture)}));
   await page.route('**/api/kline?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,asOf:'2026-11-06',rows:bars})}));
   await page.goto('http://127.0.0.1:'+server.address().port+'/picks.html');
   await page.waitForFunction(()=>document.querySelectorAll('.pick').length===3);
   assert.equal(await page.locator('.pick').count(),3);
   assert.equal(await page.locator('.picks-rule').count(),9,'research catalog renders all audited rules');
   assert.equal(await page.locator('.pick img').count(),0,'untrusted stock names are text, never markup');
   assert.equal(await page.locator('button.pick-open').count(),3,'each valid candidate can open detail');
   await page.locator('button.pick-open').first().click();
   await page.waitForFunction(()=>document.getElementById('pickKline')?.querySelector('svg'));
   assert.match(await page.locator('#pickDetailName').textContent(),/测试甲/);
   assert.match(await page.locator('#pickDetailReasons').textContent(),/量能/);
   await page.locator('button.pick-open').nth(1).click();
   await page.waitForFunction(()=>document.getElementById('pickDetailInfo')?.textContent?.includes('000001'));
   assert.match(await page.locator('#pickDetailRisk').textContent(),/风险/);
   const box=await page.evaluate(()=>({
    width:innerWidth,scrollWidth:document.body.scrollWidth,
    content:document.getElementById('candidates').getBoundingClientRect().toJSON(),
    detail:document.getElementById('pickDetailPanel').getBoundingClientRect().toJSON(),
    dock:document.querySelector('.bottom').getBoundingClientRect().toJSON()
   }));
   assert.ok(box.scrollWidth<=width+1,label+' body overflow '+JSON.stringify(box));
   if(width<=550)assert.ok(box.dock.height>35&&box.dock.width>=width-1,label+' seven-nav dock missing');
   assert.ok(box.detail.width>=width*(width<=850?.75:.6),label+' details too narrow');
   await page.locator('#search').fill('600519');
   assert.equal(await page.locator('.pick').count(),1,'search filters current cloud results');
   await page.locator('#search').fill('');
   unauthorized=true;await page.locator('#reload').click();
   await page.waitForFunction(()=>document.getElementById('status')?.textContent?.includes('没有只读查看权限'));
   assert.equal(await page.locator('.pick').count(),0,'403 must clear prior stock list');
   assert.equal(await page.locator('#total').textContent(),'—','auth must clear old counts');
   assert.equal(await page.locator('#pickDetailState').textContent(),'权限已失效','auth must clear linked detail');
   assert.ok(methods.every(x=>x==='GET'),label+' must not post to scanner, account or Feishu');
   assert.deepEqual(errors,[],label+' script errors');
   if(process.env.V6_UI_SCREENSHOTS==='1'){
    unauthorized=false;await page.locator('#reload').click();
    await page.waitForFunction(()=>document.querySelectorAll('.pick').length===3);
    await page.locator('button.pick-open').first().click();
    await page.waitForFunction(()=>document.querySelector('#pickKline svg'));
    await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});
   }
   cases.push({label,viewport:width,bodyWidth:box.scrollWidth,methods,scriptErrors:errors});
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 fs.writeFileSync(path.join(out,'picks-browser-report.json'),JSON.stringify(cases,null,2));
 console.log('V6 PICKS UI PASS '+cases.length+' viewports');
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
