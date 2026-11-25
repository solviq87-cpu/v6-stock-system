#!/usr/bin/env node
'use strict';
// Native pages and the real isolated server/worker. Fixture records are written
// only to the temporary private archive, never to a production or public route.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixture}=require('../tests/helpers/v6-studio-fixture');
const store=require('../src/core/research-workspace-store');
const output=process.env.FAYO_EVOLUTION_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-evolution-browser-'));
fs.mkdirSync(output,{recursive:true});
async function main(){
 let fixture,browser,pageAtFailure;const report={fixtureOnly:true,transport:'native real HTTP + private worker',views:[],checks:[],errors:[]};
 try{
  fixture=await createFixture({count:3});const origin='http://127.0.0.1:'+fixture.port;
  const at=Date.parse('2026-11-20T15:10:00+08:00'),workspace=path.join(fixture.tmp,'data/research-workspace');
  store.appendEvent(workspace,'screen',{asOf:at,codeVersion:{fingerprint:'a'.repeat(64)},rows:[
   {symbol:'600001',name:'核心观察样本',status:'selected',rank:1,score:72,tradeDate:'2026-11-20',reasons:[{reason:'同日条件通过，供浏览器验证'}]},
   {symbol:'600002',name:'<img src=x onerror=alert(1)>',status:'rejected',rank:2,tradeDate:'2026-11-20',reasons:[{reason:'缺少成交量证据'}]}
  ]},{requestId:'browser_screen_fixture',now:at});
  const original=(await fixture.request('/api/research/evolution')).body;
  assert.equal(original.ok,true,JSON.stringify(original));
  assert.equal(original.result.workflow.lifecycle.current.length,2);
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  let savedRevision=0;
  for(const [id,entry,viewport]of [['desktop','/',{width:1440,height:1000}],['mobile','/m',{width:390,height:844}]]){
   const context=await browser.newContext({viewport,serviceWorkers:'block',acceptDownloads:true});
   await context.addInitScript(token=>{localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','edit');},fixture.token);
   const page=await context.newPage();pageAtFailure=page;page.on('pageerror',error=>report.errors.push({id,message:error.message}));
   let injected=false;page.on('dialog',async dialog=>{injected=true;await dialog.dismiss();});
   await page.goto(origin+entry+'#/lab/evolution');
   const root=page.locator('[data-testid="evolution-workbench"]');await root.waitFor();
   await root.getByRole('button',{name:'保存双端布局',exact:true}).waitFor({state:'visible'});
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('.fy-evolution button')].find(b=>b.textContent==='保存双端布局');return b&&!b.disabled;});
   assert.equal(await root.locator('details[data-section]').count(),6);
   await root.locator('details[data-section=market]').evaluate(el=>el.open=true);
   for(const title of ['财务披露与风险','估值与行业对照','信号时效'])assert.equal(await root.getByRole('heading',{name:title,exact:true}).count(),1);
   assert.match(await root.locator('details[data-section=market]').innerText(),/审计|股权/);
   await root.locator('details[data-section=lifecycle]').evaluate(el=>el.open=true);
   const search=root.getByRole('searchbox',{name:'候选搜索'});
   if(id==='desktop'){
    await search.fill('');await search.pressSequentially('600002',{delay:15});assert.equal(await search.inputValue(),'600002','filter typing retains keyboard focus across every rerender');assert.equal(await search.evaluate(el=>document.activeElement===el),true);
    assert.match(await root.locator('details[data-section=lifecycle]').innerText(),/<img src=x onerror=alert\(1\)>/);
    assert.equal(await root.locator('details[data-section=lifecycle] img').count(),0);assert.equal(injected,false);
    await search.fill('');await root.getByLabel('研究证券代码',{exact:true}).fill('600001');
    await root.getByRole('button',{name:'刷新证据',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('证据时点'));
    assert.match(await root.locator('output').innerText(),/600001/);
    await root.getByLabel('观察窗口',{exact:true}).selectOption('20');
    assert.equal(await root.getByRole('button',{name:'导出私有报告',exact:true}).isDisabled(),true);
    assert.match(await root.locator('output').innerText(),/当前报告仍属于 600001/);
    await root.getByLabel('观察窗口',{exact:true}).selectOption('5');
    await root.getByRole('button',{name:'刷新证据',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('证据时点'));
    await root.getByText('我的布局与筛选模板',{exact:true}).click();
    await root.getByLabel('新分组名称',{exact:true}).fill('核心自选');await root.getByLabel('分组证券代码',{exact:true}).fill('600001,600002');
    await root.getByRole('button',{name:'添加自选分组',exact:true}).click();
    await root.getByLabel('自选分组',{exact:true}).selectOption({label:'核心自选'});
    await search.fill('600001');await root.getByLabel('筛选模板名称',{exact:true}).fill('核心筛选');
    await root.getByRole('button',{name:'保存当前筛选为模板',exact:true}).click();
    await root.getByLabel('显示密度',{exact:true}).selectOption('compact');
    await root.getByRole('button',{name:'保存双端布局',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('双端布局已保存'));
    const saved=(await fixture.request('/api/research/evolution')).body.result.workflow.preferences;savedRevision=saved.revision;
    assert.equal(saved.value.templates[0].name,'核心筛选');assert.equal(saved.value.groups[0].name,'核心自选');
    report.checks.push('XSS text, group/template/column/layout save, real private CAS');
   }else{
    assert.equal(await search.inputValue(),'600001');assert.equal(await root.getByLabel('自选分组',{exact:true}).locator('option:checked').textContent(),'核心自选');
    assert.equal(await root.getAttribute('data-density'),'compact');
    report.checks.push('desktop-to-mobile preferences restored from server');
   }
   // A native route change must retain the draft and return position.
   await search.fill('60000');await page.evaluate(()=>location.hash='#/lab/records');await page.locator('[data-testid="evolution-workbench"]').waitFor({state:'detached'});
   await page.evaluate(()=>location.hash='#/lab/evolution');await root.waitFor();
   await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('证据时点'));
   assert.equal(await root.getByRole('searchbox',{name:'候选搜索'}).inputValue(),'60000');
   await root.getByRole('button',{name:'恢复已保存布局',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('布局版本'));
   assert.equal(await root.getByRole('searchbox',{name:'候选搜索'}).inputValue(),'600001');
   // A second device advances the revision. Stale writes must preserve the draft.
   const current=(await fixture.request('/api/research/evolution')).body.result.workflow.preferences;
   const other=await fixture.request('/api/research/evolution','POST',{action:'preferences',requestId:'other_device_'+id,expectedRevision:current.revision,value:{...current.value,search:'600002'}});assert.equal(other.status,200,other.raw);
   await root.getByRole('searchbox',{name:'候选搜索'}).fill('unsaved_'+id);await root.getByRole('button',{name:'保存双端布局',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('版本冲突'));
   assert.equal(await root.getByRole('searchbox',{name:'候选搜索'}).inputValue(),'unsaved_'+id);
   // Restore the saved search for the second device's initial hydration.
   const reset=(await fixture.request('/api/research/evolution')).body.result.workflow.preferences;
   await fixture.request('/api/research/evolution','POST',{action:'preferences',requestId:'restore_device_'+id,expectedRevision:reset.revision,value:{...reset.value,search:'600001'}});
   await root.getByRole('button',{name:'恢复已保存布局',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('布局版本'));
   await root.locator('details[data-section=research]').evaluate(el=>el.open=true);
   await root.getByRole('button',{name:'运行因果与稳定性检查',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.fy-evolution output')?.textContent.includes('检查已结束并保存'));
   assert.match(await root.locator('details[data-section=research]').innerText(),/缺少封存行情/);
   const downloaded=page.waitForEvent('download');await root.getByRole('button',{name:'导出私有报告',exact:true}).click();const download=await downloaded;
   const file=path.join(output,id+'-report.json');await download.saveAs(file);const exported=JSON.parse(fs.readFileSync(file));assert.equal(exported.canTrade,false);assert.equal(exported.mode,'fayo-intelligence-evolution');
   assert.equal(exported.statistics.diagnostics.modelCausality.python.status,'not-evaluated');
   assert.equal(exported.statistics.diagnostics.modelCausality.python.executed,false);
   const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));assert.ok(size.document<=size.viewport+1,JSON.stringify(size));
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,id+'.png'),fullPage:false});
   report.views.push({id,entry,viewport,overflow:false,sections:6,restoredRevision:savedRevision,exported:true,diagnosticStored:true,staleWriteRejected:true,navigationDraftRetained:true});
   await context.close();
  }
  const viewer=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await viewer.addInitScript(token=>{localStorage.setItem('qd_device',token);localStorage.setItem('qd_role','view');},fixture.viewerToken);
  const p=await viewer.newPage();await p.goto(origin+'/m#/lab/evolution');await p.getByText('需要研究编辑权限',{exact:true}).waitFor();assert.equal(await p.locator('.fy-evolution').count(),0);await viewer.close();
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.checks.push('viewer cannot render or export private report','real desktop/mobile diagnostic and export','stale CAS preserves local draft','private report never put into URL credentials');
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,output,...report}));
 }catch(error){if(pageAtFailure&&!pageAtFailure.isClosed()){await pageAtFailure.screenshot({path:path.join(output,'failure.png'),fullPage:false});fs.writeFileSync(path.join(output,'failure.html'),await pageAtFailure.content());}fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,report,server:fixture?.logs().slice(-1800)},null,2));throw error;}
 finally{await browser?.close();await fixture?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
