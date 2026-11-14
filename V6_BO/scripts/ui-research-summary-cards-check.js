#!/usr/bin/env node
'use strict';
// Actual research page and core projections, with explicitly synthetic private
// archives/accounts. The browser cannot reach a real account or market source.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-summary-cards-')),publicRoot=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||path.join(dir,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
function seed(root){
 const first=D.buildWorkspaceDecision(fixture()),later=D.buildWorkspaceDecision(fixture({index:71}));first.name=later.name='合成卡片股票<img src=x onerror=window.SUMMARY_BAD=1>';first.conditions[0].status='pass';later.conditions[0].status='fail';
 S.appendEvent(root,'analysis',first,{requestId:'summary_first_001',now:at(70)});
 for(let i=0;i<25;i++){const d=structuredClone(later);d.asOf+=i;S.appendEvent(root,'analysis',d,{requestId:'summary_later_'+String(i).padStart(3,'0'),now:at(71)+i});}
 const items=Array.from({length:43},(_,i)=>({symbol:String(600000+i),name:'合成筛选'+i,quality:{usable:i<2,errors:i<2?[]:['合成缺数']},score:0,blockedBySafety:false,strategy:{pass:true},tradable:true}));
 S.appendEvent(root,'screen',D.screeningRecord({items},{provenance:'synthetic-cards-only',asOf:at(71)+25}),{requestId:'summary_screen_001',now:at(71)+25});
 S.appendEvent(root,'preferences',S.preferenceInput({unresolved:['合成待补一','合成待补二']}),{requestId:'summary_preferences_001',now:at(71)+26});
 S.appendEvent(root,'diagnostic',{symbol:'600000',asOf:at(71)+27,status:'failed',stages:[{stage:'读取封存行情',status:'completed',durationMs:0},{stage:'分析原有策略与证据',status:'failed',durationMs:3}],retry:'合成分析失败后重读'},{requestId:'summary_diagnostic_001',now:at(71)+27});
 return {fourteen:{positions:{'600000':{name:'合成持仓甲',shares:100,buyPrice:10,buyTs:at(70)+1000}}},python:{positions:{'600002':{name:'合成持仓乙',shares:100,buyPrice:10,buyTs:at(70)+1000}}}};
}
function quotes(now){const q=(price,quoteAt)=>({price,quoteAt,receivedAt:now,quoteSource:'public-price-provider',canTrade:true,tradable:true,suspended:false});return new Map([['600000',{wireQuote:q(11,now-100)}],['600002',{wireQuote:q(12,now-15001)}]]);}
const card=(page,id)=>page.locator('#workspaceSummary [data-summary-card='+id+']');
const text=(page,id)=>card(page,id).innerText();
async function cleared(page){assert.equal(await page.locator('#workspaceSummary').isHidden(),true);const context=page.locator('#workspaceSummaryContext');if(await context.count())assert.equal(await context.textContent(),'');assert.equal(await page.locator('#workspaceSummary [data-summary-card]').count(),0);}
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const root=path.join(dir,'workspace-'+width),empty=path.join(dir,'empty-'+width),accounts=seed(root),page=await browser.newPage({viewport:{width,height:1000}}),requests=[],errors=[],external=[];
   let mode='empty',hold=false,release,notifyHeld,expected;page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
    requests.push({method:req.method(),url:req.url()});if(req.headers().authorization!=='Bearer summary-fixture-editor')return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
    if(req.method()!=='GET')throw Error('Summary cards issued a write');
    if(hold){await new Promise(r=>{release=r;notifyHeld();});hold=false;}
    if(mode==='failure')return route.fulfill({status:503,json:{ok:false,error:'合成读取失败'}});
    const q=Object.fromEntries(url.searchParams);for(const k of ['asOf','offset','limit','minScore'])if(k in q)q[k]=Number(q[k]);const now=Date.now();expected=W.workspaceView(mode==='empty'?empty:root,q,{now,accounts:mode==='empty'?{}:accounts,quotes:quotes(now)});
    // Explicit response-shape fault: a recent failed task has no stages while
    // the selected older version has completed stages. Never merge the two.
    if(mode==='no-task-stages'){expected.selectedRun.diagnostics=[{stage:'旧版本已完成阶段',status:'completed'}];expected.diagnostics=[{symbol:'600000',asOf:now,status:'failed',stages:[]}];}
    if(mode==='preference-only-attention'){expected.defense.rows=expected.defense.rows.map((p,i)=>({...p,status:'observed-unverified',concentrationWarning:false,missing:[],invalidated:[],avoidedBoards:i?[]:['合成回避板块'],excludedByResearchPreference:i===0}));}
    return route.fulfill({json:{ok:true,result:expected}}).catch(()=>{});
   });
   const read=async()=>{await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));};
   await page.goto(origin+'/research.html');assert.equal(requests.length,0);await cleared(page);
   await page.locator('#token').fill('summary-fixture-editor');await read();assert.equal(await page.locator('#workspaceSummary [data-summary-card]').count(),4);
   assert.match(await card(page,'evidence').locator('.workspace-summary-value').innerText(),/未|待|未知|尚无/);assert.match(await card(page,'screening').locator('.workspace-summary-value').innerText(),/未|待|未知|尚无/);assert.ok((await text(page,'diagnostics')).includes('未记录'));assert.ok((await text(page,'diagnostics')).includes('未完成事项 0 项'));assert.equal(await card(page,'defense').locator('.workspace-summary-value').innerText(),'0 项待复核');assert.equal(fs.existsSync(empty),false);
   mode='populated';await read();const summary=page.locator('#workspaceSummary');assert.ok((await page.locator('#workspaceSummaryContext').innerText()).includes('600000'));
   const known=expected.selectedRun.conditions.filter(c=>c.status==='pass'||c.status==='fail').length,missing=expected.selectedRun.conditions.filter(c=>c.status==='unknown').length;
   assert.equal(await card(page,'evidence').locator('.workspace-summary-value').innerText(),known+' / '+expected.selectedRun.conditions.length+' 项已知');assert.ok((await text(page,'evidence')).includes('缺失 '+missing+' 项条件'));assert.equal(await summary.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.SUMMARY_BAD),undefined);
   assert.equal(await card(page,'screening').locator('.workspace-summary-value').innerText(),'43 只原始输入');assert.ok((await text(page,'screening')).includes('整批末步保留 2 只'));assert.equal(await card(page,'defense').locator('.workspace-summary-value').innerText(),'2 项待复核');assert.ok((await text(page,'defense')).includes('账户'));
   assert.ok((await text(page,'diagnostics')).includes('分析原有策略与证据'));assert.match(await text(page,'diagnostics'),/未完成|失败/);assert.ok((await text(page,'diagnostics')).includes('2'));
   for(const id of ['evidence','screening','defense','diagnostics']){const before=requests.length;await page.locator('button[data-summary-tab='+id+']').click();assert.equal(requests.length,before);assert.equal(await page.locator('#workspaceTabs button[data-tab='+id+']').getAttribute('aria-selected'),'true');assert.equal(await page.evaluate(()=>document.activeElement.id),'workspaceContent');}
   await page.locator('button[data-summary-tab=screening]').click();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('600020'));
   assert.equal(expected.screening.rows.length,20);assert.equal(expected.screening.total,43);assert.ok((await text(page,'screening')).includes('当前筛选匹配 43 只'));
   await page.getByRole('button',{name:'下一页',exact:true}).click();await page.waitForFunction(()=>document.getElementById('workspaceContent').textContent.includes('600040'));assert.equal(expected.screening.rows.length,3);assert.ok((await text(page,'screening')).includes('当前筛选匹配 43 只 · 本页 3 只'));
   // Render an actual old-version projection on the last page. The card must
   // reset pagination without silently replacing that selected version.
   const oldId=S.readEvents(root).find(e=>e.kind==='analysis').hash,now=Date.now(),oldView=W.workspaceView(root,{offset:40,runId:oldId},{now,accounts,quotes:quotes(now)});await page.evaluate(v=>window.V6ResearchWorkspace.render(v),oldView);
   const beforePaged=requests.length,pagedResponse=page.waitForResponse(r=>r.url().includes('/api/research/workspace'));await page.locator('button[data-summary-tab=evidence]').click();await pagedResponse;await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   assert.equal(requests.length,beforePaged+1);const query=new URL(requests.at(-1).url).searchParams;assert.equal(query.get('offset'),'0');assert.equal(query.get('runId'),oldId);assert.equal(expected.selectedRun.id,oldId);assert.equal(await page.locator('#workspaceContent .workspace-row').count(),20);assert.equal(await page.evaluate(()=>document.activeElement.id),'workspaceContent');
   const beforeLocal=requests.length;await page.locator('button[data-summary-tab=defense]').click();assert.equal(requests.length,beforeLocal);assert.ok((await text(page,'defense')).includes('2'));
   await page.locator('#workspaceSymbol').fill('600000');await cleared(page);await read();assert.equal(expected.screening.total,1);assert.equal(expected.screening.inputTotal,43);assert.equal(expected.defense.rows.length,2);assert.ok((await text(page,'screening')).includes('当前筛选匹配 1 只'));assert.ok((await text(page,'defense')).includes('2'));
   mode='no-task-stages';await read();assert.match(await text(page,'diagnostics'),/未完成|失败/);assert.ok(!(await text(page,'diagnostics')).includes('旧版本已完成阶段'));
   mode='preference-only-attention';await read();assert.equal(await card(page,'defense').locator('.workspace-summary-value').innerText(),'1 项待复核');await page.locator('button[data-summary-tab=defense]').click();await page.locator('#workspaceContent summary').filter({hasText:'合成持仓甲'}).click();assert.ok((await page.locator('#workspaceContent').innerText()).includes('命中回避板块'));assert.ok((await page.locator('#workspaceContent').innerText()).includes('合成回避板块'));assert.ok((await page.locator('#workspaceContent').innerText()).includes('研究排除名单'));mode='populated';
   await page.locator('#workspaceAsOf').fill(new Date(at(70)+28800000).toISOString().slice(0,16));await read();assert.ok((await page.locator('#workspaceSummaryContext').innerText()).includes('历史'));assert.ok((await text(page,'defense')).includes('历史'));assert.match(await card(page,'defense').locator('.workspace-summary-value').innerText(),/未|不|未知/);
   await page.locator('#workspaceAsOf').fill('');await read();mode='failure';await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('未完成'));await cleared(page);
   mode='populated';await read();hold=true;const held=new Promise(r=>notifyHeld=r);await page.locator('#workspaceRead').click();await held;await cleared(page);await page.locator('#token').fill('revoked-summary-token');release();await page.waitForTimeout(60);await cleared(page);
   await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('未完成'));await cleared(page);
   await page.locator('#token').fill('summary-fixture-editor');await read();const count=requests.length;await page.evaluate(()=>dispatchEvent(new Event('offline')));await cleared(page);assert.equal(requests.length,count);await read();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await summary.screenshot({path:path.join(output,'research-summary-cards-'+width+'.png')});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(requests.every(r=>r.method==='GET'));await page.close();console.log('research summary cards UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
