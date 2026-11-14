#!/usr/bin/env node
'use strict';
// Actual research DOM and API projection, using only explicitly synthetic archives.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),W=require('../src/core/research-workspace'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision');
const {fixture,at}=require('../tests/helpers/research-workspace-fixtures'),{evidence}=require('../tests/helpers/market-linkage-evidence-fixtures');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'v6-market-linkage-ui-')),publicRoot=path.resolve(__dirname,'../public');
const output=process.env.V6_UI_QA_DIR||path.join(temporary,'screenshots');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p!=='/research.html'&&!/^\/assets\/[\w.-]+$/.test(p)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(publicRoot,p.slice(1))));}catch{res.writeHead(404);res.end();}
});
function append(root,index){return S.appendEvent(root,'analysis',D.buildWorkspaceDecision(fixture({index}),{marketLinkageEvidence:evidence({index,activation:true})}),{requestId:'linkage_ui_'+index,now:at(index)});}
(async()=>{let browser;await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const archive=path.join(temporary,'archive-'+width);for(let i=65;i<=70;i++)append(archive,i);
   const page=await browser.newPage({viewport:{width,height:1100}}),requests=[],errors=[],external=[];let hold=false,release,started,deny=false,missingWeights=false;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    requests.push({method:req.method(),path:url.pathname,url:req.url()});
    if(url.pathname!=='/api/research/workspace')return route.fulfill({status:403,json:{ok:false,error:'synthetic-unused'}});
    if(hold){hold=false;started();await new Promise(r=>release=r);}
    if(deny)return route.fulfill({status:403,json:{ok:false,error:'synthetic-revocation'}}).catch(()=>{});
    const query=Object.fromEntries(url.searchParams);for(const k of ['asOf','offset','limit','minScore'])if(k in query)query[k]=Number(query[k]);
    const result=W.workspaceView(archive,query);
    if(missingWeights){result.marketLinkage.attribution={status:'unknown',coverageWeight:null,knownContribution:null,contributionPoints:null,industries:[]};result.marketLinkage.unknownReasons.push('benchmark-window-and-index-weights-unavailable');}
    return route.fulfill({json:{ok:true,result}}).catch(()=>{});
   });
   await page.goto(origin+'/research.html?symbol=600000#researchWorkspace');
   assert.equal(await page.locator('#workspaceMarketLinkage').isVisible(),false);assert.equal(requests.filter(r=>r.path==='/api/research/workspace').length,0);
   await page.locator('#token').fill('synthetic-linkage-editor');
   const read=async()=>{await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));};
   await read();const card=page.locator('#workspaceMarketLinkage');await card.scrollIntoViewIfNeeded();
   assert.equal(await card.isVisible(),true);assert.ok((await card.textContent()).includes('合成验证指数'));assert.ok((await card.textContent()).includes('+5.00点'));assert.ok((await card.textContent()).includes('-5.00点'));
   assert.ok((await card.textContent()).includes('持续前排候选'));assert.ok((await card.textContent()).includes('最先观察到异动'));
   const count=requests.length,sector=card.getByRole('combobox',{name:'联动板块'}),options=await sector.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,text:x.textContent})));
   const b=options.find(x=>x.text.includes('行业乙')),c=options.find(x=>x.text.includes('重叠概念'));
   await card.locator('[data-linkage-board="B"]').click();assert.equal(await sector.inputValue(),b.value);assert.equal(requests.length,count);
   await sector.selectOption(b.value);assert.equal(requests.length,count);await card.locator('[data-linkage-symbol="000001"]').click();
   assert.ok((await card.locator('.ml-stock').textContent()).includes('000001'));assert.ok((await card.locator('.ml-stock').textContent()).includes('相对弱势观察'));
   assert.equal(requests.length,count,'local sector and member choices must not fetch or write');
   await sector.selectOption(c.value);assert.ok((await card.textContent()).includes('概念可重叠'));
   await sector.selectOption(options.find(x=>x.text.includes('行业甲')).value);const member=card.locator('[data-linkage-symbol="600000"]');await member.focus();await member.press('Enter');assert.equal(await member.getAttribute('aria-pressed'),'true');
   const selectedRun=await page.locator('#workspaceContent [data-workspace-run][aria-pressed=true]').getAttribute('data-workspace-run');append(archive,71);await read();
   assert.equal(new URL(requests.at(-1).url).searchParams.get('runId'),selectedRun);assert.equal(await page.locator('#workspaceContent [data-workspace-run][aria-pressed=true]').getAttribute('data-workspace-run'),selectedRun);
   const beforeInspect=requests.length;await card.locator('.ml-stock [data-workspace-symbol="600000"]').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.startsWith('已读取'));
   assert.equal(requests.length,beforeInspect+1);assert.equal(new URL(requests.at(-1).url).searchParams.get('symbol'),'600000');assert.equal(new URL(requests.at(-1).url).searchParams.get('runId'),selectedRun);
   assert.equal(await page.locator('#newsEvidenceSymbol').inputValue(),'600000');assert.equal(await page.locator('#captureSymbol').inputValue(),'600000');
   await card.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const geometry=await card.locator('button,select,summary').evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().height));assert.ok(geometry.every(h=>h>=44));
   await card.screenshot({path:path.join(output,'market-linkage-'+width+'.png')});
   const tools=page.locator('#workspaceNativeFile').locator('xpath=..').locator('xpath=..');await tools.locator('summary').click();const download=page.waitForEvent('download');await page.locator('#workspaceLinkageTemplate').click();const file=await download,downloadPath=await file.path(),template=JSON.parse(fs.readFileSync(downloadPath,'utf8'));
   assert.equal(template.marketLinkageEvidence.benchmark.return,null);assert.equal(template.marketLinkageEvidence.stocks[0].weight,null);assert.equal(template.marketLinkageEvidence.symbol,'600000');assert.ok(!JSON.stringify(template).includes('synthetic-linkage-editor'));
   missingWeights=true;await read();assert.ok((await card.textContent()).includes('无法计算行业贡献'));assert.equal(await card.locator('.ml-contributions').count(),2);assert.ok(!(await card.textContent()).includes('+5.00点'));
   missingWeights=false;await read();hold=true;const pending=new Promise(r=>started=r);await page.locator('#workspaceRead').click();await pending;
   await page.locator('#workspaceSymbol').fill('600001');assert.equal(await card.isVisible(),false);release();await page.waitForTimeout(50);assert.equal(await card.textContent(),'');
   await page.locator('#workspaceSymbol').fill('600000');await read();deny=true;await page.locator('#workspaceRead').click();await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('读取权限已失效'));
   assert.equal(await card.isVisible(),false);assert.equal(await card.textContent(),'');deny=false;await read();await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal(await card.isVisible(),false);
   assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();console.log('market-sector-stock card UI '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
