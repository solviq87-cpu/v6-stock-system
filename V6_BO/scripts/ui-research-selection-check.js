#!/usr/bin/env node
'use strict';
// Actual page and core projections. All records, accounts and transport are
// explicitly synthetic; no real market, user archive or model endpoint runs.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-selection-browser-')),publicRoot=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||temporary;fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
function seed(root){
 const oldData=D.buildWorkspaceDecision(fixture());oldData.name='合成旧版研究';const old=S.appendEvent(root,'analysis',oldData,{requestId:'selection_old_001',now:at(70)});
 const twinData=structuredClone(oldData);twinData.name='合成同输入对照';twinData.conditions[0].status=twinData.conditions[0].status==='pass'?'fail':'pass';const twin=S.appendEvent(root,'analysis',twinData,{requestId:'selection_twin_001',now:at(70)+1});
 for(let i=0;i<25;i++){const d=D.buildWorkspaceDecision(fixture({index:71}));d.name='合成更新研究';d.asOf+=i;S.appendEvent(root,'analysis',d,{requestId:'selection_new_'+String(i).padStart(3,'0'),now:at(71)+i});}
 const source=D.buildWorkspaceDecision(fixture({index:72,provider:'eastmoney'}));source.name='合成其他来源';const latest=S.appendEvent(root,'analysis',source,{requestId:'selection_source_001',now:at(72)});
 const otherData=D.buildWorkspaceDecision(fixture({index:72,symbol:'600001'}));otherData.name='合成其他股票';const other=S.appendEvent(root,'analysis',otherData,{requestId:'selection_other_001',now:at(72)+1});
 const items=Array.from({length:43},(_,i)=>({symbol:String(600000+i),name:'合成筛选'+i,quality:{usable:i<2,errors:i<2?[]:['合成缺数']},score:0,blockedBySafety:false,strategy:{pass:true},tradable:true}));const screen=S.appendEvent(root,'screen',D.screeningRecord({items},{provenance:'synthetic-selection-only',asOf:at(72)+2}),{requestId:'selection_screen_001',now:at(72)+2});
 return {old,twin,latest,other,source,screen};
}
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const root=path.join(temporary,'workspace-'+width),data=seed(root),page=await browser.newPage({viewport:{width,height:1000}}),requests=[],writes=[],errors=[],external=[];let lastRendered;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'synthetic permission denial'}});
    requests.push({method:req.method(),query:Object.fromEntries(url.searchParams)});
    if(req.headers().authorization!=='Bearer selection-fixture-editor')return route.fulfill({status:403,json:{ok:false,error:'synthetic permission denial'}});
    try{if(req.method()==='POST'){const input=req.postDataJSON();writes.push(input.action);assert.equal(input.action,'preferences','selection navigation must not write');const e=W.saveSettings(root,input);return route.fulfill({json:{ok:true,revision:e.revision}});}
     const q=Object.fromEntries(url.searchParams);for(const k of ['asOf','offset','limit','minScore'])if(k in q)q[k]=Number(q[k]);const v=W.workspaceView(root,q);
     if(url.searchParams.get('export')==='1'){return route.fulfill({json:{ok:true,result:W.exportResearch(v)}});}lastRendered=v;return route.fulfill({json:{ok:true,result:v}});
    }catch(e){return route.fulfill({status:422,json:{ok:false,error:'synthetic selection failure: '+e.message}});}
   });
   const host=page.locator('#workspaceContent'),tab=name=>page.getByRole('tab',{name,exact:true});
   async function loaded(){await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));}
   async function read(){await page.locator('#workspaceRead').click();await loaded();}
   async function pageTo(offset){while(lastRendered.runs.offset!==offset){const direction=lastRendered.runs.offset<offset?'下一页':'上一页';await host.getByRole('button',{name:direction,exact:true}).click();await loaded();}}
   function pinned(){assert.equal(lastRendered.selectedRun.id,data.old.hash);assert.equal(requests.at(-1).query.runId,data.old.hash);}
   async function selectOld(){if(await tab('结论与证据').getAttribute('aria-selected')!=='true'){const paged=lastRendered.runs.offset!==0;await tab('结论与证据').click();if(paged)await loaded();}if(lastRendered.runs.offset!==20)await pageTo(20);await host.locator('button[data-workspace-run="'+data.old.hash+'"]').click();await loaded();pinned();const current=host.locator('button[data-workspace-run="'+data.old.hash+'"]');if(await current.count())assert.equal(await current.getAttribute('aria-pressed'),'true');}
   await page.goto(origin+'/research.html');assert.equal(requests.length,0);await page.locator('#token').fill('selection-fixture-editor');await page.locator('#workspaceSymbol').fill('600000');await read();assert.equal(lastRendered.selectedRun.id,data.latest.hash);
   await selectOld();if(lastRendered.runs.offset!==20)await pageTo(20);await page.locator('#workspaceCompareRun').selectOption(data.twin.hash);await loaded();pinned();assert.equal(lastRendered.pairedComparison.status,'matched-frozen-input');
   await read();pinned();assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);assert.equal(requests.at(-1).query.compareId,data.twin.hash);
   await pageTo(20);pinned();assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);await pageTo(0);pinned();assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);
   await pageTo(20);await tab('四体系分歧').click();await loaded();pinned();assert.equal(lastRendered.runs.offset,0);assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);
   await tab('结论与证据').click();await pageTo(20);await page.locator('button[data-summary-tab=evidence]').click();await loaded();pinned();assert.equal(lastRendered.runs.offset,0);
   await pageTo(20);pinned();const snapshot=structuredClone(lastRendered);await page.waitForTimeout(20);const freshData=structuredClone(data.source);freshData.name='合成读取后新增研究';const fresh=S.appendEvent(root,'analysis',freshData,{requestId:'selection_after_view_001',now:Date.now()});
   const downloadEvent=page.waitForEvent('download');await page.locator('#workspaceExport').click();const download=await downloadEvent,file=path.join(output,'research-selection-export-'+width+'.json');await download.saveAs(file);const exported=JSON.parse(fs.readFileSync(file));
   assert.equal(exported.run.id,data.old.hash);assert.equal(exported.asOf,snapshot.asOf);assert.deepEqual(exported.pairedComparison,snapshot.pairedComparison);assert.deepEqual(exported.scorecard.groups,snapshot.scorecard.groups);assert.equal(requests.at(-1).query.runId,data.old.hash);assert.equal(requests.at(-1).query.asOf,String(snapshot.asOf));assert.equal(requests.at(-1).query.screenId,snapshot.screening.runId);assert.equal(requests.at(-1).query.compareId,data.twin.hash);assert.equal(lastRendered.selectedRun.id,data.old.hash);
   await page.locator('#workspaceLatest').click();await loaded();assert.equal(lastRendered.selectedRun.id,fresh.hash);assert.equal(requests.at(-1).query.runId,undefined);await read();assert.equal(lastRendered.selectedRun.id,fresh.hash);assert.equal(requests.at(-1).query.runId,fresh.hash);
   await selectOld();if(lastRendered.runs.offset!==20)await pageTo(20);await page.locator('#workspaceCompareRun').selectOption(data.twin.hash);await loaded();pinned();
   const preference=page.locator('#researchWorkspace > details').filter({has:page.locator('#workspaceObjective')});if(!await page.locator('#workspaceObjective').isVisible())await preference.locator('summary').click();await page.locator('#workspaceObjective').fill('合成连续性约束');await page.locator('#workspaceSavePreferences').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取')&&document.getElementById('workspaceObjective').value==='合成连续性约束');pinned();assert.equal(lastRendered.preferences.value.objective,'合成连续性约束');assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);
   await page.locator('#workspaceScreenRun').selectOption(data.screen.hash);await loaded();pinned();assert.equal(requests.at(-1).query.screenId,data.screen.hash);
   await page.locator('#workspaceMinScore').fill('1');await read();pinned();assert.equal(lastRendered.screening.total,0);assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);await page.locator('#workspaceMinScore').fill('0');await read();pinned();
   if(!await page.locator('#workspaceFilterStatus').isVisible())await page.locator('#researchWorkspace > details').filter({has:page.locator('#workspaceFilterStatus')}).locator('summary').click();await page.locator('#workspaceFilterStatus').selectOption('rejected');await read();pinned();assert.equal(await page.locator('#workspaceCompareRun').inputValue(),data.twin.hash);
   await page.locator('#workspaceAsOf').fill(new Date(at(71)+28800000).toISOString().slice(0,16));await read();assert.equal(requests.at(-1).query.runId,undefined);assert.equal(requests.at(-1).query.compareId,undefined);assert.equal(requests.at(-1).query.screenId,undefined);assert.equal(await page.locator('#workspaceCompareRun').inputValue(),'');
   await page.locator('#workspaceAsOf').fill('');await read();await selectOld();await page.locator('#workspaceProvider').selectOption('eastmoney');await read();assert.equal(requests.at(-1).query.runId,undefined);assert.equal(lastRendered.selectedRun.id,fresh.hash);
   await selectOld();await page.locator('#workspaceSymbol').fill('600001');await read();assert.equal(requests.at(-1).query.runId,undefined);assert.equal(requests.at(-1).query.compareId,undefined);assert.equal(lastRendered.selectedRun.id,data.other.hash);assert.equal(lastRendered.selectedRun.symbol,'600001');
   await page.locator('#workspaceSymbol').fill('600000');await read();await selectOld();await page.locator('#token').fill('revoked-selection-token');assert.equal(await page.locator('#workspaceSummary').isHidden(),true);await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('权限已失效'));assert.equal(requests.at(-1).query.runId,undefined);await page.locator('#token').fill('selection-fixture-editor');await read();assert.equal(requests.at(-1).query.runId,undefined);assert.equal(lastRendered.selectedRun.id,fresh.hash);
   await page.locator('#workspaceFilterStatus').selectOption('all');await read();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#researchWorkspace').screenshot({path:path.join(output,'research-selection-'+width+'.png')});assert.deepEqual(writes,['preferences']);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();console.log('research selection continuity UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
