#!/usr/bin/env node
// Legacy recovery regression; not current FAYO product acceptance.
// Real isolated server and synthetic accounts; never touches the user runtime.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');
const output=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-mobile-roles-')); fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=await createFixture({count:4,legacyFrontend:true});let browser;
 const report={scope:'Legacy recovery regression; not current product acceptance; real isolated V6 Node server; synthetic stocks/accounts; Chromium320; no physical device',checks:[]};
 try{
  const origin='http://127.0.0.1:'+server.port;
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  async function session(token){const ctx=await browser.newContext({viewport:{width:320,height:900},serviceWorkers:'block'});if(token)await ctx.addInitScript(t=>localStorage.setItem('qd_device',t),token);return ctx;}
  const anonymous=await session(),anon=await anonymous.newPage();await anon.goto(origin+'/m');await anon.locator('#gate').waitFor({state:'visible'});assert.equal(await anon.locator('#app').isVisible(),false);assert.equal(await anon.locator('#foot').isVisible(),false);await anon.screenshot({path:path.join(output,'mobile-login-320.png')});report.checks.push('anonymous login gate with dashboard/dock hidden');
  await anon.locator('#pwd').fill('wrong-mobile-test-password');await anon.getByRole('button',{name:'进入',exact:true}).click();await anon.waitForFunction(()=>document.getElementById('gateErr').textContent.length>0);assert.equal(await anon.locator('#app').isVisible(),false);
  await anon.locator('#pwd').fill(server.password);await anon.getByRole('button',{name:'进入',exact:true}).click();await anon.locator('#app').waitFor({state:'visible'});assert.equal(await anon.locator('#pwd').inputValue(),'');assert.equal(await anon.locator('#v6MobileResearchEntry').isVisible(),true);await anon.screenshot({path:path.join(output,'mobile-login-success-320.png')});report.checks.push('password failure stays gated; successful fresh login initializes developer role and clears password');
  const admin=await session(server.token),page=await admin.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/m');await page.locator('#app').waitFor({state:'visible'});
  assert.equal(await page.locator('#foot a').count(),7);const links=await page.locator('#foot a').evaluateAll(nodes=>nodes.map(n=>({text:n.getAttribute('aria-label')||n.innerText.trim(),href:n.getAttribute('href')})));assert.deepEqual(links.map(x=>x.text.replace(/\s+/g,'')),['首页','自选股','行情','AI研究','模拟交易','风控','推送']);report.links=links;
  assert.equal(await page.locator('#mobileCloudRefresh').count(),1);assert.equal(await page.locator('#sub').count(),1);assert.equal(await page.locator('.top').count(),0);assert.equal(await page.locator('.vx-topbar').count(),1);assert.equal(await page.locator('.vx-mobile-dock').count(),1);await page.screenshot({path:path.join(output,'mobile-edit-320.png')});
  await page.locator('.vx-mobile-directory summary').filter({hasText:'全部功能'}).click();assert.equal(await page.locator('.v6-mobile-reference-nav').isVisible(),true);report.checks.push('one header/dock; original refresh/status and all legacy feature links reachable');
  for(let i=0;i<7;i++){
   await page.goto(origin+'/m');await page.locator('#app').waitFor({state:'visible'});await page.locator('#foot a').nth(i).click();
   if(i===0||i===6){assert.ok(await page.locator(i===0?'#vx-dashboard':'#vx-pushes').isVisible());}
   else if(i===3){assert.ok((await page.locator('#researchWorkspace').count())===1);}
   else{const target=i===2?'v6-market':i===4?'v6-paper':'holdSec1';await page.locator('#'+target).waitFor({state:'visible',timeout:15000});}
   report.checks.push('edit seven-nav '+links[i].text.replace(/\s+/g,'')+' navigates to original target');
  }
  assert.equal(await page.locator('#vx-pushes').isVisible(),true);assert.deepEqual(errors,[]);
  await server.request('/api/lock/change','POST',{role:'view',newPassword:'mobile-review-view',token:server.token});const login=(await server.request('/api/lock/unlock','POST',{role:'view',password:'mobile-review-view',fp:'mobile-review-reader',name:'mobile-review-reader'},'')).body;assert.equal(login.pending,true);await server.request('/api/lock/pending-approve','POST',{req:login.req,allow:true});const approval=(await server.request('/api/lock/pending-status?req='+login.req,'GET',null,'')).body;const token=approval.token;assert.ok(token);
  const reader=await session(token),read=await reader.newPage();await read.goto(origin+'/m');await read.locator('#app').waitFor({state:'visible'});assert.equal(await read.locator('#v6MobileResearchEntry').isVisible(),false);assert.equal(await read.locator('#relCard').isVisible(),false);assert.equal(await read.locator('#foot a').count(),7);assert.notEqual((await server.request('/api/paper','GET',null,token)).body?.ok,true);await read.screenshot({path:path.join(output,'mobile-readonly-320.png')});report.checks.push('viewer same market navigation; editor research/release controls hidden; private paper API denied');
  const revoked=await server.request('/api/lock/revoke','POST',{id:crypto.createHash('sha256').update(token).digest('hex')});assert.equal(revoked.body.ok,true);await read.evaluate(()=>manualMobileRefresh());await read.locator('#gate').waitFor({state:'visible'});assert.equal(await read.locator('#app').isVisible(),false);assert.equal(await read.locator('#foot').isVisible(),false);assert.equal(await read.evaluate(()=>window.__v6Dashboard),null);assert.match(await read.locator('#gateErr').innerText(),/失效/);await read.screenshot({path:path.join(output,'mobile-revoked-320.png')});report.checks.push('real server HTTP200 revoked response gates app/dock and clears cached dashboard');
  await anonymous.close();await admin.close();await reader.close();report.ok=true;fs.writeFileSync(path.join(output,'review.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
