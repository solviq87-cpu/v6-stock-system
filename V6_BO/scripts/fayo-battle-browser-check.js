#!/usr/bin/env node
'use strict';
// Actual product modules and DOM, isolated localhost transport only. All prices,
// names, fills and source receipts below are invented contract fixtures. Provider
// field names exercise the existing gates; they are never production evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {chromium}=require('playwright');
const transport=require('./fayo-browser-check');
const {paperDecisionPolicy}=require('../src/core/paper-decision-command');
const output=process.env.FAYO_QA_DIR||process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'fayo-battle-'));
fs.mkdirSync(output,{recursive:true});
const day='2026-11-25',now=Date.parse(day+'T10:30:00+08:00');
const policy=paperDecisionPolicy({name:'隔离验收账户',initial:100000,maxPos:5,sl:-.03,tp:.08,expireDays:4},{atrMultiplier:2,atrStopMaxPct:-10});
const rawPool=Array.from({length:4},(_,i)=>({
 code:String(600101+i),name:'验收芯片'+['甲','乙','丙','丁'][i],sector:'芯片',themes:['隔离验收'],
 price:10+i*2,pct:2+i*.1,score:90-i*2,poolDay:day,
 quoteAt:now-1000,vendorQuoteAt:now-1000,receivedAt:now-500,quoteSource:'tencent',mode:'public-live-unverified',
 explanation:['隔离验收：同日量价条件已满足'],signals:['量价条件'],hit:[{text:'同日量价条件'}],
 entry:[9.9+i*2,10.1+i*2],levels:{stop:9.5+i*2,t1:11+i*2,ma5:9+i*2},
 aboveMa5:true,volume:100000,sealAmount:0,breakCount:0
}));
const bars=Array.from({length:110},(_,i)=>{
 const at=Date.parse(day+'T00:00:00Z')-(109-i)*86400000,base=9+i*.01;
 return {date:new Date(at).toISOString().slice(0,10),open:base,high:base+.25,low:base-.1,close:base+.1,volume:100000+i};
}).filter(row=>![0,6].includes(new Date(row.date+'T12:00:00Z').getUTCDay()));
const archive={revision:0,scope:'live',market:[],marketHistory:[],checks:[],plans:[],trades:[],bars:[],notes:[],checkins:[],versions:[],candidates:[],explanations:[],corrections:[],
 catalog:JSON.parse(fs.readFileSync(path.resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8')),
 permissions:{canWrite:true,replica:false,role:'edit'}};
const account=()=>({name:'隔离验收 A 盘',positions:[],trades:[],tradesShown:0,tradesTotal:0,audit:{ok:true},capital:100000,equity:100000,cash:100000,initial:100000,totalPnl:0,totalPct:0,enabled:true,policy,
 realizedSeries:[{day:'2026-11-24',value:0},{day,value:0}]});
function state(mode='valid',role='edit'){
 const base=transport.state();
 let pool=rawPool.map(row=>structuredClone(row));
 if(mode==='none'||mode==='projection')pool=[];
 if(mode==='stale')pool=pool.map(row=>({...row,quoteAt:now-3600000,vendorQuoteAt:now-3600000}));
 if(mode==='readonly')pool=pool.map(row=>({...row,canTrade:false}));
 const distribution={kind:'market-distribution-intraday',day,source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',quoteAt:now-30000,knownAt:now-10000,
  adv:3500,dec:1400,flat:100,observed:5000,total:5000,upLimit:70,downLimit:20};
 if(mode==='defensive')Object.assign(distribution,{adv:1000,dec:3900,flat:100,upLimit:10,downLimit:50});
 const projection=rawPool.map(row=>({...row,canTrade:false,verifiedLive:false}));
 return {...base,role,now,trading:true,ready:true,isSnapshot:false,snapshotRetained:false,marketFrozen:false,closeSession:null,
  marketClock:{day,trading:true,openDay:true},snapshotDay:day,snapshotFieldDays:{candidatePool:day,dashboard:day,sectors:day,ztPool:day},
  dashboard:{...base.dashboard,observedAt:now,source:'隔离验收传输',snapshotDay:day,snapshotRetained:false,isSnapshot:false,trading:true,rows:projection,verifiedLive:false,
   mood:{upRatio:70,label:'隔离盘中条件',scope:{snapAt:now-1000,sample:5000},upN:3500,downN:1400,flatN:100}},
  pool,poolDay:day,poolSize:pool.length,stocks:pool,
  marketDistribution:distribution,dabanke:{day,knownAt:now-10000,ecology:[{label:'当日封板',success:80,total:100}]},
  auction:{stage:'盘中',strong:[],validCount:0},yierList:role==='edit'?[rawPool[0],rawPool[0]]:[],yierAsOf:day,
  sectorsDay:day,sectors:[{name:'芯片',mainInflowYuan:20000000,pct:1.1,source:'隔离验收资金',tradeDate:day}],
  ztPool:[],ztPre:[],ztDay:day,ztBySector:[],ztReviewPool:[],ztReviewPoolMeta:null,review:null,nextplan:null,
  goodNews:{items:[]},badNews:{items:[]},news:{items:[]},signals:[],mainline:{items:[]},feishuSecReady:false,
  paper:role==='edit'?{pool:account(),pre:{...account(),name:'隔离验收 B 盘'}}:{hidden:true}};
}
function kline(url,marker=''){
 const code=url.searchParams.get('code'),end=url.searchParams.get('end'),n=Number(url.searchParams.get('n')||120);
 if(url.searchParams.get('period')==='minute')return {code,day,status:'observed',offlineTheme:'隔离分时 '+code,
  minuteBars:['09:31','09:32'].map((minute,i)=>({code,role:'stock',date:day+' '+minute,close:10+i*.1,knownAt:now-1000,source:'隔离分钟样本',period:'1m'}))};
 return {ok:true,code,rows:bars.filter(row=>!end||row.date<end).slice(-n),asOf:day,source:'隔离日 K 样本',offlineTheme:marker||'隔离日 K '+code,
  dataQuality:{tradeDate:day,source:'隔离日 K 样本',receivedAt:now-500,freshness:'observed'}};
}
async function installFixture(page,origin,role='edit'){
 const control={mode:'valid',role,requests:[],external:[],errors:[],holdA:false,heldA:null,auctionFailures:0,miniFailures:0,
  receipt:{ok:false,status:'blocked',filled:false,error:'隔离门禁拒绝：价格区间未满足'}};
 page.on('pageerror',error=>control.errors.push(error.message));
 await page.clock.setFixedTime(new Date(now));
 await page.addInitScript(role=>{localStorage.setItem('qd_device','fayo-synthetic-session');localStorage.setItem('qd_role',role);},role);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){control.external.push(request.url());await route.abort();return;}
  if(!url.pathname.startsWith('/api/')){await route.continue();return;}
  const entry={path:url.pathname,query:Object.fromEntries(url.searchParams),method:request.method(),body:request.postDataJSON()};
  control.requests.push(entry);
  const send=body=>route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(body)});
  const unavailable=()=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'隔离验收：一次临时服务不可用'})});
  const p=url.pathname;
  if(p==='/api/lock/status')return send({ok:true,role,hasPassword:true,hasViewPassword:true,pushRole:'replica',appVer:'battle-20261125-1'});
  if(p==='/api/state'||p==='/api/mobile-digest')return send(state(control.mode,role));
  if(p==='/api/auction-resonance'){
   if(control.auctionFailures>0){control.auctionFailures--;return unavailable();}
   return send({ok:true,items:[rawPool[0],rawPool[1],rawPool[0]],snapshotDay:day,isSnapshot:false,snapshotRetained:false});
  }
  if(p==='/api/kline'){
   if(control.miniFailures>0&&url.searchParams.get('code')===rawPool[0].code&&url.searchParams.get('n')==='40'){
    control.miniFailures--;return unavailable();
   }
   if(control.holdA&&url.searchParams.get('code')===rawPool[0].code&&url.searchParams.get('n')==='240'){
    control.holdA=false;
    await new Promise(resolve=>{control.heldA=async()=>{try{await send(kline(url,'late-A-must-not-paint'));}catch{}resolve();};});return;
   }
   return send(kline(url));
  }
  if(p==='/api/analyze')return send({ok:true,...rawPool.find(row=>row.code===url.searchParams.get('code'))});
  if(p==='/api/paper')return send(request.method()==='POST'?control.receipt:{ok:true,paper:{pool:account(),pre:{...account(),name:'隔离验收 B 盘'}}});
  if(p==='/api/research/shortline')return send({ok:true,state:archive,result:{code:entry.body?.payload?.code,day,missing:['隔离样本无交易记录']}});
  if(p==='/api/research/stock-observations')return send({ok:true,result:{records:[],items:[]}});
  if(p==='/api/reference-indexes')return send({ok:true,source:'隔离指数',asOf:new Date(now).toISOString(),items:{}});
  if(p==='/api/fast-stock-moves')return send({schemaVersion:1,servedAt:now,trading:true,isSnapshot:false,fastStockMoves:{tradeDate:day,checkedAt:now,items:[]}});
  return route.continue();
 });
 return control;
}
const paperPosts=control=>control.requests.filter(r=>r.path==='/api/paper'&&r.method==='POST');
async function openRoute(page,view,sub){
 await page.evaluate(({view,sub})=>{location.hash='#/'+view+(sub?'/'+sub:'');},{view,sub});
 await page.waitForFunction(({view,sub})=>location.hash==='#/'+view+(sub?'/'+sub:''),{view,sub});
}
async function waitCards(page){await page.waitForFunction(()=>document.querySelectorAll('.fy-battle-card').length===3,{},{timeout:5000});}
async function waitIdentity(locator,code){await locator.waitFor({state:'visible'});assert.equal(await locator.getAttribute('data-code'),code);assert.equal(await locator.getAttribute('data-day'),day);}
async function waitHome(page){await page.locator('[data-battle-home]').waitFor({state:'visible'});await waitCards(page);}
async function screenshot(page,name){await page.screenshot({path:path.join(output,name),fullPage:false});}
async function geometry(page,width){
 const result=await page.evaluate(()=>{
  const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
  const dockNode=document.querySelector('.fy-dock'),dockRect=dockNode?.getBoundingClientRect();
  const dock=dockRect&&dockRect.width>0&&dockRect.height>0?{top:dockRect.top,bottom:dockRect.bottom,height:dockRect.height}:null;
  return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,dock,firstScreenBottom:dock?Math.min(innerHeight,dock.top):innerHeight,
   weather:rect('.fy-battle-weather'),firstCard:rect('.fy-battle-card'),plan:rect('.fy-battle-plan'),actions:rect('.fy-battle-card .fy-battle-actions'),checklist:rect('.fy-battle-checklist'),checklistSummary:rect('.fy-battle-checklist summary')};
 });
 assert.ok(result.scrollWidth<=width+1,'battle board must not introduce page-level horizontal overflow: '+JSON.stringify(result));
 assert.ok(result.weather.top>=0&&result.weather.bottom<result.height,'weather is in first screen');
 assert.ok(result.plan.bottom<result.height-50,'one complete buy/sell plan is visible above the mobile dock: '+JSON.stringify(result));
  assert.ok(result.plan.top>=0&&result.plan.bottom<=result.firstScreenBottom,'the complete plan fits above the actual dock boundary: '+JSON.stringify(result));
  assert.ok(result.checklistSummary.top>=0&&result.checklistSummary.bottom<=result.firstScreenBottom,'execution checklist summary is visible in the first screen: '+JSON.stringify(result));
  assert.ok(result.actions.top>=0&&result.actions.bottom<=result.firstScreenBottom,'card actions are fully visible above the actual dock: '+JSON.stringify(result));
 return result;
}
async function runViewport(browser,origin,width){
 const context=await browser.newContext({viewport:{width,height:width<600?844:900},deviceScaleFactor:1,isMobile:width<600,hasTouch:width<600,serviceWorkers:'block'});
 const page=await context.newPage(),control=await installFixture(page,origin);page.setDefaultTimeout(10000);
 const report={width,route:width<600?'/m':'/',synthetic:true};
 try{
  const started=performance.now();await page.goto(origin+report.route,{waitUntil:'domcontentloaded'});await waitCards(page);
  report.firstCandidatesMs=Math.round(performance.now()-started);assert.ok(report.firstCandidatesMs<=5000,'first candidates within five seconds');
  await page.waitForFunction(()=>document.querySelector('.fy-battle-card .fy-battle-tags')?.textContent.includes('3 策略共振'));
  assert.deepEqual(await page.locator('.fy-battle-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.code)),['600101','600102','600103']);
  assert.deepEqual(await page.locator('.fy-battle-card .fy-battle-tags b').allTextContents(),['3 策略共振','2 策略共振','1 策略共振']);
  assert.equal(await page.locator('.fy-battle-weather strong').textContent(),'可做多');
  assert.equal(await page.locator('.fy-battle-card').count(),3);
  await page.waitForFunction(()=>document.querySelectorAll('.fy-battle-mini svg').length===3);
  report.geometry=await geometry(page,width);await screenshot(page,'fayo-battle-'+width+'.png');
  assert.equal(await page.locator('#fy-battle-checklist').evaluate(node=>node.open),width>760,'phone starts with a compact checklist; desktop starts expanded');
  assert.equal(await page.locator('#fy-battle-checklist ol li').count(),3,'full execution details are retained');
  await page.locator('#fy-battle-checklist').evaluate(node=>{node.open=true;});
  assert.match(await page.locator('#fy-battle-checklist ol').innerText(),/核对买入区间、止损和目标/);
  assert.match(await page.locator('#fy-battle-checklist ol').innerText(),/对照事前计划与成交流水/);
  assert.match(await page.locator('[data-private-reminder]').innerText(),/未配置/);
  for(const text of ['买入区间','止损参考','目标价','建议仓位'])assert.match(await page.locator('.fy-battle-card').first().innerText(),new RegExp(text));
  assert.match(await page.locator('.fy-battle-card').first().innerText(),/19\.6%/);

  // A late history response must never replace a newer B selection, including
  // shared detail, sector/date and the prefilled paper account identity.
  await page.locator('#fy-battle-evidence').evaluate(node=>{node.open=true;});
  control.holdA=true;
  await page.locator('.fy-battle-card[data-code="600101"] .fy-battle-open').click();
  await waitIdentity(page.locator('.fy-stock-conclusion'),'600101');
  await page.waitForFunction(()=>document.querySelector('.fy-stock-drawer:not([hidden])')?.textContent.includes('600101'));
  const deadline=performance.now()+5000;while(!control.heldA&&performance.now()<deadline)await page.waitForTimeout(20);
  assert.ok(control.heldA,'A history request is held for the asynchronous race');
  await page.getByRole('button',{name:'关闭股票研究面板',exact:true}).click();
  await page.locator('.fy-battle-card[data-code="600102"] .fy-battle-open').click();
  await waitIdentity(page.locator('.fy-stock-conclusion'),'600102');
  await page.waitForFunction(()=>document.querySelector('.fy-drawer-summary')?.textContent.includes('隔离日 K 600102'));
  await control.heldA();control.heldA=null;await page.waitForTimeout(80);
  assert.match(await page.locator('.fy-drawer-title').textContent(),/600102/);
  assert.doesNotMatch(await page.locator('.fy-stock-drawer').innerText(),/late-A-must-not-paint/);
  await page.keyboard.press('Escape');await page.locator('.fy-stock-drawer').waitFor({state:'hidden'});
  await waitIdentity(page.locator('[data-linked-sector]'),'600102');
  assert.equal(await page.locator('#fy-battle-evidence').evaluate(node=>node.open),true);

  // The route memory stores the viewport and disclosure state before leaving.
  await page.evaluate(()=>scrollTo(0,160));
  const beforeScroll=await page.evaluate(()=>scrollY);
  await page.locator('[data-linked-sector] button').evaluate(node=>node.click());
  await page.waitForFunction(()=>location.hash==='#/pulse/sectors');
  await waitIdentity(page.locator('[data-linked-sector]'),'600102');
  await openRoute(page,'pulse','overview');await waitHome(page);
  await page.waitForFunction(y=>Math.abs(scrollY-y)<=2,beforeScroll);
  assert.equal(await page.locator('#fy-battle-evidence').evaluate(node=>node.open),true,'return preserves expanded evidence');
  assert.equal(await page.locator('#fy-battle-checklist').evaluate(node=>node.open),true,'return preserves expanded execution checklist');
  await waitIdentity(page.locator('[data-linked-sector]'),'600102');

  const prefill=page.locator('.fy-battle-card[data-code="600102"]').getByRole('button',{name:'加入模拟盘',exact:true});
  await prefill.click();await page.waitForFunction(()=>location.hash==='#/assets/paper');
  const draft=page.locator('[data-paper-decision]');await waitIdentity(draft,'600102');
  assert.equal(await draft.getByLabel('模拟买入区间下限').inputValue(),'11.9');
  assert.equal(await draft.getByLabel('模拟买入区间上限').inputValue(),'12.1');
  assert.match(await draft.getByLabel('模拟账户仓位规则').inputValue(),/19\.60?%/);
  assert.match(await draft.getByLabel('模拟账户止损规则').inputValue(),/3\.00%|3%/);
  assert.equal(await draft.getByLabel('模拟账户仓位规则').getAttribute('readonly'),'');
  assert.match(await draft.innerText(),/不会自动挂单等待/);
  assert.equal(paperPosts(control).length,0,'selection and prefill never submit an order');
  await page.locator('[data-execution-score="pool"]').waitFor({state:'visible'});
  assert.match(await page.locator('[data-execution-score="pool"] [data-score-value]').innerText(),/暂无法评分/);
  assert.ok(await page.locator('[data-execution-score="pool"]').evaluate(node=>node.parentElement.querySelector('svg')),'execution score and realized curve share the account card');
  await screenshot(page,'fayo-battle-paper-'+width+'.png');
  const submit=draft.getByRole('button',{name:'确认条件并加入模拟盘',exact:true});
  await submit.click();await page.waitForFunction(()=>document.querySelector('[data-paper-decision] [role=status]')?.textContent.includes('隔离门禁拒绝'));
  assert.equal(paperPosts(control).length,1);
  assert.deepEqual(paperPosts(control)[0].body,{action:'submitDecision',account:'pool',code:'600102',day,entryMin:11.9,entryMax:12.1,policy});
  assert.equal(await submit.isEnabled(),true,'a definite rejected order can be revised after review');
  assert.equal(await draft.getByRole('button',{name:'已取得成交回执',exact:true}).count(),0);
  control.receipt={ok:false,status:'receipt-unavailable',filled:null,error:'隔离验收：成交回执暂时不可用'};
  await submit.click();await draft.getByRole('button',{name:'核对账户回执',exact:true}).waitFor({state:'visible'});
  assert.equal(await submit.isEnabled(),false,'an unknown receipt cannot invite duplicate submission');
  assert.equal(paperPosts(control).length,2);
  await draft.getByRole('button',{name:'核对账户回执',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-paper-decision] button.primary')?.disabled);
  control.receipt={ok:true,status:'filled',filled:false};
  await submit.click();await draft.getByRole('button',{name:'核对账户回执',exact:true}).waitFor({state:'visible'});
  assert.equal(await submit.isEnabled(),false,'contradictory status cannot be called a fill');
  assert.equal(await draft.getByRole('button',{name:'已取得成交回执',exact:true}).count(),0);
  assert.equal(paperPosts(control).length,3);

  await draft.getByRole('button',{name:'返回今日作战台',exact:true}).click();await waitHome(page);
  assert.equal(await page.locator('#fy-battle-checklist').evaluate(node=>node.open),true,'return from paper preserves the checklist disclosure');
  await page.locator('[data-stock-command] input').fill('精选评分前3的芯片股');
  await page.locator('[data-stock-command]').getByRole('button',{name:'选股',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-stock-command-results]')?.textContent.includes('600101'));
  assert.match(await page.locator('[data-stock-command-results]').innerText(),/原精选评分 90\.0 · 题材 芯片/);
  assert.match(await page.locator('[data-private-reminder]').innerText(),/未配置/);
  for(const mode of ['none','projection','stale','readonly','defensive']){
   control.mode=mode;
   await Promise.all([page.waitForResponse(response=>['/api/state','/api/mobile-digest'].includes(new URL(response.url()).pathname)),page.getByRole('button',{name:'刷新云端数据',exact:true}).click()]);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.locator('.fy-battle-empty').waitFor({state:'visible'});
   assert.equal(await page.locator('.fy-battle-card').count(),0,mode+' must not fabricate a buy candidate');
   assert.match(await page.locator('.fy-battle-empty').innerText(),/今天空仓，等待信号/);
   if(mode==='defensive')assert.equal(await page.locator('.fy-battle-weather strong').textContent(),'空仓');
  }
  control.mode='none';
  const emptyStarted=performance.now();await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('.fy-battle-empty strong')?.textContent==='今天空仓，等待信号',{},{timeout:5000});
  report.firstEmptyMs=Math.round(performance.now()-emptyStarted);assert.ok(report.firstEmptyMs<=5000,'a fresh empty session reports no signal within five seconds');
  assert.equal(await page.locator('.fy-battle-card').count(),0);
  await page.evaluate(()=>scrollTo(0,0));await screenshot(page,'fayo-battle-empty-'+width+'.png');
  assert.equal(control.requests.filter(r=>r.method==='POST'&&/push|notify|feishu|config/.test(r.path)).length,0,'an unconfigured reminder sends nothing');
  assert.deepEqual(control.external,[],'all browser traffic stays on isolated localhost');
  assert.deepEqual(control.errors,[],'no uncaught product JS errors');
  report.paperPosts=paperPosts(control).length;report.checks=['first-screen-candidates-and-empty','first-screen-plan-checklist-actions-above-dock','full-checklist-preserved','max-three','resonance','mini-kline','three-way-code-day','late-chart-race','restore-scroll-evidence-checklist-disclosures','prefill-without-post','original-policy','rejected-unknown-contradictory-receipts','execution-score-and-curve','stock-command','empty-projection-stale-readonly-defensive','unconfigured-no-send'];
  return report;
 }catch(error){await screenshot(page,'fayo-battle-failure-'+width+'.png').catch(()=>{});fs.writeFileSync(path.join(output,'fayo-battle-failure-'+width+'.json'),JSON.stringify({error:error.stack,requests:control.requests,errors:control.errors},null,2));throw error;}
 finally{await control.heldA?.();await context.close();}
}
async function checkViewer(browser,origin){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),control=await installFixture(page,origin,'view');
 try{await page.goto(origin+'/m',{waitUntil:'domcontentloaded'});await waitCards(page);
  await page.waitForFunction(()=>document.querySelector('.fy-battle-card .fy-battle-tags')?.textContent.includes('2 策略共振'));
  assert.equal(await page.locator('[data-battle-home]').getByRole('button',{name:'加入模拟盘',exact:true}).count(),0);
  assert.equal(control.requests.filter(r=>r.path==='/api/paper'||r.path==='/api/research/shortline').length,0,'viewer does not read private paper/plan evidence');
  assert.match(await page.locator('[data-private-reminder]').innerText(),/需要编辑者权限/);
  assert.deepEqual(control.errors,[]);return {role:'view',privateReads:0,orderButtons:0};
 }finally{await context.close();}
}
async function checkManualRecovery(browser,origin){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),control=await installFixture(page,origin);
 control.auctionFailures=1;control.miniFailures=1;
 const auctionCount=()=>control.requests.filter(r=>r.path==='/api/auction-resonance').length;
 const miniCount=code=>control.requests.filter(r=>r.path==='/api/kline'&&r.query.code===code&&r.query.n==='40').length;
 try{
  await page.goto(origin+'/m',{waitUntil:'domcontentloaded'});await waitCards(page);
  await page.waitForFunction(()=>document.querySelector('#fy-battle-evidence')?.textContent.includes('竞价共振暂未读回'));
  await page.waitForFunction(()=>document.querySelector('.fy-battle-card[data-code="600101"] .fy-battle-mini')?.textContent.includes('暂无可核验日 K'));
  assert.match(await page.locator('.fy-battle-card[data-code="600101"] .fy-battle-tags').textContent(),/2 策略共振/,'unavailable auction evidence does not invent a vote');
  assert.equal(auctionCount(),1);assert.equal(miniCount('600101'),1);
  await page.locator('.fy-battle-heading').getByRole('button',{name:'刷新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.fy-battle-card[data-code="600101"] .fy-battle-tags')?.textContent.includes('3 策略共振')&&document.querySelectorAll('.fy-battle-mini svg').length===3);
  assert.equal(auctionCount(),2,'manual refresh retries the failed auction source exactly once');
  assert.equal(miniCount('600101'),2,'manual refresh retries the failed chart');
  assert.equal(miniCount('600102'),1,'successfully cached charts are retained');
  assert.equal(miniCount('600103'),1,'successfully cached charts are retained');
  assert.doesNotMatch(await page.locator('#fy-battle-evidence').textContent(),/竞价共振暂未读回/);
  assert.equal(paperPosts(control).length,0,'data recovery cannot submit an order');
  assert.deepEqual(control.errors,[]);assert.deepEqual(control.external,[]);
  return {initialStatus:503,auctionRequests:auctionCount(),failedChartRequests:miniCount('600101'),successfulChartRequests:miniCount('600102'),paperPosts:0};
 }finally{await context.close();}
}
async function main(){
 transport.role='edit';await new Promise(resolve=>transport.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+transport.server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const report={scope:'isolated synthetic transport; no production data, account writes or messages',day,origin,browserVersion:browser.version(),driverVersion:require('playwright/package.json').version,viewports:[]};
 try{
  const widths=(process.env.FAYO_BATTLE_WIDTHS||'320,390,1366').split(',').map(Number).filter(Number.isFinite);
  for(const width of widths){report.viewports.push(await runViewport(browser,origin,width));console.log('BATTLE_VIEWPORT_OK '+width);}
  report.viewer=await checkViewer(browser,origin);report.manualRecovery=await checkManualRecovery(browser,origin);report.passed=true;
  fs.writeFileSync(path.join(output,'fayo-battle-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,output,viewports:report.viewports.map(r=>({width:r.width,firstCandidatesMs:r.firstCandidatesMs,firstEmptyMs:r.firstEmptyMs})),viewer:report.viewer}));
 }finally{await browser.close();await new Promise(resolve=>transport.server.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);transport.server.close();process.exitCode=1;});
