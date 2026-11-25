#!/usr/bin/env node
'use strict';
// Presentation integration over reports/checklists produced by the real core
// and journal store in a disposable directory. No handwritten execution status
// is served as evidence, and this harness cannot mutate any application ledger.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {executionInput}=require('../tests/helpers/execution-ui-fixture');
const {buildPaperExecutionChecklist}=require('../src/core/paper-execution-checklist');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const {createConditionalOrderStore}=require('../src/core/paper-conditional-orders');
const {observePaperPlans}=require('../src/core/paper-plan-observer');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {buildDecisionCenter}=require('../src/core/decision-center');
const root=path.resolve(__dirname,'../public'),day='2026-11-16',stamp=(date,time)=>Date.parse(date+'T'+time+'+08:00');
const output=process.env.FAYO_EXECUTION_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-execution-browser-'));
fs.mkdirSync(output,{recursive:true});

async function run(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-execution-evidence-'));let at=stamp(day,'15:30:00');
 const store=createPaperExecutionReportStore({root:path.join(base,'reports'),clock:()=>at,canWrite:()=>true});
 const original=executionInput({now:at}),ledger=JSON.stringify(original.book),first=store.save(original),firstHistory=store.history({day});
 assert.equal(first.reportVersion,1);assert.equal(first.report.score.score,null);
 at+=3600000;const late=executionInput({now:at,entered:true}),lateLedger=JSON.stringify(late.book),second=store.save(late),history=store.history({day});
 assert.equal(second.reportVersion,2);assert.equal(second.checklist.items[0].state,'reviewed');
 const complete={ok:true,day,dailyReport:second,reportHistory:history,checklist:second.checklist,
  reportRuntime:{status:'saved',lastResult:{day,reportVersion:2}},paper:{pool:second.report.score},observer:{privateChannel:'unconfigured',recordCount:0,alerts:[]}};
 const firstPayload={...complete,dailyReport:first,reportHistory:firstHistory,checklist:first.checklist,paper:{pool:first.report.score}};
 const pendingAt=stamp(day,'10:01:00'),pendingInput=executionInput({now:pendingAt});
 const intent=createConditionalOrderStore({root:path.join(base,'intents'),clock:()=>pendingAt})
  .create({requestId:'browser-ui-condition-001',plan:pendingInput.plans[0],authorization:{mode:'local',principal:null,generation:0}},{readBook:()=>pendingInput.book});
 const nextDay='2026-11-17',riskAt=stamp(nextDay,'10:00:00'),price=9.3;
 const row={code:'600001',name:'执行证据隔离验证',price,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',
  quoteAt:riskAt,receivedAt:riskAt,canTrade:true,suspended:false,tradable:true};
 const quote={symbol:row.code,price,quoteSource:'tencent',provider:'tencent',quoteAt:riskAt,timestamp:riskAt,receivedAt:riskAt,tradeDate:nextDay,
  mode:'public-live-unverified',volumeUnit:'shares',volume:10000000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
  inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
 const observation=observePaperPlans({plans:late.plans,book:late.book,quotes:{[row.code]:quote},day:nextDay,now:riskAt,
  calendar:{isOpen:d=>[day,nextDay].includes(d)},continuous:true,
  exitEligibilityByPlan:{[late.plans[0].id]:{allowed:true,reason:'隔离验证中的原退出只读预检',checkedAt:riskAt,quoteAt:riskAt}}});
 assert.deepEqual(observation.rejected,[]);
 const variants=[
  ['not-planned',buildPaperExecutionChecklist({...pendingInput,plans:[]}),pendingAt],
  ['frozen',buildPaperExecutionChecklist(pendingInput),pendingAt],
  ['waiting-condition',buildPaperExecutionChecklist({...pendingInput,conditionalOrders:intent.orders}),pendingAt],
  ['executed',buildPaperExecutionChecklist(executionInput({now:pendingAt,entered:true})),pendingAt],
  ['risk-pending',buildPaperExecutionChecklist({...late,day:nextDay,now:riskAt,observations:observation.records}),riskAt],
  ['reviewed',second.checklist,at],
  ['unknown',buildPaperExecutionChecklist({...pendingInput,book:null}),pendingAt]
 ];
 for(const [state,value]of variants)assert.equal(value.items[0].state,state);
 let contract=firstPayload;
 const requests=[],account={cash:10000,equity:10000,initial:10000,totalPnl:0,totalPct:0,enabled:true,positions:[],trades:[],realizedSeries:[]};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname;
  if(p==='/'||p==='/m'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/nova/fayo.css"></head><body><main id="mount" class="fy-main"></main></body></html>');}
  if(p.startsWith('/api/')){
   requests.push({path:p,search:url.search,method:req.method,role:req.headers['x-fixture-role']});
   res.setHeader('Content-Type','application/json');
   if(req.method!=='GET'||req.headers['x-fixture-role']!=='edit'){res.writeHead(403);return res.end(JSON.stringify({ok:false,error:'isolated viewer/read-only boundary'}));}
   if(p==='/api/paper')return res.end(JSON.stringify({ok:true,paper:{pool:account,pre:account}}));
   if(p==='/api/paper/conditional-orders')return res.end(JSON.stringify({ok:true,orders:[],revision:0,engine:{privateChannel:'unconfigured'}}));
   if(p==='/api/paper/execution-score')return res.end(JSON.stringify(contract));
   res.writeHead(404);return res.end('{}');
  }
  if(!/^\/nova\/[\w./-]+$/.test(p)||p.includes('..')){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,p)));}
  catch{res.writeHead(404);res.end();}
 });
 let browser;const report={fixtureOnly:true,source:'real checklist / observer / persistent report journal; isolated HTTP UI',views:[]};
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const viewport of [{width:1366,height:900,path:'/'},{width:390,height:844,path:'/m'}]){
   const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}}),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
   try{
    await page.goto(origin+viewport.path);
    await page.evaluate(async({at,day})=>{
     const {renderOperations}=await import('/nova/operations.js'),{createDecisionHome}=await import('/nova/decision-view.mjs');
     const OriginalDate=Date;window.testNow=at;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.testNow]));}static now(){return window.testNow;}};
     window.renderEvidence=({view='paper',role='edit',payload,day:targetDay=day,now=window.testNow})=>{
      window.controller?.abort();window.controller=new AbortController();window.stateListeners=[];window.testNow=now;
      const ctx={role,canEdit:role==='edit',signal:window.controller.signal,state:{closeSession:{day:targetDay.replaceAll('-','')},paper:{}},
       decisionPayload:payload,loadDecisionCenter:async()=>{},onState:fn=>window.stateListeners.push(fn),selectStock:()=>{},navigate:()=>{},notify:()=>{},
       api:async(p,options={})=>{const response=await fetch(p,{...options,headers:{'X-Fixture-Role':role}});return response.json();}};
      window.ctx=ctx;document.getElementById('mount').replaceChildren(view==='home'?createDecisionHome(ctx):renderOperations({view:'assets',sub:'paper'},ctx));
     };
    },{at,day});
    contract=firstPayload;
    await page.evaluate(({day,now})=>window.renderEvidence({day,now}),{day,now:first.recordedAt});
    const evidence=page.locator('[data-execution-evidence]');await evidence.locator('[data-execution-state="frozen"]').waitFor();
    assert.equal(await evidence.getAttribute('data-report-version'),'1');
    assert.match(await evidence.innerText(),/已保存日报 v1/);assert.doesNotMatch(await evidence.innerText(),/100 分/);
    assert.ok(requests.some(r=>r.path==='/api/paper/execution-score'&&r.search==='?date='+day),'actual eight-digit session is requested as ISO');
    const sources=evidence.locator('#fy-execution-report-sources-'+day);
    await sources.locator('summary').click();assert.match(await sources.innerText(),new RegExp(first.reportHash));
    contract=complete;await page.evaluate(now=>{window.testNow=now;},second.recordedAt);
    await page.getByRole('button',{name:'刷新账户',exact:true}).first().click();
    await page.locator('[data-execution-evidence][data-report-version="2"]').waitFor();
    assert.equal(await sources.evaluate(node=>node.open),true,'report evidence remains open across background replacement');
    assert.match(await evidence.innerText(),/100 分/);assert.match(await sources.innerText(),/已保存 2 个版本/);
    assert.deepEqual(await sources.locator('tbody tr td:first-child').allTextContents(),['v2','v1']);
    assert.equal(await evidence.locator('[data-execution-state="reviewed"]').count(),1);
    assert.equal(await evidence.getByRole('heading',{name:'执行评分',exact:true}).count(),1,'saved score does not duplicate the outer report date');
    assert.doesNotMatch(await page.locator('#mount').innerText(),/(?:^|\n)(?:null|undefined)(?:\n|$)/,'absent optional evidence is not a text node');
    assert.ok(await evidence.evaluate(node=>node.parentElement.textContent.indexOf('已实现收益曲线')<node.parentElement.textContent.indexOf('持久执行日报')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'daily report layout fits '+viewport.width);
    await evidence.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'execution-report-'+viewport.width+'.png'),fullPage:true});
    contract={...complete,dailyReport:{status:'missing',day,report:null,missing:['原日报尚未归档：等待后台收盘处理']},reportHistory:{day,total:0,versions:[]}};
    await page.getByRole('button',{name:'刷新账户',exact:true}).first().click();
    await page.locator('[data-execution-evidence][data-report-status="missing"]').waitFor();
    assert.equal(await evidence.getAttribute('data-report-version'),null);assert.match(await evidence.innerText(),/原日报尚未归档/);
    assert.equal(await evidence.getByRole('heading',{name:'执行评分',exact:true}).count(),0,'a live GET score is never shown as a saved daily report');
    contract={...complete,day:'2026-11-13'};await page.getByRole('button',{name:'刷新账户',exact:true}).first().click();
    await page.locator('[data-execution-evidence][data-report-status="unknown"]').waitFor();
    assert.equal(await evidence.getAttribute('data-report-version'),null);assert.match(await evidence.innerText(),/回执日期.*请求不一致/);
    for(const [state,checklist,now]of variants){
     const board=await buildDecisionCenter({}, {now});board.executionChecklist=checklist;
     await page.evaluate(({payload,now,day})=>window.renderEvidence({view:'home',payload,now,day}),{payload:board,now,day:checklist.day});
     await page.locator('.fy-decision-checklist [data-execution-state="'+state+'"]').waitFor();
     await page.locator('#fy-execution-evidence summary').click();
     await page.locator('#fy-execution-evidence [data-execution-state="'+state+'"]').waitFor();
     assert.equal(await page.locator('#fy-execution-evidence [data-execution-state="'+state+'"]').count(),1);
     assert.ok((await page.locator('#fy-execution-evidence').innerText()).includes(checklist.items[0].reason),'the original reason is visible for '+state);
     if(state==='risk-pending')assert.match(await page.locator('#fy-execution-evidence').innerText(),/tencent/);
    }
    const callCount=requests.length;
    await page.evaluate(()=>window.renderEvidence({role:'view'}));await page.getByText('这是你的私人工作区',{exact:true}).waitFor();
    assert.equal(requests.length,callCount,'viewer never reads private report endpoints');
    const privatePayload=await buildDecisionCenter({}, {now:at});privatePayload.executionChecklist=second.checklist;
    await page.evaluate(({payload,now})=>window.renderEvidence({view:'home',role:'view',payload,now}),{payload:privatePayload,now:at});
    await page.getByText('编辑身份可查看执行状态',{exact:true}).waitFor();
    await page.locator('#fy-execution-evidence summary').click();assert.equal(await page.locator('[data-execution-code]').count(),0);
    assert.doesNotMatch(await page.locator('#mount').innerText(),/执行证据隔离验证/);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    report.views.push({...viewport,versions:[1,2],states:variants.map(v=>v[0]),compactDateNormalized:true,unknownPreserved:true,expandedPreserved:true,viewerPrivateReads:0});
   }finally{await page.close();}
  }
  assert.equal(JSON.stringify(original.book),ledger);assert.equal(JSON.stringify(late.book),lateLedger);
  assert.deepEqual(requests.filter(r=>r.method!=='GET'),[]);report.passed=true;report.ledgerUnchanged=true;
  fs.writeFileSync(path.join(output,'execution-browser-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify({passed:true,output,...report},null,2)+'\n');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(base,{recursive:true,force:true});}
}
run().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
