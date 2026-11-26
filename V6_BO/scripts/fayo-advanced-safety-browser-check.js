#!/usr/bin/env node
'use strict';
// Browser integration in an isolated HTTP harness. Deterministic historical
// inputs are explicitly fixtures; every displayed risk result is calculated by
// the real core. Defensive mutations use only a disposable original account.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {withEquityEvidence,now,day,priorDay}=require('../tests/helpers/advanced-portfolio-fixture');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {accountExitDiagnostics,selectAdvancedRiskQuotes}=require('../src/core/advanced-account-risk');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {inspectPaperPlanEntry}=require('../src/core/paper-plan-entry-check');
const {bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {tradingFees}=require('../src/core/trading-fees');
const output=process.env.FAYO_ADVANCED_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-advanced-browser-'));
const publicRoot=path.resolve(__dirname,'../public');fs.mkdirSync(output,{recursive:true});
async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-advanced-account-')),file=path.join(root,'pool.json');
 const service=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
 service.adoptLegacy({enabled:true,initial:20000,cash:10000,realized:0,positions:{'600000':{code:'600000',name:'隔离样本持仓',shares:1000,buyPrice:10,basis:10000,buyTs:Date.parse(priorDay+'T10:00:00+08:00')}},trades:[]});
 service.configure({expectedRevision:service.read().revision,riskPolicy:{version:'isolated-original-policy',maxPositionPct:50,maxGrossExposurePct:100}});
 const fixture=withEquityEvidence(),plan=fixture.plan;
 const card={authority:'fayo-decision-center',decisionId:plan.decisionId,code:plan.code,day,strategyAt:now-10000,calculatedAt:now-3000,quoteBasis:{source:'tencent',quoteAt:now-1000},plan:{buyLow:9,buyHigh:11,stop:8,target:12,positionPct:50}};
 bindAuthoritativePlan(plan,card);
 const stocks=['600000','600001'].map(code=>({code,name:'隔离历史输入 '+code,price:10,preClose:10,high:10.5,quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,suspended:false,tradable:true,volume:10000}));
 const quotes=selectAdvancedRiskQuotes({codes:stocks.map(x=>x.code),stocks,lastPx:new Map(),now,limitFor:()=>.1}),row=stocks[1];
 const authorityQuotes=Object.fromEntries(stocks.map(stock=>[stock.code,{symbol:stock.code,price:10,quoteSource:'tencent',provider:'tencent',quoteAt:stock.quoteAt,timestamp:stock.quoteAt,receivedAt:stock.receivedAt,tradeDate:day,mode:'public-live-unverified',volumeUnit:'shares',volume:1000000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,riskContext:{observedAt:stock.quoteAt,marks:{'600000':10,'600001':10},requireImportedEvidence:true},inputProvenance:createAutomaticInputProvenance({stock,observation:stock,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})}]));
 const quote=authorityQuotes[row.code];
 const report=()=>{
  const book=service.read(),account=service.legacy(),context=structuredClone(fixture.input.portfolioContext);
  context.plans.pool=[plan];
  const receipt=inspectPaperPlanEntry({input:{action:'executePlan',account:'pool',planId:plan.id},plan,now,day,replica:false,continuous:true,candidate:row,eligiblePick:()=>true,systemPickDay:()=>day,poolDay:null,newsBlocked:false,account,policy:{maxPos:2},equity:20000,quote,book,authoritative:card},{sealedUp:false,heldCount:1,monitorCapacity:220,lot:100,feeFor:(side,amount)=>tradingFees({side,quantity:1,price:amount,tradeDate:day,policy:book.feePolicy}).total,previewAccount:input=>service.previewAutomaticEntry({...input,valuationQuotes:authorityQuotes})});
  context.planChecks={pool:{[plan.id]:receipt}};
  context.equityEvidence.pool.accountRevision=book.revision;context.equityEvidence.pool.bookFingerprint=book.fingerprint;
  const diagnostic=accountExitDiagnostics(book,{...fixture.input,quotes,portfolioContext:context});
  return {mode:'advanced-account-risk-readonly',status:'observed',canTrade:false,writesAccount:false,accounts:[diagnostic],telemetry:{sampleCount:1,p50Ms:1,p95Ms:1}};
 };
 const first=report();assert.equal(first.accounts[0].reconciliation.internallyConsistent,true);assert.equal(first.accounts[0].portfolioEvidence.previews[0].originalGateStatus,'allowed');
 assert.equal(first.accounts[0].portfolioEvidence.previews[0].riskBudgetAfter.policyScope,'original-account-readonly-preview');
 assert.equal(first.accounts[0].portfolioEvidence.previews[0].riskBudgetAfter.policyVersion,'isolated-original-policy');
 assert.ok(first.accounts[0].portfolioEvidence.tail.historicalES!==null);assert.ok(first.accounts[0].portfolioEvidence.performance.riskAdjustedReturn.sharpe!==null);
 let delayRisk=0,rejectMutation=false;
 const requests=[],server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
  if(p==='/'||p==='/m'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"></head><body class="fy-reference-shell"><main class="fy-main"><p>隔离输入验证 · 非生产账户与市场证据</p><div id="mount"></div></main></body></html>');}
  if(p.startsWith('/api/')){
   let body='';for await(const bytes of req)body+=bytes;
   const input=body?JSON.parse(body):null;requests.push({p,method:req.method,input});
   res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
   if(req.headers['x-fixture-role']!=='edit'){res.writeHead(403);return res.end(JSON.stringify({ok:false,error:'fixture access denied'}));}
   if(p==='/api/research/risk-center'&&req.method==='GET'){
    if(delayRisk)await new Promise(resolve=>setTimeout(resolve,delayRisk));
    return res.end(JSON.stringify({ok:true,result:{mode:'research-risk-center-readonly',canTrade:false,canNotify:false,supports:[],contra:[],missing:[],advancedAccounts:report()}}));
   }
   if(p==='/api/research/order-account'&&req.method==='POST')try{
    if(rejectMutation)throw Error('隔离模拟版本冲突');
    assert.equal(input.action,'set-defense');assert.equal(input.accountId,'pool');
    const result=service.setDefensiveControl({...input,actor:'isolated-browser-editor'});return res.end(JSON.stringify({ok:true,result}));
   }catch(error){res.writeHead(400);return res.end(JSON.stringify({ok:false,error:error.message}));}
   res.writeHead(404);return res.end('{}');
  }
  if(!/^\/nova\/[\w./-]+$/.test(p)||p.includes('..')){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(publicRoot,p)));}catch{res.writeHead(404);res.end();}
 });
 let browser;const summary={fixtureOnly:true,realOriginalAccount:true,realPlanInspector:true,configuredOriginalPolicyPreview:true,productionActions:false,views:[]};
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const view of [{width:1366,height:900,path:'/'},{width:390,height:844,path:'/m'}]){
   const page=await browser.newPage({viewport:{width:view.width,height:view.height}}),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
   try{
    await page.goto(origin+view.path);
    await page.evaluate(async()=>{
     const {appendResearchExtensions}=await import('/nova/research-extensions.js');
     window.showRisk=(role='edit')=>{
      window.controller?.abort();window.controller=new AbortController();const host=document.getElementById('mount');host.replaceChildren();
      const ctx={role,canEdit:role==='edit',signal:window.controller.signal,api:async(p,options={})=>{
       const res=await fetch(p,{method:options.method||'GET',body:options.body?JSON.stringify(options.body):undefined,signal:options.signal,headers:{'X-Fixture-Role':role,'Content-Type':'application/json'}});const data=await res.json();if(!res.ok||data.ok===false)throw Error(data.error||'fixture request failed');return data;
      }};
      appendResearchExtensions(host,{sub:'desk'},ctx);
     };window.showRisk();
    });
    await page.getByRole('button',{name:'读取交叉风险证据',exact:true}).click();
    await page.getByRole('heading',{name:'现金流调整后的绩效',exact:true}).waitFor();
    const text=await page.locator('#mount').innerText();assert.match(text,/时间加权收益 TWR/);assert.match(text,/夏普比率/);assert.match(text,/历史 ES/);assert.doesNotMatch(text,/(?:^|\n)(?:null|undefined|NaN)(?:\n|$)/);
    await page.getByText('600001 · 计划预演',{exact:true}).click();assert.match(await page.locator('#mount').innerText(),/假设数量/);
    await page.getByText('原风险额度',{exact:true}).click();assert.match(await page.locator('#mount').innerText(),/isolated-original-policy/);
    await page.getByText('600000 · 容量情景',{exact:true}).click();assert.match(await page.locator('#mount').innerText(),/容量内估计股数/);
    await page.getByText('逐股风险贡献',{exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+view.width);
    await page.screenshot({path:path.join(output,'advanced-risk-'+view.width+'.png'),fullPage:true});
    const reason=page.getByRole('textbox',{name:'防御审批理由',exact:true});await reason.fill('隔离验证：核对新增敞口');
    assert.equal(await page.getByRole('heading',{name:'现金流调整后的绩效',exact:true}).count(),1,'typing in result action must not clear pane');
    await page.getByRole('button',{name:'准备限制新增',exact:true}).click();assert.equal(await page.getByRole('alertdialog').count(),1);
    const beforeCancel=requests.filter(x=>x.method==='POST').length;await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(requests.filter(x=>x.method==='POST').length,beforeCancel);
    await page.getByRole('button',{name:'准备限制新增',exact:true}).click();const expected=service.read().revision;
    await page.getByRole('button',{name:'确认限制新增',exact:true}).click();await page.getByText('防御操作已记录到原账户，请重新读取最新风险与审批回执。',{exact:true}).waitFor();
    assert.equal(requests.at(-1).input.expectedRevision,expected);assert.equal(service.reconcile().defensive.state,'restricted');assert.equal(service.read().account.cash,10000);
    await page.getByRole('button',{name:'读取交叉风险证据',exact:true}).click();await page.getByRole('button',{name:'准备审批解除',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'防御审批理由',exact:true}).fill('隔离验证：确认对账与未完成买单');await page.getByRole('button',{name:'准备审批解除',exact:true}).click();
    rejectMutation=true;const beforeReject=requests.length;await page.getByRole('button',{name:'确认审批解除',exact:true}).click();await page.getByText(/隔离模拟版本冲突/).waitFor();assert.equal(requests.length,beforeReject+1);assert.equal(service.reconcile().defensive.state,'restricted');assert.equal(await page.getByRole('alertdialog').count(),0);
    rejectMutation=false;await page.getByRole('button',{name:'读取交叉风险证据',exact:true}).click();await page.getByRole('button',{name:'准备审批解除',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'防御审批理由',exact:true}).fill('隔离验证：版本重新核对后解除');await page.getByRole('button',{name:'准备审批解除',exact:true}).click();await page.getByRole('button',{name:'确认审批解除',exact:true}).click();await page.getByText('防御操作已记录到原账户，请重新读取最新风险与审批回执。',{exact:true}).waitFor();
    assert.equal(service.reconcile().defensive.state,'open');assert.equal(requests.at(-1).input.acknowledge,'RELEASE_DEFENSIVE_RESTRICTION');
    const count=requests.length;await page.evaluate(()=>window.showRisk('view'));assert.equal(await page.getByRole('button',{name:'读取交叉风险证据',exact:true}).isDisabled(),true);assert.equal(requests.length,count);assert.doesNotMatch(await page.locator('#mount').innerText(),/10,000\.00/);
    await page.evaluate(()=>window.showRisk());delayRisk=100;await page.getByRole('button',{name:'读取交叉风险证据',exact:true}).click();await page.evaluate(()=>window.showRisk('view'));await page.waitForTimeout(150);delayRisk=0;
    assert.equal(await page.getByRole('heading',{name:'现金流调整后的绩效',exact:true}).count(),0,'aborted old result cannot repopulate viewer');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);summary.views.push({...view,richCoreEvidence:true,overflow:false,explicitReview:true,cancelHasNoMutation:true,revisionConflictNoRetry:true,viewerPrivateReads:0,abortedResultDiscarded:true});
   }finally{await page.close();}
  }
  const final=service.read();assert.equal(final.account.cash,10000);assert.equal(final.account.positions['600000'].quantity,1000);assert.equal(final.account.events.length,0);assert.equal(Object.keys(final.orders).length,0);
  summary.passed=true;summary.financialStateUnchanged=true;summary.defensiveReceiptCount=final.defensiveControl.events.length;
  fs.writeFileSync(path.join(output,'advanced-safety-browser.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({output,...summary},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
