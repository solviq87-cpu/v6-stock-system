#!/usr/bin/env node
'use strict';
// Browser-only acceptance over actual presentation modules and actual backend
// projections. Every upstream row is an isolated test input; no production
// server, account file, notification channel or collector is started.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {buildIntelligenceVisuals}=require('../src/core/intelligence-visuals');
const {buildIntelligenceResearch}=require('../src/core/intelligence-research');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const output=process.env.FAYO_INTELLIGENCE_QA_DIR||(process.env.V6_UI_QA_DIR?path.join(process.env.V6_UI_QA_DIR,'intelligence-center'):fs.mkdtempSync(path.join(os.tmpdir(),'fayo-intelligence-browser-')));
fs.mkdirSync(output,{recursive:true});
const initialDay='2026-11-25',nextDay='2026-11-26';
let phase='missing-flows';
const requests=[],writes=[],validationSubmissions=[],projectionChecks=[];
function evidence(){
  const day=phase==='next-day'?nextDay:initialDay,now=Date.parse(day+'T10:00:00+08:00');
  const stocks=[{code:'600000',name:'观测甲',sector:'芯片',price:10,pct:2,mktcap:3000000000},
    {code:'600001',name:'观测乙',sector:'消费',price:20,pct:-1,mktcap:1000000000}].map(row=>({...row,poolDay:day,
      quoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',quoteMode:'public-live-unverified'}));
  const selected={...stocks[0],score:85,baziDims:{trend:0,fund:60},baziWhy:{trend:'已观测的原趋势分为零',fund:'原资金维度分'}};
  const state={stocks,candidatePool:[selected],sectors:[{name:'芯片',mainInflow:1000000}],
    sectorsInd:[{name:'芯片',mainInflow:0,source:'eastmoney',unit:'CNY',retrievedAt:now-1000,sourceTimestamp:null,tradeDate:null}],
    marketRecovery:{emotion:{date:day,value:'修复',knownAt:now-20000,source:'原多日情绪引擎'}}};
  if(phase!=='missing-flows')state.fundFlowLinks={day,knownAt:now-2000,unit:'CNY',kind:'observed-transfer',source:'原来源去向明细',links:[
    {from:'来源甲',to:'芯片',amount:100000},{from:'来源乙',to:'消费',amount:50000}]};
  return {day,now,state};
}
function chartPayload(code='600000'){
  const {day,now,state}=evidence(),before=JSON.stringify(state),result=buildIntelligenceVisuals(state,{cards:[]},{day,now,code});
  assert.equal(JSON.stringify(state),before,'visuals projection is read only');
  projectionChecks.push({kind:'visuals',day,unchanged:true});return result;
}
function researchPayload(){
  const {day,now}=evidence(),archive={scope:'live',checks:[],plans:[],trades:[],versions:[],candidates:[]};
  const before=JSON.stringify(archive),result=buildIntelligenceResearch({day,now,archive});
  assert.equal(JSON.stringify(archive),before,'research projection is read only');
  assert.equal(result.authority,'fayo-intelligence-research');
  assert.equal(result.quality.score,null);assert.equal(result.templates.groups.length,6);
  result.historySupply={receipts:0,rows:0,sources:[],missing:['逐日源端原始时刻'],status:'missing-receipts'};
  result.historyIntake={status:'no-admitted-hfq-evidence',codes:['600000'],captures:1,admittedRows:0,
    sourceStatus:[{code:'600000',day,source:'baostock',status:'missing-dependency',receivedAt:now-1000}],missing:['独立后复权原始数据']};
  // This isolated presentation fixture exercises the new submit control. Real
  // proposal generation and five-gate writes are covered by worker/HTTP tests.
  if(phase==='feedback-ready')Object.assign(result.feedback,{proposalFingerprint:'a'.repeat(64),archiveRevision:7,
    validationBridge:{ready:true,missing:[],note:'隔离界面提案，仅测试请求字段与审批导航'}});
  projectionChecks.push({kind:'research',day,unchanged:true});return {ok:true,result};
}
function harness(viewer=false){
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>绯曜智能图谱隔离验收</title><link rel="stylesheet" href="/nova/fayo.css">
  <style>body{margin:0;padding:24px;background:#140f1c;color:#f5eafa}main{max-width:1220px;margin:auto;min-width:0}.qa-banner{color:#b6a2bf;font-size:13px;margin-bottom:20px}#drawer-proof{margin-top:20px}@media(max-width:600px){body{padding:12px}}</style></head>
  <body><main><h1>绯曜 FAYO · 智能图谱验收</h1><p class="qa-banner">隔离测试输入 · 使用真实图表与研究投影函数 · 不连接账户与推送</p><div id="center"></div><div id="drawer-proof"></div><div id="operations-proof"></div></main>
  <script type="module">
  import {createIntelligenceCenter,createDrawerRadar} from '/nova/intelligence-view.mjs';
  import {renderOperations} from '/nova/operations.js';
  const controller=new AbortController(),listeners=new Set(),reads=[],clicks=[],navigations=[];
  let selected={code:'600000',day:'${initialDay}'};
  const ctx={signal:controller.signal,canEdit:${viewer?'false':'true'},role:'${viewer?'view':'edit'}',
    get decisionSelection(){return selected;},
    async api(url,options={}){reads.push({url,method:options.method||'GET'});const response=await fetch(url,{method:options.method||'GET',signal:options.signal,...(options.body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)}:{})});return response.json();},
    onDecisionSelection(callback){listeners.add(callback);return()=>listeners.delete(callback);},
    selectStock(code,row){clicks.push({code,row});},navigate(view,sub){navigations.push({view,sub});}};
  const center=createIntelligenceCenter(ctx),radar=createDrawerRadar(ctx,()=>selected);
  document.querySelector('#center').append(center);document.querySelector('#drawer-proof').append(radar);
  window.intelligenceHarness={reads,clicks,navigations,setDay(day){selected={...selected,day};for(const callback of listeners)callback();radar.refresh();},
    showPaperObserver(){document.querySelector('#operations-proof').replaceChildren(renderOperations({view:'assets',sub:'paper'},
      {...ctx,decisionSelection:null,workspaceNavigation:true,state:{closeSession:{day:'${initialDay}'},paper:{mirror:false}}}));},
    abort(){controller.abort();},ready:true};
  </script></body></html>`;
}
function reply(res,status,type,value){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(value);}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');requests.push({method:req.method,path:u.pathname,query:u.search});
  if(req.method==='POST'&&u.pathname==='/api/decision-center/feedback'){
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      validationSubmissions.push(JSON.parse(body));
      reply(res,200,'application/json',JSON.stringify({ok:true,result:{candidateId:'isolated-center-candidate',status:'验证未通过',productionWeightsChanged:false}}));
    });return;
  }
  if(req.method!=='GET'){writes.push({method:req.method,path:u.pathname});return reply(res,405,'application/json',JSON.stringify({ok:false}));}
  if(u.pathname==='/favicon.ico')return reply(res,204,'text/plain','');
  if(u.pathname==='/'||u.pathname==='/m')return reply(res,200,'text/html; charset=utf-8',harness(u.searchParams.get('role')==='view'));
  if(u.pathname==='/api/decision-center/visuals'){
    const value=chartPayload(u.searchParams.get('code')||'600000');
    return reply(res,200,'application/json',JSON.stringify(u.searchParams.get('section')==='radar'?
      {ok:true,authority:value.authority,day:value.day,radar:value.radar}:value));
  }
  if(u.pathname==='/api/decision-center/research')return reply(res,200,'application/json',JSON.stringify(researchPayload()));
  // Presentation-only account responses verify coexistence of the observer and
  // durable-order views. No paper write endpoint is available in this harness.
  if(u.pathname==='/api/paper')return reply(res,200,'application/json',JSON.stringify({ok:true,paper:{pool:{
    name:'隔离模拟账户',enabled:true,equity:100000,cash:100000,totalPnl:0,totalPct:0,initial:100000,
    positions:[],trades:[],realizedSeries:[]}}}));
  if(u.pathname==='/api/paper/conditional-orders')return reply(res,200,'application/json',JSON.stringify({ok:true,revision:1,
    notificationOwner:'plan-observer',engine:{enabled:true,privateChannel:'unconfigured'},orders:[{
      id:'isolated-order',planId:'isolated-plan',code:'600000',name:'隔离计划',day:initialDay,status:'executed',canCancel:false,
      createdAt:Date.parse(initialDay+'T09:45:00+08:00'),expiresAt:Date.parse(initialDay+'T14:57:00+08:00'),
      lastReason:'隔离展示回执',fill:{eventId:'isolated-fill',price:10,shares:100,tradeDate:initialDay},
      alerts:[{kind:'stop',day:initialDay,status:'delegated',owner:'plan-observer',recordedAt:Date.parse(initialDay+'T10:00:00+08:00')}],observations:[]
    }]}));
  if(u.pathname==='/api/paper/execution-score')return reply(res,200,'application/json',JSON.stringify({ok:true,day:initialDay,
    paper:{pool:{day:initialDay,closed:false,score:null,status:'awaiting-close',assessed:0,unknown:1,rows:[],note:'隔离执行观察'}},
    observer:{...(phase==='observer-zero-count'?{recordCount:0}:{}),privateChannel:'unconfigured',alerts:[],
      history:{coverage:{excludedSymbols:['920001']}},lastError:'隔离来源缺项：没有连续可成交窗口'}}));
  const file=path.resolve(publicRoot,'.'+u.pathname);
  if(!u.pathname.startsWith('/nova/')||!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file))return reply(res,404,'text/plain','missing');
  return reply(res,200,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',fs.readFileSync(file));
});
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;const report={fixtureOnly:true,backend:['buildIntelligenceVisuals','buildIntelligenceResearch'],views:[]};
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
    for(const viewport of [{width:1366,height:1000,path:'/'},{width:390,height:844,path:'/m'}]){
      phase='missing-flows';
      const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block'}),page=await context.newPage();
      const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){external.push(u.origin);return route.abort();}return route.continue();});
      try{
        await page.goto(origin+viewport.path,{waitUntil:'networkidle'});
        await page.waitForFunction(()=>window.intelligenceHarness?.ready);
        assert.equal(await page.evaluate(()=>intelligenceHarness.reads.length),0,'collapsed charts and radar issue no API reads');
        await page.locator('#fy-intelligence-center > summary').click();
        await page.locator('.fy-intelligence-research').getByRole('heading',{name:'L5 · 复盘反馈',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>intelligenceHarness.reads.length),2,'one visuals read and one research read on expansion');
        const areas=await page.locator('.fy-market-map svg > g[data-code]').evaluateAll(groups=>groups.map(group=>{
          const rect=group.querySelector(':scope > rect');return {code:group.dataset.code,area:Number(rect.getAttribute('width'))*Number(rect.getAttribute('height')),fill:rect.getAttribute('fill')};}));
        assert.equal(areas.length,2);assert.ok(Math.abs(areas[0].area/areas[1].area-3)<1e-9,'heatmap area follows the actual 3:1 market caps');
        assert.ok(Math.abs(areas.reduce((sum,row)=>sum+row.area,0)-960*420)<1e-6,'heatmap conserves total area');
        assert.equal(areas.find(row=>row.code==='600000').fill,'#d1658f');assert.equal(areas.find(row=>row.code==='600001').fill,'#348b79');
        const radar=page.locator('#fy-intelligence-center .fy-nine-radar');
        assert.equal(await radar.locator('svg circle').count(),3,'only three observed values produce marks, including the real zero');
        assert.equal(await radar.locator('svg polygon:not([fill="none"])').count(),0,'six unknown axes do not close a polygon');
        assert.equal(await radar.locator('svg circle[cx="160"][cy="132"]').count(),1,'observed zero is distinct from a missing score');
        assert.equal(await page.locator('.fy-flow-sankey svg').count(),0);
        assert.match(await page.locator('.fy-intelligence-charts').innerText(),/板块净额不能证明资金来源与去向/);
        await page.getByText('已取得的板块净额 · 不代表跨板块转移',{exact:true}).click();
        assert.match(await page.locator('.fy-intelligence-charts').innerText(),/供应商未提供/);
        assert.match(await page.locator('.fy-intelligence-charts').innerText(),/资金源端时点缺失/);
        assert.match(await page.locator('.fy-intelligence-research').innerText(),/Q 尚未完整/);
        assert.match(await page.locator('.fy-intelligence-research').innerText(),/原始历史采集：1 只股票 · 0 条通过核验/);
        await page.getByText('后复权原始来源与采集回执',{exact:true}).click();
        assert.match(await page.locator('.fy-intelligence-research').innerText(),/BaoStock Python 依赖未安装/);
        assert.equal(await page.getByRole('button',{name:'验证本次反馈提案',exact:true}).isDisabled(),true,'missing research cannot submit a proposal');
        await page.getByText('后复权历史采集依据',{exact:true}).click();
        assert.match(await page.locator('.fy-intelligence-research').innerText(),/逐日源端原始时刻/);
        for(const heading of ['L1 · 数据质量','L2 · 因子有效性与去冗余','L2 · 滚动样本外验证','L2 · 原账本执行与成本压力','L2 · 六类战法模板','L5 · 复盘反馈'])
          assert.equal(await page.locator('.fy-intelligence-research').getByRole('heading',{name:heading,exact:true}).count(),1);
        assert.equal(await page.locator('.fy-intelligence-research').getByRole('heading',{name:'L2 · 六类战法模板'}).locator('..').locator('ul > li').count(),6);
        assert.equal((await page.locator('.fy-intelligence-research').innerText()).includes('undefined'),false);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,'no page-level horizontal overflow');
        await page.screenshot({path:path.join(output,'intelligence-'+viewport.width+'-missing-flows.png'),fullPage:true});
        await page.locator('.fy-market-map svg g[data-code="600000"]').click();
        assert.equal(await page.evaluate(()=>intelligenceHarness.clicks.at(-1).row.poolDay),initialDay);

        phase='observed-flows';await page.getByRole('button',{name:'刷新中心证据',exact:true}).click();
        await page.locator('.fy-flow-sankey svg').waitFor();
        // A horizontal SVG path has a zero-height geometric bounding box even
        // when its positive stroke width is visibly rendered.
        await page.locator('.fy-flow-sankey svg path').first().waitFor({state:'attached'});
        const widths=await page.locator('.fy-flow-sankey svg path').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('stroke-width'))));
        assert.equal(widths.length,2);assert.ok(Math.abs(widths[0]/widths[1]-2)<1e-9,'Sankey stroke widths follow actual 100000:50000 amounts');
        await page.locator('#fy-drawer-radar > summary').click();
        await page.locator('#fy-drawer-radar .fy-nine-radar[data-day="'+initialDay+'"]').waitFor();

        phase='next-day';await page.evaluate(day=>intelligenceHarness.setDay(day),nextDay);
        await page.locator('#fy-intelligence-center .fy-nine-radar[data-day="'+nextDay+'"]').waitFor();
        await page.locator('#fy-drawer-radar .fy-nine-radar[data-day="'+nextDay+'"]').waitFor();
        await page.locator('.fy-market-map svg g[data-code="600000"]').click();
        const clicked=await page.evaluate(()=>intelligenceHarness.clicks.at(-1));
        assert.equal(clicked.code,'600000');assert.equal(clicked.row.poolDay,nextDay,'same-code refreshed SVG uses the current day, not the old closure');
        assert.equal(clicked.row.quoteAt,Date.parse(nextDay+'T10:00:00+08:00')-1000);
        const reads=await page.evaluate(()=>intelligenceHarness.reads);
        assert.ok(reads.every(row=>row.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
        await page.screenshot({path:path.join(output,'intelligence-'+viewport.width+'-observed-flows.png'),fullPage:true});
        await page.locator('.fy-intelligence-research').screenshot({path:path.join(output,'research-'+viewport.width+'.png')});
        phase='feedback-ready';await page.getByRole('button',{name:'刷新中心证据',exact:true}).click();
        const submit=page.getByRole('button',{name:'验证本次反馈提案',exact:true});
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='验证本次反馈提案'&&!b.disabled));
        const before=validationSubmissions.length;await submit.click();
        await page.locator('[data-candidate-id="isolated-center-candidate"]').waitFor();
        assert.equal(await submit.isDisabled(),true,'the committed reference cannot be resubmitted from the old report');
        assert.equal(validationSubmissions.length,before+1);
        assert.deepEqual(validationSubmissions.at(-1),{day:initialDay,revision:7,proposalFingerprint:'a'.repeat(64)},'the browser sends only the server proposal reference');
        await page.getByRole('button',{name:'查看验证与审批',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>intelligenceHarness.navigations.at(-1)),{view:'lab',sub:'shortline-versions'});
        phase='observer-missing-count';await page.evaluate(()=>intelligenceHarness.showPaperObserver());
        const operations=page.locator('#operations-proof');
        await operations.getByText('查看当前核对结果与观察记录',{exact:true}).click();
        await operations.getByText(/计划条件记录 数量未知/).waitFor();
        assert.match(await operations.innerText(),/隔离来源缺项：没有连续可成交窗口/);
        assert.match(await operations.innerText(),/920001/);
        assert.match(await operations.innerText(),/预警由计划观察统一处理/);
        await operations.getByText('计划预警与私密通道回执',{exact:true}).click();
        assert.match(await operations.innerText(),/已交由计划观察统一处理/);
        assert.equal((await operations.innerText()).includes('私密通道接口已确认接收'),false,'delegated is not an accepted delivery receipt');
        phase='observer-zero-count';await page.evaluate(()=>intelligenceHarness.showPaperObserver());
        await operations.getByText('查看当前核对结果与观察记录',{exact:true}).click();
        await operations.getByText(/计划条件记录 0 条/).waitFor();
        assert.equal((await operations.innerText()).includes('计划条件记录 数量未知'),false,'an original observed zero remains distinct from absence');
        await page.screenshot({path:path.join(output,'observer-'+viewport.width+'.png'),fullPage:true});
        assert.deepEqual(errors,[]);
        report.views.push({...viewport,lazyReads:2,heatmapAreas:areas,knownRadarAxes:3,missingRadarAxes:6,
          missingFlowsLeftBlank:true,observedFlowCount:widths.length,updatedClickDay:clicked.row.poolDay,
          apiReads:await page.evaluate(()=>intelligenceHarness.reads.filter(row=>row.method==='GET').length),
          netObservationsSeparate:true,historyIntakePreserved:true,ledgerCostPressurePreserved:true,
          observationUnknownPreserved:true,observationZeroPreserved:true,delegatedAlertNotDelivered:true,
          feedbackReferenceOnly:true,feedbackApprovalRoute:'shortline-versions',overflow,errors});
      }catch(error){
        fs.writeFileSync(path.join(output,'failure-'+viewport.width+'.txt'),String(error.stack)+'\n'+await page.locator('body').innerText());
        await page.screenshot({path:path.join(output,'failure-'+viewport.width+'.png'),fullPage:true});throw error;
      }finally{await context.close();}
    }
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
    try{
      phase='missing-flows';await page.goto(origin+'/m?role=view',{waitUntil:'networkidle'});
      await page.locator('#fy-intelligence-center > summary').click();await page.locator('.fy-market-map svg').waitFor();
      const reads=await page.evaluate(()=>intelligenceHarness.reads);
      assert.equal(reads.filter(r=>r.url.startsWith('/api/decision-center/research')).length,0,'viewer presentation does not request the private archive');
      assert.match(await page.locator('.fy-intelligence-research').innerText(),/原编辑身份权限/);
      report.viewerPrivateReads=0;
    }finally{await context.close();}
    assert.deepEqual(writes,[]);report.passed=true;report.unexpectedWrites=0;report.fixtureFeedbackSubmissions=validationSubmissions.length;report.projectionChecks=projectionChecks;
    fs.writeFileSync(path.join(output,'intelligence-browser-report.json'),JSON.stringify(report,null,2));
    process.stdout.write(JSON.stringify({passed:true,output,views:report.views,viewerPrivateReads:0,unexpectedWrites:0,fixtureFeedbackSubmissions:validationSubmissions.length},null,2)+'\n');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
