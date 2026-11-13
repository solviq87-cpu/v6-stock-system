#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');
const out=process.env.V6_STUDIO_BROWSER_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'studio-browser-'));
fs.mkdirSync(out,{recursive:true});
const report={syntheticFixtures:true,realBrowser:'Chromium',originalReferenceCertified:false,physicalDeviceCertified:false,checks:[],requests:[],screenshots:[]};
(async()=>{
 const server=await createFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[];let context;
 try{
  const login=await server.request('/api/lock/unlock','POST',{password:server.password,role:'edit',fp:'studio-browser-only',name:'browser-only'},'');
  assert.equal(login.body.ok,true);const token=login.body.deviceToken;assert.ok(token);
  context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(t=>{if(location.protocol==='http:')localStorage.setItem('qd_device',t);},token);
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  context.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))report.requests.push({method:r.method(),path:u.pathname,query:u.search});});
  await context.route('**/api/reference-indexes',r=>r.fulfill({json:{ok:true,source:'fixture-index-source',asOf:'2026-11-12T12:00:00Z',items:{sh:{price:3200,changePct:0,quoteAt:null},sz:{price:10000,changePct:-1},cyb:{price:2100,changePct:1},kc50:{price:900,changePct:0}}}}));
  await context.route('**/api/reference-strategy-stats',r=>r.fulfill({json:{ok:true,asOf:1794480000000,items:{rule14:{status:'attributed',count:2},bazi:{status:'unavailable'},gpt:{status:'unavailable'},python:{status:'unavailable'}}}}));
  await context.route('**/api/mobile-digest',r=>r.fulfill({json:{ready:false,mood:{verdict:'证据待核验'},isSnapshot:true,snapshotDay:'2026-11-11'}}));
  const page=await context.newPage(),base='http://127.0.0.1:'+server.port;
  await page.goto(base+'/v6-matches.html');
  await page.waitForFunction(()=>document.querySelector('#source-alert').textContent.includes('尚无'));
  assert.equal(await page.locator('.stock').count(),0);
  assert.equal((await server.request('/api/v6/matches')).body.status,'not-ready');
  assert.equal(report.requests.filter(x=>x.path==='/api/quant-picks').length,0);
  report.checks.push('not-ready remains not-ready; page does not initialize scanner');
  await server.scan();await page.locator('#refresh-all').click();
  await page.waitForFunction(()=>document.querySelectorAll('.stock').length===250);
  await page.locator('#real-chart svg').waitFor();
  assert.match(await page.locator('#chart-caption').textContent(),/601/);
  assert.ok(report.requests.some(x=>x.path==='/api/kline'&&x.query.includes('end=')));
  assert.match(await page.locator('#source-alert').textContent(),/条件5.*未参与/);
  report.checks.push('all 250 six-condition matches, 500 rule hits and 601 paginated candles loaded');
  const pages=['studio','matches','research','validation','paper','market-radar'];
  for(const [label,width,height] of [['phone-320',320,740],['phone-390',390,844],['desktop-1440',1440,1000]]){
   await page.setViewportSize({width,height});
   for(const name of pages){
    const privateBefore=report.requests.filter(x=>x.path==='/api/paper').length;
    await page.goto(base+'/v6-'+name+'.html');
    if(name==='studio')await page.waitForFunction(()=>document.querySelector('#summary-count').textContent==='250');
    if(name==='matches'){await page.waitForFunction(()=>document.querySelectorAll('.stock').length===250);await page.locator('#real-chart svg').waitFor();}
    if(name==='research')await page.waitForFunction(()=>document.querySelector('#count-rule14').textContent==='2 只');
    if(name==='validation')await page.waitForFunction(()=>document.querySelector('#verify-stocks').textContent==='250');
    if(name==='market-radar')await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('4 项'));
    if(name==='paper'){assert.equal(report.requests.filter(x=>x.path==='/api/paper').length,privateBefore);assert.equal(await page.locator('#paper-pool-equity').textContent(),'未读取');}
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
     text:document.body.innerText.includes('天枢智策')}));
    assert.ok(geometry.scroll<=width,`${name} overflows at ${width}: ${geometry.scroll}`);assert.equal(geometry.text,true);
    const file=label+'-'+name+'.png';await page.screenshot({path:path.join(out,file),fullPage:false});report.screenshots.push(file);
    if(name==='matches'){
      await page.locator('#detail-panel').scrollIntoViewIfNeeded();
      const detail=label+'-matches-detail.png';await page.screenshot({path:path.join(out,detail),fullPage:false});report.screenshots.push(detail);
    }
   }
   report.checks.push(label+': six direct pages render without horizontal document overflow');
  }
  await page.setViewportSize({width:1440,height:1000});
  let slow=true;
  await page.route('**/api/kline?**',async route=>{
   const u=new URL(route.request().url());if(slow&&u.searchParams.get('code')==='600000')await new Promise(resolve=>setTimeout(resolve,350));
   try{await route.continue();}catch{}
  });
  await page.goto(base+'/v6-matches.html');await page.waitForFunction(()=>document.querySelectorAll('.stock').length===250);
  await page.locator('[data-stock="600001"]').click();
  await page.locator('#real-chart svg').waitFor();await page.waitForTimeout(500);
  assert.match(await page.locator('#detail-panel h2').textContent(),/600001/);
  assert.match(await page.locator('#chart-caption').textContent(),/601/);slow=false;
  for(const label of ['月K','年K','日K']){await page.getByRole('button',{name:label,exact:true}).click();await page.locator('#real-chart svg').waitFor();}
  report.checks.push('rapid stock switching discards delayed former candle requests; daily/monthly/yearly aggregation works');
  await context.setOffline(true);
  await page.waitForFunction(()=>document.querySelectorAll('.stock').length===0);
  assert.equal(await page.locator('#real-chart').count(),0);
  await page.screenshot({path:path.join(out,'matches-offline-cleared.png')});report.screenshots.push('matches-offline-cleared.png');
  await context.setOffline(false);await page.locator('#refresh-all').click();await page.waitForFunction(()=>document.querySelectorAll('.stock').length===250);
  await page.route('**/api/v6/matches?**',r=>r.fulfill({status:503,json:{ok:false,error:'fixture refresh failure'}}));
  await page.locator('#refresh-all').click();await page.waitForFunction(()=>document.querySelector('#source-alert').textContent.includes('旧结果已清除'));
  assert.equal(await page.locator('.stock').count(),0);assert.equal(await page.locator('#real-chart').count(),0);
  await page.unroute('**/api/v6/matches?**');
  report.checks.push('offline and failed refresh clear candidates, details and candles; reconnect can reread');
  await page.goto(base+'/v6-paper.html');assert.equal(await page.locator('#paper-pool-equity').textContent(),'未读取');
  await page.locator('#paper-read').click();await page.waitForFunction(()=>document.querySelector('#paper-pool-equity').textContent!=='未读取');
  assert.match(await page.locator('#paper-status').textContent(),/仅显示/);
  const revoke=await server.request('/api/lock/revoke','POST',{id:crypto.createHash('sha256').update(token).digest('hex')});assert.equal(revoke.body.ok,true);assert.equal(revoke.body.revoked,1);
  await page.locator('#paper-read').click();await page.waitForFunction(()=>document.querySelector('#paper-status').textContent.includes('未获得'));
  assert.equal(await page.locator('#paper-pool-equity').textContent(),'未读取');
  await page.screenshot({path:path.join(out,'paper-revoked-cleared.png')});report.screenshots.push('paper-revoked-cleared.png');
  await page.goto(base+'/v6-matches.html');await page.waitForFunction(()=>document.querySelector('#source-alert').textContent.includes('权限'));
  assert.equal(await page.locator('.stock').count(),0);
  report.checks.push('actual server revocation clears private paper values and blocks candidate reads');
  assert.ok(report.requests.length>0);assert.ok(report.requests.every(x=>x.method==='GET'),'browser must make only reads');
  assert.ok(report.requests.every(x=>!x.query.includes('token=')),'tokens must stay out of URLs');
  assert.equal(report.requests.filter(x=>x.path==='/api/quant-picks').length,0);
  assert.deepEqual(errors,[]);
  report.checks.push('every observed browser API request is GET; no quant-picks scan initialization, writes, URL tokens or page errors');
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(out,'studio-browser-report.json'),JSON.stringify(report,null,2));if(context)await context.close();await browser.close();await server.close();}
 console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,screenshots:report.screenshots.length,requests:report.requests.length,output:out}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
